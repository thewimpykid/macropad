"use client";

import { useState } from "react";
import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import SeriesCard from "@/components/SeriesCard";
import QuantCard from "@/components/QuantCard";
import NewsFeedCard from "@/components/NewsFeedCard";
import MarketTicker from "@/components/MarketTicker";
import PanelIcon from "@/components/PanelIcon";
import CustomDashboardPage from "@/components/CustomDashboardPage";
import CustomBiasPage from "@/components/CustomBiasPage";
import { MARKET_SYMBOLS } from "@/lib/markets";
import { getSignTone } from "@/lib/bias";

const DEEP_PANELS = new Set(["us-macro", "yield-rates", "cot-positioning", "transmission", "geopolitics"]);
const NEWS_ID = "news";
const CUSTOM_DASHBOARD_ID = "custom-dashboard";
const CUSTOM_BIAS_ID = "custom-bias";

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
  const [navOpen, setNavOpen] = useState(false);
  const active = panels.find((p) => p.id === activeId);
  const pickPage = (id: string) => {
    setActiveId(id);
    setNavOpen(false);
  };
  const isNews = activeId === NEWS_ID;
  const isCustomDashboard = activeId === CUSTOM_DASHBOARD_ID;
  const isCustomBias = activeId === CUSTOM_BIAS_ID;
  const assetLabel = MARKET_SYMBOLS.find((m) => m.symbol === assetFilter)?.label ?? null;
  const newsSeries = panels.flatMap((p) => p.series).find((s) => s.id === "geo:news-feed") ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <MarketTicker markets={markets} />

      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 lg:hidden">
        <button
          onClick={() => setNavOpen((v) => !v)}
          aria-label="Toggle navigation"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-dim)]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 4H14" />
            <path d="M2 8H14" />
            <path d="M2 12H14" />
          </svg>
        </button>
        <div className="font-display text-[1.1rem] leading-none">
          <span className="text-[var(--accent)]">Macro</span>pad
        </div>
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}

      <div className="flex flex-1">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 -translate-x-full flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--panel-2)] transition-transform duration-200 lg:static lg:translate-x-0 ${
            navOpen ? "translate-x-0" : ""
          }`}
        >
          <div className="hidden border-b border-[var(--border)] px-5 py-5 lg:block">
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

          <nav className="flex flex-1 flex-col gap-1 p-3">
            <NavButton isActive={isNews} onClick={() => pickPage(NEWS_ID)} icon="news" title="News" subtitle="headline sentiment" />
            {panels.map((panel) => {
              const { bull, bear } = panelSignals(panel);
              return (
                <NavButton
                  key={panel.id}
                  isActive={panel.id === activeId}
                  onClick={() => pickPage(panel.id)}
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
              isActive={isCustomDashboard}
              onClick={() => pickPage(CUSTOM_DASHBOARD_ID)}
              icon="custom-dashboard"
              title="Custom Dashboard"
              subtitle="pick your own indicators"
            />
            <NavButton
              isActive={isCustomBias}
              onClick={() => pickPage(CUSTOM_BIAS_ID)}
              icon="custom-bias"
              title="Custom Bias"
              subtitle="your own weights + thresholds"
            />
          </nav>

          <div className="border-t border-[var(--border)] px-5 py-3.5 font-mono text-[0.66rem] text-[var(--text-faint)]">
            {panels.reduce((n, p) => n + p.series.length, 0)} live series
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-9 lg:py-8">
          {isNews ? (
            <>
              <header className="mb-7">
                <h1 className="font-display m-0 text-balance text-[1.5rem] font-semibold">News</h1>
              </header>
              {newsSeries ? <NewsFeedCard series={newsSeries} /> : <p className="font-sans text-[0.85rem] text-[var(--text-faint)]">No news data yet.</p>}
            </>
          ) : isCustomDashboard ? (
            <>
              <header className="mb-7">
                <h1 className="font-display m-0 text-balance text-[1.5rem] font-semibold">Custom Dashboard</h1>
              </header>
              <CustomDashboardPage panels={panels} markets={markets} />
            </>
          ) : isCustomBias ? (
            <>
              <header className="mb-7">
                <h1 className="font-display m-0 text-balance text-[1.5rem] font-semibold">Custom Bias</h1>
              </header>
              <CustomBiasPage panels={panels} />
            </>
          ) : active ? (
            <>
              <header className="mb-7">
                <h1 className="font-display m-0 text-balance text-[1.5rem] font-semibold">{active.title}</h1>
              </header>

              <div className={DEEP_PANELS.has(active.id) ? "flex flex-col gap-2" : "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"}>
                {active.series
                  .filter((series) => series.id !== "geo:news-feed")
                  .map((series) =>
                    DEEP_PANELS.has(active.id) ? (
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
