import type { MacroPanel, MacroSeries } from "@/lib/macroData";
import { computeIndicatorSignal } from "@/lib/indicatorSignal";
import { getSignTone, getBias } from "@/lib/bias";
import { inferCadence } from "@/lib/stats";

/**
 * Pillar framework mirrors how macro desks actually build a composite
 * regime read (GS FCI, BofA Bull & Bear, Bridgewater growth/inflation
 * quadrants): score each dimension independently on its own indicators,
 * then combine dimensions - never blend 60 raw series into one number
 * directly. Every series here already has a method-appropriate -1..1
 * score (indicatorSignal.ts) and a good/bad tone (bias.ts); this layer
 * only groups and averages what already exists.
 */
export interface PillarDef {
  id: string;
  label: string;
  description: string;
  seriesIds: string[];
}

export const PILLARS: PillarDef[] = [
  {
    id: "growth",
    label: "Growth & Labor",
    description: "Real-economy activity and the labor market - the demand side of the cycle.",
    seriesIds: [
      "us-macro:gdp",
      "us-macro:payrolls",
      "us-macro:unemployment",
      "us-macro:jobless-claims",
      "us-macro:industrial-production",
      "us-macro:retail-sales",
      "us-macro:housing-starts",
      "us-macro:consumer-sentiment",
    ],
  },
  {
    id: "inflation",
    label: "Inflation",
    description: "Realized and market-implied inflation - what constrains the Fed's reaction function.",
    seriesIds: ["us-macro:cpi-yoy", "us-macro:core-cpi", "us-macro:core-pce", "yield-rates:breakeven", "yield-rates:forward-inflation"],
  },
  {
    id: "liquidity",
    label: "Liquidity & Funding",
    description: "Fed balance sheet, funding plumbing, and broad money - the liquidity impulse under risk assets.",
    seriesIds: [
      "us-macro:h41-balance-sheet",
      "us-macro:net-liquidity",
      "us-macro:tga",
      "us-macro:reserve-balances",
      "us-macro:sofr-effr-iorb",
      "us-macro:reverse-repo",
      "us-macro:m2",
    ],
  },
  {
    id: "rates",
    label: "Rates & Curve",
    description: "The level and shape of the Treasury curve - financial conditions and recession signaling.",
    seriesIds: [
      "yield-rates:10y2y-spread",
      "yield-rates:10y3m-spread",
      "yield-rates:2y-yield",
      "yield-rates:10y-yield",
      "yield-rates:30y-yield",
    ],
  },
  {
    id: "credit",
    label: "Credit & Financial Conditions",
    description: "Corporate credit pricing and the Fed's own conditions index - whether tightening is actually biting.",
    seriesIds: [
      "us-macro:hy-credit-spread",
      "us-macro:ig-credit-spread",
      "transmission:nfci",
      "transmission:real-10y",
      "transmission:hyg-lqd",
      "transmission:broad-dollar",
    ],
  },
  {
    id: "positioning",
    label: "Positioning (COT)",
    description: "Leveraged-fund crowding across equities, rates, and commodities - contrarian by nature at extremes.",
    seriesIds: [
      "cot:es",
      "cot:nq",
      "cot:zn",
      "cot:zt",
      "cot:gold",
      "cot:wti",
      "cot:copper",
      "cot:dxy",
      "cot:silver",
      "cot:natgas",
      "cot:vix",
      "yield-rates:10y-cot",
      "yield-rates:2y-cot",
    ],
  },
  {
    id: "volatility",
    label: "Volatility & Risk Sentiment",
    description: "What options and cross-asset ratios are actually pricing for risk, plus policy-uncertainty flow.",
    seriesIds: [
      "geo:vix",
      "geo:vix-term",
      "geo:vvix",
      "geo:skew",
      "geo:ovx",
      "geo:gvz",
      "geo:move",
      "geo:epu",
      "geo:gepu",
      "geo:equity-uncertainty",
      "geo:defense-spy",
      "geo:news-feed",
      "transmission:copper-gold",
      "transmission:gold-silver",
      "transmission:crude-natgas",
      "transmission:rsp-spy",
      "transmission:smh-spy",
    ],
  },
];

