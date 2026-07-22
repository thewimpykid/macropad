import type { MacroSeries } from "@/lib/macroData";
import Sparkline from "@/components/Sparkline";
import ZScoreBar from "@/components/ZScoreBar";
import { getBias, getSignTone } from "@/lib/bias";
import { seriesAffectsSymbol, IMPACTS } from "@/lib/markets";

const dirGlyph: Record<"up" | "down" | "flat", string> = {
  up: "▲",
  down: "▼",
  flat: "→",
};

const toneLabel: Record<"up" | "down" | "flat", string> = {
  up: "bullish",
  down: "bearish",
  flat: "flat",
};

export default function SeriesCard({
  series,
  assetFilter = null,
  assetLabel = null,
}: {
  series: MacroSeries;
  assetFilter?: string | null;
  assetLabel?: string | null;
}) {
  const hasChart = series.sparkline !== null && series.sparkline.length >= 5;
  const hasSignal = series.zscore !== null;
  const isRelevant = !assetFilter || seriesAffectsSymbol(series.id, assetFilter);
  const bias = getBias(series.id, series.zscore);
  // Glyph, label, and bar all key off the same score-derived tone - no
  // separate literal-direction tone to ever disagree with the bias label.
  const signalTone = getSignTone(series.id, series.zscore);
  const chipColor = signalTone === "up" ? "var(--up)" : signalTone === "down" ? "var(--down)" : "var(--text-faint)";

  return (
    <div
      className="border-b border-[var(--border)] py-5"
      style={!isRelevant ? { opacity: 0.4 } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-[0.92rem] font-semibold text-[var(--text)]">{series.name}</h3>
          <p className="m-0 mt-0.5 text-[0.78rem] leading-snug text-[var(--text-dim)]">{series.note}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {series.stale && (
            <span
              className="rounded-sm border border-[var(--amber)] px-1 py-0.5 font-mono text-[0.54rem] uppercase tracking-[0.08em] text-[var(--amber)]"
              title="This source didn't refresh in the latest sync - showing the last value it returned."
            >
              stale
            </span>
          )}
          <span className="font-mono text-[0.78rem]" style={{ color: chipColor }} title={toneLabel[signalTone]}>
            {dirGlyph[signalTone]}
          </span>
        </div>
      </div>

      {!isRelevant && (
        <div className="mt-2 text-[0.68rem] text-[var(--text-faint)]">
          No mapped impact on {assetLabel ?? assetFilter}
        </div>
      )}

      <div className="mt-2.5 font-mono text-[1.45rem] font-semibold leading-none text-[var(--text)]">
        {series.value}
      </div>

      {bias && bias.strength !== null && (
        <div
          className="mt-1.5 text-[0.76rem] font-medium"
          style={{ color: bias.tone === "up" ? "var(--up)" : bias.tone === "down" ? "var(--down)" : "var(--text-dim)" }}
        >
          {bias.label}
        </div>
      )}

      {hasChart && (
        <div className="mt-2.5">
          <Sparkline data={series.sparkline as number[]} tone={series.status} />
        </div>
      )}

      {hasSignal && (
        <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
          <div className="mb-1 flex items-center justify-between text-[0.66rem] text-[var(--text-faint)]">
            <span>Indicator score</span>
            {IMPACTS[series.id] && <span>{IMPACTS[series.id].length} linked asset{IMPACTS[series.id].length === 1 ? "" : "s"}</span>}
          </div>
          <ZScoreBar z={series.zscore as number} tone={signalTone} />
        </div>
      )}

      {series.windowLabel && (
        <div className="mt-2.5 text-right font-mono text-[0.62rem] text-[var(--text-faint)]">{series.windowLabel}</div>
      )}
    </div>
  );
}
