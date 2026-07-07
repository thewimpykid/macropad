/**
 * Latest and previous non-null values, scanning back from the end. FRED
 * series often carry a "." placeholder for holidays/weekends mid-array —
 * naively reading the last two array slots picks up those nulls and makes
 * a perfectly fresh series read as "pending".
 */
export function lastValidPair(values: (number | null)[]): [number | null, number | null] {
  let latest: number | null = null;
  let prev: number | null = null;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v === null || Number.isNaN(v)) continue;
    if (latest === null) {
      latest = v;
    } else {
      prev = v;
      break;
    }
  }
  return [latest, prev];
}

export interface SeriesStats {
  zscore: number | null;
  sparkline: number[] | null;
}

export interface DistStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  latest: number;
  percentile: number; // 0-100, share of history <= latest
  zscore: number;
}

/**
 * history: chronological (oldest -> newest) numeric observations.
 * z-score is computed on the full window; sparkline keeps the last `sparkPoints`.
 */
export function computeStats(history: (number | null)[], sparkPoints = 30): SeriesStats {
  const clean = history.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (clean.length < 5) {
    return { zscore: null, sparkline: clean.length ? clean.slice(-sparkPoints) : null };
  }
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / clean.length;
  const std = Math.sqrt(variance);
  const latest = clean[clean.length - 1];
  const zscore = std === 0 ? 0 : (latest - mean) / std;
  return { zscore, sparkline: clean.slice(-sparkPoints) };
}

/** Full distribution stats over a history window, for a "quant panel" detail view. */
export function computeDistStats(history: (number | null)[]): DistStats | null {
  const clean = history.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (clean.length < 5) return null;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / clean.length;
  const std = Math.sqrt(variance);
  const latest = clean[clean.length - 1];
  const below = clean.filter((v) => v <= latest).length;
  const percentile = (below / clean.length) * 100;
  const zscore = std === 0 ? 0 : (latest - mean) / std;
  return {
    mean,
    std,
    min: Math.min(...clean),
    max: Math.max(...clean),
    latest,
    percentile,
    zscore,
  };
}

/**
 * Rolling z-score at every point using a trailing window (quant-standard
 * standardization). Points before `window` observations exist use an
 * expanding window instead of returning null, so the chart has no gaps.
 */
export function rollingZScore(history: (number | null)[], window = 60): (number | null)[] {
  const clean: number[] = [];
  const out: (number | null)[] = [];
  for (const raw of history) {
    if (raw === null || Number.isNaN(raw)) {
      out.push(null);
      continue;
    }
    clean.push(raw);
    const slice = clean.length > window ? clean.slice(clean.length - window) : clean;
    if (slice.length < 5) {
      out.push(null);
      continue;
    }
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    const std = Math.sqrt(variance);
    out.push(std === 0 ? 0 : (raw - mean) / std);
  }
  return out;
}

/** Simple trailing moving average, null until `window` points exist. */
export function movingAverage(history: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < history.length; i++) {
    if (i < window - 1) {
      out.push(null);
      continue;
    }
    const slice = history.slice(i - window + 1, i + 1);
    if (slice.some((v) => v === null)) {
      out.push(null);
      continue;
    }
    out.push((slice as number[]).reduce((a, b) => a + b, 0) / window);
  }
  return out;
}

/** Trailing rolling standard deviation (realized volatility proxy). */
export function rollingStd(history: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < history.length; i++) {
    if (i < window - 1) {
      out.push(null);
      continue;
    }
    const slice = history.slice(i - window + 1, i + 1);
    if (slice.some((v) => v === null)) {
      out.push(null);
      continue;
    }
    const nums = slice as number[];
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
    out.push(Math.sqrt(variance));
  }
  return out;
}

export interface MomentumStats {
  wow: number | null; // 1 period back at weekly cadence
  m1: number | null; // ~1 month back
  m3: number | null; // ~3 months back
  y1: number | null; // ~1 year back
}

export type Cadence = "daily" | "weekly" | "monthly" | "quarterly";

export interface CadenceInfo {
  cadence: Cadence;
  periodsPerYear: number;
}

/** Infer sampling cadence (and periods/year) from the median date gap. */
export function inferCadence(history: { date: string }[]): CadenceInfo {
  if (history.length < 3) return { cadence: "weekly", periodsPerYear: 52 };
  const gaps: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const d = (new Date(history[i].date).getTime() - new Date(history[i - 1].date).getTime()) / 86_400_000;
    if (d > 0) gaps.push(d);
  }
  gaps.sort((a, b) => a - b);
  const medianDays = gaps[Math.floor(gaps.length / 2)] || 7;
  if (medianDays < 3) return { cadence: "daily", periodsPerYear: 252 };
  if (medianDays < 10) return { cadence: "weekly", periodsPerYear: 52 };
  if (medianDays < 45) return { cadence: "monthly", periodsPerYear: 12 };
  return { cadence: "quarterly", periodsPerYear: 4 };
}

