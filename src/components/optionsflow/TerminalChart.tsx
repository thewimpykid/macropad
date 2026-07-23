"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { fmtNum, fmtUsd } from "@/lib/gex";
import { fmtStrikeLabel, layoutAroundPivot } from "@/components/optionsflow/labelLayout";

export interface TerminalMetricPoint {
  strike: number;
  value: number;
}

export interface WallMarker {
  label: string;
  price: number;
  color: string;
  /** true for the #2-ranked walls - rendered at reduced weight so primaries stay dominant. */
  dim?: boolean;
}

/** Actual walls: the strikes carrying the largest exposure for the selected Greek, ranked, split by side. Positive-side strikes are dealer-sign-convention "call-like" for every Greek except DEX (which keeps its own natural, unflipped delta sign - see gex.ts), so DEX gets Long/Short labels instead of Call/Put. */
export function computeTopWalls(rows: TerminalMetricPoint[], metric: string, count = 2): WallMarker[] {
  const posLabel = metric === "dex" ? "Long Wall" : "Call Wall";
  const negLabel = metric === "dex" ? "Short Wall" : "Put Wall";
  const positives = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, count);
  const negatives = [...rows].filter((r) => r.value < 0).sort((a, b) => a.value - b.value).slice(0, count);
  return [
    ...positives.map((r, i) => ({ label: i === 0 ? posLabel : `${posLabel} #${i + 1}`, price: r.strike, color: "var(--up)", dim: i > 0 })),
    ...negatives.map((r, i) => ({ label: i === 0 ? negLabel : `${negLabel} #${i + 1}`, price: r.strike, color: "var(--down)", dim: i > 0 })),
  ];
}

/**
 * Right-margin label for a horizontal ReferenceLine, with a background halo
 * (so it stays readable over gridlines/bars) and an optional dashed elbow
 * leader when the collision layout has displaced it from its true line.
 */
function RefLineLabel({
  viewBox,
  value,
  fill,
  dy = 0,
  dim = false,
  bold = false,
}: {
  viewBox?: { x: number; y: number; width: number };
  value: string;
  fill: string;
  dy?: number;
  dim?: boolean;
  bold?: boolean;
}) {
  if (!viewBox) return null;
  const lx = viewBox.x + viewBox.width;
  const ty = viewBox.y + dy;
  return (
    <g opacity={dim ? 0.55 : 1}>
      {Math.abs(dy) > 1 && <path d={`M ${lx} ${viewBox.y} L ${lx + 5} ${ty}`} stroke={fill} strokeDasharray="2 2" fill="none" opacity={0.5} />}
      <text
        x={lx + 7}
        y={ty + 3}
        fill={fill}
        fontSize={10}
        fontWeight={bold ? 700 : 400}
        fontFamily="var(--font-data), monospace"
        stroke="var(--panel)"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {value}
      </text>
    </g>
  );
}

/**
 * Collision layout for the right-margin level labels: category rows are
 * evenly spaced, so each label's ideal y is derived from its snapped strike's
 * row index, then everything is spread around the spot label (immovable)
 * via the same lane layout the spine uses. Returns dy per wall label.
 */
function layoutWallLabelDy(
  wallLines: (WallMarker & { snappedStrike: number })[],
  strikes: number[],
  nearestIdx: number,
  height: number
): Map<string, number> {
  const AXIS_H = 30; // recharts default XAxis height
  const MT = 4;
  const plotH = Math.max(0, height - MT - 4 - AXIS_H);
  const rowH = strikes.length ? plotH / strikes.length : 0;
  const approxY = (idx: number) => MT + rowH * (idx + 0.5);
  const withIdx = wallLines.map((w) => ({ ...w, idx: strikes.indexOf(w.snappedStrike) }));
  const laid = layoutAroundPivot(
    withIdx.map((w) => ({ key: w.label, y: approxY(w.idx) })),
    approxY(nearestIdx),
    { pivotGap: 14, minGap: 13, top: MT + 6, bottom: MT + plotH - 4 }
  );
  return new Map(withIdx.map((w) => [w.label, (laid.get(w.label) ?? approxY(w.idx)) - approxY(w.idx)]));
}