export interface IndicatorRead {
  seriesId: string;
  name: string;
  panelTitle: string;
  score: number | null; // -1..1 method score, raw
  directional: number | null; // -1..1, sign flipped so + is always risk-on/bullish
  tone: "up" | "down" | "flat";
  label: string; // getBias human label
}

export interface PillarResult {
  id: string;
  label: string;
  description: string;
  score: number | null; // weighted average of directional reads, -1..1
  tone: "up" | "down" | "flat";
  strength: "mild" | "strong" | "extreme" | null;
  indicators: IndicatorRead[];
}

export interface MacroBias {
  overall: { score: number | null; tone: "up" | "down" | "flat"; strength: "mild" | "strong" | "extreme" | null };
  pillars: PillarResult[];
}

/**
 * Lookback windows. Short-window indicators (COT, positioning ratios) still
 * resolve on 6M; long-window methods (momentum, anchor bands needing >1y of
 * context) will legitimately go null on 6M - that's a correct "not enough
 * history at this horizon" read, not a bug (readSeries falls back to full
 * history rather than going blank).
 *
 * `horizon` drives the pillar reweighting in HORIZON_PILLAR_WEIGHTS below:
 * trend-following research finds momentum/positioning signals concentrated
 * in the ~1-12mo range with decaying half-life beyond that (shorter lookback
 * for shorter horizons is standard practice - e.g. quantdecoded.com's
 * 1-3mo/4-6mo/7-12mo bucketing), while slow fundamentals (GDP, CPI YoY,
 * structural credit) are the ones that actually resolve over multi-quarter
 * horizons. So short horizons up-weight positioning/vol, long horizons
 * up-weight growth/inflation/credit.
 */
export interface TimeframeDef {
  id: string;
  label: string;
  days: number | null; // null = full history
  horizon: "short" | "medium" | "long";
}
export const TIMEFRAMES: TimeframeDef[] = [
  { id: "d", label: "D", days: 1, horizon: "short" },
  { id: "w", label: "W", days: 7, horizon: "short" },
  { id: "m", label: "M", days: 30, horizon: "short" },
  { id: "2m", label: "2M", days: 60, horizon: "medium" },
  { id: "3m", label: "3M", days: 91, horizon: "medium" },
  { id: "6m", label: "6M", days: 182, horizon: "long" },
  { id: "y", label: "Y", days: 365, horizon: "long" },
  { id: "2y", label: "2Y", days: 730, horizon: "long" },
];
export const DEFAULT_TIMEFRAME = "w";

/**
 * Per-pillar multipliers applied on top of the asset-scope weights, keyed by
 * horizon bucket. "medium" is left at 1x across the board - it's the
 * baseline, not a tilt in either direction. Short/long zero out (exclude,
 * not just down-weight) the pillars whose signal has actually decayed at
 * that horizon: a monthly CPI print hasn't moved inside a week, so it
 * shouldn't dilute a Daily/Weekly read; COT crowding has fully resolved or
 * reversed many times over inside a 2-year window, so it shouldn't dilute
 * a long-horizon regime call either.
 */
const HORIZON_PILLAR_WEIGHTS: Record<TimeframeDef["horizon"], Record<string, number>> = {
  short: { growth: 0, inflation: 0, liquidity: 1, rates: 1, credit: 1, positioning: 1.8, volatility: 1.6 },
  medium: { growth: 1, inflation: 1, liquidity: 1, rates: 1, credit: 1, positioning: 1, volatility: 1 },
  long: { growth: 1.6, inflation: 1.6, liquidity: 1.3, rates: 1, credit: 1.4, positioning: 0, volatility: 0 },
};

/**
 * Asset-scope presets reweight individual indicators toward what actually
 * moves that asset class - the same tilt a desk applies informally (an
 * equities trader leans on positioning in ES/NQ, credit spreads and vol; a
 * rates trader leans on the curve and inflation prints). Fixed presets, no
 * user-adjustable weights.
 *
 * Deliberately polarized, not softly tilted: indicators genuinely
 * disconnected from an asset class (e.g. nat-gas positioning for an
 * equities read, or HY/IG credit spreads for FX) are weighted 0 - excluded
 * outright, not diluted at 0.5x. Not every indicator belongs in every view.
 * Indicators not listed default to 1 (unremarkable for that asset, counted
 * at face value).
 */
