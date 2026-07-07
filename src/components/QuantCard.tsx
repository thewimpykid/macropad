"use client";

import { useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import type { MacroSeries } from "@/lib/macroData";
import {
  computeDistStats,
  rollingZScore,
  movingAverage,
  rollingStd,
  momentumForCadence,
  histogram,
  inferCadence,
} from "@/lib/stats";
import { computeIndicatorSignal, getSignalConfig } from "@/lib/indicatorSignal";
import SeriesCard from "@/components/SeriesCard";
import Sparkline from "@/components/Sparkline";
import ZHeatmap from "@/components/ZHeatmap";
import MarketLink from "@/components/MarketLink";
import SpecializedStatChart from "@/components/SpecializedStatChart";
import { getBias, getDirectionTone, getSignTone } from "@/lib/bias";
import { IMPACTS, seriesAffectsSymbol, marketRowId } from "@/lib/markets";
import type { MarketRow } from "@/lib/getMarkets";

const TOOLTIP_STYLE = {
  background: "var(--panel-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: 3,
  fontSize: 12,
  color: "var(--text)",
} as const;

function toneColor(tone: "up" | "down" | "flat" | "pending"): string {
  return tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text-faint)";
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function SectionHead({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="mb-2">
      <div className="text-[0.72rem] font-semibold text-[var(--text-dim)]">{title}</div>
      <div className="text-[0.72rem] leading-snug text-[var(--text-faint)]">{caption}</div>
    </div>
  );
}

function MomentumBadge({
  seriesId,
  label,
  value,
  maxAbs,
}: {
  seriesId: string;
  label: string;
  value: number | null;
  maxAbs: number;
}) {
  const t = getSignTone(seriesId, value);
  const color = value === null ? "var(--text-faint)" : toneColor(t);
  const barPct = value === null || maxAbs === 0 ? 0 : Math.round((Math.abs(value) / maxAbs) * 10000) / 100;
  return (
    <div className="flex flex-col gap-1 rounded-[3px] border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2">
      <span className="text-[0.64rem] text-[var(--text-faint)]">{label}</span>
      <span className="font-mono text-[0.88rem] font-medium" style={{ color }}>
        {value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(3)}`}
      </span>
      <div className="relative h-[3px] rounded-[2px] bg-[var(--border)]">
        <div
          className="absolute top-0 h-full rounded-[2px]"
          style={{ width: `${barPct}%`, backgroundColor: color, [value !== null && value < 0 ? "right" : "left"]: 0 }}
        />
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0 text-[var(--text-faint)] transition-transform duration-150"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
    >
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  const isRelevant = !assetFilter || seriesAffectsSymbol(series.id, assetFilter);
  if (!history || history.length < 20) {
    return <SeriesCard series={series} assetFilter={assetFilter} assetLabel={assetLabel} />;
  }

  const impacts = IMPACTS[series.id] ?? [];
  const values = history.map((h) => h.value);
  const dist = computeDistStats(values);
  const { cadence, periodsPerYear } = inferCadence(history);
  const signal = series.zscore ?? computeIndicatorSignal(series.id, values, cadence)?.score ?? null;
  const signalConfig = getSignalConfig(series.id);
  const zWindow = Math.min(60, Math.floor(values.length / 2));
  const zSeries = rollingZScore(values, zWindow);
  const maShortWindow = Math.min(20, Math.floor(values.length / 3));
  const maLongWindow = Math.min(50, Math.floor(values.length / 2));
  const ma20 = movingAverage(values, maShortWindow);
  const ma50 = movingAverage(values, maLongWindow);
  const volWindow = Math.min(20, Math.floor(values.length / 3));
  const vol = rollingStd(values, volWindow);
  const momentum = momentumForCadence(history, cadence);
  const lookbackPoints = cadence === "daily" ? 252 : cadence === "weekly" ? 52 : cadence === "monthly" ? 12 : 4;
  const dist52 = computeDistStats(values.slice(-Math.min(values.length, lookbackPoints)));
  const hist = histogram(values, 14);

  const chartData = history.map((h, i) => ({
    date: h.date,
    value: h.value,
    ma20: ma20[i],
    ma50: ma50[i],
    z: zSeries[i],
    vol: vol[i],
  }));

  const annVolMultiplier = Math.sqrt(periodsPerYear);
  const annVol = dist && vol[vol.length - 1] !== null ? (vol[vol.length - 1] as number) * annVolMultiplier : null;
  const bias = getBias(series.id, signal);
  const biasColor = bias ? toneColor(bias.tone) : "var(--text-faint)";
  const chipTone = getDirectionTone(series.id, series.status);
  const signalTone = getSignTone(series.id, signal);

  return (
    <div
      className="rounded border border-[var(--border)] bg-[var(--panel)]"
      style={!isRelevant ? { opacity: 0.4 } : undefined}
    >
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-4 px-5 py-4 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="m-0 truncate text-[1rem] font-semibold">{series.name}</h3>
            <span className="shrink-0 font-mono text-[0.78rem]" style={{ color: toneColor(chipTone) }}>
              {series.status === "up" ? "▲" : series.status === "down" ? "▼" : series.status === "flat" ? "→" : "·"}
            </span>
            {!isRelevant && (
              <span className="shrink-0 whitespace-nowrap text-[0.64rem] text-[var(--text-faint)]">
                — no mapped impact on {assetLabel ?? assetFilter}
              </span>
            )}
          </div>
          <p className="m-0 mt-0.5 truncate text-[0.76rem] text-[var(--text-faint)]">{series.note}</p>
          {bias && (
            <div className="mt-0.5 flex items-center gap-1.5 truncate text-[0.78rem] font-medium" style={{ color: biasColor }}>
              {bias.strength === "extreme" && <span className="font-mono text-[0.64rem]">‼</span>}
              {bias.label}
            </div>
          )}
        </div>

        {series.sparkline && series.sparkline.length >= 5 && (
          <div className="hidden w-24 shrink-0 md:block">
            <Sparkline data={series.sparkline} tone={series.status} heightClass="h-9" />
          </div>
        )}

        <div className="shrink-0 text-right">
          <div className="font-mono text-[1.6rem] font-semibold leading-none">{series.value}</div>
          {signal !== null && (
            <div className="mt-1 font-mono text-[0.74rem]" style={{ color: toneColor(signalTone) }}>
              score {signal > 0 ? "+" : ""}
              {signal.toFixed(2)}
            </div>
          )}
        </div>

        <Chevron open={open} />
      </button>

      {open && (
        <div className="border-t border-[var(--border)] px-5 py-5">
          {bias && (
            <div
              className="rounded-[3px] border-l-2 bg-[var(--panel-2)] py-3 pl-3.5 pr-3"
              style={{ borderLeftColor: biasColor }}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[0.86rem] font-semibold" style={{ color: biasColor }}>
                  {bias.label}
                </span>
                <span className="text-[0.66rem] text-[var(--text-faint)]">
                  {bias.strength === null ? "neutral read" : `${bias.strength} read at score ${signal !== null ? `${signal > 0 ? "+" : ""}${signal.toFixed(2)}` : "—"}`}
                </span>
              </div>
              <p className="m-0 mt-1 text-[0.76rem] leading-snug text-[var(--text-dim)]">{bias.context}</p>
            </div>
          )}

          {signalConfig && (
            <div className="mt-3 rounded-[3px] border border-[var(--border)] bg-[var(--panel-2)] px-3.5 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[0.7rem] font-semibold text-[var(--text-dim)]">
                  How this score is computed
                </span>
                <span className="rounded-[3px] border border-[var(--border-strong)] px-1.5 py-[1px] font-mono text-[0.62rem] font-medium text-[var(--steel)]">
                  {signalConfig.method}
                </span>
                {signalConfig.method === "momentum" && signalConfig.momentumWindow && (
                  <span className="font-mono text-[0.64rem] text-[var(--text-faint)]">
                    last {signalConfig.momentumWindow}p vs prior {signalConfig.momentumWindow}p
                  </span>
                )}
                {(signalConfig.method === "anchor" || signalConfig.method === "threshold") && (
                  <span className="font-mono text-[0.64rem] text-[var(--text-faint)]">
                    reference {signalConfig.reference} · full read at ±{signalConfig.band}
                  </span>
                )}
                {signalConfig.method === "positioning" && (
                  <span className="font-mono text-[0.64rem] text-[var(--text-faint)]">
                    robust z + percentile, trailing ~2y
                  </span>
                )}
              </div>
              <p className="m-0 mt-1 text-[0.72rem] leading-snug text-[var(--text-faint)]">{signalConfig.rationale}</p>
            </div>
          )}

          {impacts.length > 0 && (
            <div className="mt-5">
              <SectionHead
                title={`Impacts ${impacts.length} asset${impacts.length === 1 ? "" : "s"}`}
                caption="Arrow = effect of this indicator printing HIGH vs its regime norm. These signed links are exactly what Net Bias aggregates."
              />
              <div className="flex flex-col gap-1.5">
                {impacts.map((impact) => (
                  <MarketLink
                    key={impact.symbol}
                    market={markets.find((m) => m.id === marketRowId(impact.symbol)) ?? null}
                    impact={impact}
                    indicatorHistory={history}
                  />
                ))}
              </div>
            </div>
          )}

          {series.extraStats && series.extraStats.length > 0 && (
            <div className="mt-5">
              <SectionHead
                title="Specialized for this indicator"
                caption="The derived metrics a desk actually quotes for this series — each with its own history."
              />
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                {series.extraStats.map((stat) => (
                  <SpecializedStatChart key={stat.label} stat={stat} />
                ))}
              </div>
            </div>
          )}

          <div className="mt-5">
            <SectionHead
              title="History"
              caption={`Raw series with ${maShortWindow}- and ${maLongWindow}-period moving averages — crossovers flag trend shifts.`}
            />
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{ fill: "var(--text-faint)", fontSize: 10.5 }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                    minTickGap={70}
                  />
                  <YAxis
                    tick={{ fill: "var(--text-faint)", fontSize: 10.5 }}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={(d) => fmtDate(String(d))}
                    formatter={(v, name) => [v === null || v === undefined ? "—" : Number(v).toFixed(3), name]}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--text-dim)" strokeWidth={2} fill="var(--text-dim)" fillOpacity={0.05} dot={false} isAnimationActive={false} name="value" />
                  <Line type="monotone" dataKey="ma20" stroke="var(--steel)" strokeWidth={1.5} dot={false} isAnimationActive={false} name={`MA${maShortWindow}`} />
                  <Line type="monotone" dataKey="ma50" stroke="var(--accent)" strokeWidth={1.5} dot={false} isAnimationActive={false} name={`MA${maLongWindow}`} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 flex gap-4 text-[0.68rem] text-[var(--text-faint)]">
              <span className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-4" style={{ background: "var(--text-dim)" }} /> value</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-4" style={{ background: "var(--steel)" }} /> MA{maShortWindow}</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-4" style={{ background: "var(--accent)" }} /> MA{maLongWindow}</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <SectionHead
                title={`Rolling signal (${zWindow}p window)`}
                caption="σ from the trailing mean at every point — dashed lines mark ±2σ."
              />
              <div className="h-[120px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 2, right: 8, bottom: 0, left: 4 }}>
                    <XAxis dataKey="date" hide />
                    <YAxis
                      domain={[-3, 3]}
                      tick={{ fill: "var(--text-faint)", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={26}
                      ticks={[-2, 0, 2]}
                    />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <ReferenceLine y={2} stroke="var(--border-strong)" strokeDasharray="3 3" />
                    <ReferenceLine y={-2} stroke="var(--border-strong)" strokeDasharray="3 3" />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelFormatter={(d) => fmtDate(String(d))}
                      formatter={(v) => [v === null || v === undefined ? "—" : Number(v).toFixed(2) + "σ", "z"]}
                    />
                    <Line type="monotone" dataKey="z" stroke="var(--steel)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <SectionHead
                title={`Rolling volatility (${volWindow}p std dev)`}
                caption="Realized dispersion — rising means choppier, not a direction."
              />
              <div className="h-[120px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 2, right: 8, bottom: 0, left: 4 }}>
                    <XAxis dataKey="date" hide />
                    <YAxis tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={false} width={38} domain={[0, "auto"]} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelFormatter={(d) => fmtDate(String(d))}
                      formatter={(v) => [v === null || v === undefined ? "—" : Number(v).toFixed(4), "σ"]}
                    />
                    <Area type="monotone" dataKey="vol" stroke="var(--text-faint)" strokeWidth={1.5} fill="var(--text-faint)" fillOpacity={0.08} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <SectionHead
              title="Signal robustness"
              caption="Rolling z across 8 lookback windows at once. A column that's hot in every row is a robust regime move; a single hot row is a window artifact."
            />
            <ZHeatmap history={history} />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <SectionHead
                title={`Distribution (${series.windowLabel ?? "full window"})`}
                caption="Historical values by bucket — the marked bar is where today sits."
              />
              <div className="h-[90px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hist} margin={{ top: 2, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="bucket" hide />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelFormatter={(b) => `≈ ${Number(b).toFixed(3)}`}
                      formatter={(v) => [v, "count"]}
                    />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {hist.map((h, i) => (
                        <Cell
                          key={i}
                          fill={dist && Math.abs(h.bucket - dist.latest) < (dist.max - dist.min) / 14 ? "var(--accent)" : "var(--border-strong)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {dist52 && (
              <div>
                <SectionHead
                  title={cadence === "daily" || cadence === "weekly" ? "52w range" : cadence === "monthly" ? "12m range" : "4q range"}
                  caption="Dot marks where today's value sits in the recent range."
                />
                <div className="mt-3">
                  <div className="mb-1.5 flex justify-between font-mono text-[0.7rem] text-[var(--text-faint)]">
                    <span>{dist52.min.toFixed(3)}</span>
                    <span>{dist52.max.toFixed(3)}</span>
                  </div>
                  <div className="relative h-[5px] rounded-[2px] bg-[var(--border)]">
                    <div
                      className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-[var(--panel)] bg-[var(--accent)]"
                      style={{
                        left: `${dist52.max === dist52.min ? 50 : Math.round(((dist52.latest - dist52.min) / (dist52.max - dist52.min)) * 10000) / 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5">
            <SectionHead title="Momentum" caption="Absolute change vs N periods ago, at this series' own cadence." />
            <div className="grid grid-cols-4 gap-2">
              {(() => {
                const maxAbs = Math.max(1e-9, ...momentum.map((m) => (m.value === null ? 0 : Math.abs(m.value))));
                return momentum.map((m) => (
                  <MomentumBadge key={m.label} seriesId={series.id} label={m.label} value={m.value} maxAbs={maxAbs} />
                ));
              })()}
            </div>
          </div>

          {dist && (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <div className="mb-1.5 flex justify-between text-[0.66rem] text-[var(--text-faint)]">
                <span>Full-window range</span>
                <span className="font-mono">{dist.percentile.toFixed(0)}th percentile</span>
              </div>
              <div className="relative h-[5px] rounded-[2px] bg-[var(--border)]">
                <div
                  className="absolute top-1/2 h-[9px] w-px -translate-y-1/2 bg-[var(--text-faint)]"
                  style={{ left: `${Math.round(((dist.mean - dist.min) / (dist.max - dist.min || 1)) * 10000) / 100}%` }}
                />
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-[var(--panel)]"
                  style={{
                    left: `${Math.round(((dist.latest - dist.min) / (dist.max - dist.min || 1)) * 10000) / 100}%`,
                    backgroundColor: toneColor(signalTone),
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[0.68rem] text-[var(--text-faint)]">
                <span>{dist.min.toFixed(3)}</span>
                <span>mean {dist.mean.toFixed(3)}</span>
                <span>{dist.max.toFixed(3)}</span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3 font-mono text-[0.8rem] sm:grid-cols-5">
                <Stat label="Std dev" value={dist.std.toFixed(3)} />
                <Stat label="Ann. vol" value={annVol !== null ? annVol.toFixed(3) : "—"} />
                <Stat label="Score" value={signal !== null ? `${signal > 0 ? "+" : ""}${signal.toFixed(2)}` : "—"} color={toneColor(signalTone)} />
                <Stat label="N obs" value={String(values.length)} />
                <Stat label="Cadence" value={cadence} />
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between font-mono text-[0.66rem] text-[var(--text-faint)]">
            <span>{series.source}</span>
            {series.windowLabel && <span>{series.windowLabel}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[0.62rem] text-[var(--text-faint)]">{label}</div>
      <div style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
