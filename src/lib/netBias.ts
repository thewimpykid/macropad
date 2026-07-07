import type { MacroPanel, MacroSeries } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import { getBias } from "@/lib/bias";
import { IMPACTS, marketRowId } from "@/lib/markets";
import { inferCadence, changeCorrelation, pearson, type Cadence } from "@/lib/stats";
import { computeIndicatorSignal, type SignalMethod } from "@/lib/indicatorSignal";

export type Horizon = "daily" | "weekly" | "monthly";

export interface BiasContributor {
  seriesId: string;
  name: string;
  panelTitle: string;
  tone: "up" | "down" | "flat";
  /** -1..1, method-based indicator score (see indicatorSignal.ts). */
  score: number | null;
  method: SignalMethod;
  methodRationale: string;
  label: string;
  rationale: string;
  /** Signed, per-asset: impact.sign * score. -1..1. */
  contribution: number;
  cadence: Cadence;
  /** impact weight × cadence fit × measured-correlation factor. */
  weight: number;
  /** Correlation of CHANGES between indicator and asset, for display. */
  correlation: number | null;
}

export type Verdict =
  | "Strongly Bullish"
  | "Bullish"
  | "Lean Bullish"
  | "Neutral"
  | "Lean Bearish"
  | "Bearish"
  | "Strongly Bearish";

export interface NetBiasResult {
  symbol: string;
  score: number; // -1..1 weighted average of signed contributions
  verdict: Verdict;
  tone: "up" | "down" | "flat";
  /** 0..1 — share of total weight agreeing with the score's direction. */
  conviction: number;
  contributors: BiasContributor[];
}

export interface HorizonBias {
  score: number;
  verdict: Verdict;
  tone: "up" | "down" | "flat";
  daysUsed: number;
}

/**
 * How much a horizon cares about an indicator with a given release cadence.
 * A monthly print (CPI, payrolls) is what actually moves the monthly picture;
 * on a daily horizon it's stale information sitting there until the next
 * print, so it counts for less.
 */
const CADENCE_WEIGHT: Record<Horizon, Record<Cadence, number>> = {
  daily: { daily: 1, weekly: 0.55, monthly: 0.25, quarterly: 0.15 },
  weekly: { daily: 0.7, weekly: 1, monthly: 0.5, quarterly: 0.3 },
  monthly: { daily: 0.4, weekly: 0.65, monthly: 1, quarterly: 0.6 },
};

export function verdictFor(score: number): { verdict: Verdict; tone: "up" | "down" | "flat" } {
  if (score >= 0.55) return { verdict: "Strongly Bullish", tone: "up" };
  if (score >= 0.3) return { verdict: "Bullish", tone: "up" };
  if (score >= 0.12) return { verdict: "Lean Bullish", tone: "up" };
  if (score <= -0.55) return { verdict: "Strongly Bearish", tone: "down" };
  if (score <= -0.3) return { verdict: "Bearish", tone: "down" };
  if (score <= -0.12) return { verdict: "Lean Bearish", tone: "down" };
  return { verdict: "Neutral", tone: "flat" };
}

/**
 * How empirically related an indicator's MOVES are to the asset's MOVES —
 * measured on period-over-period changes, not levels (any two trending
 * levels correlate spuriously). Floored at 0.15 so a real economic link is
 * never fully zeroed by a noisy sample; neutral 0.5 when there isn't enough
 * overlap to judge.
 */
function correlationFactor(
  seriesHistory: { date: string; value: number }[],
  marketHistory: { date: string; value: number }[] | null
): { factor: number; r: number | null } {
  if (!marketHistory || marketHistory.length < 10) return { factor: 0.5, r: null };
  const r = changeCorrelation(seriesHistory, marketHistory, 6);
  if (r === null) return { factor: 0.5, r: null };
  return { factor: 0.15 + 0.85 * Math.min(1, Math.abs(r)), r };
}

function aggregate(symbol: string, contributors: BiasContributor[]): NetBiasResult {
  const totalWeight = contributors.reduce((a, c) => a + c.weight, 0);
  const score =
    totalWeight === 0 ? 0 : contributors.reduce((a, c) => a + c.contribution * c.weight, 0) / totalWeight;
  const { verdict, tone } = verdictFor(score);

  const dir = Math.sign(score);
  const agreeing = contributors.reduce(
    (a, c) => a + (Math.sign(c.contribution) === dir && c.contribution !== 0 ? c.weight : 0),
    0
  );
  const conviction = totalWeight === 0 || dir === 0 ? 0 : agreeing / totalWeight;

  contributors.sort((a, b) => Math.abs(b.contribution * b.weight) - Math.abs(a.contribution * a.weight));
  return { symbol, score, verdict, tone, conviction, contributors };
}