export interface AssetScopeDef {
  id: string;
  label: string;
  indicatorWeights: Record<string, number>;
}
export const ASSET_SCOPES: AssetScopeDef[] = [
  { id: "all", label: "All assets", indicatorWeights: {} },
  {
    id: "equities",
    label: "Equities",
    indicatorWeights: {
      "cot:es": 2.4,
      "cot:nq": 2.4,
      "transmission:rsp-spy": 2,
      "transmission:smh-spy": 2,
      "us-macro:hy-credit-spread": 1.8,
      "us-macro:ig-credit-spread": 1.5,
      "transmission:hyg-lqd": 1.8,
      "transmission:nfci": 1.8,
      "us-macro:net-liquidity": 2.2,
      "us-macro:tga": 1.5,
      "geo:vix": 2,
      "geo:vix-term": 1.6,
      "geo:skew": 1.5,
      "us-macro:payrolls": 1.5,
      "us-macro:gdp": 1.3,
      "us-macro:consumer-sentiment": 1.3,
      // Genuinely disconnected from equity price action - excluded, not diluted.
      "cot:dxy": 0,
      "cot:gold": 0,
      "cot:natgas": 0,
      "cot:wti": 0,
      "cot:copper": 0,
      "cot:silver": 0,
      "yield-rates:10y-cot": 0,
      "yield-rates:2y-cot": 0,
      "transmission:crude-natgas": 0,
      "transmission:gold-silver": 0,
      "transmission:copper-gold": 0,
      "geo:ovx": 0,
      "geo:gvz": 0,
    },
  },
  {
    id: "rates",
    label: "Rates",
    indicatorWeights: {
      "yield-rates:10y2y-spread": 2.4,
      "yield-rates:10y3m-spread": 2.4,
      "yield-rates:2y-yield": 2.2,
      "yield-rates:10y-yield": 2.2,
      "yield-rates:30y-yield": 2,
      "yield-rates:breakeven": 1.8,
      "yield-rates:forward-inflation": 1.8,
      "yield-rates:10y-cot": 2,
      "yield-rates:2y-cot": 2,
      "us-macro:cpi-yoy": 1.6,
      "us-macro:core-cpi": 1.6,
      "us-macro:core-pce": 1.6,
      "transmission:real-10y": 1.8,
      "transmission:nfci": 1.4,
      "geo:move": 2,
      // Equity/commodity-specific positioning and cross-asset ratios have no
      // real bearing on the rates complex - excluded, not diluted.
      "cot:es": 0,
      "cot:nq": 0,
      "cot:gold": 0,
      "cot:silver": 0,
      "cot:copper": 0,
      "cot:wti": 0,
      "cot:natgas": 0,
      "cot:dxy": 0,
      "transmission:rsp-spy": 0,
      "transmission:smh-spy": 0,
      "geo:defense-spy": 0,
      "transmission:crude-natgas": 0,
      "transmission:copper-gold": 0,
      "transmission:gold-silver": 0,
      "geo:ovx": 0,
      "geo:gvz": 0,
      "geo:vix": 0,
      "geo:skew": 0,
    },
  },
  {
    id: "fx-dollar",
    label: "FX / Dollar",
    indicatorWeights: {
      "cot:dxy": 2.4,
      "transmission:broad-dollar": 2.4,
      "us-macro:h41-balance-sheet": 1.6,
      "us-macro:net-liquidity": 2,
      "us-macro:tga": 1.8,
      "us-macro:m2": 1.6,
      "us-macro:reverse-repo": 1.5,
      "us-macro:sofr-effr-iorb": 1.5,
      "yield-rates:2y-yield": 1.6,
      "transmission:real-10y": 1.5,
      "geo:epu": 1.5,
      "geo:gepu": 1.6,
      // Dollar strengthens as an independent safe-haven driver during risk-off
      // even when rate differentials argue otherwise - vol is a real dollar
      // driver, not just noise, at the horizons where that dynamic dominates.
      "geo:vix": 1.4,
      "geo:move": 1.3,
      // Single-asset equity/commodity positioning and credit spreads don't
      // move the dollar directly - excluded, not diluted.
      "cot:es": 0,
      "cot:nq": 0,
      "cot:gold": 0,
      "cot:silver": 0,
      "cot:copper": 0,
      "cot:wti": 0,
      "cot:natgas": 0,
      "transmission:rsp-spy": 0,
      "transmission:smh-spy": 0,
      "geo:defense-spy": 0,
      "us-macro:hy-credit-spread": 0,
      "us-macro:ig-credit-spread": 0,
      "transmission:hyg-lqd": 0,
      "geo:skew": 0,
      "geo:ovx": 0,
      "geo:gvz": 0,
    },
  },
  {
    id: "commodities",
    label: "Commodities",
    indicatorWeights: {
      "cot:wti": 2.2,
      "cot:copper": 2.2,
      "cot:gold": 2.2,
      "cot:silver": 2,
      "cot:natgas": 2.2,
      "transmission:copper-gold": 2,
      "transmission:gold-silver": 2,
      "transmission:crude-natgas": 2,
      "geo:ovx": 1.8,
      "geo:gvz": 1.8,
      "us-macro:industrial-production": 1.5,
      "us-macro:gdp": 1.3,
      // Dollar strength is a dominant, usually-inverse commodity driver -
      // weighted above the FX scope's own broad-dollar weight for that reason.
      "transmission:broad-dollar": 2,
      // Equity/rates-specific positioning and credit have no direct bearing
      // on commodity price action - excluded, not diluted.
      "cot:es": 0,
      "cot:nq": 0,
      "cot:dxy": 0,
      "transmission:rsp-spy": 0,
      "transmission:smh-spy": 0,
      "yield-rates:10y-cot": 0,
      "yield-rates:2y-cot": 0,
      "geo:skew": 0,
      "geo:vix": 0,
      "geo:move": 0,
      "us-macro:hy-credit-spread": 0,
      "us-macro:ig-credit-spread": 0,
      "transmission:hyg-lqd": 0,
    },
  },
];
export const DEFAULT_ASSET_SCOPE = "all";

