"use client";

import { useEffect, useMemo, useState } from "react";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from "recharts";
import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import { PILLARS } from "@/lib/macroBias";
import { computePillarVector, findSimilarRegimes, buildDateReport, type PillarVector, type SimilarRegime, type ReportLine } from "@/lib/regimeFingerprint";
import AsciiContour from "@/components/fx/AsciiContour";

const MATCH_COLORS = ["#f5a623", "#e05a5a", "#8b5cf6", "#22c55e", "#ec4899", "#38bdf8"];

function dateRange(panels: MacroPanel[]): { min: string; max: string } {
  let min: string | null = null;
  let max: string | null = null;
  for (const p of panels) {
    for (const s of p.series) {
      const first = s.history?.[0]?.date;
      const last = s.history?.[s.history.length - 1]?.date;
      if (first && (min === null || first < min)) min = first;
      if (last && (max === null || last > max)) max = last;
    }
  }
  return { min: min ?? "2015-01-01", max: max ?? new Date().toISOString().slice(0, 10) };
}

function clampToday(min: string, max: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (today > max) return max;
  if (today < min) return min;
  return today;
}

function buildChartData(a: PillarVector, b?: PillarVector | null) {
  return PILLARS.map((p) => ({
    pillar: p.label.replace(" & ", " "),
    a: a.scores[p.id] ?? 0,
    b: b ? b.scores[p.id] ?? 0 : undefined,
  }));
}

