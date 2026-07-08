"use client";

import { useEffect, useState } from "react";
import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import SeriesCard from "@/components/SeriesCard";
import QuantCard from "@/components/QuantCard";
import NewsFeedCard from "@/components/NewsFeedCard";
import MarketTicker from "@/components/MarketTicker";
import OverviewBoard from "@/components/OverviewBoard";
import CustomDashboardPage from "@/components/CustomDashboardPage";
import CustomBiasPage from "@/components/CustomBiasPage";
import { MARKET_SYMBOLS } from "@/lib/markets";
import { getSignTone } from "@/lib/bias";

const DEEP_PANELS = new Set(["us-macro", "yield-rates", "cot-positioning", "transmission", "geopolitics"]);
const BOARD_ID = "board";
const NEWS_ID = "news";
const CUSTOM_DASHBOARD_ID = "custom-dashboard";
const CUSTOM_BIAS_ID = "custom-bias";

const SHORT_LABEL: Record<string, string> = {
  "us-macro": "macro",
  "yield-rates": "rates",
  "cot-positioning": "cot",
  transmission: "transmission",
  geopolitics: "geo-vol",
};

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

/** Wordmark that resolves out of a brief character scramble, then parks a cursor. */
function Wordmark() {
  const TARGET = "MACROPAD";
  const [txt, setTxt] = useState(TARGET);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const CH = "<>/#%$@*+=?";
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      const reveal = Math.floor(frame / 2.4);
      if (reveal >= TARGET.length) {
        setTxt(TARGET);
        clearInterval(id);
        return;
      }
      setTxt(
        TARGET.split("")
          .map((c, i) => (i <= reveal ? c : CH[Math.floor(Math.random() * CH.length)]))
          .join("")
      );
    }, 42);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="shrink-0 select-none whitespace-nowrap font-mono text-[0.86rem] font-bold tracking-[0.18em] text-[var(--text)]">
      {txt}
      <span className="blink-cursor text-[var(--text-faint)]">_</span>
    </span>
  );
}

