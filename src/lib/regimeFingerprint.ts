import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import { computeMacroBias, PILLARS } from "@/lib/macroBias";
import { MARKET_SYMBOLS } from "@/lib/markets";

/** Fixed baseline for comparability across dates - regime shape shouldn't shift because someone happened to have a different asset scope or timeframe picked. 2Y lookback matches "regime" being a structural read, not daily noise. */
const FINGERPRINT_OPTIONS = { historyDays: 730, horizon: "medium" as const, indicatorWeights: {} };

export interface PillarVector {
  date: string;
  scores: Record<string, number | null>;
}

export function computePillarVector(panels: MacroPanel[], asOfDate?: string): PillarVector {
  const bias = computeMacroBias(panels, { ...FINGERPRINT_OPTIONS, asOfDate });
  const scores: Record<string, number | null> = {};
  for (const p of bias.pillars) scores[p.id] = p.score;
  return { date: asOfDate ?? "latest", scores };
}

function distance(a: PillarVector, b: PillarVector): number | null {
  let sumSq = 0;
  let count = 0;
  for (const pillar of PILLARS) {
    const av = a.scores[pillar.id];
    const bv = b.scores[pillar.id];
    if (av === null || bv === null || av === undefined || bv === undefined) continue;
    sumSq += (av - bv) ** 2;
    count++;
  }
  if (count < 4) return null; // too few comparable pillars to mean anything
  return Math.sqrt(sumSq / count);
}

function overallDateRange(panels: MacroPanel[]): { min: string; max: string } {
  let min: string | null = null;
  let max: string | null = null;
  for (const p of panels) {
    for (const s of p.series) {
      const first = s.history?.[0]?.date;
      const last = s.history?.[s.history.length - 1]?.date;
      if (first && (min === null || first < min)) min = first;
      if (last && (max === null || last > max)) max = last;
    }
  }
  return { min: min ?? "2015-01-01", max: max ?? new Date().toISOString().slice(0, 10) };
}

export interface SimilarRegime {
  date: string;
  distance: number;
}

/**
 * Nearest-neighbor search over sampled historical dates (not every day - a
 * 2-week step is plenty of resolution for a "which regime does this look
 * like" read and keeps this cheap enough to run on a button click). Dates
 * within `minGapDays` of the target are excluded so the closest "match"
 * isn't trivially last week.
 */
export function findSimilarRegimes(
  panels: MacroPanel[],
  targetDate: string,
  opts: { stepDays?: number; minGapDays?: number; topN?: number } = {}
): SimilarRegime[] {
  const stepDays = opts.stepDays ?? 14;
  const minGapDays = opts.minGapDays ?? 180;
  const topN = opts.topN ?? 8;

  const target = computePillarVector(panels, targetDate);
  const { min, max } = overallDateRange(panels);
  const minMs = new Date(min).getTime();
  const maxMs = new Date(max).getTime();
  const targetMs = new Date(targetDate).getTime();
  const stepMs = stepDays * 24 * 60 * 60 * 1000;
  const gapMs = minGapDays * 24 * 60 * 60 * 1000;

  const results: SimilarRegime[] = [];
  for (let ms = minMs; ms <= maxMs; ms += stepMs) {
    if (Math.abs(ms - targetMs) < gapMs) continue;
    const date = new Date(ms).toISOString().slice(0, 10);
    const vec = computePillarVector(panels, date);
    const d = distance(target, vec);
    if (d !== null) results.push({ date, distance: d });
  }

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, topN);
}

export interface ReportLine {
  symbol: string;
  label: string;
  dailyReturnPct: number | null;
}

/** 1-day return ending at `date` from daily bars; falls back to the weekly bar's own period return if daily history doesn't reach that far back (labeled by the caller, not hidden). */
function dailyReturn(market: MarketRow | undefined, date: string): number | null {
  const daily = market?.dailyHistory?.filter((p) => p.date <= date);
  if (daily && daily.length >= 2) {
    const latest = daily[daily.length - 1].value;
    const prior = daily[daily.length - 2].value;
    if (prior !== 0) return ((latest - prior) / prior) * 100;
  }
  const weekly = market?.history?.filter((p) => p.date <= date);
  if (weekly && weekly.length >= 2) {
    const latest = weekly[weekly.length - 1].value;
    const prior = weekly[weekly.length - 2].value;
    if (prior !== 0) return ((latest - prior) / prior) * 100;
  }
  return null;
}

/** Daily (or nearest available period) return for every tracked ticker as of `date` - equities, commodities, dollar, credit, rates. */
export function buildDateReport(_panels: MacroPanel[], markets: MarketRow[], date: string): ReportLine[] {
  const marketIndex = new Map<string, MarketRow>();
  for (const m of markets) marketIndex.set(m.symbol, m);

  return MARKET_SYMBOLS.map((m) => ({
    symbol: m.symbol,
    label: m.label,
    dailyReturnPct: dailyReturn(marketIndex.get(m.symbol), date),
  }));
}