export function bandStrength(abs: number): "mild" | "strong" | "extreme" | null {
  if (abs < 0.15) return null;
  return abs >= 0.8 ? "extreme" : abs >= 0.5 ? "strong" : "mild";
}

function scoreHistory(seriesId: string, history: { date: string; value: number }[]) {
  if (history.length < 5) return null;
  const cadence = inferCadence(history).cadence;
  return computeIndicatorSignal(seriesId, history.map((p) => p.value), cadence);
}

/**
 * Every indicator must always resolve to a read - a monthly-cadence series
 * (CPI, GDP, payrolls) has 0-1 points inside a Daily/Weekly window, so a hard
 * truncation would blank out most of the board at short horizons. Try the
 * requested horizon first; if it can't support the method, fall back to full
 * history so the indicator still reads (using its best available window)
 * instead of going blank.
 */
function readSeries(
  series: MacroSeries,
  historyDays: number | null,
  asOfDate?: string
): { score: number | null; directional: number | null; tone: "up" | "down" | "flat"; label: string } {
  let full = series.history;
  if (asOfDate && full) {
    const cutoffMs = new Date(asOfDate + "T23:59:59").getTime();
    full = full.filter((p) => new Date(p.date).getTime() <= cutoffMs);
  }
  if (!full || full.length < 5) {
    return { score: null, directional: null, tone: "flat", label: "No history available yet" };
  }

  let signal = null as ReturnType<typeof computeIndicatorSignal>;
  if (historyDays !== null) {
    const lastDate = new Date(full[full.length - 1].date).getTime();
    const cutoff = lastDate - historyDays * 24 * 60 * 60 * 1000;
    const windowed = full.filter((p) => new Date(p.date).getTime() >= cutoff);
    signal = scoreHistory(series.id, windowed);
  }
  if (!signal) signal = scoreHistory(series.id, full); // fall back to full history - always resolve

  if (!signal) return { score: null, directional: null, tone: "flat", label: "No signal method configured" };

  const tone = getSignTone(series.id, signal.score);
  const directional = tone === "flat" ? 0 : tone === "up" ? Math.abs(signal.score) : -Math.abs(signal.score);
  const bias = getBias(series.id, signal.score);
  return { score: signal.score, directional, tone, label: bias?.label ?? "" };
}

