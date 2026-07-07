"use client";

import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import { MARKET_SYMBOLS, marketRowId } from "@/lib/markets";
import { computeNetBias, type Horizon } from "@/lib/netBias";

const SHORT: Record<string, string> = {
  "^GSPC": "SPX",
  "^IXIC": "NDX",
  "CL=F": "WTI",
  "GC=F": "GOLD",
  "HG=F": "COPPER",
  "DX-Y.NYB": "DXY",
  HYG: "HYG",
  TLT: "TLT",
  "SI=F": "SILVER",
  "NG=F": "NATGAS",
};

function toneColor(tone: "up" | "down" | "flat"): string {
  return tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text-faint)";
}

/**
 * The bias tape: every asset's cadence-weighted net macro bias in one fixed
 * strip. The signed bar fills from the center — length is score, side is
 * direction. This is the dashboard's one-glance thesis.
 */
export default function BiasTape({
  panels,
  markets,
  horizon,
  activeSymbol,
  onPick,
}: {
  panels: MacroPanel[];
  markets: MarketRow[];
  horizon: Horizon;
  activeSymbol: string;
  onPick: (symbol: string) => void;
}) {
  const marketById = new Map(markets.map((m) => [m.id, m]));

  return (
    <div className="border-b border-[var(--border)] bg-[var(--panel-2)]">
      <div className="flex flex-wrap">
        {MARKET_SYMBOLS.map(({ symbol }) => {
          const result = computeNetBias(panels, markets, symbol, horizon);
          const market = marketById.get(marketRowId(symbol));
          const clamped = Math.max(-1, Math.min(1, result.score));
          // Rounded: Chromium's CSSOM re-serializes long floats (and expands
          // the `background` shorthand), which trips React hydration diffing.
          const halfPct = Math.round(Math.abs(clamped) * 5000) / 100;
          const color = toneColor(result.tone);
          const isActive = activeSymbol === symbol;
          return (
            <button
              key={symbol}
              onClick={() => onPick(symbol)}
              title={`${SHORT[symbol]}: ${result.verdict} (score ${result.score >= 0 ? "+" : ""}${result.score.toFixed(2)}, ${Math.round(result.conviction * 100)}% agreement)`}
              className="group min-w-[128px] flex-1 border-r border-[var(--border)] px-3.5 py-2.5 text-left transition-colors last:border-r-0"
              style={isActive ? { background: "var(--panel)", boxShadow: "inset 0 -2px 0 var(--accent)" } : undefined}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[0.7rem] font-semibold tracking-wide text-[var(--text-dim)] group-hover:text-[var(--text)]">
                  {SHORT[symbol]}
                </span>
                <span className="font-mono text-[0.7rem] text-[var(--text-faint)]">{market?.value ?? ""}</span>
              </div>
              <div className="relative mt-1.5 h-[4px] rounded-[2px] bg-[var(--border)]">
                <div className="absolute left-1/2 top-[-2px] h-[8px] w-px bg-[var(--border-strong)]" />
                <div
                  className="absolute top-0 h-full rounded-[2px]"
                  style={{ width: `${halfPct}%`, backgroundColor: color, [clamped >= 0 ? "left" : "right"]: "50%" }}
                />
              </div>
              <div className="mt-1 text-[0.64rem] font-medium" style={{ color }}>
                {result.verdict}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