/** Horizontal diverging bar chart - strike on the Y axis, exposure on the X axis - matching a classic options-terminal gamma profile. Optional wall/pain/flip reference lines snap to the nearest strike actually present in the data (a category axis can only draw a line exactly on one of its ticks). */
export function TerminalExposureChart({
  data,
  unitLabel,
  spot,
  walls,
  height = 420,
  showAllTicks = false,
  valueFormatter = fmtUsd,
}: {
  data: TerminalMetricPoint[];
  unitLabel: string;
  spot: number;
  walls?: WallMarker[];
  height?: number;
  showAllTicks?: boolean;
  /** Defaults to $-formatted (this app's own self-computed exposure is real dollars); pass fmtRaw for /heatmap-sourced values, which are a raw magnitude proxy, not dollars. */
  valueFormatter?: (n: number | null | undefined) => string;
}) {
  const sorted = [...data].sort((a, b) => b.strike - a.strike);
  const nearestIdx = sorted.reduce((best, d, i) => (Math.abs(d.strike - spot) < Math.abs(sorted[best].strike - spot) ? i : best), 0);

  const wallLines = (walls ?? [])
    .map((w) => {
      const nearest = sorted.reduce((best, d) => (Math.abs(d.strike - w.price) < Math.abs(best.strike - w.price) ? d : best), sorted[0]);
      return nearest ? { ...w, snappedStrike: nearest.strike } : null;
    })
    .filter((w): w is WallMarker & { snappedStrike: number } => w !== null);
  const labelDy = layoutWallLabelDy(wallLines, sorted.map((d) => d.strike), nearestIdx, height);
  const wallStrikes = new Set(wallLines.map((w) => w.snappedStrike));

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 104, bottom: 4, left: 0 }} barCategoryGap="15%">
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={(v) => valueFormatter(Number(v))} />
          <YAxis
            type="category"
            dataKey="strike"
            tick={{ fill: "var(--text-faint)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={58}
            interval={showAllTicks ? 0 : Math.max(0, Math.floor(sorted.length / 20))}
          />
          <ReferenceLine x={0} stroke="var(--border-strong)" />
          {wallLines.map((w) => (
            <ReferenceLine
              key={w.label}
              y={w.snappedStrike}
              stroke={w.color}
              strokeOpacity={w.dim ? 0.4 : 0.8}
              strokeDasharray="4 3"
              label={<RefLineLabel value={`${w.label} ${fmtStrikeLabel(w.price)}`} fill={w.color} dy={labelDy.get(w.label) ?? 0} dim={w.dim} />}
            />
          ))}
          {sorted[nearestIdx] && (
            <ReferenceLine
              y={sorted[nearestIdx].strike}
              stroke="var(--text)"
              strokeDasharray="2 2"
              label={<RefLineLabel value={`Spot ${fmtNum(spot, 2)}`} fill="var(--text)" bold />}
            />
          )}
          <Tooltip
            cursor={{ fill: "var(--panel-2)", opacity: 0.5 }}
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 3, fontSize: 11 }}
            labelFormatter={(s) => `Strike ${s}`}
            formatter={(v) => [`${valueFormatter(Number(v))} ${unitLabel}`, unitLabel]}
          />
          <Bar dataKey="value" isAnimationActive={false} radius={[2, 2, 2, 2]}>
            {sorted.map((d, i) => (
              <Cell
                key={i}
                fill={d.value >= 0 ? "var(--up)" : "var(--down)"}
                fillOpacity={wallStrikes.has(d.strike) ? 0.95 : i === nearestIdx ? 0.8 : 0.5}
                stroke={i === nearestIdx ? "var(--text)" : undefined}
                strokeWidth={i === nearestIdx ? 1 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DualBarPoint {
  strike: number;
  up: number;
  down: number;
}

/** "Both" view - up-move and down-move scenario bars side by side per strike, so the two directions can be compared at a glance instead of toggling between them. */
export function TerminalDualBarChart({
  data,
  unitLabel,
  spot,
  walls,
  height = 420,
  showAllTicks = false,
  valueFormatter = fmtUsd,
}: {
  data: DualBarPoint[];
  unitLabel: string;
  spot: number;
  walls?: WallMarker[];
  height?: number;
  showAllTicks?: boolean;
  valueFormatter?: (n: number | null | undefined) => string;
}) {
  const sorted = [...data].sort((a, b) => b.strike - a.strike);
  const nearestIdx = sorted.reduce((best, d, i) => (Math.abs(d.strike - spot) < Math.abs(sorted[best].strike - spot) ? i : best), 0);

  const wallLines = (walls ?? [])
    .map((w) => {
      const nearest = sorted.reduce((best, d) => (Math.abs(d.strike - w.price) < Math.abs(best.strike - w.price) ? d : best), sorted[0]);
      return nearest ? { ...w, snappedStrike: nearest.strike } : null;
    })
    .filter((w): w is WallMarker & { snappedStrike: number } => w !== null);
  const labelDy = layoutWallLabelDy(wallLines, sorted.map((d) => d.strike), nearestIdx, height);
  const wallStrikes = new Set(wallLines.map((w) => w.snappedStrike));

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 104, bottom: 4, left: 0 }} barCategoryGap="20%" barGap={1}>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={(v) => valueFormatter(Number(v))} />
          <YAxis
            type="category"
            dataKey="strike"
            tick={{ fill: "var(--text-faint)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={58}
            interval={showAllTicks ? 0 : Math.max(0, Math.floor(sorted.length / 20))}
          />
          <ReferenceLine x={0} stroke="var(--border-strong)" />
          {wallLines.map((w) => (
            <ReferenceLine
              key={w.label}
              y={w.snappedStrike}
              stroke={w.color}
              strokeOpacity={w.dim ? 0.4 : 0.8}
              strokeDasharray="4 3"
              label={<RefLineLabel value={`${w.label} ${fmtStrikeLabel(w.price)}`} fill={w.color} dy={labelDy.get(w.label) ?? 0} dim={w.dim} />}
            />
          ))}
          {sorted[nearestIdx] && (
            <ReferenceLine
              y={sorted[nearestIdx].strike}
              stroke="var(--text)"
              strokeDasharray="2 2"
              label={<RefLineLabel value={`Spot ${fmtNum(spot, 2)}`} fill="var(--text)" bold />}
            />
          )}
          <Tooltip
            cursor={{ fill: "var(--panel-2)", opacity: 0.5 }}
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 3, fontSize: 11 }}
            labelFormatter={(s) => `Strike ${s}`}
            formatter={(v, name) => [`${valueFormatter(Number(v))} ${unitLabel}`, name === "up" ? "+move" : "-move"]}
          />
          <Bar dataKey="up" isAnimationActive={false} radius={[2, 2, 2, 2]}>
            {sorted.map((d, i) => (
              <Cell
                key={i}
                fill="var(--up)"
                fillOpacity={wallStrikes.has(d.strike) ? 0.95 : i === nearestIdx ? 0.8 : 0.5}
                stroke={i === nearestIdx ? "var(--text)" : undefined}
                strokeWidth={i === nearestIdx ? 1 : 0}
              />
            ))}
          </Bar>
          <Bar dataKey="down" isAnimationActive={false} radius={[2, 2, 2, 2]}>
            {sorted.map((d, i) => (
              <Cell
                key={i}
                fill="var(--down)"
                fillOpacity={wallStrikes.has(d.strike) ? 0.95 : i === nearestIdx ? 0.8 : 0.5}
                stroke={i === nearestIdx ? "var(--text)" : undefined}
                strokeWidth={i === nearestIdx ? 1 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Alternate diverging color pairs for the heatmap - a plain up/down pair, a colorblind-friendly blue/orange pair, and a single-hue magnitude ramp for when direction matters less than concentration. */
const HEATMAP_PALETTES: { id: string; label: string; pos: string; neg: string; mono?: boolean }[] = [
  { id: "default", label: "DEFAULT", pos: "var(--up)", neg: "var(--down)" },
  { id: "blue-orange", label: "BLUE/ORANGE", pos: "#3b82f6", neg: "#f97316" },
  { id: "violet-gold", label: "VIOLET/GOLD", pos: "#a78bfa", neg: "#facc15" },
  { id: "heat", label: "HEAT", pos: "#f97316", neg: "#f97316", mono: true },
];

function divergingColor(value: number, maxAbs: number, palette: (typeof HEATMAP_PALETTES)[number]): string {
  if (maxAbs <= 0) return "var(--panel-2)";
  const t = Math.max(-1, Math.min(1, value / maxAbs));
  const pct = Math.round(Math.pow(Math.abs(t), 0.6) * 85);
  const base = palette.mono ? palette.pos : t >= 0 ? palette.pos : palette.neg;
  return `color-mix(in srgb, ${base} ${pct}%, var(--panel-2) ${100 - pct}%)`;
}

export interface StrikeExpiryHeatmapData {
  columns: { label: string; dte: number | null }[];
  strikes: number[];
  values: (number | null)[][];
}

/** Strike x expiry grid for one selected Greek: rows are strikes (highest at top), columns are expirations, cell color diverges call-green/put-pink by magnitude. Overlays dashed reference lines for the walls/flip passed in. Scrollable (own max-height, sticky strike column + expiry footer), hoverable (per-cell highlight), and clickable (pins a detail readout instead of relying on the native title tooltip). */
export function StrikeExpiryHeatmapChart({
  grid,
  spot,
  walls,
  unitLabel,
  valueFormatter = fmtUsd,
}: {
  grid: StrikeExpiryHeatmapData | null;
  spot: number;
  walls: WallMarker[];
  unitLabel: string;
  /** Defaults to $-formatted; pass fmtRaw when the grid comes from /heatmap - see TerminalExposureChart. */
  valueFormatter?: (n: number | null | undefined) => string;
}) {
  const [palIdx, setPalIdx] = useState(0);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [pinned, setPinned] = useState<{ r: number; c: number } | null>(null);

  if (!grid || !grid.strikes.length) return <p className="m-0 py-12 text-center font-mono text-[0.75rem] text-[var(--text-faint)]">No cross-expiry data this request.</p>;

  const rows = [...grid.strikes].map((strike, i) => ({ strike, cells: grid.values[i] })).sort((a, b) => b.strike - a.strike);
  const maxAbs = Math.max(1, ...rows.flatMap((r) => r.cells.filter((c): c is number => c !== null).map((c) => Math.abs(c))));
  const spotRowIdx = rows.reduce((best, r, i) => (Math.abs(r.strike - spot) < Math.abs(rows[best].strike - spot) ? i : best), 0);
  const pal = HEATMAP_PALETTES[palIdx];
  const active = hover ?? pinned;
  const activeCell = active ? rows[active.r]?.cells[active.c] ?? null : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 min-h-[1.2em] font-mono text-[0.62rem] text-[var(--text-faint)]">
          {active && activeCell !== null
            ? `$${fmtNum(rows[active.r].strike, 0)} @ ${grid.columns[active.c].label}: ${valueFormatter(activeCell)} ${unitLabel}${pinned && !hover ? " (pinned - click again to unpin)" : ""}`
            : "hover or click a cell for detail"}
        </p>
        <div className="flex items-center gap-1">
          {HEATMAP_PALETTES.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setPalIdx(i)}
              title={p.label}
              className="h-3.5 w-3.5 rounded-[2px] border transition-transform duration-150 hover:scale-125"
              style={{
                borderColor: i === palIdx ? "var(--text)" : "var(--border)",
                background: p.mono ? p.pos : `linear-gradient(135deg, ${p.pos}, ${p.neg})`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex max-h-[420px] flex-1 flex-col gap-px overflow-auto">
          {rows.map((row, rowIdx) => {
            const wall = walls.find((w) => Math.abs(w.price - row.strike) < (rows[0].strike - rows[Math.min(rows.length - 1, 1)].strike || 1) / 2);
            return (
              <div key={row.strike} className="relative flex items-stretch gap-px">
                <div
                  className="sticky left-0 z-10 flex w-14 shrink-0 items-center justify-end bg-[var(--panel)] pr-2 font-mono text-[0.62rem] text-[var(--text-faint)]"
                  style={{ fontWeight: rowIdx === spotRowIdx ? 700 : 400, color: rowIdx === spotRowIdx ? "var(--text)" : undefined }}
                >
                  ${fmtNum(row.strike, 0)}
                </div>
                <div className="flex flex-1 gap-px">
                  {row.cells.map((c, colIdx) => {
                    const isActive = active?.r === rowIdx && active?.c === colIdx;
                    return (
                      <div
                        key={colIdx}
                        onMouseEnter={() => setHover({ r: rowIdx, c: colIdx })}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => setPinned((p) => (p?.r === rowIdx && p?.c === colIdx ? null : { r: rowIdx, c: colIdx }))}
                        className="flex h-6 flex-1 cursor-pointer items-center justify-center font-mono text-[0.6rem] font-semibold transition-[transform,filter] duration-150 ease-out"
                        style={{
                          background: c !== null ? divergingColor(c, maxAbs, pal) : "var(--panel-2)",
                          color: "rgba(255,255,255,0.92)",
                          transform: isActive ? "scale(1.12)" : "scale(1)",
                          filter: isActive ? "brightness(1.35)" : "brightness(1)",
                          boxShadow: isActive ? "0 0 0 1px var(--text) inset" : undefined,
                          zIndex: isActive ? 5 : undefined,
                        }}
                      >
                        {c !== null ? valueFormatter(c) : ""}
                      </div>
                    );
                  })}
                </div>
                {rowIdx === spotRowIdx && <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-[var(--text)]" />}
                {wall && (
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed" style={{ borderColor: wall.color }}>
                    <span className="absolute right-0 -translate-y-1/2 rounded-[2px] border px-1.5 py-0.5 font-mono text-[0.56rem] font-semibold" style={{ borderColor: wall.color, color: wall.color, background: "var(--panel)" }}>
                      {wall.label} {fmtNum(wall.price, 2)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          <div className="sticky bottom-0 flex gap-px bg-[var(--panel)] pl-14">
            {grid.columns.map((c, i) => (
              <div key={i} className="flex-1 text-center font-mono text-[0.56rem] text-[var(--text-faint)]">
                {c.label}
              </div>
            ))}
          </div>
        </div>
        <div className="flex w-6 shrink-0 flex-col items-center gap-1">
          <span className="font-mono text-[0.5rem] text-[var(--text-faint)]">MAX</span>
          <div className="w-2 flex-1 rounded-[2px]" style={{ background: pal.mono ? `linear-gradient(to bottom, ${pal.pos}, var(--panel-2))` : `linear-gradient(to bottom, ${pal.pos}, var(--panel-2), ${pal.neg})` }} />
          <span className="font-mono text-[0.5rem] text-[var(--text-faint)]">MAX</span>
        </div>
      </div>
    </div>
  );
}