function buildContributors(
  panels: MacroPanel[],
  markets: MarketRow[],
  symbol: string,
  horizon: Horizon,
  asOfDate: string | null
): BiasContributor[] {
  const cutoff = asOfDate ? new Date(asOfDate).getTime() : null;
  const market = markets.find((m) => m.id === marketRowId(symbol));
  const marketHistory = market?.history
    ? cutoff
      ? market.history.filter((p) => new Date(p.date).getTime() <= cutoff)
      : market.history
    : null;

  const out: BiasContributor[] = [];
  for (const panel of panels) {
    for (const s of panel.series) {
      const impacts = IMPACTS[s.id];
      if (!impacts) continue;
      const impact = impacts.find((i) => i.symbol === symbol);
      if (!impact || !s.history) continue;

      const truncated = cutoff ? s.history.filter((p) => new Date(p.date).getTime() <= cutoff) : s.history;
      if (truncated.length < 5) continue;

      const cadence = inferCadence(truncated).cadence;
      const signal = computeIndicatorSignal(s.id, truncated.map((p) => p.value), cadence);
      if (!signal) continue;

      const bias = getBias(s.id, signal.score);
      if (!bias) continue;

      const { factor, r } = correlationFactor(truncated, marketHistory);
      const contribution = impact.sign * signal.score;

      out.push({
        seriesId: s.id,
        name: s.name,
        panelTitle: panel.title,
        tone: bias.tone,
        score: signal.score,
        method: signal.method,
        methodRationale: signal.rationale,
        label: bias.label,
        rationale: impact.rationale,
        contribution,
        cadence,
        weight: impact.weight * CADENCE_WEIGHT[horizon][cadence] * factor,
        correlation: r,
      });
    }
  }
  return out;
}

/** Live read from full histories. */
export function computeNetBias(
  panels: MacroPanel[],
  markets: MarketRow[],
  symbol: string,
  horizon: Horizon = "weekly"
): NetBiasResult {
  return aggregate(symbol, buildContributors(panels, markets, symbol, horizon, null));
}

/**
 * Point-in-time read: every series (and the asset's own history used for the
 * correlation weight) is truncated to observations dated on or before
 * `asOfDate`. No value dated after asOfDate is ever read — this is what
 * makes the replay and backtest honest (no lookahead).
 */
