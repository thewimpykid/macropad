/**
 * Fetch + mapping layer for the y3os /greeks feed
 * (https://feed.y3os.com/greeks?symbol=...&key=...), which replaced the old
 * railway vendor entirely. Unlike that vendor, y3os ships real per-strike
 * gex/dex/vex/chex(charm)/tex(theta)/vegaEx/rex already computed server-side
 * (dense, $1-5-wide strikes, not the sparse every-$5-with-gaps 0DTE chain we
 * were getting before) plus real per-contract r/q/T/iv/oi in `ladderInputs` -
 * so this app no longer needs to self-compute Black-Scholes gamma/dex/vanna/
 * charm/theta/vega for the headline numbers; it only still uses this app's
 * own pricer for the Effective GEX/Shadow Gamma scenario reprice, which
 * needs a full contract-level chain to reprice at a hypothetical spot.
 *
 * Gaps versus the old vendor, and how they're handled (not silently):
 * - No spot/quote field anywhere in the payload - derived from `rnd.forward`
 *   via the standard cost-of-carry inversion (spot = forward * e^-(r-q)T)
 *   using the front expiry's own real r/q/T. For a 0DTE (T on the order of
 *   hours), that inversion is accurate to a few cents on SPX - not a guess.
 * - No historical daily-return series (old /probability) - left as an
 *   explicit "unavailable" stub (nDays: 0), not fabricated.
 * - No dealer buy/sell Z-score anomaly detector (old /dealer_anomalies) -
 *   left null, same as the old code's existing failure path.
 * - No 5/15/30m volume candles (old /chart) - left null.
 * - Expected move / P-C ratio / charm-vanna direction (old /zero_dte's own
 *   fields) - rebuilt from data this feed does provide: expected move from
 *   spot * ATM IV * sqrt(T) (the standard formula, not this app's guess),
 *   P/C ratio from summed real OI, charm direction from `dealer.drift`
 *   (which is literally labeled "$/hr of dealer delta-rebalance from charm
 *   decay"), vanna direction from the `shadow` vol-regime block.
 */

import type { ChainStrikeInput, CrossExpiryRow, StrikeRow0DTE, ZeroDteContext, GexSymbol } from "@/lib/gex";
import type { HeatmapMetric, StrikeExpiryHeatmap } from "@/lib/strikeExpiryHeatmaps";

export interface Y3LadderInput {
  K: number;
  iv: number;
  T: number;
  oi: number;
  mult: number;
  sign: number;
  r: number;
  q: number;
  isCall: boolean;
}

export interface Y3PerStrikeExposure {
  strike: number;
  gex: number;
  callGex: number;
  putGex: number;
  dex: number;
  vex: number;
  chex: number;
  callChex: number;
  putChex: number;
  vegaEx: number;
  tex: number;
  rex: number;
  callOi: number;
  putOi: number;
  iv: number;
}

export interface Y3TermContextRow {
  exp: string;
  dte: number;
  netGex: number;
  regime: string;
  flip: number | null;
  callWall: number;
  putWall: number;
  nStrikes: number;
  oi: number;
}

export interface Y3GreeksRaw {
  ok: boolean;
  symbol: string;
  asOf: string;
  exposure: {
    perStrike: Y3PerStrikeExposure[];
    perExpiry: { exp: string; dte: number; T: number; netGex: number }[];
    ladderInputs: Y3LadderInput[];
    totalGex: number;
  };
  aggregate?: { callWall: number; putWall: number; flip?: { nearestFlip: number | null } };
  structure?: { regime: string; kingNode: { strike: number; gex: number; type: string } };
  quality?: { atmIv?: number };
  dealer?: {
    drift?: {
      netPerHourUsd: number;
      direction: string;
      bias: string;
      maxPain?: { strike: number };
    };
  };
  shadow?: { regime: string; book: { ratioUp: number; ratioDown: number } };
  selection?: { book: string; exp: string };
  termContext?: Y3TermContextRow[];
  code?: string;
}

