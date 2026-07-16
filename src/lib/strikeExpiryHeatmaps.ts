/**
 * Strike x expiry heatmap grids for the Terminal page - one shared shape so
 * the same component can render whichever Greek is selected.
 *
 * Built in y3osFeed.ts from the y3os /greeks feed's real per-strike
 * exposures (gex/dex/vex/chex/tex/vegaEx, actual $ figures, not a magnitude
 * proxy). Currently one column (the front 0DTE book) - y3os rate-limits to
 * 1 request per 10s per symbol, which rules out fetching several extra
 * expiries per request. See y3osFeed.ts for the full explanation.
 */

export interface StrikeExpiryHeatmap {
  columns: { label: string; dte: number | null }[];
  strikes: number[];
  values: (number | null)[][];
}

export type HeatmapMetric = "gex" | "dex" | "vex" | "cex" | "tex" | "vegaex";