/**
 * history: {date, value} chronological. periodsPerYear (from inferCadence)
 * lets the lookback offsets land on the right cadence regardless of whether
 * the series is daily, weekly, monthly, or quarterly.
 */
export function computeMomentum(history: { date: string; value: number }[], periodsPerYear: number): MomentumStats {
  if (history.length < 2) return { wow: null, m1: null, m3: null, y1: null };
  const latest = history[history.length - 1].value;
  const at = (yearsAgo: number): number | null => {
    const idx = history.length - 1 - Math.round(yearsAgo * periodsPerYear);
    return idx >= 0 ? history[idx].value : null;
  };
  const delta = (prev: number | null) => (prev === null ? null : latest - prev);
  return {
    wow: delta(at(1 / 52)),
    m1: delta(at(1 / 12)),
    m3: delta(at(1 / 4)),
    y1: delta(at(1)),
  };
}

/** Momentum windows + labels appropriate for the series' cadence (no "WoW" on monthly data). */
export function momentumForCadence(
  history: { date: string; value: number }[],
  cadence: Cadence
): { label: string; value: number | null }[] {
  const latest = history[history.length - 1]?.value;
  if (latest === undefined) return [];
  const at = (idx: number): number | null => (idx >= 0 ? history[idx].value : null);
  const delta = (prev: number | null) => (prev === null ? null : latest - prev);
  const n = history.length - 1;

  if (cadence === "daily" || cadence === "weekly") {
    const ppy = cadence === "daily" ? 252 : 52;
    return [
      { label: "WoW", value: delta(at(n - Math.round(ppy / 52))) },
      { label: "1M", value: delta(at(n - Math.round(ppy / 12))) },
      { label: "3M", value: delta(at(n - Math.round(ppy / 4))) },
      { label: "1Y", value: delta(at(n - ppy)) },
    ];
  }
  if (cadence === "monthly") {
    return [
      { label: "1M", value: delta(at(n - 1)) },
      { label: "3M", value: delta(at(n - 3)) },
      { label: "6M", value: delta(at(n - 6)) },
      { label: "1Y", value: delta(at(n - 12)) },
    ];
  }
  return [
    { label: "1Q", value: delta(at(n - 1)) },
    { label: "2Q", value: delta(at(n - 2)) },
    { label: "1Y", value: delta(at(n - 4)) },
    { label: "2Y", value: delta(at(n - 8)) },
  ];
}

/** Bucket a distribution into `bins` equal-width buckets for a histogram chart. */
export function histogram(values: number[], bins = 16): { bucket: number; count: number }[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  values.forEach((v) => {
    const idx = Math.min(bins - 1, Math.floor((v - min) / width));
    counts[idx]++;
  });
  return counts.map((count, i) => ({ bucket: min + width * (i + 0.5), count }));
}

/**
 * Z-score "surface": rolling z-score computed at every date, across a range
 * of lookback windows. Rows = window sizes, cols = dates. Reveals whether a
 * regime signal is robust across horizon choices or an artifact of one window.
 */
export function zScoreSurface(
  history: { date: string; value: number }[],
  windows: number[]
): { windows: number[]; dates: string[]; grid: (number | null)[][] } {
  const values = history.map((h) => h.value);
  const dates = history.map((h) => h.date);
  const grid = windows.map((w) => rollingZScore(values, w));
  return { windows, dates, grid };
}

/** Pearson correlation coefficient between two equal-length numeric arrays. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const av = a.slice(-n);
  const bv = b.slice(-n);
  const meanA = av.reduce((x, y) => x + y, 0) / n;
  const meanB = bv.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = av[i] - meanA;
    const db = bv[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

/** Align series B onto series A's dates by nearest match within `toleranceDays`. */
export function alignByDate(
  a: { date: string; value: number }[],
  b: { date: string; value: number }[],
  toleranceDays = 4
): { a: number[]; b: number[] } {
  const bSorted = b.map((p) => ({ t: new Date(p.date).getTime(), v: p.value })).sort((x, y) => x.t - y.t);
  const outA: number[] = [];
  const outB: number[] = [];
  for (const pt of a) {
    const t = new Date(pt.date).getTime();
    let best: { t: number; v: number } | null = null;
    let bestDiff = Infinity;
    for (const bp of bSorted) {
      const diff = Math.abs(bp.t - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = bp;
      }
      if (bp.t > t && diff > bestDiff) break;
    }
    if (best && bestDiff <= toleranceDays * 86_400_000) {
      outA.push(pt.value);
      outB.push(best.v);
    }
  }
  return { a: outA, b: outB };
}

