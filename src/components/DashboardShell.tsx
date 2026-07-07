"use client";

import { useState } from "react";
import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import SeriesCard from "@/components/SeriesCard";
import QuantCard from "@/components/QuantCard";
import NewsFeedCard from "@/components/NewsFeedCard";
import MarketTicker from "@/components/MarketTicker";
import BiasTape from "@/components/BiasTape";
import TopologyGraph from "@/components/TopologyGraph";
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

const DEEP_PANELS = new Set(["us-macro", "yield-rates", "cot-positioning", "transmission", "geopolitics"]);
const TOPOLOGY_ID = "topology";
const MATRIX_ID = "impact-matrix";
const NET_BIAS_ID = "net-bias";

/** Count of strong reads (|score| >= 0.5 on the -1..1 method scale) per panel, split by good/bad tone. */
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
      className="group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-sans transition-all duration-150"
      style={
        isActive
          ? {
              background: "color-mix(in srgb, var(--accent) 11%, transparent)",
              boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)",
            }
          : undefined
      }
    >
      {isActive && (
        <span
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full"
          style={{ background: "var(--accent)" }}
        />
      )}
      <PanelIcon id={icon} className="shrink-0 transition-colors" style={{ color: isActive ? "var(--accent)" : "var(--text-faint)" }} />
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[0.85rem] font-semibold transition-colors ${
            isActive ? "text-[var(--text)]" : "text-[var(--text-dim)] group-hover:text-[var(--text)]"
          }`}
        >
          {title}
        </div>
        <div className="mt-0.5 text-[0.66rem] text-[var(--text-faint)]">{subtitle}</div>
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
  const isTopology = activeId === TOPOLOGY_ID;
  const isMatrix = activeId === MATRIX_ID;
  const isNetBias = activeId === NET_BIAS_ID;
  const assetLabel = MARKET_SYMBOLS.find((m) => m.symbol === assetFilter)?.label ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <MarketTicker markets={markets} />
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
        <aside className="flex w-[248px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel-2)]">
          <div className="border-b border-[var(--border)] px-5 py-5">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-mono text-[0.8rem] font-bold"
                style={{
                  background: "color-mix(in srgb, var(--accent) 16%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)",
                  color: "var(--accent)",
                  boxShadow: "0 0 14px color-mix(in srgb, var(--accent) 25%, transparent)",
                }}
              >
                M
              </div>
              <div className="font-display text-[1.3rem] leading-none">
                <span className="text-[var(--accent)]">Macro</span>pad
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.09em] text-[var(--text-faint)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--up)] opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--up)]" />
              </span>
              {lastUpdated ? `synced ${new Date(lastUpdated).toLocaleTimeString()}` : "not yet synced"}
            </div>
          </div>

          <div className="border-b border-[var(--border)] px-3.5 py-3.5">
            <label className="mb-1.5 block font-sans text-[0.64rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
              Asset lens
            </label>
            <div className="relative">
              <select
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
                className="w-full appearance-none rounded-md border px-3 py-2 pr-8 font-sans text-[0.82rem] font-medium outline-none"
                style={{
                  borderColor: assetFilter ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)",
                  background: assetFilter ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "var(--panel)",
                  color: assetFilter ? "var(--accent)" : "var(--text-dim)",
                }}
              >
                <option value="">All indicators</option>
                {MARKET_SYMBOLS.map((m) => (
                  <option key={m.symbol} value={m.symbol}>
                    {m.label}
                  </option>
                ))}
              </select>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
                style={{ color: assetFilter ? "var(--accent)" : "var(--text-faint)" }}
              >
                <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {assetFilter && (
              <p className="m-0 mt-1.5 font-sans text-[0.68rem] leading-snug text-[var(--text-faint)]">
                Indicators with no mapped impact on {assetLabel} are dimmed below.
              </p>
            )}
          </div>

          <div className="border-b border-[var(--border)] px-3.5 py-3.5">
            <label className="mb-1.5 block font-sans text-[0.64rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
              Horizon
            </label>
            <div className="flex rounded-md border border-[var(--border)] bg-[var(--panel)] p-0.5">
              {HORIZONS.map((h) => {
                const isSel = horizon === h.id;
                return (
                  <button
                    key={h.id}
                    onClick={() => setHorizon(h.id)}
                    className="flex-1 rounded px-2 py-1.5 font-sans text-[0.72rem] font-semibold transition-colors"
                    style={
                      isSel
                        ? { background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--accent)" }
                        : { color: "var(--text-faint)" }
                    }
                  >
                    {h.label}
                  </button>
                );
              })}
            </div>
            <p className="m-0 mt-1.5 font-sans text-[0.68rem] leading-snug text-[var(--text-faint)]">
              Weights Net Bias toward indicators that release on this cadence — a monthly print like CPI matters
              more for a monthly read than a daily one.
            </p>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-3">
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
              isActive={isTopology}
              onClick={() => setActiveId(TOPOLOGY_ID)}
              icon="topology"
              title="Topology"
              subtitle="every indicator, linked"
            />
            <NavButton
              isActive={isMatrix}
              onClick={() => setActiveId(MATRIX_ID)}
              icon="impact-matrix"
              title="Impact Matrix"
              subtitle="every indicator × every asset"
            />
            <NavButton
              isActive={isNetBias}
              onClick={() => setActiveId(NET_BIAS_ID)}
              icon="net-bias"
              title="Net Bias"
              subtitle="combined read per asset"
            />
          </nav>

          <div className="border-t border-[var(--border)] px-5 py-3.5 font-mono text-[0.66rem] text-[var(--text-faint)]">
            {panels.reduce((n, p) => n + p.series.length, 0)} live series
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-9 py-8">
          {isTopology ? (
            <>
              <header className="mb-7">
                <h1 className="font-display m-0 text-balance text-[1.5rem] font-semibold">Topology</h1>
                <p className="m-0 mt-1 max-w-[70ch] font-sans text-[0.9rem] text-[var(--text-dim)]">
                  Every indicator across every panel, linked to the tradable markets it actually moves. Panel nodes
                  cluster their own indicators; drag anything to explore.
                </p>
              </header>
              <TopologyGraph panels={panels} markets={markets} />
            </>
          ) : isMatrix ? (
            <>
              <header className="mb-7">
                <h1 className="font-display m-0 text-balance text-[1.5rem] font-semibold">Impact Matrix</h1>
                <p className="m-0 mt-1 max-w-[74ch] font-sans text-[0.9rem] text-[var(--text-dim)]">
                  The signed weight map Net Bias runs on: which indicators move which assets, in which direction,
                  and how hard. Hover a cell for the reasoning.
                </p>
              </header>
              <ImpactMatrix panels={panels} />
            </>
          ) : isNetBias ? (
            <>
              <header className="mb-7">
                <h1 className="font-display m-0 text-balance text-[1.5rem] font-semibold">Net Bias</h1>
                <p className="m-0 mt-1 max-w-[70ch] font-sans text-[0.9rem] text-[var(--text-dim)]">
                  Every mapped indicator combined into one signed read per asset — polarized when the evidence is,
                  neutral only when it actually is.
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
              <header className="mb-7">
                <h1 className="font-display m-0 text-balance text-[1.5rem] font-semibold">{active.title}</h1>
                <p className="m-0 mt-1 max-w-[60ch] font-sans text-[0.9rem] text-[var(--text-dim)]">
                  {active.description}
                </p>
              </header>

              <div className={DEEP_PANELS.has(active.id) ? "flex flex-col gap-2" : "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"}>
                {active.series.map((series) =>
                  series.id === "geo:news-feed" ? (
                    <NewsFeedCard key={series.id} series={series} />
                  ) : DEEP_PANELS.has(active.id) ? (
                    <QuantCard
                      key={series.id}
                      series={series}
                      markets={markets}
                      assetFilter={assetFilter || null}
                      assetLabel={assetLabel}
                    />
                  ) : (
                    <SeriesCard key={series.id} series={series} assetFilter={assetFilter || null} assetLabel={assetLabel} />
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