function FingerprintChart({
  data,
  labelA,
  labelB,
  colorB = "var(--down)",
  height = 300,
  compact = false,
}: {
  data: ReturnType<typeof buildChartData>;
  labelA: string;
  labelB?: string;
  colorB?: string;
  height?: number;
  compact?: boolean;
}) {
  const gid = `fp-${labelA}-${labelB ?? "solo"}`.replace(/[^a-zA-Z0-9-]/g, "");
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius={compact ? "68%" : "75%"}>
          <defs>
            <radialGradient id={`${gid}-a`} cx="50%" cy="50%" r="70%">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.05} />
            </radialGradient>
            {labelB && (
              <radialGradient id={`${gid}-b`} cx="50%" cy="50%" r="70%">
                <stop offset="0%" stopColor={colorB} stopOpacity={0.4} />
                <stop offset="100%" stopColor={colorB} stopOpacity={0.03} />
              </radialGradient>
            )}
          </defs>
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="pillar" tick={{ fill: "var(--text-dim)", fontSize: compact ? 9 : 11, fontWeight: compact ? 400 : 600 }} />
          {!compact && (
            <PolarRadiusAxis domain={[-1, 1]} tick={{ fill: "var(--text-faint)", fontSize: 9 }} tickCount={5} axisLine={false} tickLine={false} />
          )}
          <Radar
            name={labelA}
            dataKey="a"
            stroke="var(--accent)"
            fill={`url(#${gid}-a)`}
            strokeWidth={compact ? 1.5 : 2.5}
            isAnimationActive
            animationDuration={450}
            style={{ filter: compact ? undefined : "drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 60%, transparent))" }}
          />
          {labelB && (
            <Radar
              name={labelB}
              dataKey="b"
              stroke={colorB}
              fill={`url(#${gid}-b)`}
              strokeWidth={compact ? 1.5 : 2.5}
              isAnimationActive
              animationDuration={450}
              style={{ filter: compact ? undefined : `drop-shadow(0 0 6px color-mix(in srgb, ${colorB} 60%, transparent))` }}
            />
          )}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReportPanel({ tag, date, color, lines }: { tag: string; date: string | null; color: string; lines: ReportLine[] | null }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="font-mono text-[0.6rem] uppercase tracking-wide" style={{ color }}>
          {tag}
        </span>
        <span className="font-mono text-[0.68rem] font-semibold text-[var(--text)]">{date ?? ""}</span>
      </div>
      {!date ? (
        <p className="px-1 font-sans text-[0.72rem] text-[var(--text-faint)]">Click a match below to see what happened then.</p>
      ) : !lines || lines.length === 0 ? (
        <p className="px-1 font-sans text-[0.72rem] text-[var(--text-faint)]">No data for this date.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {lines.map((l) => (
            <div key={l.symbol} className="flex items-center justify-between gap-2 py-0.5">
              <span className="truncate font-sans text-[0.7rem] text-[var(--text-dim)]">{l.label}</span>
              <span
                className="shrink-0 font-mono text-[0.7rem] font-semibold"
                style={{ color: l.dailyReturnPct === null ? "var(--text-faint)" : l.dailyReturnPct >= 0 ? "var(--up)" : "var(--down)" }}
              >
                {l.dailyReturnPct === null ? "-" : `${l.dailyReturnPct >= 0 ? "+" : ""}${l.dailyReturnPct.toFixed(2)}%`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RegimeFingerprintPage({ panels, markets }: { panels: MacroPanel[]; markets: MarketRow[] }) {
  const { min: minDate, max: maxDate } = useMemo(() => dateRange(panels), [panels]);
  const defaultDate = useMemo(() => clampToday(minDate, maxDate), [minDate, maxDate]);

  const [dateA, setDateA] = useState(defaultDate);
  const [focused, setFocused] = useState<string | null>(null);
  const [similar, setSimilar] = useState<SimilarRegime[] | null>(null);
  const [searching, setSearching] = useState(false);

  const vectorA = useMemo(() => computePillarVector(panels, dateA), [panels, dateA]);
  const focusedVector = useMemo(() => (focused ? computePillarVector(panels, focused) : null), [panels, focused]);
  const reportA = useMemo(() => buildDateReport(panels, markets, dateA), [panels, markets, dateA]);
  const reportFocused = useMemo(() => (focused ? buildDateReport(panels, markets, focused) : null), [panels, markets, focused]);

  useEffect(() => {
    setSearching(true);
    setFocused(null);
    const id = setTimeout(() => {
      setSimilar(findSimilarRegimes(panels, dateA));
      setSearching(false);
    }, 20);
    return () => clearTimeout(id);
  }, [panels, dateA]);

  const matchVectors = useMemo(
    () => (similar ?? []).map((s) => ({ match: s, vector: computePillarVector(panels, s.date) })),
    [panels, similar]
  );
  const focusedColor = useMemo(() => {
    const idx = matchVectors.findIndex((m) => m.match.date === focused);
    return idx >= 0 ? MATCH_COLORS[idx % MATCH_COLORS.length] : "var(--down)";
  }, [matchVectors, focused]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">Date A</span>
        <input
          type="date"
          min={minDate}
          max={maxDate}
          value={dateA}
          onChange={(e) => setDateA(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1.5 font-mono text-[0.78rem] text-[var(--text)] outline-none focus-visible:border-[var(--accent)]"
        />
        {searching && <span className="font-mono text-[0.7rem] text-[var(--text-faint)]">Scanning history…</span>}
        <span className="ml-auto font-sans text-[0.68rem] text-[var(--text-faint)]">
          7 pillars · 2Y lookback · auto-matched to nearest historical regimes
        </span>
      </div>

      <div className="relative mb-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <AsciiContour className="pointer-events-none absolute inset-0 h-full w-full" cell={14} maxAlpha={0.12} />
        <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <div className="mb-1 px-1 font-mono text-[0.7rem] font-semibold text-[var(--text-dim)]">
              {focused ? `${dateA} vs ${focused}` : dateA}
            </div>
            <FingerprintChart data={buildChartData(vectorA, focusedVector)} labelA={dateA} labelB={focused ?? undefined} colorB={focusedColor} height={300} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ReportPanel tag="Now" date={dateA} color="var(--accent)" lines={reportA} />
            <ReportPanel tag="Then" date={focused} color={focusedColor} lines={reportFocused} />
          </div>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="font-sans text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Closest historical regimes</span>
        <span className="font-sans text-[0.66rem] text-[var(--text-faint)]">Click a card to pin it above</span>
      </div>
      {matchVectors.length === 0 ? (
        <p className="font-sans text-[0.85rem] text-[var(--text-faint)]">{searching ? "Scanning…" : "Not enough comparable history yet."}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {matchVectors.map(({ match, vector }, i) => {
            const color = MATCH_COLORS[i % MATCH_COLORS.length];
            const isFocused = focused === match.date;
            return (
              <button
                key={match.date}
                onClick={() => setFocused(isFocused ? null : match.date)}
                className="rounded-lg border bg-[var(--panel)] p-1.5 text-left transition-colors"
                style={{ borderColor: isFocused ? color : "var(--border)" }}
              >
                <div className="flex items-center justify-between px-1">
                  <span className="font-mono text-[0.64rem] font-semibold" style={{ color }}>
                    #{i + 1} {match.date}
                  </span>
                </div>
                <FingerprintChart data={buildChartData(vectorA, vector)} labelA={dateA} labelB={match.date} colorB={color} height={110} compact />
                <div className="px-1 font-mono text-[0.58rem] text-[var(--text-faint)]">distance {match.distance.toFixed(2)}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