/** Annualized rate of change over `months` months of a monthly index series (e.g. CPI 3M/6M annualized). */
export function annualizedChange(monthlyIndex: (number | null)[], months: number): number | null {
  const n = monthlyIndex.length;
  if (n <= months) return null;
  const latest = monthlyIndex[n - 1];
  const prior = monthlyIndex[n - 1 - months];
  if (latest === null || prior === null || prior === 0) return null;
  return (Math.pow(latest / prior, 12 / months) - 1) * 100;
}

/** Simple trailing average of change over `months` months (e.g. payrolls 3M/6M avg monthly gain). */
export function avgChange(monthlyLevels: (number | null)[], months: number): number | null {
  const n = monthlyLevels.length;
  if (n <= months) return null;
  const window = monthlyLevels.slice(n - months - 1);
  const deltas: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const a = window[i];
    const b = window[i - 1];
    if (a !== null && b !== null) deltas.push(a - b);
  }
  if (deltas.length === 0) return null;
  return deltas.reduce((x, y) => x + y, 0) / deltas.length;
}

/**
 * Sahm Rule: 3-month average unemployment rate minus its own minimum over
 * the trailing 12 months. A real-time recession indicator — NBER-adjacent
 * research shows >=0.50 has a strong historical hit rate for a recession
 * already being underway.
 */
export function sahmRule(monthlyUnrate: (number | null)[]): { value: number | null; triggered: boolean } {
  const n = monthlyUnrate.length;
  if (n < 15) return { value: null, triggered: false };
  const clean = monthlyUnrate.map((v) => v ?? NaN);
  const threeMoAvgAt = (endIdx: number): number | null => {
    const slice = clean.slice(endIdx - 2, endIdx + 1);
    if (slice.some((v) => Number.isNaN(v))) return null;
    return slice.reduce((a, b) => a + b, 0) / 3;
  };
  const current = threeMoAvgAt(n - 1);
  if (current === null) return { value: null, triggered: false };
  let minPast: number | null = null;
  for (let i = n - 1; i >= Math.max(2, n - 13); i--) {
    const avg = threeMoAvgAt(i);
    if (avg !== null && (minPast === null || avg < minPast)) minPast = avg;
  }
  if (minPast === null) return { value: null, triggered: false };
  const value = current - minPast;
  return { value, triggered: value >= 0.5 };
}

export interface HistPoint {
  date: string;
  value: number;
}

/** Full historical Sahm Rule series — recomputed at every trailing month, not just the latest print. */
export function sahmRuleHistory(unrateHist: HistPoint[]): HistPoint[] {
  const out: HistPoint[] = [];
  const values = unrateHist.map((p) => p.value);
  for (let i = 14; i < unrateHist.length; i++) {
    const { value } = sahmRule(values.slice(0, i + 1));
    if (value !== null) out.push({ date: unrateHist[i].date, value });
  }
  return out;
}

/** Full historical annualized-change series (e.g. CPI 3m/6m annualized at every month, not just latest). */
export function annualizedChangeHistory(indexHist: HistPoint[], months: number): HistPoint[] {
  const out: HistPoint[] = [];
  for (let i = months; i < indexHist.length; i++) {
    const latest = indexHist[i].value;
    const prior = indexHist[i - months].value;
    if (prior !== 0) out.push({ date: indexHist[i].date, value: (Math.pow(latest / prior, 12 / months) - 1) * 100 });
  }
  return out;
}

