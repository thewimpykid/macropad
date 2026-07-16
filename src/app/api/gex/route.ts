import { after, NextResponse, type NextRequest } from "next/server";
import type { GexSymbol } from "@/lib/gex";
import { getSnapshot, refreshSnapshotStep } from "@/lib/gexStore";
import { isAuthedCookie, TESS_COOKIE } from "@/lib/tesseractAuth";

// y3os only serves these two live - confirmed directly against the feed
// (SPY/NDX return an explicit SYMBOL_NOT_AVAILABLE, not a silent SPX
// substitution).
const ALLOWED_SYMBOLS = new Set<GexSymbol>(["QQQ", "SPX"]);

export async function GET(request: NextRequest) {
  // This data only exists behind the /tesseract access-code gate - checked
  // here too (not just on the page) so hitting this endpoint directly
  // without the code can't bypass the gate and pull live data.
  if (!isAuthedCookie(request.cookies.get(TESS_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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

  const response = await getSnapshot(symbol, base, key, movePctOverride);
  if (!response) {
    return NextResponse.json({ ok: false, error: "upstream_error" }, { status: 502 });
  }

  // Kick one rate-limit-respecting background refresh step after the
  // response is already on the wire - never adds to this request's latency.
  // No-op (near-instantly) if another concurrent request already claimed it
  // or the y3os rate gate hasn't cleared yet.
  after(() => refreshSnapshotStep(symbol, base, key).catch(() => {}));

  return NextResponse.json(response);
}
