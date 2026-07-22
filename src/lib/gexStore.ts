/**
 * Supabase-backed shared cache for the y3os feed, so /api/gex never blocks a
 * request on an upstream fetch (Vercel Hobby serverless functions cap out
 * at ~10s, and a cold multi-column y3os build easily needs 70-90s given its
 * 1-request-per-10s-per-symbol rate limit - see y3osFeed.ts). Every visitor
 * just reads whatever's currently in the `gex_snapshots` table, which is
 * always instant; freshness comes from opportunistic background refresh
 * steps piggybacked on real request traffic (via next/server's `after()`),
 * not a dedicated cron (Hobby cron is far too infrequent for this).
 *
 * Each background step does exactly ONE y3os request - either "refresh the
 * front (0DTE) book" (spot/walls/perStrike/engines/effectiveGex/ivSmile -
 * everything that needs to feel live) or "backfill the next Chart/Heatmap/
 * Topo column" (round-robin through the upcoming expiries) - gated by a
 * `refreshing` lock and a `last_request_at` check so concurrent requests
 * from multiple visitors don't stack refreshes and blow the rate limit.
 * With a page open and polling every ~30s, the front book stays close to
 * live and the extra columns backfill one every ~30s until all are warm;
 * with nobody on the page, the snapshot just goes stale until the next
 * visitor's request triggers a catch-up refresh.
 */

import { supabaseAdmin } from "@/lib/supabaseServer";
import type { GexResponse, GexSymbol } from "@/lib/gex";
import { fetchY3osFront, fetchY3osExtraColumn, type ColumnBook, type Y3Core } from "@/lib/y3osFeed";
import { buildGexResponse } from "@/lib/gexResponseBuilder";

const TABLE = "gex_snapshots";
const RATE_GATE_MS = 10_500; // y3os: 1 request per 10s per symbol
const FRONT_STALE_MS = 25_000; // roughly matches the client's ~30s poll cadence
const STALE_LOCK_MS = 30_000; // longer than any single y3os fetch should ever take - past this, a held lock is abandoned, not active
// Well past FRONT_STALE_MS, so a quiet stretch with no visitors (the front
// book only refreshes on real traffic) doesn't read as broken - but short
// enough that a genuinely dead upstream is called out within one coffee break
// rather than silently serving a previous session's book behind a LIVE dot.
const FEED_DEAD_MS = 10 * 60 * 1000;

interface SnapshotRow {
  symbol: string;
  core: Y3Core | null;
  columns: ColumnBook[] | null;
  data: GexResponse | null;
  front_updated_at: string | null;
  updated_at: string | null;
  last_request_at: string | null;
  next_column_idx: number | null;
  refreshing: boolean | null;
}

async function readRow(symbol: GexSymbol): Promise<SnapshotRow | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("symbol", symbol).maybeSingle();
  if (error || !data) return null;
  return data as SnapshotRow;
}

/**
 * Returns the current live response for `symbol`, instantly if a snapshot
 * already exists. On the very first request ever for a symbol (no row yet),
 * does one synchronous front-book fetch to bootstrap - a single y3os
 * request, comfortably under Hobby's function-duration cap. An explicit
 * movePctOverride (the Chart's own %-move input) always does a fresh
 * synchronous front fetch and is never persisted - it's a personal scenario
 * tweak, not the shared live feed.
 */