async function fetchY3os(symbol: GexSymbol, base: string, key: string, exp?: string): Promise<{ ok: boolean; data: Y3GreeksRaw | null }> {
  const url = `${base}/greeks?symbol=${symbol}&key=${key}${exp ? `&exp=${exp}` : ""}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as Y3GreeksRaw | null;
    if (!res.ok || !data?.ok) return { ok: false, data: null };
    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  }
}

/** spot = forward * e^-(r-q)T, using the front expiry's own real rate/yield/time - not this app's DIVIDEND_YIELD guess. */
function deriveSpot(forward: number, r: number, q: number, T: number): number {
  return forward * Math.exp(-(r - q) * T);
}

function mapPerStrike(rows: Y3PerStrikeExposure[]): StrikeRow0DTE[] {
  return rows
    .map((row) => ({
      strike: row.strike,
      gex: row.gex,
      callGex: row.callGex,
      putGex: row.putGex,
      dex: row.dex,
      vex: row.vex,
      tex: row.tex,
      cex: row.chex,
      vegaex: row.vegaEx,
      callOi: row.callOi,
      putOi: row.putOi,
    }))
    .sort((a, b) => a.strike - b.strike);
}

export interface ColumnBook {
  /** Expiration date (YYYY-MM-DD) - the stable identity of a column. dte/label are derived from it against the CURRENT front book (see rebaseColumns in gexStore.ts): a column fetched yesterday as "2d" must read "1d" today, not keep its fetch-time tenor. */
  exp: string;
  dte: number;
  label: string;
  perStrike: StrikeRow0DTE[];
}

export interface Y3Core {
  spot: number;
  forward: number;
  r: number;
  q: number;
  T: number;
  dteHours: number;
  /** The feed's OWN timestamp for this book (ms), not our fetch time. A 200 OK carrying a stale `asOf` is the one freshness failure the fetch-succeeded path can't otherwise see - threaded through so the response `asOf` reflects the data, not the render. Null if the feed omitted it. */
  upstreamAsOf: number | null;
  resolvedExpiry: string;
  atmIv: number;
  chain: ChainStrikeInput[];
  perStrike: StrikeRow0DTE[];
  maxPain: number;
  crossExpiry: CrossExpiryRow[];
  zeroDte: ZeroDteContext;
  /** Upcoming expiries from this same fetch's termContext, candidates for backfilling extra Chart/Heatmap/Topo columns one at a time - see gexStore.ts. */
  upcoming: { exp: string; dte: number }[];
}

/**
 * Fetches ONLY the front (0DTE) book - one y3os request. Chart/Heatmap/Topo
 * columns beyond this one are backfilled separately, one per background
 * refresh step (see gexStore.ts) - y3os hard rate-limits to 1 request per
 * 10s PER SYMBOL (confirmed directly: firing several of these back-to-back
 * 429s immediately), so this module no longer tries to fetch them all in
 * one call.
 */
export async function fetchY3osFront(symbol: GexSymbol, base: string, key: string): Promise<Y3Core | null> {
  const frontResult = await fetchY3os(symbol, base, key);
  if (!frontResult.ok || !frontResult.data) return null;
  const front = frontResult.data;
  if (!front.exposure?.ladderInputs?.length || !front.exposure.perStrike?.length) return null;

  const first = front.exposure.ladderInputs[0];
  const r = first.r;
  const q = first.q;
  const T = Math.max(first.T, 0.05 / 24 / 365);
  // rnd.forward isn't typed above (large/optional payload) - pull it defensively.
  const rndForward = (front as unknown as { rnd?: { forward?: number } }).rnd?.forward;
  const spot = rndForward ? deriveSpot(rndForward, r, q, T) : NaN;
  if (!Number.isFinite(spot) || spot <= 0) return null;

  const chain: ChainStrikeInput[] = front.exposure.ladderInputs.map((row) => ({
    strike: row.K,
    side: row.isCall ? "call" : "put",
    oi: row.oi ?? 0,
    iv: row.iv ?? 0,
  }));

  const perStrike = mapPerStrike(front.exposure.perStrike);
  const upstreamMs = front.asOf ? Date.parse(front.asOf) : NaN;
  const upstreamAsOf = Number.isFinite(upstreamMs) ? upstreamMs : null;
  const dteHours = T * 365 * 24;
  const resolvedExpiry = front.selection?.exp ?? front.exposure.perExpiry?.[0]?.exp ?? "";
  const atmIv = front.quality?.atmIv ?? 0.2;

  const totalCallOi = perStrike.reduce((s, r2) => s + r2.callOi, 0);
  const totalPutOi = perStrike.reduce((s, r2) => s + r2.putOi, 0);
  const pcRatio = totalCallOi > 0 ? totalPutOi / totalCallOi : 0;
  const pcSentiment = pcRatio > 1.2 ? "put-heavy (bearish OI skew)" : pcRatio > 0 && pcRatio < 0.8 ? "call-heavy (bullish OI skew)" : "balanced";
  const expectedMove1s = spot * atmIv * Math.sqrt(T);

  const drift = front.dealer?.drift;
  const shadow = front.shadow;
  const zeroDte: ZeroDteContext = {
    expectedMove1s,
    expectedMove2s: expectedMove1s * 2,
    pcRatio,
    pcSentiment,
    charmDirection: drift?.direction ?? "",
    vannaDirection: shadow?.regime ? `${shadow.regime} vol regime` : "",
    charmNote: drift ? `${drift.bias} dealer delta-rebalance drift, ~$${Math.round(drift.netPerHourUsd).toLocaleString()}/hr from charm decay` : "",
    vannaNote: shadow ? `shadow gamma ratio up ${shadow.book.ratioUp.toFixed(2)}x, down ${shadow.book.ratioDown.toFixed(2)}x vs static` : "",
  };

  const maxPain = drift?.maxPain?.strike ?? 0;

  const crossExpiry: CrossExpiryRow[] = (front.termContext ?? []).map((row) => ({
    expiration: row.exp,
    dte: row.dte,
    netGex: row.netGex,
    callResistance: row.callWall ?? null,
    putSupport: row.putWall ?? null,
    totalOi: row.oi,
    totalVol: 0,
    callDex: 0,
    putDex: 0,
    netDex: 0,
  }));

  // Grid columns: 0DTE (this same front book) plus the next 5 expiries.
  // gexStore.ts fills these in one at a time, round-robin, on live traffic.
  const upcoming = (front.termContext ?? [])
    .filter((row) => row.dte > 0)
    .slice(0, 5)
    .map((row) => ({ exp: row.exp, dte: row.dte }));

  return { spot, forward: rndForward ?? spot, r, q, T, dteHours, upstreamAsOf, resolvedExpiry, atmIv, chain, perStrike, maxPain, crossExpiry, zeroDte, upcoming };
}

/** Fetches one extra expiry's per-strike book for the Chart/Heatmap/Topo columns - one y3os request. Caller is responsible for the 10s-per-symbol rate-limit spacing (see gexStore.ts). */
export async function fetchY3osExtraColumn(symbol: GexSymbol, base: string, key: string, exp: string, dte: number): Promise<ColumnBook | null> {
  const res = await fetchY3os(symbol, base, key, exp);
  if (!res.ok || !res.data?.exposure?.perStrike?.length) return null;
  return { exp, dte, label: `${exp.slice(5)} - ${dte}d`, perStrike: mapPerStrike(res.data.exposure.perStrike) };
}

/** Builds the Chart/Heatmap/Topo strike x expiry grids from whatever column books are on hand (front 0DTE plus however many extras have been backfilled so far) - real per-strike values, null where a given strike isn't listed in that column. */
export function buildY3osHeatmapGrids(columns: ColumnBook[]): Record<HeatmapMetric, StrikeExpiryHeatmap> {
  const sortedColumns = [...columns].sort((a, b) => a.dte - b.dte);

  const strikeSet = new Set<number>();
  for (const col of sortedColumns) for (const row of col.perStrike) strikeSet.add(row.strike);
  const strikes = [...strikeSet].sort((a, b) => a - b);

  const metrics: HeatmapMetric[] = ["gex", "dex", "vex", "cex", "tex", "vegaex"];
  const grids = {} as Record<HeatmapMetric, StrikeExpiryHeatmap>;
  for (const metric of metrics) {
    const values = strikes.map((strike) => sortedColumns.map((col) => col.perStrike.find((row) => row.strike === strike)?.[metric] ?? null));
    grids[metric] = { columns: sortedColumns.map((c) => ({ label: c.label, dte: c.dte })), strikes, values };
  }
  return grids;
}
