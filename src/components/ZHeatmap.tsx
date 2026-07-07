"use client";

import { useMemo, useState } from "react";
import type { HistoryPoint } from "@/lib/macroData";
import { rollingZScore } from "@/lib/stats";

/**
 * Rolling z-score swept across several lookback windows, as a window × time
 * heat grid. A reading that stays hot down an entire column is robust to
 * window choice; one hot in a single row is a lookback artifact. Replaces
 * the old 3D surface — same data, actually readable.
 *
 * Diverging scale: steel (below trailing mean) ↔ neutral ↔ brass (above).
 * Deliberately NOT green/red — raw sign is not good/bad; that mapping
 * belongs to the bias layer.
 */
export default function ZHeatmap({ history }: { history: HistoryPoint[] }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  const { windows, dates, grid } = useMemo(() => {
    const n = history.length;
    const candidates = [10, 20, 30, 45, 60, 90, 120, 180];
    const windows = candidates.filter((w) => w <= Math.floor(n / 2)).slice(0, 8);
    const values = history.map((h) => h.value);
    const maxCols = 120;
    const stride = Math.max(1, Math.ceil(n / maxCols));
    const colIdx: number[] = [];
    for (let i = n - 1; i >= 0; i -= stride) colIdx.unshift(i);
    const grid = windows.map((w) => {
      const z = rollingZScore(values, w);
      return colIdx.map((i) => z[i]);
    });
    return { windows, dates: colIdx.map((i) => history[i].date), grid };
  }, [history]);

  if (windows.length < 3) return null;

  const cellW = 100 / dates.length;
  const rowH = 16;
  const height = windows.length * rowH;

  const color = (z: number | null): string => {
    if (z === null) return "transparent";
    const t = Math.max(-1, Math.min(1, z / 2.5));
    const alpha = Math.abs(t) * 0.92 + 0.04;
    // steel for negative, brass for positive — neutral fades to the surface
    return t >= 0 ? `rgba(189, 130, 38, ${alpha})` : `rgba(94, 150, 216, ${alpha})`;
  };

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", year: "2-digit" });

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="flex shrink-0 flex-col justify-between py-[2px] text-right font-mono text-[0.6rem] leading-none text-[var(--text-faint)]">
          {windows.map((w) => (
            <div key={w} style={{ height: rowH - 2 }} className="flex items-center justify-end">
              {w}p
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <svg
            width="100%"
            height={height}
            preserveAspectRatio="none"
            className="block rounded-[3px] border border-[var(--border)] bg-[var(--panel-2)]"
            onMouseLeave={() => setHover(null)}
          >
            {grid.map((row, ri) =>
              row.map((z, ci) =>
                z === null ? null : (
                  <rect
                    key={`${ri}-${ci}`}
                    x={`${ci * cellW}%`}
                    y={ri * rowH}
                    width={`${cellW + 0.05}%`}
                    height={rowH - 1}
                    fill={color(z)}
                    onMouseEnter={(e) => {
                      const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setHover({
                        x: ((e.clientX - box.left) / box.width) * 100,
                        y: ri * rowH,
                        text: `${fmtDate(dates[ci])} · ${windows[ri]}p window · ${z > 0 ? "+" : ""}${z.toFixed(2)}σ`,
                      });
                    }}
                  />
                )
              )
            )}
          </svg>
          <div className="mt-1 flex justify-between font-mono text-[0.6rem] text-[var(--text-faint)]">
            <span>{fmtDate(dates[0])}</span>
            <span>{fmtDate(dates[Math.floor(dates.length / 2)])}</span>
            <span>{fmtDate(dates[dates.length - 1])}</span>
          </div>
        </div>
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-[3px] border border-[var(--border-strong)] bg-[var(--panel)] px-2 py-1 font-mono text-[0.66rem] text-[var(--text)]"
          style={{ left: `${hover.x}%`, top: hover.y - 30 }}
        >
          {hover.text}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-3 text-[0.64rem] text-[var(--text-faint)]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: "rgba(94,150,216,0.9)" }} />
          below trailing mean
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: "rgba(189,130,38,0.9)" }} />
          above trailing mean
        </span>
        <span>rows = lookback windows</span>
      </div>
    </div>
  );
}