export function computeNetBiasAsOf(
  panels: MacroPanel[],
  markets: MarketRow[],
  symbol: string,
  asOfDate: string,
  horizon: Horizon = "weekly"
): NetBiasResult {
  return aggregate(symbol, buildContributors(panels, markets, symbol, horizon, asOfDate));
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Trailing-window smoothing: averages the point-in-time score over 1 / 7 /
 * 30 calendar days ending at asOfDate.
 */
export function computeHorizonBias(
  panels: MacroPanel[],
  markets: MarketRow[],
  symbol: string,
  asOfDate: string,
  horizon: Horizon = "weekly"
): { daily: HorizonBias; weekly: HorizonBias; monthly: HorizonBias } {
  const windowScores: number[] = [];
  for (let i = 0; i < 30; i++) {
    const d = addDays(asOfDate, -i);
    const result = computeNetBiasAsOf(panels, markets, symbol, d, horizon);
    windowScores.push(result.contributors.length > 0 ? result.score : NaN);
  }

  const avg = (n: number): HorizonBias => {
    const slice = windowScores.slice(0, n).filter((v) => !Number.isNaN(v));
    const score = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
    const { verdict, tone } = verdictFor(score);
    return { score, verdict, tone, daysUsed: slice.length };
  };

  return { daily: avg(1), weekly: avg(7), monthly: avg(30) };
}

// ---------------------------------------------------------------------------
// Backtest
// ---------------------------------------------------------------------------

export interface BacktestPoint {
  date: string;
  score: number;
  forwardReturnPct: number | null;
}

export interface BacktestResult {
  points: BacktestPoint[];
  n: number; // points with a forward return available
  correlation: number | null; // score vs forward return
  hitRate: number | null; // 0-100, % where sign(score) matched sign(forward return), |score| > 0.1
  avgForwardReturnWhenBullish: number | null;
  avgForwardReturnWhenBearish: number | null;
  horizonDays: number;
}

/**
 * Forward-return window per horizon — literally what each horizon claims to
 * predict. Measured against daily price bars where available (weekly bars
 * can't resolve a 1-day-ahead return at all).
 */
const HORIZON_TEST_DAYS: Record<Horizon, number> = { daily: 1, weekly: 7, monthly: 30 };
const HORIZON_TOLERANCE_DAYS: Record<Horizon, number> = { daily: 2, weekly: 3, monthly: 6 };

function nearestBar(
  history: { date: string; value: number }[],
  targetTime: number,
  maxDiffMs: number,
  after: number | null = null
): { date: string; value: number } | null {
  let best: { date: string; value: number } | null = null;
  let bestDiff = Infinity;
  for (const p of history) {
    const t = new Date(p.date).getTime();
    if (after !== null && t <= after) continue;
    const diff = Math.abs(t - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  return best && bestDiff <= maxDiffMs ? best : null;
}

/**
 * Walks the asset's weekly history as the set of as-of dates, computes what
 * Net Bias would have said using ONLY data available on each date (the same
 * no-lookahead machinery as the replay), then measures what the asset
 * actually did over the horizon's literal forward window using daily bars.
 * This is the honesty check: a plausible-sounding methodology that doesn't
 * predict forward returns isn't a signal, and this is how you catch that.
 */
export function backtestNetBias(
  panels: MacroPanel[],
  markets: MarketRow[],
  symbol: string,
  horizon: Horizon = "weekly"
): BacktestResult {
  const horizonDays = HORIZON_TEST_DAYS[horizon];
  const toleranceDays = HORIZON_TOLERANCE_DAYS[horizon];
  const market = markets.find((m) => m.id === marketRowId(symbol));
  const points: BacktestPoint[] = [];

  if (!market?.history || market.history.length < 20) {
    return { points, n: 0, correlation: null, hitRate: null, avgForwardReturnWhenBullish: null, avgForwardReturnWhenBearish: null, horizonDays };
  }

  const priceHistory = market.dailyHistory && market.dailyHistory.length >= 20 ? market.dailyHistory : market.history;
  const testDates = market.history.slice(0, -1);
  const dayMs = 86_400_000;

  for (const testPoint of testDates) {
    const asOfDate = testPoint.date;
    const result = computeNetBiasAsOf(panels, markets, symbol, asOfDate, horizon);
    if (result.contributors.length === 0) continue;

    const asOfTime = new Date(asOfDate).getTime();
    const startBar = nearestBar(priceHistory, asOfTime, toleranceDays * dayMs) ?? testPoint;
    const targetTime = asOfTime + horizonDays * dayMs;
    const forwardBar = nearestBar(priceHistory, targetTime, toleranceDays * dayMs, asOfTime);

    const forwardReturnPct = forwardBar ? ((forwardBar.value - startBar.value) / startBar.value) * 100 : null;
    points.push({ date: asOfDate, score: result.score, forwardReturnPct });
  }

  const withForward = points.filter((p) => p.forwardReturnPct !== null) as { date: string; score: number; forwardReturnPct: number }[];
  const n = withForward.length;
  const correlation = n >= 8 ? pearson(withForward.map((p) => p.score), withForward.map((p) => p.forwardReturnPct)) : null;

  const meaningful = withForward.filter((p) => Math.abs(p.score) > 0.1);
  const hits = meaningful.filter((p) => Math.sign(p.score) === Math.sign(p.forwardReturnPct));
  const hitRate = meaningful.length >= 5 ? (hits.length / meaningful.length) * 100 : null;

  const bullish = withForward.filter((p) => p.score > 0.2);
  const bearish = withForward.filter((p) => p.score < -0.2);
  const avgForwardReturnWhenBullish = bullish.length ? bullish.reduce((a, p) => a + p.forwardReturnPct, 0) / bullish.length : null;
  const avgForwardReturnWhenBearish = bearish.length ? bearish.reduce((a, p) => a + p.forwardReturnPct, 0) / bearish.length : null;

  return { points, n, correlation, hitRate, avgForwardReturnWhenBullish, avgForwardReturnWhenBearish, horizonDays };
}

export function seriesLinkedToSymbol(series: MacroSeries, symbol: string): boolean {
  return (IMPACTS[series.id] ?? []).some((i) => i.symbol === symbol);
}
