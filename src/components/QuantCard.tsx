"use client";

import { useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  Bar,
  BarChart,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import type { MacroSeries, HistoryPoint } from "@/lib/macroData";
import {
  computeDistStats,
  rollingZScore,
  movingAverage,
  rollingStd,
  momentumForCadence,
  histogram,
  inferCadence,
} from "@/lib/stats";
import SeriesCard from "@/components/SeriesCard";
import Sparkline from "@/components/Sparkline";
import ZHeatmap from "@/components/ZHeatmap";
import MarketLink from "@/components/MarketLink";
import SpecializedStatChart from "@/components/SpecializedStatChart";
import NewsFeedCard from "@/components/NewsFeedCard";
import { getBias, getSignTone } from "@/lib/bias";
import { IMPACTS, marketRowId } from "@/lib/markets";
import { computeIndicatorSignal, getSignalConfig, type SignalMethod } from "@/lib/indicatorSignal";
import type { MarketRow } from "@/lib/getMarkets";

/** Context-aware z-score color: only paints green/red once |z| clears 2σ, else neutral accent. */
function zTone(seriesId: string, z: number) {
  if (Math.abs(z) < 2) return "var(--accent)";
  const t = getSignTone(seriesId, z);
  return t === "up" ? "var(--up)" : t === "down" ? "var(--down)" : "var(--accent)";
}

function toneColorFor(tone: "up" | "down" | "flat"): string {
  return tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--flat)";
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function SectionHead({ title }: { title: string }) {
  return <div className="mb-1.5 font-sans text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--text-dim)]">{title}</div>;
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
  const color = value === null ? "var(--text-faint)" : t === "up" ? "var(--up)" : t === "down" ? "var(--down)" : "var(--flat)";
  const barPct = value === null || maxAbs === 0 ? 0 : (Math.abs(value) / maxAbs) * 100;
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-[var(--panel-2)] px-2.5 py-2.5">
      <span className="font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">{label}</span>
      <span className="font-mono text-[0.94rem] font-semibold" style={{ color }}>
        {value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(3)}`}
      </span>
      <div className="relative h-1 rounded-full bg-[var(--border)]">
        <div
          className="absolute top-0 h-1 rounded-full"
          style={{
            width: `${barPct}%`,
            background: color,
            [value !== null && value < 0 ? "right" : "left"]: 0,
          }}
        />
      </div>
    </div>
  );
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

/** ---------------- Positioning layout: genuinely mean-reverting series (COT, sentiment, ratios) ---------------- */
function PositioningBody({ series, history, values }: { series: MacroSeries; history: HistoryPoint[]; values: number[] }) {
  const dist = computeDistStats(values);
  const { cadence, periodsPerYear } = inferCadence(history);
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

  const chartData = history.map((h, i) => ({ date: h.date, value: h.value, ma20: ma20[i], ma50: ma50[i], z: zSeries[i], vol: vol[i] }));
  const annVolMultiplier = Math.sqrt(periodsPerYear);
  const annVol = dist && vol[vol.length - 1] !== null ? (vol[vol.length - 1] as number) * annVolMultiplier : null;

  return (
    <>
      <div className="mt-6">
        <SectionHead title="History" />
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 22, left: 4 }}>
              <defs>
                <linearGradient id={`q-hist-${series.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={70} label={{ value: "Date", position: "insideBottom", offset: -14, fill: "var(--text-faint)", fontSize: 11 }} />
              <YAxis tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={false} width={58} domain={["auto", "auto"]} label={{ value: "Value", angle: -90, position: "insideLeft", offset: 10, fill: "var(--text-faint)", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5 }} labelFormatter={(d) => fmtDate(String(d))} formatter={(v, name) => [v === null || v === undefined ? "—" : Number(v).toFixed(3), name]} />
              <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill={`url(#q-hist-${series.id})`} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="ma20" stroke="var(--up)" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeOpacity={0.85} />
              <Line type="monotone" dataKey="ma50" stroke="var(--down)" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeOpacity={0.85} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex gap-4 font-sans text-[0.72rem] text-[var(--text-faint)]">
          <span><span className="text-[var(--accent)]">■</span> value</span>
          <span><span className="text-[var(--up)]">■</span> MA{maShortWindow}</span>
          <span><span className="text-[var(--down)]">■</span> MA{maLongWindow}</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <SectionHead title={`Rolling z-score (${zWindow}p)`} />
          <div className="h-[130px] w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={130}>
              <ComposedChart data={chartData} margin={{ top: 2, right: 8, bottom: 0, left: 4 }}>
                <XAxis dataKey="date" hide />
                <YAxis domain={[-3, 3]} tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={false} width={26} ticks={[-2, 0, 2]} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <ReferenceLine y={2} stroke="var(--down)" strokeDasharray="3 3" strokeOpacity={0.5} />
                <ReferenceLine y={-2} stroke="var(--down)" strokeDasharray="3 3" strokeOpacity={0.5} />
                <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} labelFormatter={(d) => fmtDate(String(d))} formatter={(v) => [v === null || v === undefined ? "—" : Number(v).toFixed(2) + "σ", "z"]} />
                <Line type="monotone" dataKey="z" stroke={dist ? zTone(series.id, dist.zscore) : "var(--accent)"} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <SectionHead title={`Rolling volatility (${volWindow}p)`} />
          <div className="h-[130px] w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={130}>
              <ComposedChart data={chartData} margin={{ top: 2, right: 8, bottom: 0, left: 4 }}>
                <XAxis dataKey="date" hide />
                <YAxis tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={false} width={38} domain={[0, "auto"]} />
                <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} labelFormatter={(d) => fmtDate(String(d))} formatter={(v) => [v === null || v === undefined ? "—" : Number(v).toFixed(4), "σ"]} />
                <Area type="monotone" dataKey="vol" stroke="var(--flat)" strokeWidth={1.25} fill="var(--flat)" fillOpacity={0.18} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <SectionHead title="Signal robustness" />
        <ZHeatmap history={history} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <SectionHead title="Distribution" />
          <div className="h-[90px] w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={90}>
              <BarChart data={hist} margin={{ top: 2, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="bucket" hide />
                <YAxis hide />
                <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} labelFormatter={(b) => `≈ ${Number(b).toFixed(3)}`} formatter={(v) => [v, "count"]} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {hist.map((h, i) => (
                    <Cell key={i} fill={dist && Math.abs(h.bucket - dist.latest) < (dist.max - dist.min) / 14 ? "var(--accent)" : "var(--border)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {dist52 && (
          <div>
            <SectionHead title={cadence === "daily" || cadence === "weekly" ? "52w range" : cadence === "monthly" ? "12m range" : "4q range"} />
            <div className="mt-3">
              <div className="mb-1.5 flex justify-between font-mono text-[0.72rem] text-[var(--text-faint)]">
                <span>{dist52.min.toFixed(3)}</span>
                <span>{dist52.max.toFixed(3)}</span>
              </div>
              <div className="relative h-2 rounded-full bg-[var(--border)]">
                <div
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-[var(--panel)] bg-[var(--accent)]"
                  style={{ left: `${dist52.max === dist52.min ? 50 : ((dist52.latest - dist52.min) / (dist52.max - dist52.min)) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6">
        <div className="mb-1.5 font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">Momentum — absolute change vs. N periods ago</div>
        <div className="grid grid-cols-4 gap-2">
          {(() => {
            const maxAbs = Math.max(1e-9, ...momentum.map((m) => (m.value === null ? 0 : Math.abs(m.value))));
            return momentum.map((m) => <MomentumBadge key={m.label} seriesId={series.id} label={m.label} value={m.value} maxAbs={maxAbs} />);
          })()}
        </div>
      </div>

      {dist && (
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <div className="mb-1.5 flex justify-between font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">
            <span>Full-history range</span>
            <span className="font-mono normal-case">{dist.percentile.toFixed(0)}th percentile</span>
          </div>
          <div className="relative h-2 rounded-full bg-[var(--border)]">
            <div className="absolute top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-[var(--text-faint)]" style={{ left: `${((dist.mean - dist.min) / (dist.max - dist.min || 1)) * 100}%` }} />
            <div className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-[var(--panel)]" style={{ left: `${((dist.latest - dist.min) / (dist.max - dist.min || 1)) * 100}%`, background: zTone(series.id, dist.zscore) }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[0.7rem] text-[var(--text-faint)]">
            <span>{dist.min.toFixed(3)}</span>
            <span>mean {dist.mean.toFixed(3)}</span>
            <span>{dist.max.toFixed(3)}</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3 font-mono text-[0.82rem] sm:grid-cols-5">
            <Stat label="Std Dev" value={dist.std.toFixed(3)} />
            <Stat label="Ann. Vol" value={annVol !== null ? annVol.toFixed(3) : "—"} />
            <Stat label="Z-score" value={`${dist.zscore > 0 ? "+" : ""}${dist.zscore.toFixed(2)}σ`} color={zTone(series.id, dist.zscore)} />
            <Stat label="N obs" value={String(values.length)} />
            <Stat label="Cadence" value={cadence} />
          </div>
        </div>
      )}
    </>
  );
}

/** ---------------- Momentum layout: level is arbitrary/structurally drifting, pace is the signal ---------------- */
function MomentumBody({ series, history, values, momentumWindow }: { series: MacroSeries; history: HistoryPoint[]; values: number[]; momentumWindow: number }) {
  const { cadence } = inferCadence(history);
  const trendWindow = Math.min(momentumWindow, Math.floor(values.length / 2));
  const trend = movingAverage(values, Math.max(2, trendWindow));
  const momentum = momentumForCadence(history, cadence);

  const chartData = history.map((h, i) => ({ date: h.date, value: h.value, trend: trend[i] }));

  const window = Math.min(momentumWindow, Math.floor(values.length / 2));
  const recent = values.slice(-window);
  const prior = values.slice(-window * 2, -window);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  const paceDelta = recentAvg !== null && priorAvg !== null ? recentAvg - priorAvg : null;
  const paceTone = paceDelta === null ? "flat" : getSignTone(series.id, paceDelta);
  const paceColor = toneColorFor(paceTone);

  const paceData = [
    { label: `Prior ${window}p`, avg: priorAvg },
    { label: `Recent ${window}p`, avg: recentAvg },
  ];

  return (
    <>
      <div className="mt-6">
        <SectionHead title="History" />
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 22, left: 4 }}>
              <defs>
                <linearGradient id={`q-mom-${series.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={70} label={{ value: "Date", position: "insideBottom", offset: -14, fill: "var(--text-faint)", fontSize: 11 }} />
              <YAxis tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={false} width={58} domain={["auto", "auto"]} label={{ value: "Value", angle: -90, position: "insideLeft", offset: 10, fill: "var(--text-faint)", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5 }} labelFormatter={(d) => fmtDate(String(d))} formatter={(v, name) => [v === null || v === undefined ? "—" : Number(v).toFixed(3), name]} />
              <Area type="monotone" dataKey="value" stroke="var(--text-faint)" strokeWidth={1.25} fill={`url(#q-mom-${series.id})`} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="trend" stroke="var(--accent)" strokeWidth={2.25} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex gap-4 font-sans text-[0.72rem] text-[var(--text-faint)]">
          <span><span className="text-[var(--text-faint)]">■</span> raw value</span>
          <span><span className="text-[var(--accent)]">■</span> {trendWindow}p trend</span>
        </div>
      </div>

      <div className="mt-6">
        <SectionHead title="Pace" />
        <div className="h-[110px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={110}>
            <BarChart data={paceData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
              <XAxis type="number" domain={["auto", "auto"]} tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
              <YAxis type="category" dataKey="label" tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={false} width={90} />
              <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} formatter={(v) => [v === null || v === undefined ? "—" : Number(v).toFixed(3), "avg"]} />
              <Bar dataKey="avg" radius={[0, 3, 3, 0]}>
                <Cell fill="var(--text-faint)" />
                <Cell fill={paceColor} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-baseline gap-2 font-mono text-[0.85rem]" style={{ color: paceColor }}>
          {paceDelta === null ? "—" : `${paceDelta > 0 ? "+" : ""}${paceDelta.toFixed(3)} pace change`}
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-1.5 font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">Momentum — absolute change vs. N periods ago</div>
        <div className="grid grid-cols-4 gap-2">
          {(() => {
            const maxAbs = Math.max(1e-9, ...momentum.map((m) => (m.value === null ? 0 : Math.abs(m.value))));
            return momentum.map((m) => <MomentumBadge key={m.label} seriesId={series.id} label={m.label} value={m.value} maxAbs={maxAbs} />);
          })()}
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--border)] pt-4">
        <div className="grid grid-cols-3 gap-x-3 gap-y-3 font-mono text-[0.82rem] sm:grid-cols-4">
          <Stat label="N obs" value={String(values.length)} />
          <Stat label="Cadence" value={cadence} />
          <Stat label="Pace window" value={`${window}p`} />
          <Stat label="Pace delta" value={paceDelta === null ? "—" : `${paceDelta > 0 ? "+" : ""}${paceDelta.toFixed(3)}`} color={paceColor} />
        </div>
      </div>
    </>
  );
}

/** ---------------- Anchor layout: judged against a real economic reference point, not its own history ---------------- */
function AnchorBody({
  series,
  history,
  values,
  reference,
  band,
}: {
  series: MacroSeries;
  history: HistoryPoint[];
  values: number[];
  reference: number;
  band: number;
}) {
  const { cadence } = inferCadence(history);
  const momentum = momentumForCadence(history, cadence);
  const latest = values[values.length - 1];
  const distance = latest - reference;
  const clamped = Math.max(-1, Math.min(1, distance / band));
  const pct = ((clamped + 1) / 2) * 100;
  const tone = clamped > 0.15 ? getSignTone(series.id, 1) : clamped < -0.15 ? getSignTone(series.id, -1) : "flat";
  const toneCol = toneColorFor(tone);

  const withinBand = values.filter((v) => Math.abs(v - reference) <= band).length;
  const withinBandPct = (withinBand / values.length) * 100;

  const chartData = history.map((h) => ({ date: h.date, value: h.value }));
  const yMin = Math.min(reference - band, ...values) - Math.abs(band) * 0.15;
  const yMax = Math.max(reference + band, ...values) + Math.abs(band) * 0.15;

  return (
    <>
      <div className="mt-6">
        <SectionHead title="History vs. target" />
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 22, left: 4 }}>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={70} label={{ value: "Date", position: "insideBottom", offset: -14, fill: "var(--text-faint)", fontSize: 11 }} />
              <YAxis domain={[yMin, yMax]} tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={false} width={58} label={{ value: "Value", angle: -90, position: "insideLeft", offset: 10, fill: "var(--text-faint)", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5 }} labelFormatter={(d) => fmtDate(String(d))} formatter={(v) => [v === null || v === undefined ? "—" : Number(v).toFixed(3), "value"]} />
              <ReferenceArea y1={reference - band} y2={reference + band} fill="var(--accent)" fillOpacity={0.08} />
              <ReferenceLine y={reference} stroke="var(--accent)" strokeDasharray="4 3" label={{ value: `target ${reference}`, position: "insideTopLeft", fill: "var(--accent)", fontSize: 10 }} />
              <Line type="monotone" dataKey="value" stroke="var(--text)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6">
        <SectionHead title="Distance from target" />
        <div className="mt-3">
          <div className="mb-1.5 flex justify-between font-mono text-[0.72rem] text-[var(--text-faint)]">
            <span>{(reference - band).toFixed(2)}</span>
            <span className="text-[var(--text)]">target {reference}</span>
            <span>{(reference + band).toFixed(2)}</span>
          </div>
          <div className="relative h-2.5 rounded-full bg-[var(--border)]">
            <div className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-[var(--accent)]" />
            <div className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-[var(--panel)]" style={{ left: `${pct}%`, background: toneCol }} />
          </div>
          <div className="mt-2 font-mono text-[0.85rem]" style={{ color: toneCol }}>
            {distance > 0 ? "+" : ""}
            {distance.toFixed(3)} from target
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-1.5 font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">Momentum — is it moving toward or away from target?</div>
        <div className="grid grid-cols-4 gap-2">
          {(() => {
            const maxAbs = Math.max(1e-9, ...momentum.map((m) => (m.value === null ? 0 : Math.abs(m.value))));
            return momentum.map((m) => <MomentumBadge key={m.label} seriesId={series.id} label={m.label} value={m.value} maxAbs={maxAbs} />);
          })()}
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--border)] pt-4">
        <div className="grid grid-cols-3 gap-x-3 gap-y-3 font-mono text-[0.82rem] sm:grid-cols-5">
          <Stat label="Latest" value={latest.toFixed(3)} />
          <Stat label="Target" value={reference.toFixed(2)} />
          <Stat label="Band" value={`±${band}`} />
          <Stat label="Time in band" value={`${withinBandPct.toFixed(0)}%`} />
          <Stat label="Cadence" value={cadence} />
        </div>
      </div>
    </>
  );
}

/** ---------------- Threshold layout: a sign flip is the event, not the magnitude on either side of it ---------------- */
function ThresholdBody({ series, history, values }: { series: MacroSeries; history: HistoryPoint[]; values: number[] }) {
  const { cadence } = inferCadence(history);
  const latest = values[values.length - 1];
  const invertedNow = latest < 0;

  let flipIndex = values.length - 1;
  for (let i = values.length - 1; i >= 0; i--) {
    if ((values[i] < 0) !== invertedNow) break;
    flipIndex = i;
  }
  const daysInState = daysBetween(history[flipIndex].date, history[history.length - 1].date);

  let flips = 0;
  for (let i = 1; i < values.length; i++) {
    if ((values[i] < 0) !== (values[i - 1] < 0)) flips++;
  }

  const chartData = history.map((h) => ({ date: h.date, value: h.value }));
  const stateColor = invertedNow ? "var(--down)" : "var(--up)";

  return (
    <>
      <div className="mt-6">
        <SectionHead title="Sign history" />
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 22, left: 4 }}>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={70} label={{ value: "Date", position: "insideBottom", offset: -14, fill: "var(--text-faint)", fontSize: 11 }} />
              <YAxis tick={{ fill: "var(--text-faint)", fontSize: 11 }} tickLine={false} axisLine={false} width={50} label={{ value: "Spread", angle: -90, position: "insideLeft", offset: 10, fill: "var(--text-faint)", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5 }} labelFormatter={(d) => fmtDate(String(d))} formatter={(v) => [v === null || v === undefined ? "—" : Number(v).toFixed(3), "spread"]} />
              <ReferenceLine y={0} stroke="var(--text-faint)" />
              <Bar dataKey="value" radius={[1, 1, 1, 1]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.value < 0 ? "var(--down)" : "var(--up)"} fillOpacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 rounded-md border p-4" style={{ borderColor: `color-mix(in srgb, ${stateColor} 35%, var(--border))`, background: `color-mix(in srgb, ${stateColor} 7%, transparent)` }}>
        <div className="font-sans text-[1.05rem] font-semibold" style={{ color: stateColor }}>
          {invertedNow ? "Inverted" : "Normal"} for {daysInState}d
        </div>
        <p className="m-0 mt-1 font-sans text-[0.76rem] text-[var(--text-faint)]">
          {flips} sign flip{flips === 1 ? "" : "s"} in view
        </p>
      </div>

      <div className="mt-6 border-t border-[var(--border)] pt-4">
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 font-mono text-[0.82rem] sm:grid-cols-4">
          <Stat label="Latest" value={`${latest > 0 ? "+" : ""}${latest.toFixed(3)}`} color={stateColor} />
          <Stat label="N obs" value={String(values.length)} />
          <Stat label="Cadence" value={cadence} />
          <Stat label="Flips" value={String(flips)} />
        </div>
      </div>
    </>
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

  const values = history.map((h) => h.value);
  const dist = computeDistStats(values);
  const { cadence } = inferCadence(history);
  const signal = computeIndicatorSignal(series.id, values, cadence);
  const config = getSignalConfig(series.id);
  const method: SignalMethod = config?.method ?? "positioning";

  const bias = getBias(series.id, signal?.score ?? null);
  const biasToneColor = bias ? (bias.tone === "up" ? "var(--up)" : bias.tone === "down" ? "var(--down)" : "var(--text-faint)") : "var(--text-faint)";

  return (
    <div className="border-b border-[var(--border)] transition-opacity duration-150" style={!isRelevant ? { opacity: 0.42 } : undefined}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 py-6 text-left sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="m-0 truncate text-[1.15rem] font-semibold">{series.name}</h3>
            {bias && bias.tone !== "flat" && (
              <span className="shrink-0 text-[0.72rem] font-semibold uppercase tracking-wide" style={{ color: biasToneColor }}>
                {bias.tone === "up" ? "bullish" : "bearish"}
              </span>
            )}
            {!isRelevant && (
              <span className="shrink-0 whitespace-nowrap font-sans text-[0.62rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                Not linked to {assetLabel ?? assetFilter}
              </span>
            )}
          </div>
          <p className="m-0 mt-1.5 truncate font-sans text-[0.86rem] text-[var(--text-dim)]">{series.note}</p>
        </div>

        {series.sparkline && series.sparkline.length >= 5 && (
          <div className="hidden w-24 shrink-0 md:block">
            <Sparkline data={series.sparkline} tone={series.status} heightClass="h-10" />
          </div>
        )}

        <div className="shrink-0 text-right">
          <div className="font-mono text-[1.4rem] font-semibold leading-none sm:text-[1.9rem]">{series.value}</div>
          {signal && (
            <div className="mt-1.5 font-mono text-[0.8rem]" style={{ color: toneColorFor(getSignTone(series.id, signal.score)) }}>
              {signal.score > 0 ? "+" : ""}
              {Math.round(signal.score * 100)}%
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

          {method === "momentum" ? (
            <MomentumBody series={series} history={history} values={values} momentumWindow={config?.momentumWindow ?? 10} />
          ) : method === "anchor" ? (
            <AnchorBody series={series} history={history} values={values} reference={config?.reference ?? 0} band={config?.band ?? 1} />
          ) : method === "threshold" ? (
            <ThresholdBody series={series} history={history} values={values} />
          ) : (
            <PositioningBody series={series} history={history} values={values} />
          )}

          <div className="mt-5 flex items-center justify-between font-mono text-[0.7rem] text-[var(--text-faint)]">
            <span>{series.source}</span>
            {series.windowLabel && <span>{series.windowLabel}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
