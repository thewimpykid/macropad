"use client";

import { AreaChart, Area, ReferenceLine, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import type { ExtraStat } from "@/lib/macroData";

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export default function SpecializedStatChart({ stat }: { stat: ExtraStat }) {
  const history = stat.history;
  const color = stat.flag ? "var(--down)" : "var(--steel)";

  return (
    <div
      className="rounded-[3px] border bg-[var(--panel-2)] p-3"
      style={{ borderColor: stat.flag ? "var(--down)" : "var(--border)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[0.7rem] font-medium text-[var(--text-dim)]">{stat.label}</div>
        {stat.flag && (
          <span className="font-mono text-[0.64rem] font-semibold text-[var(--down)]">⚑ flagged</span>
        )}
      </div>
      <div className="mt-0.5 font-mono text-[1.05rem] font-semibold" style={stat.flag ? { color: "var(--down)" } : undefined}>
        {stat.value}
      </div>
      {stat.caption && <p className="m-0 mt-1 text-[0.7rem] leading-snug text-[var(--text-faint)]">{stat.caption}</p>}

      {history && history.length >= 10 && (
        <div className="mt-2 h-[86px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: -26 }}>
              <XAxis dataKey="date" hide />
              <YAxis tick={{ fill: "var(--text-faint)", fontSize: 9 }} tickLine={false} axisLine={false} width={34} domain={["auto", "auto"]} />
              {stat.threshold !== undefined && (
                <ReferenceLine y={stat.threshold} stroke="var(--down)" strokeDasharray="3 3" strokeOpacity={0.6} />
              )}
              <ReferenceLine y={0} stroke="var(--border)" />
              <Tooltip
                contentStyle={{ background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 3, fontSize: 11 }}
                labelFormatter={(d) => fmtDate(String(d))}
                formatter={(v) => [Number(v).toFixed(3), stat.label]}
              />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.07} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {stat.windowLabel && (
        <div className="mt-1 font-mono text-[0.6rem] text-[var(--text-faint)]">{stat.windowLabel}</div>
      )}
    </div>
  );
}
