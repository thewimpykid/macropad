"use client";

import { useMemo, useState } from "react";
import type { MacroPanel } from "@/lib/macroData";
import { computeMacroBias, TIMEFRAMES, DEFAULT_TIMEFRAME, ASSET_SCOPES, DEFAULT_ASSET_SCOPE } from "@/lib/macroBias";
import { toneColor, verdictLabel, Bar, SegmentedControl, PillarCard } from "@/components/BiasView";

function earliestDate(panels: MacroPanel[]): string {
  let min: string | null = null;
  for (const p of panels) {
    for (const s of p.series) {
      const first = s.history?.[0]?.date;
      if (first && (min === null || first < min)) min = first;
    }
  }
  return min ?? "2015-01-01";
}

function latestDate(panels: MacroPanel[]): string {
  let max: string | null = null;
  for (const p of panels) {
    for (const s of p.series) {
      const last = s.history?.[s.history.length - 1]?.date;
      if (last && (max === null || last > max)) max = last;
    }
  }
  return max ?? new Date().toISOString().slice(0, 10);
}

export default function ReplayPage({ panels }: { panels: MacroPanel[] }) {
  const minDate = useMemo(() => earliestDate(panels), [panels]);
  const maxDate = useMemo(() => latestDate(panels), [panels]);

  const [timeframeId, setTimeframeId] = useState(DEFAULT_TIMEFRAME);
  const [assetScopeId, setAssetScopeId] = useState(DEFAULT_ASSET_SCOPE);
  const [asOfDate, setAsOfDate] = useState(maxDate);

  const scope = ASSET_SCOPES.find((s) => s.id === assetScopeId) ?? ASSET_SCOPES[0];
  const timeframe = TIMEFRAMES.find((t) => t.id === timeframeId) ?? TIMEFRAMES[TIMEFRAMES.length - 1];

  const bias = useMemo(
    () =>
      computeMacroBias(panels, {
        historyDays: timeframe.days,
        indicatorWeights: scope.indicatorWeights,
        horizon: timeframe.horizon,
        asOfDate,
      }),
    [panels, timeframe.days, timeframe.horizon, scope.indicatorWeights, asOfDate]
  );
  const { overall, pillars } = bias;
  const isLive = asOfDate >= maxDate;

  return (
    <div>
      <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">
              Macro bias as of {asOfDate}
              {isLive && " (latest available)"}
            </div>
            <div className="mt-1 font-sans text-[1rem] font-semibold">
              {overall.score === null ? "Insufficient data" : verdictLabel(overall.tone, overall.strength)}
            </div>
          </div>
          <span
            className="rounded-full border px-4 py-1.5 text-[0.9rem] font-bold"
            style={{
              color: toneColor(overall.tone),
              borderColor: `color-mix(in srgb, ${toneColor(overall.tone)} 40%, var(--border))`,
              background: `color-mix(in srgb, ${toneColor(overall.tone)} 12%, transparent)`,
            }}
          >
            {overall.score === null ? "-" : `${overall.score > 0 ? "+" : ""}${overall.score.toFixed(2)}`}
          </span>
        </div>
        {overall.score !== null && (
          <div className="mt-4">
            <Bar score={overall.score} tone={overall.tone} />
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 border-t border-[var(--border)] pt-4">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">As of</span>
            <input
              type="date"
              min={minDate}
              max={maxDate}
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1 font-mono text-[0.75rem] text-[var(--text)] outline-none focus-visible:border-[var(--accent)]"
            />
            <input
              type="range"
              min={0}
              max={1000}
              value={
                new Date(asOfDate).getTime() <= new Date(minDate).getTime()
                  ? 0
                  : Math.round(
                      ((new Date(asOfDate).getTime() - new Date(minDate).getTime()) /
                        (new Date(maxDate).getTime() - new Date(minDate).getTime())) *
                        1000
                    )
              }
              onChange={(e) => {
                const pct = Number(e.target.value) / 1000;
                const ms = new Date(minDate).getTime() + pct * (new Date(maxDate).getTime() - new Date(minDate).getTime());
                setAsOfDate(new Date(ms).toISOString().slice(0, 10));
              }}
              className="flex-1 accent-[var(--accent)]"
            />
            <button
              onClick={() => setAsOfDate(maxDate)}
              className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1 font-mono text-[0.68rem] font-semibold text-[var(--text-faint)] hover:text-[var(--text)]"
            >
              Jump to live
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">Timeframe</span>
              <SegmentedControl options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))} value={timeframeId} onChange={setTimeframeId} />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">Asset scope</span>
              <SegmentedControl options={ASSET_SCOPES.map((s) => ({ id: s.id, label: s.label }))} value={assetScopeId} onChange={setAssetScopeId} />
            </div>
          </div>
        </div>

        <p className="mt-4 font-sans text-[0.72rem] leading-relaxed text-[var(--text-faint)]">
          Same composite engine as Macro Bias, pinned to a past date - every indicator is truncated to what was
          actually known as of that day, then scored and weighted exactly the same way. Drag the slider or pick a
          date to see what the board looked like at any point in its stored history.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {pillars
          .filter((pillar) => pillar.indicators.length > 0)
          .map((pillar) => (
            <PillarCard key={pillar.id} pillar={pillar} weights={scope.indicatorWeights} />
          ))}
      </div>
    </div>
  );
}
