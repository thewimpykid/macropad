import { computeWindowedBias, momentumSignal, distanceSignal, type Cadence } from "@/lib/stats";

export type SignalMethod = "positioning" | "momentum" | "anchor" | "threshold";

export interface SignalConfig {
  method: SignalMethod;
  /** momentum: how many trailing periods to compare against the prior equal window. */
  momentumWindow?: number;
  /** anchor/threshold: the reference value the series is judged against. */
  reference?: number;
  /** anchor/threshold: distance from reference that reads as a "full" ±1 signal. */
  band?: number;
  /** One-line, human explanation of why this method fits this indicator - shown in the UI. */
  rationale: string;
}

/**
 * Every indicator's score is computed with the method that fits how it
 * behaves economically, not one generic z-score for everything:
 *
 * - positioning: genuinely mean-reverting / self-referential (COT crowding,
 *   sentiment surveys, ratios with no fixed fair value). Robust median/MAD
 *   z + percentile rank over a ~2y window.
 * - momentum: the level is arbitrary or structurally drifting; the trend is
 *   the signal (balance sheet, claims, yields as a conditions read).
 * - anchor: a real economic reference exists (2% inflation target, NAIRU,
 *   NFCI's defined zero, VIX's regime bands).
 * - threshold: a sign flip is the event (curve inversion), not magnitude.
 *
 * NOTE: methods run on the series AS STORED - several rows store a
 * transformed history (payrolls = 3m avg gain, M2/IP/retail/housing = YoY,
 * SOFR card = the SOFR−IORB spread in bps), and their anchors are set in
 * those units.
 */
