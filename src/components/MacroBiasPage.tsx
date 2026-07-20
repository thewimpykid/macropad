"use client";

import { useMemo, useState } from "react";
import type { MacroPanel } from "@/lib/macroData";
import { computeMacroBias, TIMEFRAMES, DEFAULT_TIMEFRAME, ASSET_SCOPES, DEFAULT_ASSET_SCOPE } from "@/lib/macroBias";
import { toneColor, verdictLabel, Bar, SegmentedControl, PillarCard } from "@/components/BiasView";

export default function MacroBiasPage({ panels }: { panels: MacroPanel[] }) {
  const [timeframeId, setTimeframeId] = useState(DEFAULT_TIMEFRAME);
  const [assetScopeId, setAssetScopeId] = useState(DEFAULT_ASSET_SCOPE);

  const scope = ASSET_SCOPES.find((s) => s.id === assetScopeId) ?? ASSET_SCOPES[0];
  const timeframe = TIMEFRAMES.find((t) => t.id === timeframeId) ?? TIMEFRAMES[TIMEFRAMES.length - 1];

  const bias = useMemo(
    () => computeMacroBias(panels, { historyDays: timeframe.days, indicatorWeights: scope.indicatorWeights, horizon: timeframe.horizon }),
    [panels, timeframe.days, timeframe.horizon, scope.indicatorWeights]
  );
  const { overall, pillars } = bias;

  return (
    <div>
      <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">Overall macro bias</div>
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

        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-[var(--border)] pt-4">
          <div className="flex items-center gap-2">
            <span className="font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">Timeframe</span>
            <SegmentedControl options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))} value={timeframeId} onChange={setTimeframeId} />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-sans text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">Asset scope</span>
            <SegmentedControl options={ASSET_SCOPES.map((s) => ({ id: s.id, label: s.label }))} value={assetScopeId} onChange={setAssetScopeId} />
          </div>
        </div>

        <p className="mt-4 font-sans text-[0.72rem] leading-relaxed text-[var(--text-faint)]">
          Weighted average across every indicator&apos;s method-scored read over the selected lookback, grouped into
          seven pillars (growth, inflation, liquidity, rates, credit, positioning, volatility) for the breakdown
          below. Asset scope is a fixed preset, and deliberately polarized: indicators disconnected from that asset
          class (nat-gas positioning for an equities read, credit spreads for FX) are excluded outright at 0x, not
          softly diluted, while the ones that actually move it are weighted up sharply (e.g. Equities leans on net
          liquidity, credit spreads, and vol; Rates leans on the curve and inflation prints). Timeframe does the
          same to the pillar mix: short horizons (D/W/M) exclude growth and inflation entirely - a monthly print
          hasn&apos;t moved inside a week - and weight positioning/volatility up sharply; long horizons (6M/Y/2Y)
          exclude positioning and volatility - COT crowding has fully turned over many times inside a 2-year window
          - and weight growth, inflation, and credit up instead. None of this is user-adjustable. Positive =
          risk-on, negative = risk-off.
        </p>
        <p className="mt-2 font-sans text-[0.72rem] leading-relaxed text-[var(--text-faint)]">
          The bias reads standing conditions only. Geopolitical shocks, sudden headlines, and other event risk sit
          outside every input here and can drastically move outcomes without warning - treat any reading, however
          strong, as a lean under normal conditions rather than a guarantee.
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
