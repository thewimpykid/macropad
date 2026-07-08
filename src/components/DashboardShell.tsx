"use client";

import { useState } from "react";
import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import SeriesCard from "@/components/SeriesCard";
import QuantCard from "@/components/QuantCard";
import NewsFeedCard from "@/components/NewsFeedCard";
import MarketTicker from "@/components/MarketTicker";
import IndicatorTicker from "@/components/IndicatorTicker";
import PanelIcon from "@/components/PanelIcon";
import CustomDashboardPage from "@/components/CustomDashboardPage";
import CustomBiasPage from "@/components/CustomBiasPage";
import BoardPage from "@/components/BoardPage";
import DocumentationPage from "@/components/DocumentationPage";
import { MARKET_SYMBOLS } from "@/lib/markets";
import { getSignTone } from "@/lib/bias";
import SignOutButton from "@/components/marketing/SignOutButton";

const DEEP_PANELS = new Set(["us-macro", "yield-rates", "cot-positioning", "transmission", "geopolitics", "volatility"]);
/** Catalogue-only panels - carry data (e.g. per-asset news) but never show up as their own nav entry. */
const HIDDEN_PANELS = new Set(["asset-news"]);
const BOARD_ID = "board";
const NEWS_ID = "news";
const CUSTOM_DASHBOARD_ID = "custom-dashboard";
const CUSTOM_BIAS_ID = "custom-bias";
const DOCS_ID = "docs";

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
      {isActive && <span className="absolute left-0 top-1/2 h-full w-[3px] -translate-y-1/2" style={{ background: "var(--accent)" }} />}
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
  const [activeId, setActiveId] = useState(BOARD_ID);
  const [navOpen, setNavOpen] = useState(false);
  const [newsAssetTab, setNewsAssetTab] = useState<string>(""); // "" = general macro feed
  const visiblePanels = panels.filter((p) => !HIDDEN_PANELS.has(p.id));
  const active = visiblePanels.find((p) => p.id === activeId);
  const pickPage = (id: string) => {
    setActiveId(id);
    setNavOpen(false);
  };
  const isBoard = activeId === BOARD_ID;
  const isNews = activeId === NEWS_ID;
  const isCustomDashboard = activeId === CUSTOM_DASHBOARD_ID;
  const isCustomBias = activeId === CUSTOM_BIAS_ID;
  const isDocs = activeId === DOCS_ID;
  const allSeries = panels.flatMap((p) => p.series);
  const newsSeries = allSeries.find((s) => s.id === "geo:news-feed") ?? null;
  const activeNewsSeries = newsAssetTab
    ? allSeries.find((s) => s.id === `asset-news:${newsAssetTab}`) ?? null
    : newsSeries;
  const boardNewsSeries = [
    newsSeries,
    ...MARKET_SYMBOLS.map((m) => allSeries.find((s) => s.id === `asset-news:${m.symbol}`) ?? null),
  ].filter((s): s is NonNullable<typeof s> => s !== null);
  const tickerSeries = visiblePanels.flatMap((p) => p.series).filter((s) => s.id !== "geo:news-feed");

  return (
    <div className="flex min-h-screen flex-col">
      <MarketTicker markets={markets} />
      <IndicatorTicker series={tickerSeries} />

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
        <a href="/" className="font-display text-[1.05rem] uppercase leading-none tracking-[-0.01em]">
          MACRO<span className="glow-accent" style={{ color: "var(--accent)" }}>PAD</span>
        </a>
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
          <div className="hidden px-6 pb-6 pt-8 lg:block">
            <a href="/" className="font-display block text-[1.9rem] uppercase leading-none tracking-[-0.03em]">
              MACRO<span className="glow-accent" style={{ color: "var(--accent)" }}>PAD</span>
            </a>
            <div className="mt-3 flex items-center gap-1.5 eyebrow">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--up)] opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--up)]" />
              </span>
              {lastUpdated ? `synced ${new Date(lastUpdated).toLocaleTimeString()}` : "not yet synced"}
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-3">
            <NavButton isActive={isBoard} onClick={() => pickPage(BOARD_ID)} icon="board" title="Board" subtitle="everything, one screen" />

            <div className="my-2 border-t border-[var(--border)]" />

            <NavButton isActive={isNews} onClick={() => pickPage(NEWS_ID)} icon="news" title="News" subtitle="headline sentiment" />
            {visiblePanels.map((panel) => {
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

            <div className="my-2 border-t border-[var(--border)]" />

            <NavButton
              isActive={isDocs}
              onClick={() => pickPage(DOCS_ID)}
              icon="docs"
              title="Documentation"
              subtitle="how the board works"
            />
          </nav>

          <div className="shrink-0 border-t border-[var(--border)] px-5 py-3.5">
            <div className="flex items-center justify-end gap-2">
              <SignOutButton className="font-sans text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--text-faint)] transition-colors hover:text-[var(--text)] disabled:opacity-50" />
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-14 lg:py-12">
          {isBoard ? (
            <>
              <header className="mb-4 flex items-baseline gap-3">
                <h1 className="font-display m-0 text-[1.4rem] uppercase leading-none tracking-[-0.02em]">Board</h1>
                <span className="eyebrow">{visiblePanels.reduce((n, p) => n + p.series.filter((s) => s.id !== "geo:news-feed").length, 0)} indicators, one screen</span>
              </header>
              <BoardPage panels={visiblePanels} newsSeries={boardNewsSeries} />
            </>
          ) : isNews ? (
            <>
              <header className="mb-6">
                <div className="eyebrow mb-2">Headline sentiment</div>
                <h1 className="font-display m-0 text-balance text-[2.6rem] uppercase leading-none tracking-[-0.03em] sm:text-[3.4rem]">News</h1>
              </header>

              <div className="mb-6 flex flex-wrap gap-1.5">
                <button
                  onClick={() => setNewsAssetTab("")}
                  className="rounded-full border px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-wide transition-colors"
                  style={
                    newsAssetTab === ""
                      ? { borderColor: "var(--accent)", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }
                      : { borderColor: "var(--border)", color: "var(--text-faint)" }
                  }
                >
                  General
                </button>
                {MARKET_SYMBOLS.map((m) => (
                  <button
                    key={m.symbol}
                    onClick={() => setNewsAssetTab(m.symbol)}
                    className="rounded-full border px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-wide transition-colors"
                    style={
                      newsAssetTab === m.symbol
                        ? { borderColor: "var(--accent)", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }
                        : { borderColor: "var(--border)", color: "var(--text-faint)" }
                    }
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {activeNewsSeries ? (
                <NewsFeedCard key={activeNewsSeries.id} series={activeNewsSeries} />
              ) : (
                <p className="font-sans text-[0.85rem] text-[var(--text-faint)]">No news data yet.</p>
              )}
            </>
          ) : isCustomDashboard ? (
            <>
              <header className="mb-10">
                <div className="eyebrow mb-2">Watchlist</div>
                <h1 className="font-display m-0 text-balance text-[2.6rem] uppercase leading-none tracking-[-0.03em] sm:text-[3.4rem]">Custom Dashboard</h1>
              </header>
              <CustomDashboardPage panels={panels} markets={markets} />
            </>
          ) : isCustomBias ? (
            <>
              <header className="mb-10">
                <div className="eyebrow mb-2">Weights + thresholds</div>
                <h1 className="font-display m-0 text-balance text-[2.6rem] uppercase leading-none tracking-[-0.03em] sm:text-[3.4rem]">Custom Bias</h1>
              </header>
              <CustomBiasPage panels={panels} />
            </>
          ) : isDocs ? (
            <>
              <header className="mb-10">
                <div className="eyebrow mb-2">Reference</div>
                <h1 className="font-display m-0 text-balance text-[2.6rem] uppercase leading-none tracking-[-0.03em] sm:text-[3.4rem]">Documentation</h1>
              </header>
              <DocumentationPage panels={panels} />
            </>
          ) : active ? (
            <>
              <header className="mb-10">
                <h1 className="font-display m-0 text-balance text-[2.6rem] uppercase leading-none tracking-[-0.03em] sm:text-[3.4rem]">{active.title}</h1>
              </header>

              <div className={DEEP_PANELS.has(active.id) ? "flex flex-col gap-2" : "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"}>
                {active.series
                  .filter((series) => series.id !== "geo:news-feed")
                  .map((series) =>
                    DEEP_PANELS.has(active.id) ? (
                      <QuantCard key={series.id} series={series} markets={markets} assetFilter={null} assetLabel={null} />
                    ) : (
                      <SeriesCard key={series.id} series={series} assetFilter={null} assetLabel={null} />
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
