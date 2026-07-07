"use client";

import { useState } from "react";
import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import QuantCard from "@/components/QuantCard";
import NewsFeedCard from "@/components/NewsFeedCard";
import BiasTape from "@/components/BiasTape";
import ImpactMatrix from "@/components/ImpactMatrix";
import NetBiasPage from "@/components/NetBiasPage";
import PanelIcon from "@/components/PanelIcon";
import { MARKET_SYMBOLS } from "@/lib/markets";
import { getSignTone } from "@/lib/bias";
import type { Horizon } from "@/lib/netBias";

const HORIZONS: { id: Horizon; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

const MATRIX_ID = "impact-matrix";
const NET_BIAS_ID = "net-bias";

/** Count of strong reads (|score| ≥ 0.5 on the -1..1 method scale) per panel, split by good/bad tone. */
function panelSignals(panel: MacroPanel): { bull: number; bear: number } {
  let bull = 0;
  let bear = 0;
  for (const s of panel.series) {
    if (s.zscore === null || Math.abs(s.zscore) < 0.5) continue;
    const tone = getSignTone(s.id, s.zscore);
    if (tone === "up") bull++;
    else if (tone === "down") bear++;
  }
  return { bull, bear };
}

function NavButton({
  isActive,
  onClick,
  icon,
  title,
  subtitle,
}: {
  isActive: boolean;
  onClick: () => void;
  icon: string;
  title: string;
  subtitle: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex items-center gap-2.5 rounded-[3px] px-3 py-2 text-left transition-colors"
      style={isActive ? { background: "var(--panel)", boxShadow: "inset 2px 0 0 var(--accent)" } : undefined}
    >
      <PanelIcon
        id={icon}
        className="shrink-0"
        style={{ color: isActive ? "var(--accent)" : "var(--text-faint)" }}
      />
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[0.82rem] font-medium ${
            isActive ? "text-[var(--text)]" : "text-[var(--text-dim)] group-hover:text-[var(--text)]"
          }`}
        >
          {title}
        </div>
        <div className="mt-0.5 text-[0.64rem] text-[var(--text-faint)]">{subtitle}</div>
      </div>
    </button>
  );
}

export default function DashboardShell({
  panels,
  lastUpdated,
  markets,
}: {
  panels: MacroPanel[];
  lastUpdated: string | null;
  markets: MarketRow[];
}) {
  const [activeId, setActiveId] = useState(panels[0]?.id ?? "");
  const [assetFilter, setAssetFilter] = useState<string>("");
  const [horizon, setHorizon] = useState<Horizon>("weekly");
  const active = panels.find((p) => p.id === activeId);
  const isMatrix = activeId === MATRIX_ID;
  const isNetBias = activeId === NET_BIAS_ID;
  const assetLabel = MARKET_SYMBOLS.find((m) => m.symbol === assetFilter)?.label ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <BiasTape
        panels={panels}
        markets={markets}
        horizon={horizon}
        activeSymbol={assetFilter}
        onPick={(symbol) => {
          setAssetFilter(symbol === assetFilter ? "" : symbol);
          setActiveId(NET_BIAS_ID);
        }}
      />

      <div className="flex flex-1">
        <aside className="flex w-[236px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel-2)]">
          <div className="border-b border-[var(--border)] px-4 py-4">
            <div className="font-display text-[1.3rem] leading-none">
              Macropad
            </div>
            <div className="mt-1.5 font-mono text-[0.62rem] text-[var(--text-faint)]">
              {lastUpdated ? `data as of ${new Date(lastUpdated).toLocaleString()}` : "no data synced yet"}
            </div>
          </div>

          <div className="border-b border-[var(--border)] px-3.5 py-3">
            <label className="mb-1.5 block text-[0.62rem] font-medium text-[var(--text-faint)]">
              Asset lens
            </label>
            <select
              value={assetFilter}
              onChange={(e) => setAssetFilter(e.target.value)}
              className="w-full rounded-[3px] border bg-[var(--panel)] px-2.5 py-1.5 text-[0.78rem] outline-none focus-visible:border-[var(--accent)]"
              style={{
                borderColor: assetFilter ? "var(--accent)" : "var(--border)",
                color: assetFilter ? "var(--text)" : "var(--text-dim)",
              }}
            >
              <option value="">All indicators</option>
              {MARKET_SYMBOLS.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.label}
                </option>
              ))}
            </select>
            {assetFilter && (
              <p className="m-0 mt-1.5 text-[0.64rem] leading-snug text-[var(--text-faint)]">
                Indicators with no mapped impact on {assetLabel} are dimmed.
              </p>
            )}
          </div>

          <div className="border-b border-[var(--border)] px-3.5 py-3">
            <label className="mb-1.5 block text-[0.62rem] font-medium text-[var(--text-faint)]">
              Horizon
            </label>
            <div className="flex rounded-[3px] border border-[var(--border)] bg-[var(--panel)] p-0.5">
              {HORIZONS.map((h) => {
                const isSel = horizon === h.id;
                return (
                  <button
                    key={h.id}
                    onClick={() => setHorizon(h.id)}
                    className="flex-1 rounded-[2px] px-2 py-1 text-[0.7rem] font-medium transition-colors"
                    style={isSel ? { background: "var(--panel-2)", color: "var(--accent)", boxShadow: "inset 0 0 0 1px var(--border-strong)" } : { color: "var(--text-faint)" }}
                  >
                    {h.label}
                  </button>
                );
              })}
            </div>
            <p className="m-0 mt-1.5 text-[0.64rem] leading-snug text-[var(--text-faint)]">
              Weights Net Bias toward indicators released on this cadence.
            </p>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 p-2.5">
            {panels.map((panel) => {
              const { bull, bear } = panelSignals(panel);
              return (
                <NavButton
                  key={panel.id}
                  isActive={panel.id === activeId}
                  onClick={() => setActiveId(panel.id)}
                  icon={panel.id}
                  title={panel.title}
                  subtitle={
                    bull + bear === 0 ? (
                      "no strong reads"
                    ) : (
                      <span className="font-mono">
                        {bull > 0 && <span className="text-[var(--up)]">{bull} bull</span>}
                        {bull > 0 && bear > 0 && " · "}
                        {bear > 0 && <span className="text-[var(--down)]">{bear} bear</span>}
                        <span> strong</span>
                      </span>
                    )
                  }
                />
              );
            })}

            <div className="my-2 border-t border-[var(--border)]" />

            <NavButton
              isActive={isNetBias}
              onClick={() => setActiveId(NET_BIAS_ID)}
              icon="net-bias"
              title="Net Bias"
              subtitle="combined read per asset"
            />
            <NavButton
              isActive={isMatrix}
              onClick={() => setActiveId(MATRIX_ID)}
              icon="topology"
              title="Impact Matrix"
              subtitle="every indicator × every asset"
            />
          </nav>

          <div className="border-t border-[var(--border)] px-4 py-3 font-mono text-[0.62rem] text-[var(--text-faint)]">
            {panels.reduce((n, p) => n + p.series.length, 0)} series · FRED / CFTC / Yahoo
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-8 py-7">
          {isMatrix ? (
            <>
              <header className="mb-6">
                <h1 className="font-display m-0 text-[1.65rem] leading-tight">Impact Matrix</h1>
                <p className="m-0 mt-1 max-w-[74ch] text-[0.84rem] text-[var(--text-dim)]">
                  The signed weight map Net Bias runs on: which indicators move which assets, in which direction,
                  and how hard. Hover a cell for the reasoning.
                </p>
              </header>
              <ImpactMatrix panels={panels} />
            </>
          ) : isNetBias ? (
            <>
              <header className="mb-6">
                <h1 className="font-display m-0 text-[1.65rem] leading-tight">Net Bias</h1>
                <p className="m-0 mt-1 max-w-[74ch] text-[0.84rem] text-[var(--text-dim)]">
                  Every mapped indicator combined into one signed read per asset — polarized when the evidence
                  is, neutral only when it actually is.
                </p>
              </header>
              <NetBiasPage
                panels={panels}
                markets={markets}
                assetFilter={assetFilter}
                onPickAsset={setAssetFilter}
                horizon={horizon}
              />
            </>
          ) : active ? (
            <>
              <header className="mb-6">
                <h1 className="font-display m-0 text-[1.65rem] leading-tight">{active.title}</h1>
                <p className="m-0 mt-1 max-w-[74ch] text-[0.84rem] text-[var(--text-dim)]">{active.description}</p>
              </header>

              <div className="flex flex-col gap-2">
                {active.series.map((series) =>
                  series.id === "geo:news-feed" ? (
                    <NewsFeedCard key={series.id} series={series} />
                  ) : (
                    <QuantCard
                      key={series.id}
                      series={series}
                      markets={markets}
                      assetFilter={assetFilter || null}
                      assetLabel={assetLabel}
                    />
                  )
                )}
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
