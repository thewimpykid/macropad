"use client";

import { fmtNum } from "@/lib/gex";
import type { WallMarker } from "@/components/optionsflow/TerminalChart";

export function MajorWallsPanel({ metricLabel, walls }: { metricLabel: string; walls: WallMarker[] }) {
  return (
    <div className="hud flex flex-col gap-3 border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="partno">Major Walls · {metricLabel}</div>
      <div className="flex flex-col gap-1.5">
        {walls.length ? (
          walls.map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-2 border-b border-[var(--border)] py-1.5 last:border-0">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: w.color, boxShadow: `0 0 6px ${w.color}` }} />
                <span className="font-mono text-[0.68rem] text-[var(--text-dim)]">{w.label}</span>
              </div>
              <span className="font-mono text-[0.78rem] font-semibold" style={{ color: w.color }}>
                {fmtNum(w.price, 2)}
              </span>
            </div>
          ))
        ) : (
          <p className="m-0 py-4 text-center font-mono text-[0.68rem] text-[var(--text-faint)]">No walls this request.</p>
        )}
      </div>
    </div>
  );
}
