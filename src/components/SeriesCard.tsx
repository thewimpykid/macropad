import type { MacroSeries } from "@/lib/macroData";
import Sparkline from "@/components/Sparkline";
import ZScoreBar from "@/components/ZScoreBar";
import { getBias, getDirectionTone, getSignTone } from "@/lib/bias";
import { seriesAffectsSymbol, IMPACTS } from "@/lib/markets";

const dirGlyph: Record<MacroSeries["status"], string> = {
  up: "▲",
  down: "▼",
  flat: "→",
  pending: "·",
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
  const chipTone = getDirectionTone(series.id, series.status);
  const chipColor =
    chipTone === "up" ? "var(--up)" : chipTone === "down" ? "var(--down)" : "var(--text-faint)";
  const signalTone = getSignTone(series.id, series.zscore);

  return (
    <div
      className="rounded border border-[var(--border)] bg-[var(--panel)] p-4"
      style={!isRelevant ? { opacity: 0.4 } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-[0.9rem] font-semibold text-[var(--text)]">{series.name}</h3>
          <p className="m-0 mt-0.5 truncate text-[0.74rem] text-[var(--text-faint)]">{series.note}</p>
        </div>
        <span className="shrink-0 font-mono text-[0.78rem]" style={{ color: chipColor }} title={`Last change: ${series.status}`}>
          {dirGlyph[series.status]}
        </span>
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

      <div className="mt-2.5 flex items-center justify-between font-mono text-[0.62rem] text-[var(--text-faint)]">
        <span>{series.source}</span>
        {series.windowLabel && <span>{series.windowLabel}</span>}
      </div>
    </div>
  );
}
