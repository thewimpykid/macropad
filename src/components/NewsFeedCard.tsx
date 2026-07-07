"use client";

import { useMemo, useState } from "react";
import { AreaChart, Area, ReferenceLine, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import type { MacroSeries, NewsHeadlinePayload } from "@/lib/macroData";

function toneColor(label: NewsHeadlinePayload["sentimentLabel"]): string {
  return label === "bullish" ? "var(--up)" : label === "bearish" ? "var(--down)" : "var(--text-faint)";
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / (60 * 24))}d`;
}

type Filter = "all" | "bullish" | "bearish";

/**
 * Pooled headlines scored by a transparent keyword lexicon (see
 * sentiment.ts). Deliberately NOT presented as a market signal — it's a
 * scored reading list plus a tape-average trace.
 */
export default function NewsFeedCard({ series }: { series: MacroSeries }) {
  const [filter, setFilter] = useState<Filter>("all");
  const headlines = series.payload?.headlines ?? [];

  const shown = useMemo(
    () => (filter === "all" ? headlines : headlines.filter((h) => h.sentimentLabel === filter)),
    [headlines, filter]
  );

  const rollingAvg = useMemo(() => {
    if (!series.history || series.history.length < 5) return null;
    const window = 10;
    return series.history.map((p, i, arr) => {
      const slice = arr.slice(Math.max(0, i - window + 1), i + 1);
      return { date: p.date, value: slice.reduce((a, b) => a + b.value, 0) / slice.length };
    });
  }, [series.history]);

  if (headlines.length === 0) return null;

  const bull = headlines.filter((h) => h.sentimentLabel === "bullish").length;
  const bear = headlines.filter((h) => h.sentimentLabel === "bearish").length;

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[1rem] font-semibold">News Sentiment</h3>
          <p className="m-0 mt-0.5 text-[0.74rem] text-[var(--text-faint)]">
            {headlines.length} pooled headlines scored by a fixed keyword lexicon — reproducible, not an NLP model.
            A noisy directional read across many headlines, never a verdict on one.
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono text-[0.78rem]">
          <span className="text-[var(--up)]">{bull}▲</span>
          <span className="text-[var(--down)]">{bear}▼</span>
        </div>
      </div>

      {rollingAvg && (
        <div className="border-b border-[var(--border)] px-5 py-3">
          <div className="mb-1 text-[0.66rem] text-[var(--text-faint)]">
            Rolling 10-headline average score, oldest → newest
          </div>
          <div className="h-[64px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rollingAvg} margin={{ top: 3, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="date" hide />
                <YAxis domain={[-0.6, 0.6]} hide />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Tooltip
                  contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border-strong)", borderRadius: 3, fontSize: 11 }}
                  labelFormatter={() => ""}
                  formatter={(v) => [Number(v).toFixed(2), "avg score"]}
                />
                <Area type="monotone" dataKey="value" stroke="var(--steel)" strokeWidth={1.5} fill="var(--steel)" fillOpacity={0.07} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-[var(--border)] px-5 py-2">
        {(["all", "bullish", "bearish"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="rounded-[3px] px-2.5 py-1 text-[0.7rem] font-medium capitalize transition-colors"
            style={
              filter === f
                ? { background: "var(--panel-2)", color: "var(--text)", boxShadow: "inset 0 0 0 1px var(--border-strong)" }
                : { color: "var(--text-faint)" }
            }
          >
            {f}
          </button>
        ))}
      </div>

      <div className="max-h-[440px] overflow-y-auto">
        {shown.map((h, i) => (
          <a
            key={`${h.title}-${i}`}
            href={h.link ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-baseline gap-3 border-b border-[var(--border)] px-5 py-2.5 last:border-b-0 hover:bg-[var(--panel-2)]"
          >
            <span
              className="w-12 shrink-0 text-right font-mono text-[0.7rem] font-medium"
              style={{ color: toneColor(h.sentimentLabel) }}
              title={`lexicon score ${h.sentimentScore.toFixed(2)}`}
            >
              {h.sentimentScore > 0 ? "+" : ""}
              {h.sentimentScore.toFixed(2)}
            </span>
            <span className="min-w-0 flex-1 text-[0.8rem] leading-snug text-[var(--text)]">{h.title}</span>
            <span className="shrink-0 font-mono text-[0.64rem] text-[var(--text-faint)]">
              {h.source} · {timeAgo(h.pubDate)}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
