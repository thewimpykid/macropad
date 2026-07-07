"use client";

import Sparkline from "@/components/Sparkline";
import { changeCorrelation } from "@/lib/stats";
import type { MarketRow } from "@/lib/getMarkets";
import type { HistoryPoint } from "@/lib/macroData";
import type { Impact } from "@/lib/markets";

/**
 * One impacted asset: direction, weight, live correlation vs the indicator,
 * and the reason the link exists.
 */
export default function MarketLink({
  market,
  impact,
  indicatorHistory,
}: {
  market: MarketRow | null;
  impact: Impact;
  indicatorHistory: HistoryPoint[];
}) {
  const r =
    market?.history && market.history.length >= 20 ? changeCorrelation(indicatorHistory, market.history, 6) : null;

  const dirColor = impact.sign > 0 ? "var(--up)" : "var(--down)";

  return (
    <div className="flex items-center gap-3 rounded-[3px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
      <span
        className="w-10 shrink-0 text-center font-mono text-[0.9rem] font-semibold"
        style={{ color: dirColor }}
        title={impact.sign > 0 ? "High reading is bullish this asset" : "High reading is bearish this asset"}
      >
        {impact.sign > 0 ? "↑" : "↓"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[0.8rem] font-semibold text-[var(--text)]">{market?.name ?? impact.symbol}</span>
          {market && <span className="font-mono text-[0.74rem] text-[var(--text-dim)]">{market.value}</span>}
          {r !== null && (
            <span className="font-mono text-[0.66rem] text-[var(--text-faint)]" title="Pearson correlation of period-over-period changes, indicator vs asset">
              r {r > 0 ? "+" : ""}{r.toFixed(2)}
            </span>
          )}
          <span className="ml-auto shrink-0 font-mono text-[0.66rem] text-[var(--text-faint)]">
            wt {(impact.weight * 100).toFixed(0)}%
          </span>
        </div>
        <p className="m-0 mt-0.5 text-[0.7rem] leading-snug text-[var(--text-faint)]">{impact.rationale}</p>
      </div>
      {market?.sparkline && market.sparkline.length >= 5 && (
        <div className="w-14 shrink-0">
          <Sparkline data={market.sparkline} tone={market.status} heightClass="h-8" />
        </div>
      )}
    </div>
  );
}