export async function getSnapshot(symbol: GexSymbol, base: string, key: string, movePctOverride?: number): Promise<GexResponse | null> {
  if (movePctOverride !== undefined) {
    const row = await readRow(symbol);
    const core = await fetchY3osFront(symbol, base, key);
    // Rate-limited or upstream hiccup - fall back to the last known snapshot
    // rather than erroring, but flag it: the fallback is exactly the case
    // where the caller must not be told this is live.
    if (!core) return row?.data ? { ...row.data, stale: isStaleSnapshot(row) } : null;
    const merged = mergeColumn(rebaseColumns(row?.columns ?? [], core), frontColumn(core));
    const built = buildGexResponse(symbol, core, merged, movePctOverride);
    built.stale = isStaleData(built);
    return built;
  }

  const row = await readRow(symbol);
  if (row?.data) return { ...row.data, stale: isStaleSnapshot(row) };

  // No snapshot yet - bootstrap synchronously (one request, fast).
  const core = await fetchY3osFront(symbol, base, key);
  if (!core) return null;
  const front = frontColumn(core);
  const response = buildGexResponse(symbol, core, [front], undefined);
  const now = new Date().toISOString();
  if (supabaseAdmin) {
    await supabaseAdmin.from(TABLE).upsert(
      { symbol, core, columns: [front], data: response, front_updated_at: now, updated_at: now, last_request_at: now, next_column_idx: 0, refreshing: false },
      { onConflict: "symbol" }
    );
  }
  return response;
}

