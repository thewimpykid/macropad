"use client";

/**
 * The Spine - this terminal's signature exposure visual, deliberately NOT a
 * horizontal diverging bar chart (the form every GEX dashboard shares).
 * A central vertical strike ruler runs the full height of the page; the
 * selected Greek's per-strike exposure grows off it as two smooth mirrored
 * terrain lobes (positive/call-side right, negative/put-side left). Spot is
 * a live cursor riding the ruler, the ±1σ expected move is a bracket on the
 * left margin, and walls/flip/max-pain hang off the right edge as
 * engineering-drawing callouts. Hover reads out any strike. Pure SVG sized
 * by a ResizeObserver - no chart library, nothing borrowed.
 */

import { useEffect, useRef, useState } from "react";
import { fmtNum } from "@/lib/gex";

export interface SpinePoint {
  strike: number;
  /** Right-lobe magnitude (>= 0): positive/call-side exposure, or the +move scenario. */
  right: number;
  /** Left-lobe magnitude (>= 0): negative/put-side exposure, or the -move scenario. */
  left: number;
  /** Pre-formatted value(s) for the hover readout. */
  readout: string;
}

export interface SpineAnnotation {
  label: string;
  price: number;
  color: string;
}

function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Catmull-Rom -> cubic bezier through every point, with control-point x clamped so the terrain never overshoots across its own baseline. */
function smoothPath(pts: { x: number; y: number }[], clampX: (x: number) => number): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = clampX(p1.x + (p2.x - p0.x) / 6);
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = clampX(p2.x - (p3.x - p1.x) / 6);
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function SpineProfile({
  points,
  spot,
  tickDir,
  annotations,
  band,
  lobeLabels,
  height = 620,
}: {
  points: SpinePoint[];
  spot: number;
  tickDir: "up" | "down" | null;
  annotations: SpineAnnotation[];
  /** Expected-move bracket [lo, hi] in price - omitted when the request carried no expected move. */
  band: { lo: number; hi: number } | null;
  /** [leftLobe, rightLobe] footer captions, e.g. ["− GEX", "+ GEX"] or ["−1.2% move", "+1.2% move"]. */
  lobeLabels: [string, string];
  height?: number;
}) {
  const [containerRef, width] = useMeasuredWidth();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!points.length) {
    return (
      <div ref={containerRef} className="flex items-center justify-center" style={{ height }}>
        <span className="font-mono text-[0.7rem] text-[var(--text-faint)]">No exposure data this request.</span>
      </div>
    );
  }

  const sorted = [...points].sort((a, b) => b.strike - a.strike); // top = highest strike
  const strikes = sorted.map((p) => p.strike);

  const m = { top: 16, bottom: 24, left: 26, right: 118 };
  const innerH = height - m.top - m.bottom;
  const plotW = Math.max(0, width - m.left - m.right);
  const bandW = 46; // central strike-ruler band
  const lobeW = Math.max(0, (plotW - bandW) / 2);
  const axisL = m.left + lobeW;
  const axisR = axisL + bandW;

  const rawLo = Math.min(...strikes, spot, band ? band.lo : Infinity);
  const rawHi = Math.max(...strikes, spot, band ? band.hi : -Infinity);
  const pad = (rawHi - rawLo || spot * 0.004) * 0.03;
  const lo = rawLo - pad;
  const hi = rawHi + pad;
  const y = (p: number) => m.top + ((hi - p) / (hi - lo)) * innerH;

  const maxAbs = Math.max(1e-9, ...sorted.flatMap((p) => [p.right, p.left]));
  const xRight = (v: number) => axisR + (v / maxAbs) * lobeW * 0.94;
  const xLeft = (v: number) => axisL - (v / maxAbs) * lobeW * 0.94;

  const rightPts = sorted.map((p) => ({ x: xRight(p.right), y: y(p.strike) }));
  const leftPts = sorted.map((p) => ({ x: xLeft(p.left), y: y(p.strike) }));
  const rightCurve = smoothPath(rightPts, (x) => Math.max(axisR, x));
  const leftCurve = smoothPath(leftPts, (x) => Math.min(axisL, x));
  const rightArea = rightCurve
    ? `M ${axisR} ${rightPts[0].y.toFixed(1)} L ${rightPts[0].x.toFixed(1)} ${rightPts[0].y.toFixed(1)} ${rightCurve.slice(rightCurve.indexOf("C") - 1)} L ${axisR} ${rightPts[rightPts.length - 1].y.toFixed(1)} Z`
    : "";
  const leftArea = leftCurve
    ? `M ${axisL} ${leftPts[0].y.toFixed(1)} L ${leftPts[0].x.toFixed(1)} ${leftPts[0].y.toFixed(1)} ${leftCurve.slice(leftCurve.indexOf("C") - 1)} L ${axisL} ${leftPts[leftPts.length - 1].y.toFixed(1)} Z`
    : "";

  // Ruler labels: at most ~11, always including the extremes.
  const step = Math.max(1, Math.ceil(strikes.length / 11));
  const ruled = sorted.filter((_, i) => i % step === 0 || i === sorted.length - 1);

  // Right-margin callouts, nudged apart vertically; leaders stay at true price.
  const minGap = 15;
  const callouts = annotations
    .filter((a) => a.price >= lo && a.price <= hi)
    .map((a) => ({ ...a, ly: y(a.price) }))
    .sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < callouts.length; i++) {
    if (callouts[i].ly - callouts[i - 1].ly < minGap) callouts[i].ly = callouts[i - 1].ly + minGap;
  }
  const overflowY = callouts.length ? callouts[callouts.length - 1].ly - (height - m.bottom) : 0;
  if (overflowY > 0) for (const c of callouts) c.ly = Math.max(m.top, c.ly - overflowY);

  const spotY = y(spot);
  const hover = hoverIdx !== null ? sorted[hoverIdx] : null;

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const py = e.clientY - rect.top + m.top;
    let best = 0;
    let bestD = Infinity;
    sorted.forEach((p, i) => {
      const d = Math.abs(y(p.strike) - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHoverIdx(best);
  }

  return (
    <div ref={containerRef} className="w-full">
      {width > 120 && (
        <svg width={width} height={height} className="block">
          {/* expected-move bracket, left margin */}
          {band && (
            <g stroke="var(--text-faint)" fill="none" style={{ transition: "all 700ms var(--ease-out)" }}>
              <path d={`M ${m.left - 8} ${y(band.hi)} h -6 V ${y(band.lo)} h 6`} />
              <text
                x={m.left - 18}
                y={(y(band.hi) + y(band.lo)) / 2}
                fill="var(--text-faint)"
                fontSize={8.5}
                fontFamily="var(--font-data), monospace"
                textAnchor="middle"
                transform={`rotate(-90 ${m.left - 18} ${(y(band.hi) + y(band.lo)) / 2})`}
              >
                ±1σ
              </text>
            </g>
          )}

          {/* terrain lobes */}
          {leftArea && <path d={leftArea} fill="var(--down)" opacity={0.09} />}
          {leftCurve && <path d={leftCurve} stroke="var(--down)" strokeWidth={1} fill="none" opacity={0.85} />}
          {rightArea && <path d={rightArea} fill="var(--up)" opacity={0.09} />}
          {rightCurve && <path d={rightCurve} stroke="var(--up)" strokeWidth={1} fill="none" opacity={0.85} />}

          {/* central strike ruler */}
          <line x1={axisL} y1={m.top} x2={axisL} y2={height - m.bottom} stroke="var(--border-strong)" />
          <line x1={axisR} y1={m.top} x2={axisR} y2={height - m.bottom} stroke="var(--border-strong)" />
          {sorted.map((p) => (
            <line key={p.strike} x1={axisL} y1={y(p.strike)} x2={axisL + 4} y2={y(p.strike)} stroke="var(--border-strong)" />
          ))}
          {ruled.map((p) => (
            <text
              key={p.strike}
              x={axisL + bandW / 2}
              y={y(p.strike) + 2.5}
              fill="var(--text-faint)"
              fontSize={8.5}
              fontFamily="var(--font-data), monospace"
              textAnchor="middle"
            >
              {fmtNum(p.strike, 0)}
            </text>
          ))}

          {/* level callouts, right margin */}
          {callouts.map((c) => (
            <g key={c.label}>
              <line x1={axisR} y1={y(c.price)} x2={width - m.right + 6} y2={c.ly} stroke={c.color} strokeDasharray="3 3" opacity={0.55} />
              <text x={width - m.right + 10} y={c.ly + 2.5} fill={c.color} fontSize={8.5} fontFamily="var(--font-data), monospace" letterSpacing="0.08em">
                {c.label.toUpperCase()} {fmtNum(c.price, 2)}
              </text>
            </g>
          ))}

          {/* live spot cursor */}
          <g style={{ transform: `translateY(${spotY}px)`, transition: "transform 700ms var(--ease-out)" }}>
            <line x1={m.left} y1={0} x2={width - m.right} y2={0} stroke="var(--text)" strokeWidth={1} />
            <rect x={width - m.right + 4} y={-8} width={m.right - 10} height={16} fill="var(--text)" />
            <text x={width - m.right + 9} y={3.5} fill="var(--bg)" fontSize={9.5} fontWeight={700} fontFamily="var(--font-data), monospace">
              {tickDir ? (tickDir === "up" ? "▲ " : "▼ ") : ""}
              {fmtNum(spot, 2)}
            </text>
          </g>

          {/* hover crosshair + readout */}
          {hover && (
            <g pointerEvents="none">
              <line x1={m.left} y1={y(hover.strike)} x2={width - m.right} y2={y(hover.strike)} stroke="var(--text-dim)" strokeDasharray="2 3" />
              <text x={m.left} y={m.top - 5} fill="var(--text-dim)" fontSize={9} fontFamily="var(--font-data), monospace">
                {fmtNum(hover.strike, 0)} · {hover.readout}
              </text>
            </g>
          )}
          <rect
            x={m.left}
            y={m.top}
            width={Math.max(0, width - m.left - m.right)}
            height={innerH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHoverIdx(null)}
          />

          {/* lobe captions */}
          <text x={m.left} y={height - 8} fill="var(--text-faint)" fontSize={8.5} fontFamily="var(--font-data), monospace" letterSpacing="0.1em">
            {lobeLabels[0].toUpperCase()}
          </text>
          <text x={width - m.right} y={height - 8} fill="var(--text-faint)" fontSize={8.5} fontFamily="var(--font-data), monospace" letterSpacing="0.1em" textAnchor="end">
            {lobeLabels[1].toUpperCase()}
          </text>
        </svg>
      )}
      {width <= 120 && <div style={{ height }} />}
    </div>
  );
}