/** Full historical trailing-average-change series (e.g. payrolls 3m/6m avg gain at every month). */
export function avgChangeHistory(levelHist: HistPoint[], months: number): HistPoint[] {
  const out: HistPoint[] = [];
  for (let i = months; i < levelHist.length; i++) {
    const window = levelHist.slice(i - months, i + 1);
    const deltas: number[] = [];
    for (let j = 1; j < window.length; j++) deltas.push(window[j].value - window[j - 1].value);
    if (deltas.length) out.push({ date: levelHist[i].date, value: deltas.reduce((a, b) => a + b, 0) / deltas.length });
  }
  return out;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median/MAD z-score of the latest value — outliers and fat tails don't dominate the way mean/std lets them. */
export function robustZScore(values: number[]): number | null {
  if (values.length < 5) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  const absDevs = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = median(absDevs);
  const robustStd = mad * 1.4826;
  const latest = values[values.length - 1];
  if (robustStd === 0) return 0;
  return (latest - med) / robustStd;
}

/** Non-parametric percentile rank (0-100) of the latest value within the given window. */
export function percentileRankOf(values: number[]): number | null {
  if (values.length < 5) return null;
  const latest = values[values.length - 1];
  const below = values.filter((v) => v <= latest).length;
  return (below / values.length) * 100;
}

/** How many trailing observations count as "recent regime" for a given cadence — roughly 2 years. */
export function windowSizeForCadence(cadence: Cadence): number {
  switch (cadence) {
    case "daily":
      return 504;
    case "weekly":
      return 104;
    case "monthly":
      return 24;
    case "quarterly":
      return 8;
  }
}

export interface WindowedBias {
  robustZ: number | null;
  percentile: number | null;
  /** -1..1, blends robust z (60%) and percentile rank (40%) so no single distributional assumption dominates. */
  blended: number | null;
}

/**
 * Positioning-style read for genuinely mean-reverting series: (1) only a
 * trailing ~2y window so a decade-old regime doesn't distort what "normal"
 * means today, and (2) robust statistics (median/MAD) with a non-parametric
 * percentile-rank cross-check blended in.
 */
export function computeWindowedBias(historyValues: number[], cadence: Cadence): WindowedBias {
  const window = historyValues.slice(-windowSizeForCadence(cadence));
  const robustZ = robustZScore(window);
  const percentile = percentileRankOf(window);
  if (robustZ === null || percentile === null) return { robustZ, percentile, blended: null };
  const zComponent = Math.max(-1, Math.min(1, robustZ / 2));
  const pComponent = (percentile - 50) / 50;
  const blended = 0.6 * zComponent + 0.4 * pComponent;
  return { robustZ, percentile, blended };
}

/**
 * For indicators where the LEVEL is arbitrary/structurally-shifting but the
 * TREND is the signal — payrolls, WALCL pace, claims, M2, yields as a
 * financial-conditions read. Compares the mean of the most recent `window`
 * observations against the mean of the `window` before that, normalized by
 * the series' own period-over-period volatility.
 */
export function momentumSignal(values: number[], window: number): number | null {
  if (values.length < window * 2) return null;
  const recent = values.slice(-window);
  const prior = values.slice(-window * 2, -window);
  const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const change = avg(recent) - avg(prior);
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i++) diffs.push(values[i] - values[i - 1]);
  const diffMean = avg(diffs);
  const diffStd = Math.sqrt(diffs.reduce((a, b) => a + (b - diffMean) ** 2, 0) / diffs.length) || 1;
  const raw = change / (diffStd * Math.sqrt(window));
  return Math.max(-1, Math.min(1, raw / 2));
}

/**
 * For indicators with a real economic reference point — inflation vs the
 * Fed's 2% target, unemployment vs NAIRU, a spread vs its 0 inversion line.
 * `band` sets how far from `reference` counts as a "full" ±1 read.
 */
export function distanceSignal(latest: number, reference: number, band: number): number {
  return Math.max(-1, Math.min(1, (latest - reference) / band));
}

/**
 * Pearson correlation of period-over-period CHANGES between two date-aligned
 * series. Raw levels of any two trending series correlate spuriously (~0.9
 * for a growing payroll level vs a rising index, regardless of any real
 * relationship) — differencing first is what makes the measured correlation
 * mean something.
 */
export function changeCorrelation(
  a: { date: string; value: number }[],
  b: { date: string; value: number }[],
  toleranceDays = 6
): number | null {
  const aligned = alignByDate(a, b, toleranceDays);
  if (aligned.a.length < 9) return null;
  const diff = (v: number[]) => v.slice(1).map((x, i) => x - v[i]);
  return pearson(diff(aligned.a), diff(aligned.b));
}

/** Elementwise a-b, aligning b onto a's dates by nearest match within toleranceDays. */
export function subtractHistory(a: HistPoint[], b: HistPoint[], toleranceDays = 3): HistPoint[] {
  const bByTime = b.map((p) => ({ t: new Date(p.date).getTime(), v: p.value })).sort((x, y) => x.t - y.t);
  const out: HistPoint[] = [];
  for (const pt of a) {
    const t = new Date(pt.date).getTime();
    let best: { t: number; v: number } | null = null;
    let bestDiff = Infinity;
    for (const bp of bByTime) {
      const diff = Math.abs(bp.t - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = bp;
      }
      if (bp.t > t && diff > bestDiff) break;
    }
    if (best && bestDiff <= toleranceDays * 86_400_000) {
      out.push({ date: pt.date, value: pt.value - best.v });
    }
  }
  return out;
}