/** Today's date in market (ET) terms - the 0DTE book's `exp` is an ET trading date, so UTC "today" would flag a live book as expired every evening. */
function marketToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Three independent tells that a cached snapshot is no longer live, any one
 * of which is decisive on its own:
 * - the front book hasn't successfully refreshed in FEED_DEAD_MS (OUR fetch is
 *   failing - note refreshSnapshotStep touches `last_request_at` even when the
 *   fetch returns null, so only `front_updated_at` proves a real write), or
 * - the feed answered us but the book it returned carries a frozen `asOf`
 *   (response.asOf is the upstream's own data timestamp - a 200 OK over a
 *   stale book, the one failure a fetch-succeeded check can't otherwise see), or
 * - the 0DTE expiry it was built on has already passed, which no amount of
 *   clock-watching can excuse.
 */
function isStaleSnapshot(row: SnapshotRow): boolean {
  const frontUpdatedAt = row.front_updated_at ? new Date(row.front_updated_at).getTime() : 0;
  if (Date.now() - frontUpdatedAt > FEED_DEAD_MS) return true;
  return isStaleData(row.data);
}

/**
 * The freshness tells that live purely in the served payload (the feed's own
 * `asOf` frozen, or the 0DTE expiry already past) - the subset of
 * isStaleSnapshot that doesn't need the row's fetch bookkeeping. Used on the
 * fresh-fetch (movePctOverride / bootstrap) paths, where "our fetch failed"
 * can't apply because it just succeeded, but a 200-OK-over-a-stale-book still can.
 */
function isStaleData(data: GexResponse | null): boolean {
  if (!data) return false;
  if (data.asOf && Date.now() - data.asOf > FEED_DEAD_MS) return true;
  return !!data.resolvedExpiry && data.resolvedExpiry < marketToday();
}

function frontColumn(core: Y3Core): ColumnBook {
  return { exp: core.resolvedExpiry, dte: 0, label: `${core.resolvedExpiry.slice(5)} - 0DTE`, perStrike: core.perStrike };
}

/**
 * Re-derives every stored column's dte/label against a FRESH front book.
 * Without this, a column backfilled yesterday as "2d" keeps its fetch-time
 * tenor forever: after the day rolls over it should read "1d", and once its
 * expiry becomes the front 0DTE the stale copy would sit in the grid as a
 * duplicate column of the same expiration with old values. Columns whose
 * expiry has passed (or left the upcoming window) are dropped; pre-`exp`
 * legacy rows are dropped too and simply backfill again.
 */
function rebaseColumns(columns: ColumnBook[], core: Y3Core): ColumnBook[] {
  const dteByExp = new Map(core.upcoming.map((u) => [u.exp, u.dte]));
  return columns.flatMap((c) => {
    if (!c.exp || c.exp === core.resolvedExpiry) return [];
    const dte = dteByExp.get(c.exp);
    if (dte === undefined) return [];
    return [{ ...c, dte, label: `${c.exp.slice(5)} - ${dte}d` }];
  });
}

function mergeColumn(columns: ColumnBook[], next: ColumnBook): ColumnBook[] {
  const withoutExp = columns.filter((c) => c.exp !== next.exp);
  return [...withoutExp, next].sort((a, b) => a.dte - b.dte);
}

/** One rate-limit-respecting background step: refresh the front book if it's gone stale, else backfill the next Chart/Heatmap/Topo column. No-op if another request already claimed the refresh lock or the rate gate hasn't cleared yet. */
export async function refreshSnapshotStep(symbol: GexSymbol, base: string, key: string): Promise<void> {
  if (!supabaseAdmin) return;
  const row = await readRow(symbol);
  if (!row?.core) return; // nothing to refresh yet - getSnapshot's bootstrap owns the first write

  const now = Date.now();
  const lastRequestAt = row.last_request_at ? new Date(row.last_request_at).getTime() : 0;
  // A lock can be left stuck at true forever if the process that claimed it
  // gets killed outright (Vercel function timeout mid-fetch) rather than
  // throwing a catchable JS error - confirmed directly: a snapshot stuck
  // with refreshing=true from a locally-interrupted run never recovered on
  // its own. Treat a lock older than this as abandoned, not active.
  const lockStale = row.refreshing && now - lastRequestAt > STALE_LOCK_MS;
  if (row.refreshing && !lockStale) return;
  if (now - lastRequestAt < RATE_GATE_MS) return;

  // Claim the lock. Normal case: only proceeds if we're the one flipping
  // refreshing false -> true. Stale-recovery case: force it (the value we'd
  // be racing against is already known-abandoned).
  const claimQuery = supabaseAdmin.from(TABLE).update({ refreshing: true, last_request_at: new Date().toISOString() }).eq("symbol", symbol);
  const { data: claimed } = await (lockStale ? claimQuery : claimQuery.eq("refreshing", false)).select("symbol");
  if (!claimed?.length) return;

  // Every exit path below - success, "nothing to do", or a thrown error -
  // MUST release this lock, or the next refresh attempt (for this symbol,
  // from any visitor) silently no-ops forever like the bug above.
  try {
    const frontUpdatedAt = row.front_updated_at ? new Date(row.front_updated_at).getTime() : 0;
    const nowIso = new Date().toISOString();

    if (now - frontUpdatedAt > FRONT_STALE_MS) {
      const core = await fetchY3osFront(symbol, base, key);
      if (!core) return;
      const columns = mergeColumn(rebaseColumns(row.columns ?? [], core), frontColumn(core));
      const response = buildGexResponse(symbol, core, columns, undefined);
      await supabaseAdmin
        .from(TABLE)
        .update({ core, columns, data: response, front_updated_at: nowIso, updated_at: nowIso, last_request_at: nowIso, refreshing: false })
        .eq("symbol", symbol);
      return;
    }

    const upcoming = row.core.upcoming ?? [];
    if (!upcoming.length) return;
    const idx = (row.next_column_idx ?? 0) % upcoming.length;
    const target = upcoming[idx];
    const column = await fetchY3osExtraColumn(symbol, base, key, target.exp, target.dte);
    const nextIdx = (idx + 1) % upcoming.length;
    if (!column) {
      await supabaseAdmin.from(TABLE).update({ next_column_idx: nextIdx, last_request_at: nowIso, refreshing: false }).eq("symbol", symbol);
      return;
    }
    const columns = mergeColumn(row.columns ?? [], column);
    const response = buildGexResponse(symbol, row.core, columns, undefined);
    await supabaseAdmin
      .from(TABLE)
      .update({ columns, data: response, updated_at: nowIso, last_request_at: nowIso, next_column_idx: nextIdx, refreshing: false })
      .eq("symbol", symbol);
  } finally {
    await supabaseAdmin.from(TABLE).update({ refreshing: false }).eq("symbol", symbol).eq("refreshing", true);
  }
}
