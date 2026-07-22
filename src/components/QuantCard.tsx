"use client";

import { useState } from "react";
import {
  ComposedChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import type { MacroSeries, HistoryPoint } from "@/lib/macroData";
import SeriesCard from "@/components/SeriesCard";
import Sparkline from "@/components/Sparkline";
import MarketLink from "@/components/MarketLink";
import SpecializedStatChart from "@/components/SpecializedStatChart";
import NewsFeedCard from "@/components/NewsFeedCard";
import { getBias, getSignTone } from "@/lib/bias";
import { IMPACTS, marketRowId } from "@/lib/markets";
import type { MarketRow } from "@/lib/getMarkets";

function toneColorFor(tone: "up" | "down" | "flat"): string {
  return tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--flat)";
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function SectionHead({ title }: { title: string }) {
  return <div className="mb-1.5 font-sans text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--text-dim)]">{title}</div>;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0 text-[var(--text-faint)] transition-transform duration-200"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
    >
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="font-sans text-[0.66rem] uppercase tracking-wide text-[var(--text-faint)]">{label}</div>
      <div style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

/**
 * The expanded view shows the series itself over time and nothing about how it
 * is scored - no reference levels, bands, rolling-window internals, or method
 * labels. Just the data. The score comes pre-computed from the server; the
 * math that produces it never ships to the browser.
 */
function DataHistoryBody({ series, history }: { series: MacroSeries; history: HistoryPoint[] }) {
  const values = history.map((h) => h.value);
  const latest = values[values.length - 1];
  const high = Math.max(...values);
  const low = Math.min(...values);
  const chartData = history.map((h) => ({ date: h.date, value: h.value }));
  const tone = getSignTone(series.id, series.zscore);
  const stroke = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--accent)";

  return (
    <div className="mt-6">
      <SectionHead title="History" />
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 22, left: 4 }}>
            <defs>
              <linearGradient id={`q-hist-${series.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={70} label={{ value: "Date", position: "insideBottom", offset: -14, fill: "var(--text-faint)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={false} width={58} domain={["auto", "auto"]} label={{ value: "Value", angle: -90, position: "insideLeft", offset: 10, fill: "var(--text-faint)", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 3, fontSize: 12.5 }} labelFormatter={(d) => fmtDate(String(d))} formatter={(v) => [v === null || v === undefined ? "-" : Number(v).toFixed(3), "value"]} />
            <Area type="monotone" dataKey="value" stroke={stroke} strokeWidth={2} fill={`url(#q-hist-${series.id})`} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6 border-t border-[var(--border)] pt-4">
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 font-mono text-[0.82rem] sm:grid-cols-4">
          <Stat label="Latest" value={latest.toFixed(3)} />
          <Stat label="High" value={high.toFixed(3)} />
          <Stat label="Low" value={low.toFixed(3)} />
          <Stat label="Points" value={String(values.length)} />
        </div>
      </div>
    </div>
  );
}

export default function QuantCard({
  series,
  markets,
  assetFilter = null,
  assetLabel = null,
}: {
  series: MacroSeries;
  markets: MarketRow[];
  assetFilter?: string | null;
  assetLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const history = series.history;
  const impacts = IMPACTS[series.id] ?? [];
  const isRelevant = !assetFilter || impacts.some((i) => i.symbol === assetFilter);
  if (!history || history.length < 20) {
    return <SeriesCard series={series} assetFilter={assetFilter} assetLabel={assetLabel} />;
  }

  if (series.payload?.headlines) {
    return <NewsFeedCard series={series} />;
  }

  const linkedMarkets = impacts
    .map((impact) => ({ impact, market: markets.find((m) => m.id === marketRowId(impact.symbol)) }))
    .filter((x): x is { impact: (typeof impacts)[number]; market: MarketRow } => !!x.market);

  const score = series.zscore;
  const bias = getBias(series.id, score);
  const biasToneColor = bias ? (bias.tone === "up" ? "var(--up)" : bias.tone === "down" ? "var(--down)" : "var(--text-faint)") : "var(--text-faint)";

  return (
    <div className="border-b border-[var(--border)] transition-opacity duration-150" style={!isRelevant ? { opacity: 0.42 } : undefined}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 py-6 text-left sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="m-0 truncate text-[1.15rem] font-semibold">{series.name}</h3>
            {bias && (
              <span className="shrink-0 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.08em]" style={{ color: biasToneColor }}>
                [{bias.tone === "up" ? "BULL" : bias.tone === "down" ? "BEAR" : "FLAT"}
                {score !== null && ` ${score > 0 ? "+" : ""}${score.toFixed(2)}`}]
              </span>
            )}
            {series.stale && (
              <span
                className="shrink-0 rounded-sm border border-[var(--amber)] px-1 py-0.5 font-mono text-[0.54rem] uppercase tracking-[0.08em] text-[var(--amber)]"
                title="This source didn't refresh in the latest sync - showing the last value it returned."
              >
                stale
              </span>
            )}
            {!isRelevant && (
              <span className="shrink-0 whitespace-nowrap font-sans text-[0.62rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                Not linked to {assetLabel ?? assetFilter}
              </span>
            )}
          </div>
          <p className="m-0 mt-1.5 font-sans text-[0.86rem] leading-snug text-[var(--text-dim)]">{series.note}</p>
        </div>

        {series.sparkline && series.sparkline.length >= 5 && (
          <div className="hidden w-24 shrink-0 md:block">
            <Sparkline data={series.sparkline} tone={series.status} heightClass="h-10" />
          </div>
        )}

        <div className="shrink-0 text-right">
          <div className="font-mono text-[1.4rem] font-semibold leading-none sm:text-[1.9rem]">{series.value}</div>
          {score !== null && (
            <div className="mt-1.5 font-mono text-[0.8rem]" style={{ color: toneColorFor(getSignTone(series.id, score)) }}>
              {score > 0 ? "+" : ""}
              {score.toFixed(2)}
            </div>
          )}
        </div>

        <Chevron open={open} />
      </button>

      {open && (
        <div className="pb-8">
          {bias && (
            <div className="font-sans text-[0.92rem] font-semibold" style={{ color: biasToneColor }}>
              {bias.label}
            </div>
          )}

          {linkedMarkets.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              <SectionHead title={`Linked assets (${linkedMarkets.length})`} />
              {linkedMarkets.map(({ impact, market }) => (
                <MarketLink key={impact.symbol} market={market} impact={impact} indicatorHistory={history} />
              ))}
            </div>
          )}

          {series.extraStats && series.extraStats.length > 0 && (
            <div className="mt-6">
              <SectionHead title="Specialized metrics" />
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {series.extraStats.map((stat) => (
                  <SpecializedStatChart key={stat.label} stat={stat} />
                ))}
              </div>
            </div>
          )}

          <DataHistoryBody series={series} history={history} />

          {series.windowLabel && (
            <div className="mt-5 text-right font-mono text-[0.7rem] text-[var(--text-faint)]">{series.windowLabel}</div>
          )}
        </div>
      )}
    </div>
  );
}
