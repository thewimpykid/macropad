"use client";

import { useState } from "react";
import type { MacroPanel } from "@/lib/macroData";
import { MARKET_SYMBOLS, IMPACTS } from "@/lib/markets";
import { getSignTone } from "@/lib/bias";

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

/**
 * Every indicator × every asset, as the signed weight map Net Bias actually
 * uses. Arrow = direction when the indicator prints HIGH; opacity = weight.
 * The left column shows each indicator's live regime signal, so you can
 * read current pressure straight across a row.
 */
export default function ImpactMatrix({ panels }: { panels: MacroPanel[] }) {
  const [tip, setTip] = useState<string | null>(null);

  return (
    <div>
      <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--panel)]">
        <table className="w-full border-collapse text-[0.78rem]">
          <thead>
            <tr className="border-b border-[var(--border-strong)]">
              <th className="sticky left-0 bg-[var(--panel)] px-4 py-2.5 text-left font-medium text-[var(--text-faint)]">
                Indicator
              </th>
              <th className="px-2 py-2.5 text-right font-medium text-[var(--text-faint)]">Signal</th>
              {MARKET_SYMBOLS.map((m) => (
                <th key={m.symbol} className="px-2 py-2.5 text-center font-mono text-[0.68rem] font-semibold text-[var(--text-dim)]">
                  {SHORT[m.symbol]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {panels.map((panel) => {
              const withImpacts = panel.series.filter((s) => IMPACTS[s.id]?.length);
              if (withImpacts.length === 0) return null;
              return [
                <tr key={`${panel.id}-head`} className="border-b border-[var(--border)]">
                  <td
                    colSpan={2 + MARKET_SYMBOLS.length}
                    className="sticky left-0 bg-[var(--panel-2)] px-4 py-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]"
                  >
                    {panel.title}
                  </td>
                </tr>,
                ...withImpacts.map((s) => {
                  const signalTone = getSignTone(s.id, s.zscore);
                  const signalColor =
                    signalTone === "up" ? "var(--up)" : signalTone === "down" ? "var(--down)" : "var(--text-faint)";
                  return (
                    <tr key={s.id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--panel-2)]">
                      <td className="sticky left-0 max-w-[260px] truncate bg-[var(--panel)] px-4 py-2 font-medium text-[var(--text)]">
                        {s.name}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-[0.72rem]" style={{ color: signalColor }}>
                        {s.zscore === null ? "—" : `${s.zscore > 0 ? "+" : ""}${s.zscore.toFixed(2)}`}
                      </td>
                      {MARKET_SYMBOLS.map((m) => {
                        const impact = IMPACTS[s.id]?.find((i) => i.symbol === m.symbol);
                        if (!impact) {
                          return (
                            <td key={m.symbol} className="px-2 py-2 text-center text-[var(--border-strong)]">
                              ·
                            </td>
                          );
                        }
                        const color = impact.sign > 0 ? "var(--up)" : "var(--down)";
                        return (
                          <td
                            key={m.symbol}
                            className="cursor-help px-2 py-2 text-center font-mono font-semibold"
                            style={{ color, opacity: Math.round((0.35 + impact.weight * 0.65) * 100) / 100 }}
                            onMouseEnter={() =>
                              setTip(
                                `${s.name} → ${SHORT[m.symbol]} (${impact.sign > 0 ? "high = bullish" : "high = bearish"}, weight ${(impact.weight * 100).toFixed(0)}%): ${impact.rationale}`
                              )
                            }
                            onMouseLeave={() => setTip(null)}
                          >
                            {impact.sign > 0 ? "↑" : "↓"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex min-h-[38px] items-start gap-4">
        <div className="flex shrink-0 items-center gap-4 pt-0.5 text-[0.68rem] text-[var(--text-faint)]">
          <span><span className="font-mono font-semibold text-[var(--up)]">↑</span> high = bullish</span>
          <span><span className="font-mono font-semibold text-[var(--down)]">↓</span> high = bearish</span>
          <span>opacity = weight</span>
        </div>
        {tip && <p className="m-0 text-[0.72rem] leading-snug text-[var(--text-dim)]">{tip}</p>}
      </div>
    </div>
  );
}
