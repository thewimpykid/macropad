"use client";

import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { IvSmilePoint } from "@/lib/gex";

const STRIKE_WINDOW = 30; // ~+-15 strikes around spot

/** Strike x IV: real quoted call/put IV (scatter dots) against the session's fitted SVI smile (line) - where the raw quotes deviate from the fit is the smile's actual shape, not an assumption. */
export function IvSmileChart({ points, spot }: { points: IvSmilePoint[] | null | undefined; spot: number }) {
  if (!points || !points.length) {
    return <p className="m-0 py-16 text-center font-mono text-[0.72rem] text-[var(--text-faint)]">No IV data this request.</p>;
  }

  const rows = [...points]
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, STRIKE_WINDOW)
    .sort((a, b) => a.strike - b.strike)
    .map((p) => ({
      strike: p.strike,
      callIv: p.callIv !== null ? p.callIv * 100 : null,
      putIv: p.putIv !== null ? p.putIv * 100 : null,
      fittedIv: p.fittedIv * 100,
    }));

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" />
          <XAxis dataKey="strike" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
          {spot > 0 && <ReferenceLine x={spot} stroke="var(--text-faint)" strokeDasharray="3 3" label={{ value: "Spot", fill: "var(--text-faint)", fontSize: 10, position: "top" }} />}
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 3, fontSize: 11 }}
            labelFormatter={(s) => `Strike ${s}`}
            formatter={(v, name) => [`${Number(v).toFixed(2)}%`, name]}
          />
          <Line type="monotone" dataKey="fittedIv" name="Fitted (SVI)" stroke="var(--text-faint)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="callIv" name="Call IV (live)" stroke="var(--up)" strokeWidth={1.5} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="putIv" name="Put IV (live)" stroke="var(--down)" strokeWidth={1.5} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