const SIGNAL_CONFIG: Record<string, SignalConfig> = {
  // ---- US macro ----
  "us-macro:h41-balance-sheet": {
    method: "momentum",
    momentumWindow: 13,
    rationale: "The level is meaningless on its own (10x since 2008) - what matters is whether it's expanding (QE) or contracting (QT) right now.",
  },
  "us-macro:sofr-effr-iorb": {
    method: "anchor",
    reference: 0,
    band: 10,
    rationale: "The stored series is the SOFR−IORB spread in bps. Zero = normal plumbing; +10bp sustained = genuine funding stress (Sept 2019 hit +300bp intraday).",
  },
  "us-macro:hy-credit-spread": {
    method: "anchor",
    reference: 4,
    band: 1.5,
    rationale: "Credit spreads have a real fair-value range: sub-3% is complacent, 3-5% normal, 6%+ stress - judged against that range, not their own multi-year history.",
  },
  "us-macro:ig-credit-spread": {
    method: "anchor",
    reference: 1.3,
    band: 0.6,
    rationale: "IG OAS has a real fair-value range: sub-0.9% is priced-for-perfection tight, ~1.3% normal, 2%+ genuine stress - judged against that range, not its own history.",
  },
  "us-macro:cpi-yoy": { method: "anchor", reference: 2, band: 1, rationale: "Judged against the Fed's actual 2% inflation target." },
  "us-macro:core-cpi": { method: "anchor", reference: 2, band: 1, rationale: "Core CPI judged against the same 2% target it's meant to approach." },
  "us-macro:core-pce": { method: "anchor", reference: 2, band: 1, rationale: "The Fed's actual target metric, judged directly against 2%." },
  "us-macro:unemployment": {
    method: "anchor",
    reference: 4.2,
    band: 1.2,
    rationale: "Judged against a rough NAIRU estimate, not its own historical range which spans both 3.5% and 14%.",
  },
  "us-macro:payrolls": {
    method: "anchor",
    reference: 100,
    band: 150,
    rationale: "The stored series is the 3m average monthly gain (k). ~100k/mo roughly absorbs labor-force growth; +250k is boom pace, negative is contraction.",
  },
  "us-macro:jobless-claims": {
    method: "momentum",
    momentumWindow: 8,
    rationale: "The \"normal\" claims level drifts with labor-force size - the trend (rising vs falling) is what signals labor-market turns.",
  },
  "us-macro:m2": {
    method: "anchor",
    reference: 5,
    band: 6,
    rationale: "The stored series is YoY growth. ~5-6% is the long-run nominal norm; 0% or below (2022-23) is genuine contraction, 11%+ is flood conditions.",
  },
  "us-macro:10y-yield": {
    method: "momentum",
    momentumWindow: 20,
    rationale: "Financial conditions tighten or ease on the recent MOVE in yields, not the absolute level, which shifts structurally across cycles.",
  },
  "us-macro:industrial-production": {
    method: "anchor",
    reference: 1,
    band: 4,
    rationale: "The stored series is YoY growth. Trend US IP growth is ~1%; ±4-5pp marks real expansion or contraction.",
  },
  "us-macro:consumer-sentiment": { method: "positioning", rationale: "A survey index with no fixed fair value - judged against its own recent range." },
  "us-macro:gdp": { method: "anchor", reference: 2, band: 1.5, rationale: "Real GDP YoY judged against ~2% trend/potential US growth." },
  "us-macro:reverse-repo": {
    method: "momentum",
    momentumWindow: 20,
    rationale: "RRP size has swung structurally (near-zero to $2.5T and back) - the direction of change is the liquidity signal.",
  },
  "us-macro:retail-sales": { method: "anchor", reference: 3, band: 3, rationale: "YoY nominal growth judged against a rough ~3% trend (real growth + inflation)." },
  "us-macro:housing-starts": { method: "anchor", reference: 0, band: 10, rationale: "YoY growth judged against flat - housing swings ±15-20% YoY are normal, so the band is wide." },

  // ---- Yield rates ----
  "yield-rates:10y2y-spread": { method: "threshold", reference: 0, band: 0.3, rationale: "Inversion (crossing zero) is the meaningful event - a textbook threshold signal, not a magnitude one." },
  "yield-rates:10y3m-spread": { method: "threshold", reference: 0, band: 0.3, rationale: "Same logic - the NY Fed's own model treats this as a sign flip, not a continuous z-score." },
  "yield-rates:2y-yield": { method: "momentum", momentumWindow: 20, rationale: "Front-end rate direction (pricing hikes vs cuts) is the signal." },
  "yield-rates:10y-yield": { method: "momentum", momentumWindow: 20, rationale: "Same financial-conditions framing as the us-macro 10y card." },
  "yield-rates:30y-yield": { method: "momentum", momentumWindow: 20, rationale: "Long-bond yield direction, independent of the structurally-shifting level." },
  "yield-rates:breakeven": { method: "anchor", reference: 2.2, band: 0.5, rationale: "Judged against a target-consistent ~2.2% breakeven (2% CPI target plus typical risk premium)." },
  "yield-rates:forward-inflation": { method: "anchor", reference: 2.2, band: 0.3, rationale: "The Fed's own long-run anchoring gauge - tight band since this is supposed to stay very stable." },
  "yield-rates:10y-cot": { method: "positioning", rationale: "Speculative positioning is genuinely a crowding/mean-reversion signal." },
  "yield-rates:2y-cot": { method: "positioning", rationale: "Same - front-end positioning extremes are a crowding signal." },

  // ---- COT (all positioning by nature) ----
  "cot:es": { method: "positioning", rationale: "Speculative positioning extremes are a crowding/mean-reversion signal by nature." },
  "cot:nq": { method: "positioning", rationale: "Same - crowding signal." },
  "cot:zn": { method: "positioning", rationale: "Same - crowding signal." },
  "cot:zt": { method: "positioning", rationale: "Same - structural basis-trade shorts make the CHANGE the readable part, which the windowed method captures." },
  "cot:gold": { method: "positioning", rationale: "Same - crowding signal." },
  "cot:wti": { method: "positioning", rationale: "Same - crowding signal." },
  "cot:copper": { method: "positioning", rationale: "Same - crowding signal." },
  "cot:dxy": { method: "positioning", rationale: "Same - crowding signal." },
  "cot:silver": { method: "positioning", rationale: "Same - amplified by silver's thinner market." },
  "cot:natgas": { method: "positioning", rationale: "Same - crowding signal in the most vol-prone major commodity." },
  "cot:vix": { method: "positioning", rationale: "Specs are structurally short VIX - positioning vs its own range reads hedging demand building or unwinding." },

  // ---- Transmission ----
  "transmission:nfci": {
    method: "anchor",
    reference: 0,
    band: 0.6,
    rationale: "The index is constructed so 0 = average US financial conditions - the anchor is part of its definition. ±0.6 covers genuinely loose vs 2008/2020-style tight.",
  },
  "transmission:real-10y": {
    method: "anchor",
    reference: 1,
    band: 1.2,
    rationale: "Judged against a rough r* (~1% real). Above 2% = genuinely restrictive; below 0 = easy money in real terms - absolute stance matters, not its own history.",
  },
  "transmission:broad-dollar": { method: "momentum", momentumWindow: 20, rationale: "Trade-weighted index level is arbitrary - the recent move is what tightens or eases global conditions." },
  "transmission:copper-gold": { method: "positioning", rationale: "No fixed fair value for this ratio - judged against its own range." },
  "transmission:gold-silver": { method: "positioning", rationale: "No fixed fair value - judged against its own range." },
  "transmission:crude-natgas": { method: "positioning", rationale: "No fixed fair value - judged against its own range." },
  "transmission:hyg-lqd": { method: "positioning", rationale: "Relative-performance ratio with no fair value - its own range is the reference." },
  "transmission:rsp-spy": { method: "positioning", rationale: "Breadth ratio - judged against its own range." },
  "transmission:smh-spy": { method: "positioning", rationale: "Leadership ratio - judged against its own range." },

  // ---- Geopolitics / vol ----
  "geo:vix": { method: "anchor", reference: 17, band: 7, rationale: "VIX has a well-known long-run average (~17) and regime bands (<15 calm, 20-30 elevated, 30+ crisis)." },
  "geo:vix-term": {
    method: "anchor",
    reference: 1.05,
    band: 0.12,
    rationale: "The vol curve's normal shape is mild contango (~1.05-1.10). Below 1.0 (backwardation) has marked every major drawdown - the anchor is structural, not historical.",
  },
  "geo:ovx": { method: "anchor", reference: 35, band: 15, rationale: "Crude vol runs structurally higher than equity vol - judged against its typical ~30-40 range." },
  "geo:gvz": { method: "anchor", reference: 17, band: 7, rationale: "Gold vol's typical range is close to VIX's - judged the same way." },
  "geo:vvix": { method: "anchor", reference: 90, band: 30, rationale: "VVIX has a well-known regime range (~80-100 normal, 120+ marks vol-of-vol stress on top of elevated VIX itself)." },
  "geo:skew": { method: "anchor", reference: 120, band: 25, rationale: "SKEW's long-run average sits near 120; readings above ~140 price meaningfully fatter tail/crash risk than normal." },
  "geo:move": { method: "anchor", reference: 100, band: 40, rationale: "MOVE's calm-era average is ~80-100; 2022-23 policy shock regimes pushed it well above 140 - judged against that structural range." },
  "geo:epu": { method: "positioning", rationale: "A news-count index with no natural unit - its own range is the only sensible reference." },
  "geo:gepu": { method: "positioning", rationale: "Same as US EPU - a GDP-weighted news-count index with no fixed fair value." },
  "geo:equity-uncertainty": { method: "positioning", rationale: "News- and options-derived uncertainty index with no fixed fair value - judged against its own range." },
  "geo:defense-spy": { method: "positioning", rationale: "Relative-performance ratio with no fair value - its own range is the reference." },
};