export interface MacroBiasOptions {
  /** Lookback in days truncating each series' history before scoring; null = full history. */
  historyDays?: number | null;
  /** Per-indicator weight multipliers (asset-scope preset). Missing ids default to 1. */
  indicatorWeights?: Record<string, number>;
  /** Horizon bucket (see TimeframeDef.horizon) - applies HORIZON_PILLAR_WEIGHTS on top of indicatorWeights. */
  horizon?: TimeframeDef["horizon"];
  /** Replay: pin "now" to this date (YYYY-MM-DD) - every series' history is truncated to this date before historyDays is applied. */
  asOfDate?: string;
}

function weightedAverage(indicators: IndicatorRead[], weights: Record<string, number>): number | null {
  const usable = indicators.filter((i) => i.directional !== null);
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((a, i) => a + (weights[i.seriesId] ?? 1), 0);
  if (totalWeight === 0) return null;
  return usable.reduce((a, i) => a + (i.directional ?? 0) * (weights[i.seriesId] ?? 1), 0) / totalWeight;
}

export function computeMacroBias(panels: MacroPanel[], options: MacroBiasOptions = {}): MacroBias {
  const historyDays = options.historyDays ?? null;
  const horizonWeights = HORIZON_PILLAR_WEIGHTS[options.horizon ?? "medium"];

  // Combine the asset-scope's per-indicator weight with its pillar's
  // horizon multiplier once, up front - every indicator belongs to exactly
  // one pillar so this is a straight per-id multiply, not a re-derivation.
  const indicatorWeights: Record<string, number> = {};
  for (const pillar of PILLARS) {
    const horizonMult = horizonWeights[pillar.id] ?? 1;
    for (const id of pillar.seriesIds) {
      indicatorWeights[id] = (options.indicatorWeights?.[id] ?? 1) * horizonMult;
    }
  }

  const seriesIndex = new Map<string, { series: MacroSeries; panelTitle: string }>();
  for (const panel of panels) {
    for (const series of panel.series) seriesIndex.set(series.id, { series, panelTitle: panel.title });
  }

  const pillars: PillarResult[] = PILLARS.map((def) => {
    const allIndicators: IndicatorRead[] = def.seriesIds
      .map((id) => seriesIndex.get(id))
      .filter((x): x is { series: MacroSeries; panelTitle: string } => x !== undefined)
      .map(({ series, panelTitle }) => {
        const read = readSeries(series, historyDays, options.asOfDate);
        return { seriesId: series.id, name: series.name, panelTitle, score: read.score, directional: read.directional, tone: read.tone, label: read.label };
      });

    const score = weightedAverage(allIndicators, indicatorWeights);
    const tone = score === null || Math.abs(score) < 0.15 ? "flat" : score > 0 ? "up" : "down";
    const strength = score === null ? null : bandStrength(Math.abs(score));

    // Weight-0 (asset scope or horizon excludes it entirely) means it plays
    // no part in this view's score - so it shouldn't appear in the
    // breakdown either. Excluded, not just diluted.
    const indicators = allIndicators.filter((i) => (indicatorWeights[i.seriesId] ?? 1) !== 0);

    return { id: def.id, label: def.label, description: def.description, score, tone, strength, indicators };
  });

  const allScoredIndicators = pillars.flatMap((p) => p.indicators);
  const overallScore = weightedAverage(allScoredIndicators, indicatorWeights);
  const overallTone = overallScore === null || Math.abs(overallScore) < 0.15 ? "flat" : overallScore > 0 ? "up" : "down";
  const overallStrength = overallScore === null ? null : bandStrength(Math.abs(overallScore));

  return { overall: { score: overallScore, tone: overallTone, strength: overallStrength }, pillars };
}
