/**
 * Strike x expiry "term profile" for the Terminal's 3D topography surface -
 * per strike, each major Greek's exposure across whatever real expiry
 * columns this fetch actually has (0DTE + next 5 - see y3osFeed.ts). No
 * coarse time-bucketing (there used to be a fixed 0DTE/1W/2W/M+ scheme) -
 * bucketing into "monthly+" implied a timeframe this app was never
 * actually fetching data for, which doesn't make sense to show as if it
 * were real.
 *
 * Built directly from the same six StrikeExpiryHeatmap grids the Terminal
 * heatmap renders (see strikeExpiryHeatmaps.ts) - one real, per-expiry
 * source for both views. Values are RAW, not scaled to $ - see
 * strikeExpiryHeatmaps.ts for why.
 */

import type { StrikeExpiryHeatmap, HeatmapMetric } from "@/lib/strikeExpiryHeatmaps";

export interface TopoRow {
  strike: number;
  gex: number[];
  dex: number[];
  vanna: number[];
  charm: number[];
  theta: number[];
  vega: number[];
}

function columnMap(grid: StrikeExpiryHeatmap | null): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!grid) return out;
  grid.strikes.forEach((strike, i) => {
    out.set(strike, grid.values[i].map((v) => v ?? 0));
  });
  return out;
}

export type TopoGrids = Record<HeatmapMetric, StrikeExpiryHeatmap | null>;

/** Column labels for whichever grid actually has columns (they all share the same fetch, so the same columns). */
export function topoTenorLabels(grids: TopoGrids): string[] {
  const grid = grids.gex ?? grids.dex ?? grids.vex ?? grids.cex ?? grids.tex ?? grids.vegaex;
  return grid?.columns.map((c) => c.label) ?? [];
}

/** Nearest `count` strikes to spot with any grid data, ascending. */
export function buildTopoProfile(grids: TopoGrids, spot: number, count = 60): TopoRow[] {
  const width = topoTenorLabels(grids).length || 1;
  const zero = () => new Array(width).fill(0);
  const maps = {
    gex: columnMap(grids.gex),
    dex: columnMap(grids.dex),
    vanna: columnMap(grids.vex),
    charm: columnMap(grids.cex),
    theta: columnMap(grids.tex),
    vega: columnMap(grids.vegaex),
  };

  const strikes = [...new Set(Object.values(maps).flatMap((m) => [...m.keys()]))]
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, count)
    .sort((a, b) => a - b);

  const get = (m: Map<number, number[]>, k: number): number[] => m.get(k) ?? zero();
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
