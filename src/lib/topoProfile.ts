/**
 * Strike x tenor "term profile" for the Terminal's 3D topography surface -
 * per strike, each major Greek's exposure split into four expiry tenors
 * [0DTE, this-week (1-7 DTE), next-week (8-14 DTE), monthly+ (15+ DTE)].
 *
 * Built directly from the same six StrikeExpiryHeatmap grids the Terminal
 * heatmap renders (see strikeExpiryHeatmaps.ts) - one real, per-expiry
 * source for both views instead of mixing this app's self-computed 0DTE
 * chain with a raw cross-expiry proxy, which disagreed with each other and
 * with the source's own dashboard. Values are RAW, not scaled to $ - see
 * strikeExpiryHeatmaps.ts for why.
 */

import type { StrikeExpiryHeatmap, HeatmapMetric } from "@/lib/strikeExpiryHeatmaps";

export type TenorArr = [number, number, number, number];

export interface TopoRow {
  strike: number;
  gex: TenorArr;
  dex: TenorArr;
  vanna: TenorArr;
  charm: TenorArr;
  theta: TenorArr;
  vega: TenorArr;
}

export const TENOR_LABELS = ["0DTE", "1W", "2W", "M+"] as const;

const bucketIdx = (dte: number) => (dte <= 0 ? 0 : dte <= 7 ? 1 : dte <= 14 ? 2 : 3);

function bucketGrid(grid: StrikeExpiryHeatmap | null): Map<number, TenorArr> {
  const out = new Map<number, TenorArr>();
  if (!grid) return out;
  grid.strikes.forEach((strike, i) => {
    const arr: TenorArr = [0, 0, 0, 0];
    grid.values[i].forEach((v, ci) => {
      if (v === null) return;
      const dte = grid.columns[ci].dte;
      if (dte === null || dte === undefined) return; // unknown expiry - skipping is honest; defaulting to 0 would silently inflate the 0DTE tenor
      arr[bucketIdx(dte)] += v;
    });
    out.set(strike, arr);
  });
  return out;
}

export type TopoGrids = Record<HeatmapMetric, StrikeExpiryHeatmap | null>;

/** Nearest `count` strikes to spot with any grid data, ascending. */
export function buildTopoProfile(grids: TopoGrids, spot: number, count = 60): TopoRow[] {
  const maps = {
    gex: bucketGrid(grids.gex),
    dex: bucketGrid(grids.dex),
    vanna: bucketGrid(grids.vex),
    charm: bucketGrid(grids.cex),
    theta: bucketGrid(grids.tex),
    vega: bucketGrid(grids.vegaex),
  };

  const strikes = [...new Set(Object.values(maps).flatMap((m) => [...m.keys()]))]
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, count)
    .sort((a, b) => a - b);

  const get = (m: Map<number, TenorArr>, k: number): TenorArr => m.get(k) ?? ([0, 0, 0, 0] as TenorArr);
  return strikes.map((strike) => ({
    strike,
    gex: get(maps.gex, strike),
    dex: get(maps.dex, strike),
    vanna: get(maps.vanna, strike),
    charm: get(maps.charm, strike),
    theta: get(maps.theta, strike),
    vega: get(maps.vega, strike),
  }));
}