export interface IndicatorSignal {
  score: number; // -1..1
  method: SignalMethod;
  rationale: string;
}

/** Read-only lookup of an indicator's method + params, for the UI to explain and chart it. */
export function getSignalConfig(seriesId: string): SignalConfig | null {
  return SIGNAL_CONFIG[seriesId] ?? null;
}

/**
 * Computes the score for a series using whichever method fits it, from a
 * chronological value array truncated to whatever "as of" point the caller
 * wants - the same shape serves the live read, the replay, and the backtest.
 */
export function computeIndicatorSignal(seriesId: string, values: number[], cadence: Cadence): IndicatorSignal | null {
  const config = SIGNAL_CONFIG[seriesId];
  if (!config || values.length === 0) return null;

  if (config.method === "positioning") {
    const { blended } = computeWindowedBias(values, cadence);
    if (blended === null) return null;
    return { score: blended, method: "positioning", rationale: config.rationale };
  }

  if (config.method === "momentum") {
    const score = momentumSignal(values, config.momentumWindow ?? 10);
    if (score === null) return null;
    return { score, method: "momentum", rationale: config.rationale };
  }

  // anchor and threshold both reduce to distance-from-reference
  const latest = values[values.length - 1];
  const score = distanceSignal(latest, config.reference ?? 0, config.band ?? 1);
  return { score, method: config.method, rationale: config.rationale };
}
