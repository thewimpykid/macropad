"use client";

import dynamic from "next/dynamic";
import { AreaChart, Area, ReferenceLine, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import type { MacroSeries } from "@/lib/macroData";

// three.js is by far the heaviest dependency in the app - keep it out of
// the main bundle and only fetch it when a news card actually renders.
const NewsGlobe = dynamic(() => import("@/components/NewsGlobe"), {
  ssr: false,
  loading: () => <div className="h-[360px] w-full border border-[var(--border)] bg-[var(--panel)]" aria-hidden />,
});

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const toneColor: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "var(--up)",
  bearish: "var(--down)",
  neutral: "var(--flat)",
};

const chipColor: Record<MacroSeries["status"], string> = {
  up: "var(--up)",
  down: "var(--down)",
  flat: "var(--flat)",
  pending: "var(--accent)",
};

const chipLabel: Record<MacroSeries["status"], string> = {
  up: "bullish",
  down: "bearish",
  flat: "neutral",
  pending: "pending",
};

export default function NewsFeedCard({ series }: { series: MacroSeries }) {
  const headlines = series.payload?.headlines ?? [];
  const history = series.history ?? [];

  return (
    <div className="border-b border-[var(--border)]">
      <div className="flex w-full items-center gap-3 py-6 text-left sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="m-0 truncate text-[1.15rem] font-semibold">{series.name}</h3>
            <span className="shrink-0 text-[0.72rem] font-semibold uppercase tracking-wide" style={{ color: chipColor[series.status] }}>
              {chipLabel[series.status]}
              {series.zscore !== null && ` ${series.zscore > 0 ? "+" : ""}${series.zscore.toFixed(2)}`}
            </span>
          </div>
          <p className="m-0 mt-1.5 truncate font-sans text-[0.86rem] text-[var(--text-dim)]">{series.note}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[1.5rem] font-semibold leading-none">{series.value}</div>
          <div className="mt-1.5 font-mono text-[0.72rem] text-[var(--text-faint)]">{series.windowLabel}</div>
        </div>
      </div>

      <div className="pb-8">
        {headlines.length === 0 ? (
            <p className="m-0 font-sans text-[0.85rem] text-[var(--text-faint)]">No data for this asset yet.</p>
          ) : (
            <>
              <NewsGlobe headlines={headlines} />

              <div className="mt-6">
                <div className="mb-1.5 font-sans text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                  Sentiment over time
                </div>
                <div className="h-[130px] w-full">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={130}>
                    <AreaChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
                      <defs>
                        <linearGradient id="news-sentiment-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tickFormatter={fmtDateTime} tick={{ fill: "var(--text-faint)", fontSize: 9 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={60} />
                      <YAxis domain={[-1, 1]} tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={false} width={30} ticks={[-1, 0, 1]} />
                      <ReferenceLine y={0} stroke="var(--border)" />
                      <Tooltip
                        contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 3, fontSize: 11 }}
                        labelFormatter={(d) => fmtDateTime(String(d))}
                        formatter={(v) => [Number(v).toFixed(2), "sentiment"]}
                      />
                      <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={1.5} fill="url(#news-sentiment-fill)" dot={{ r: 2 }} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="mt-6">
                <div className="mb-2 font-sans text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                  All {headlines.length} items, newest first
                </div>
                <div className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto pr-1">
                  {headlines.map((h, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3.5 py-2.5">
                      <span
                        className="mt-0.5 shrink-0 rounded-full border px-1.5 py-[2px] font-mono text-[0.6rem] font-bold uppercase tracking-wide"
                        style={{
                          color: toneColor[h.sentimentLabel],
                          borderColor: `color-mix(in srgb, ${toneColor[h.sentimentLabel]} 40%, var(--border))`,
                        }}
                      >
                        {h.sentimentScore > 0 ? "+" : ""}
                        {h.sentimentScore.toFixed(2)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {h.kind && h.kind !== "headline" && (
                            <span className="shrink-0 font-mono text-[0.58rem] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                              [DATA]
                            </span>
                          )}
                          {h.link ? (
                            <a href={h.link} target="_blank" rel="noopener noreferrer" className="font-sans text-[0.8rem] leading-snug text-[var(--text)] hover:text-[var(--accent)] hover:underline">
                              {h.title}
                            </a>
                          ) : (
                            <span className="font-sans text-[0.8rem] leading-snug text-[var(--text)]">{h.title}</span>
                          )}
                        </div>
                        {h.description && (
                          <p className="m-0 mt-0.5 font-sans text-[0.74rem] leading-snug text-[var(--text-dim)]">{h.description}</p>
                        )}
                        <div className="mt-0.5 font-mono text-[0.64rem] text-[var(--text-faint)]">
                          {fmtDateTime(h.pubDate)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
      </div>
    </div>
  );
}
