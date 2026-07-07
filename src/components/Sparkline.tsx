"use client";

import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";

export default function Sparkline({
  data,
  tone,
  heightClass = "h-12",
}: {
  data: number[];
  tone: "up" | "down" | "flat" | "pending";
  heightClass?: string;
}) {
  const color =
    tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : tone === "flat" ? "var(--flat)" : "var(--accent)";
  const points = data.map((v, i) => ({ i, v }));
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pad = (max - min) * 0.12 || 1;

  return (
    <div className={`${heightClass} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 3, right: 1, bottom: 1, left: 1 }}>
          <YAxis domain={[min - pad, max + pad]} hide />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={color}
            fillOpacity={0.07}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