/** Live local clock for the statusline; blank until mounted so SSR matches. */
function Clock() {
  const [t, setT] = useState("");
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString("en-US", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono tabular-nums">{t}</span>;
}

function PageHead({ title, meta }: { title: string; meta?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 className="font-display m-0 text-[1.45rem] leading-none text-[var(--text)]">{title}</h1>
      {meta && <span className="font-mono text-[0.66rem] tracking-wide text-[var(--text-faint)]">{meta}</span>}
    </div>
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
  const [activeId, setActiveId] = useState<string>(BOARD_ID);
  const [focusSeriesId, setFocusSeriesId] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState<string>("");
  const active = panels.find((p) => p.id === activeId);

  const pickPage = (id: string) => {
    setActiveId(id);
    setFocusSeriesId(null);
  };
  const openFromBoard = (panelId: string, seriesId: string) => {
    setActiveId(panelId);
    setFocusSeriesId(seriesId);
  };

  useEffect(() => {
    if (!focusSeriesId) return;
    const t = setTimeout(() => {
      document.getElementById(`card-${focusSeriesId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 90);
    return () => clearTimeout(t);
  }, [focusSeriesId, activeId]);

  const isBoard = activeId === BOARD_ID;
  const isNews = activeId === NEWS_ID;
  const isCustomDashboard = activeId === CUSTOM_DASHBOARD_ID;
  const isCustomBias = activeId === CUSTOM_BIAS_ID;
  const assetLabel = MARKET_SYMBOLS.find((m) => m.symbol === assetFilter)?.label ?? null;
  const newsSeries = panels.flatMap((p) => p.series).find((s) => s.id === "geo:news-feed") ?? null;

  const totalSeries = panels.reduce((n, p) => n + p.series.length, 0);
  const totals = panels.reduce(
    (acc, p) => {
      const { bull, bear } = panelSignals(p);
      return { bull: acc.bull + bull, bear: acc.bear + bear };
    },
    { bull: 0, bear: 0 }
  );

  const tabs: { id: string; label: string }[] = [
    { id: BOARD_ID, label: "board" },
    { id: NEWS_ID, label: "news" },
    ...panels.map((p) => ({ id: p.id, label: SHORT_LABEL[p.id] ?? p.id })),
    { id: CUSTOM_DASHBOARD_ID, label: "custom-dash" },
    { id: CUSTOM_BIAS_ID, label: "custom-bias" },
  ];

  return (
    <div className="flex min-h-screen flex-col pb-8">
      <header
        className="sticky top-0 z-40 border-b border-[var(--border)] backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--bg) 86%, transparent)" }}
      >
        <div className="mx-auto flex h-12 w-full max-w-[1760px] items-center gap-4 px-4 sm:gap-6 sm:px-6 lg:px-8">
          <Wordmark />
          <nav className="no-scrollbar relative flex h-full flex-1 items-stretch gap-1 overflow-x-auto">
            {tabs.map((t) => {
              const isActive = activeId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => pickPage(t.id)}
                  className={`relative shrink-0 whitespace-nowrap px-2.5 font-mono text-[0.7rem] tracking-wide transition-colors sm:px-3 ${
                    isActive ? "text-[var(--text)]" : "text-[var(--text-faint)] hover:text-[var(--text-dim)]"
                  }`}
                >
                  {t.label}
                  {isActive && <span className="absolute inset-x-2.5 bottom-0 h-px bg-[var(--text)] sm:inset-x-3" />}
                </button>
              );
            })}
          </nav>
          <select
            value={assetFilter}
            onChange={(e) => setAssetFilter(e.target.value)}
            aria-label="Asset lens"
            className="max-w-[96px] shrink-0 appearance-none rounded border bg-transparent px-2 py-1 font-mono text-[0.66rem] outline-none sm:max-w-none"
            style={{
              borderColor: assetFilter ? "var(--border-strong)" : "var(--border)",
              color: assetFilter ? "var(--text)" : "var(--text-faint)",
            }}
          >
            <option value="">lens: all</option>
            {MARKET_SYMBOLS.map((m) => (
              <option key={m.symbol} value={m.symbol}>
                lens: {m.label}
              </option>
            ))}
          </select>
          <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-faint)] md:flex">
            <span className="keep-round h-1.5 w-1.5 rounded-full" style={{ background: lastUpdated ? "var(--up)" : "var(--text-faint)" }} />
            {lastUpdated ? "live" : "offline"}
          </span>
        </div>
      </header>

      <MarketTicker markets={markets} />

      <main className="blueprint min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8">
          {isBoard ? (
            <>
              <PageHead
                title="The Board"
                meta={
                  <>
                    {totalSeries} series · <span className="text-[var(--up)]">{totals.bull}▲</span>{" "}
                    <span className="text-[var(--down)]">{totals.bear}▼</span> strong
                    {assetFilter && <> · lens {assetLabel}</>}
                  </>
                }
              />
              <OverviewBoard panels={panels} assetFilter={assetFilter || null} onOpen={openFromBoard} />
            </>
          ) : isNews ? (
            <>
              <PageHead title="News" />
              {newsSeries ? (
                <NewsFeedCard series={newsSeries} />
              ) : (
                <p className="font-sans text-[0.85rem] text-[var(--text-faint)]">No news data yet.</p>
              )}
            </>
          ) : isCustomDashboard ? (
            <>
              <PageHead title="Custom Dashboard" />
              <CustomDashboardPage panels={panels} markets={markets} />
            </>
          ) : isCustomBias ? (
            <>
              <PageHead title="Custom Bias" />
              <CustomBiasPage panels={panels} />
            </>
          ) : active ? (
            <>
              <PageHead
                title={active.title}
                meta={(() => {
                  const { bull, bear } = panelSignals(active);
                  return bull + bear === 0 ? (
                    "no strong reads"
                  ) : (
                    <>
                      <span className="text-[var(--up)]">{bull}▲</span> <span className="text-[var(--down)]">{bear}▼</span> strong
                    </>
                  );
                })()}
              />

              <div className={DEEP_PANELS.has(active.id) ? "flex flex-col gap-2" : "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"}>
                {active.series
                  .filter((series) => series.id !== "geo:news-feed")
                  .map((series) => (
                    <div key={series.id} id={`card-${series.id}`} className="scroll-mt-16">
                      {DEEP_PANELS.has(active.id) ? (
                        <QuantCard
                          series={series}
                          markets={markets}
                          assetFilter={assetFilter || null}
                          assetLabel={assetLabel}
                          defaultOpen={focusSeriesId === series.id}
                        />
                      ) : (
                        <SeriesCard series={series} assetFilter={assetFilter || null} assetLabel={assetLabel} />
                      )}
                    </div>
                  ))}
              </div>
            </>
          ) : null}
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-40 flex h-8 items-center gap-x-4 overflow-hidden border-t border-[var(--border)] bg-[var(--bg)] px-3 font-mono text-[0.64rem] text-[var(--text-faint)] sm:px-4">
        <span className="tracking-[0.14em] text-[var(--text-dim)]">MACROPAD</span>
        <span className="hidden sm:inline">{totalSeries} series</span>
        <span>
          <span className="text-[var(--up)]">{totals.bull}▲</span> <span className="text-[var(--down)]">{totals.bear}▼</span>
        </span>
        <span className="hidden md:inline">
          synced {lastUpdated ? new Date(lastUpdated).toLocaleTimeString("en-US", { hour12: false }) : "never"}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[var(--text-dim)]">
          <Clock />
          <span className="blink-cursor">_</span>
        </span>
      </footer>
    </div>
  );
}
