import { after, NextResponse, type NextRequest } from "next/server";
import type { GexSymbol } from "@/lib/gex";
import { getSnapshot, refreshSnapshotStep } from "@/lib/gexStore";
import { fetchYahooPrice } from "@/lib/yahoo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasFounderKey, isSiteRequest } from "@/lib/apiAccess";

// y3os only serves these two live - confirmed directly against the feed
// (SPY/NDX return an explicit SYMBOL_NOT_AVAILABLE, not a silent SPX
// substitution).
const ALLOWED_SYMBOLS = new Set<GexSymbol>(["QQQ", "SPX"]);

// y3os's own spot (derived from its rnd.forward) only refreshes every
// ~25-35s along with the rest of the snapshot (rate-limited to 1 request
// per 10s per symbol - see gexStore.ts). Yahoo's public chart endpoint has
// no such limit and returns a live tick, so spot is fetched from there on
// EVERY request instead, decoupled entirely from the y3os cache cadence -
// confirmed directly: Yahoo's "^SPX" ticker returns a quote stale by ~15
// minutes, "^GSPC" (the actual S&P 500 index symbol on Yahoo) is live.
const YAHOO_SYMBOL: Record<GexSymbol, string> = { QQQ: "QQQ", SPX: "^GSPC", SPY: "SPY", NDX: "^NDX" };

export async function GET(request: NextRequest) {
  // No more separate Tesseract access code - any signed-in (Discord/guild
  // member) user gets this, same as every other page in /app. Checked here
  // too (not just gating the page) so hitting this endpoint directly
  // without a session can't pull live data either. On top of the session,
  // the fetch must come from the site's own pages (isSiteRequest): the JSON
  // is for the dashboard to render, not for signed-in users to pipe into
  // their own programs. Founders bypass both with the x-api-key header
  // (never shipped to clients). DEV_PREVIEW is the local design-review
  // escape hatch (/dev-preview has no session to send); never set in prod.
  if (process.env.DEV_PREVIEW !== "1" && !hasFounderKey(request)) {
    if (!isSiteRequest(request)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase() as GexSymbol | undefined;
  if (!symbol || !ALLOWED_SYMBOLS.has(symbol)) {
    return NextResponse.json({ ok: false, error: "unsupported_symbol" }, { status: 400 });
  }

  const movePctRaw = request.nextUrl.searchParams.get("movePct");
  const movePctOverride = movePctRaw !== null && Number.isFinite(Number(movePctRaw)) ? Number(movePctRaw) : undefined;

  const base = process.env.Y3OS_API_BASE;
  const key = process.env.Y3OS_API_KEY;
  if (!base || !key) {
    return NextResponse.json({ ok: false, error: "gex_api_not_configured" }, { status: 500 });
  }

  const [response, liveSpot] = await Promise.all([
    getSnapshot(symbol, base, key, movePctOverride),
    fetchYahooPrice(YAHOO_SYMBOL[symbol]).catch(() => ({ price: null, prevClose: null })),
  ]);
  if (!response) {
    return NextResponse.json({ ok: false, error: "upstream_error" }, { status: 502 });
  }

  // Live tick wins when available; the y3os-derived spot is only a
  // fallback (upstream Yahoo hiccup), never the default.
  if (liveSpot.price !== null && Number.isFinite(liveSpot.price)) {
    response.spot = liveSpot.price;
  }

  // Kick one rate-limit-respecting background refresh step after the
  // response is already on the wire - never adds to this request's latency.
  // No-op (near-instantly) if another concurrent request already claimed it
  // or the y3os rate gate hasn't cleared yet.
  after(() => refreshSnapshotStep(symbol, base, key).catch(() => {}));

  return NextResponse.json(response);
}
