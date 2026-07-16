"use client";

import { useEffect, useState } from "react";
import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import SeriesCard from "@/components/SeriesCard";
import QuantCard from "@/components/QuantCard";
import NewsFeedCard from "@/components/NewsFeedCard";
import MarketTicker from "@/components/MarketTicker";
import IndicatorTicker from "@/components/IndicatorTicker";
import PanelIcon from "@/components/PanelIcon";
import MacroBiasPage from "@/components/MacroBiasPage";
import ReplayPage from "@/components/ReplayPage";
import RegimeFingerprintPage from "@/components/RegimeFingerprintPage";
import CalendarPage from "@/components/CalendarPage";
import BoardPage from "@/components/BoardPage";
import TerminalPage from "@/components/TerminalPage";
import DocumentationPage from "@/components/DocumentationPage";
import OptionsFlowPage from "@/components/OptionsFlowPage";
import { TesseractGate } from "@/components/TesseractGate";
import { MARKET_SYMBOLS } from "@/lib/markets";
import { getSignTone } from "@/lib/bias";
import SignOutButton from "@/components/marketing/SignOutButton";
import BrandMark from "@/components/fx/BrandMark";
import AsciiContour from "@/components/fx/AsciiContour";
import SettingsPanel from "@/components/SettingsPanel";
import { loadNavOrder, saveNavOrder, moveToPosition, type NavOrderState } from "@/lib/navOrder";
import { PREFS_EVENT, loadThemePrefs, type ControlsPos, type SidebarSide, type ThemePrefs } from "@/lib/theme";

const DEEP_PANELS = new Set(["us-macro", "yield-rates", "cot-positioning", "transmission", "geopolitics", "volatility"]);
/** Catalogue-only panels - carry data (e.g. per-asset news) but never show up as their own nav entry. */
const HIDDEN_PANELS = new Set(["asset-news", "calendar"]);
const BOARD_ID = "board";
const TERMINAL_ID = "terminal";
const NEWS_ID = "news";
const MACRO_BIAS_ID = "macro-bias";
const REPLAY_ID = "replay";
const FINGERPRINT_ID = "fingerprint";
const CALENDAR_ID = "calendar";
const DOCS_ID = "docs";

const SHORT_LABEL: Record<string, string> = {
  "us-macro": "US MACRO",
  "yield-rates": "RATES",
  "cot-positioning": "COT",
  transmission: "TRANSMISSION",
  geopolitics: "GEOPOLITICS",
  volatility: "VOLATILITY",
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

/** Brand mark + wordmark; the one always-on ambient animation in the chrome. */
function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex select-none items-center gap-2.5 whitespace-nowrap">
      <BrandMark size={compact ? 18 : 22} className="shrink-0" />
      <span className={`font-mono font-bold tracking-[0.2em] text-[var(--text)] ${compact ? "text-[0.8rem]" : "text-[0.88rem]"}`}>
        TRIFEKTA<span className="blink-cursor text-[var(--text-faint)]">_</span>
      </span>
    </span>
  );
}

/** Title text that resolves out of a short character scramble whenever it changes. */
function Scramble({ text }: { text: string }) {
  const [txt, setTxt] = useState(text);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTxt(text);
      return;
    }
    const CH = "<>/#%*+=?";
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      const reveal = Math.floor((frame * text.length) / 12);
      if (reveal >= text.length) {
        setTxt(text);
        clearInterval(id);
        return;
      }
      setTxt(
        text
          .split("")
          .map((c, i) => (c === " " || i <= reveal ? c : CH[Math.floor(Math.random() * CH.length)]))
          .join("")
      );
    }, 28);
    return () => clearInterval(id);
  }, [text]);
  return <>{txt}</>;
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

interface NavDrag {
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

/** Six-dot grip: the only part of a tab that initiates a drag. */
function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden>
      {[2, 7, 12].flatMap((y) => [
        <circle key={`l${y}`} cx="3" cy={y} r="1.1" />,
        <circle key={`r${y}`} cx="7" cy={y} r="1.1" />,
      ])}
    </svg>
  );
}

function NavItem({
  id,
  label,
  isActive,
  onClick,
  bull,
  bear,
  drag,
}: {
  id: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  bull?: number;
  bear?: number;
  /** Present on reorderable tabs. Only the grip handle starts a drag; the row stays a drop target. */
  drag?: NavDrag;
}) {
  return (
    <div
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      className={`group relative flex w-full items-center gap-3 px-4 py-[9px] text-left font-mono text-[0.7rem] tracking-wide transition-colors duration-150 ${
        isActive ? "bg-[var(--panel-2)] text-[var(--text)]" : "text-[var(--text-faint)] hover:text-[var(--text-dim)]"
      } ${drag?.isDragging ? "opacity-35" : ""}`}
    >
      {isActive && <span className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-[var(--text)]" />}
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <PanelIcon id={id} className="shrink-0" style={{ color: isActive ? "var(--text)" : "var(--text-faint)" }} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {(bull ?? 0) + (bear ?? 0) > 0 && (
        <span className="shrink-0 text-[0.6rem]">
          {bull ? <span className="text-[var(--up)]">{bull}▲</span> : null}
          {bear ? <span className="text-[var(--down)]">{bear}▼</span> : null}
        </span>
      )}
      {drag && (
        <span
          draggable
          onDragStart={drag.onDragStart}
          onDragEnd={drag.onDragEnd}
          title="Drag to reorder"
          className="-mr-1.5 shrink-0 cursor-grab px-1 py-0.5 text-[var(--text-faint)] opacity-0 transition-opacity duration-150 hover:text-[var(--text-dim)] active:cursor-grabbing group-hover:opacity-100"
        >
          <GripIcon />
        </span>
      )}
    </div>
  );
}

/** Tesseract nav item - a normal in-shell page like every other one (Board, Terminal, etc), driven by the same pickPage state switch. Gating happens in the content area below, not here. */
function TesseractNavItem({ isActive, onClick }: { isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center gap-3 px-4 py-[9px] text-left font-mono text-[0.7rem] tracking-wide transition-colors duration-150 ${
        isActive ? "bg-[var(--panel-2)] text-[var(--text)]" : "text-[var(--text-faint)] hover:text-[var(--text-dim)]"
      }`}
    >
      {isActive && <span className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-[var(--text)]" />}
      <PanelIcon id="options-flow" className="shrink-0" style={{ color: isActive ? "var(--text)" : "var(--text-faint)" }} />
      <span className="min-w-0 flex-1 truncate">TESSERACT</span>
    </button>
  );
}

const TESSERACT_ID = "tesseract";

export default function DashboardShell({
  panels,
  lastUpdated,
  markets,
  tesseractAuthed,
}: {
  panels: MacroPanel[];
  lastUpdated: string | null;
  markets: MarketRow[];
  tesseractAuthed: boolean;
}) {
  const [activeId, setActiveId] = useState(BOARD_ID);
  const [navOpen, setNavOpen] = useState(false);
  // Layout prefs from the settings panel: which side the sidebar lives on and
  // where the utility bar (clock/settings/sign-out) sits inside it. Loaded
  // after mount (localStorage) and kept live via the prefs event.
  const [sidebarSide, setSidebarSide] = useState<SidebarSide>("left");
  const [controlsPos, setControlsPos] = useState<ControlsPos>("bottom");
  useEffect(() => {
    const applyLayout = (p: { sidebar: SidebarSide; controls: ControlsPos }) => {
      setSidebarSide(p.sidebar);
      setControlsPos(p.controls);
    };
    applyLayout(loadThemePrefs());
    const onPrefs = (e: Event) => applyLayout((e as CustomEvent<ThemePrefs>).detail);
    window.addEventListener(PREFS_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_EVENT, onPrefs);
  }, []);
  const [newsAssetTab, setNewsAssetTab] = useState<string>(""); // "" = general macro feed
  const visiblePanels = panels.filter((p) => !HIDDEN_PANELS.has(p.id));
  const active = visiblePanels.find((p) => p.id === activeId);
  const pickPage = (id: string) => {
    setActiveId(id);
    setNavOpen(false);
  };

  // Reorderable nav: Board and Docs stay pinned as structural anchors; News +
  // indicator panels (group A) and the analysis pages (group B) each have
  // their own persisted order so a reorder never mixes the two families.
  // Tabs are draggable at all times - drag one over a sibling and the list
  // reorders live; the result persists on drop.
  const defaultGroupA = [NEWS_ID, ...visiblePanels.map((p) => p.id)];
  const defaultGroupB = [MACRO_BIAS_ID, REPLAY_ID, FINGERPRINT_ID, CALENDAR_ID];
  const [navOrder, setNavOrder] = useState<NavOrderState>({ a: defaultGroupA, b: defaultGroupB });
  const [draggingTab, setDraggingTab] = useState<{ group: "a" | "b"; id: string } | null>(null);

  useEffect(() => {
    setNavOrder(loadNavOrder(defaultGroupA, defaultGroupB));
    // Only reconcile against the default shape once on mount - re-running on
    // every panels re-render would fight a user's in-progress reorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tabDrag(group: "a" | "b", id: string): NavDrag {
    return {
      isDragging: draggingTab?.group === group && draggingTab.id === id,
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag without data attached.
        e.dataTransfer.setData("text/plain", id);
        setDraggingTab({ group, id });
      },
      onDragOver: (e) => {
        e.preventDefault(); // required for the drop cursor
        if (draggingTab && draggingTab.group === group && draggingTab.id !== id) {
          setNavOrder((prev) => ({ ...prev, [group]: moveToPosition(prev[group], draggingTab.id, id) }));
        }
      },
      onDrop: (e) => e.preventDefault(),
      onDragEnd: () => {
        setDraggingTab(null);
        setNavOrder((prev) => {
          saveNavOrder(prev);
          return prev;
        });
      },
    };
  }
  const isBoard = activeId === BOARD_ID;
  const isTerminal = activeId === TERMINAL_ID;
  const isNews = activeId === NEWS_ID;
  const isMacroBias = activeId === MACRO_BIAS_ID;
  const isReplay = activeId === REPLAY_ID;
  const isFingerprint = activeId === FINGERPRINT_ID;
  const isCalendar = activeId === CALENDAR_ID;
  const isDocs = activeId === DOCS_ID;
  const isTesseract = activeId === TESSERACT_ID;
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
  const indicatorCount = visiblePanels.reduce((n, p) => n + p.series.filter((s) => s.id !== "geo:news-feed").length, 0);
  const strongReads = visiblePanels.reduce(
    (acc, p) => {
      const s = panelSignals(p);
      acc.bull += s.bull;
      acc.bear += s.bear;
      return acc;
    },
    { bull: 0, bear: 0 }
  );

  interface NavEntryMeta {
    id: string;
    iconId: string;
    label: string;
    onClick: () => void;
    bull?: number;
    bear?: number;
  }
  function resolveGroupAEntry(id: string): NavEntryMeta | null {
    if (id === NEWS_ID) return { id: NEWS_ID, iconId: "news", label: "NEWS", onClick: () => pickPage(NEWS_ID) };
    const panel = visiblePanels.find((p) => p.id === id);
    if (!panel) return null;
    const { bull, bear } = panelSignals(panel);
    return { id: panel.id, iconId: panel.id, label: SHORT_LABEL[panel.id] ?? panel.title.toUpperCase(), onClick: () => pickPage(panel.id), bull, bear };
  }
  function resolveGroupBEntry(id: string): NavEntryMeta | null {
    switch (id) {
      case MACRO_BIAS_ID:
        return { id, iconId: "macro-bias", label: "MACRO BIAS", onClick: () => pickPage(MACRO_BIAS_ID) };
      case REPLAY_ID:
        return { id, iconId: "replay", label: "REPLAY", onClick: () => pickPage(REPLAY_ID) };
      case FINGERPRINT_ID:
        return { id, iconId: "fingerprint", label: "FINGERPRINT", onClick: () => pickPage(FINGERPRINT_ID) };
      case CALENDAR_ID:
        return { id, iconId: "calendar", label: "CALENDAR", onClick: () => pickPage(CALENDAR_ID) };
      default:
        return null;
    }
  }
  const groupAEntries = navOrder.a.map(resolveGroupAEntry).filter((e): e is NavEntryMeta => e !== null);
  const groupBEntries = navOrder.b.map(resolveGroupBEntry).filter((e): e is NavEntryMeta => e !== null);

  const pageTitle = isBoard
    ? "Board"
    : isTerminal
      ? "Terminal"
      : isNews
      ? "News"
      : isMacroBias
        ? "Macro Bias"
        : isReplay
          ? "Replay"
          : isFingerprint
            ? "Regime Fingerprint"
            : isCalendar
              ? "Calendar"
              : isDocs
                ? "Documentation"
                : isTesseract
                  ? "Tesseract"
                  : active?.title ?? "";

  // Clock + settings + sign-out. Always visible (the nav scrolls internally
  // now, so this no longer sinks to the bottom of long pages like Docs) and
  // placeable at either end of the sidebar.
  const utilityBar = (
    <div className={`shrink-0 px-4 py-3 ${controlsPos === "top" ? "border-b" : "border-t"} border-[var(--border)]`}>
      <div className="flex items-center justify-between font-mono text-[0.62rem] text-[var(--text-faint)]">
        <Clock />
        <div className="flex items-center gap-3">
          <SettingsPanel />
          <SignOutButton className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-[var(--text-faint)] transition-colors duration-150 hover:text-[var(--text)] disabled:opacity-50" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <MarketTicker markets={markets} />
      <IndicatorTicker series={tickerSeries} />

      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3 lg:hidden">
        <button
          onClick={() => setNavOpen((v) => !v)}
          aria-label="Toggle navigation"
          className="flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--border)] text-[var(--text-dim)]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 4H14" />
            <path d="M2 8H14" />
            <path d="M2 12H14" />
          </svg>
        </button>
        <a href="/" className="flex items-center">
          <Wordmark compact />
        </a>
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}

      <div className="flex flex-1">
        <aside
          className={`fixed inset-y-0 z-40 flex w-[236px] shrink-0 flex-col bg-[var(--panel)] transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
            sidebarSide === "right"
              ? "right-0 border-l border-[var(--border)] lg:order-2"
              : "left-0 border-r border-[var(--border)]"
          } ${navOpen ? "translate-x-0" : sidebarSide === "right" ? "translate-x-full" : "-translate-x-full"}`}
          style={{ transitionTimingFunction: "var(--ease-out)" }}
        >
          <div className="relative hidden overflow-hidden border-b border-[var(--border)] px-4 pb-5 pt-6 lg:block">
            <AsciiContour className="pointer-events-none absolute inset-0 h-full w-full" cell={11} maxAlpha={0.14} />
            <a href="/" className="relative block">
              <Wordmark />
            </a>
            <div className="relative mt-3 flex items-center gap-1.5 eyebrow">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--up)] opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--up)]" />
              </span>
              {lastUpdated ? `synced ${new Date(lastUpdated).toLocaleTimeString()}` : "not yet synced"}
            </div>
          </div>

          {controlsPos === "top" && utilityBar}

          <nav className="flex flex-1 flex-col overflow-y-auto py-3">
            <NavItem id="board" label="BOARD" isActive={isBoard} onClick={() => pickPage(BOARD_ID)} />
            <NavItem id="terminal" label="TERMINAL" isActive={isTerminal} onClick={() => pickPage(TERMINAL_ID)} />

            <div className="mx-4 my-2 border-t border-[var(--border)]" />

            {groupAEntries.map((entry) => (
              <NavItem
                key={entry.id}
                id={entry.iconId}
                label={entry.label}
                isActive={entry.id === activeId}
                onClick={entry.onClick}
                bull={entry.bull}
                bear={entry.bear}
                drag={tabDrag("a", entry.id)}
              />
            ))}

            <div className="mx-4 my-2 border-t border-[var(--border)]" />

            {groupBEntries.map((entry) => (
              <NavItem
                key={entry.id}
                id={entry.iconId}
                label={entry.label}
                isActive={entry.id === activeId}
                onClick={entry.onClick}
                drag={tabDrag("b", entry.id)}
              />
            ))}

            <div className="mx-4 my-2 border-t border-[var(--border)]" />

            <div className="flex items-center justify-between px-4 pb-1 pt-1">
              <span className="partno">OPTIONS</span>
            </div>
            <TesseractNavItem isActive={isTesseract} onClick={() => pickPage(TESSERACT_ID)} />

            <div className="mx-4 my-2 border-t border-[var(--border)]" />

            <NavItem id="docs" label="DOCS" isActive={isDocs} onClick={() => pickPage(DOCS_ID)} />
          </nav>

          {controlsPos === "bottom" && utilityBar}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
          {isBoard ? (
            <>
              <header className="relative mb-6 overflow-hidden border border-[var(--border)] bg-[var(--panel)]">
                <AsciiContour className="pointer-events-none absolute inset-0 h-full w-full" cell={12} maxAlpha={0.2} />
                <div className="relative flex flex-wrap items-end justify-between gap-4 px-5 pb-4 pt-5">
                  <div>
                    <h1 className="font-display m-0 text-[1.6rem] leading-none">
                      <Scramble text="Board" />
                    </h1>
                    <span className="eyebrow mt-1.5 block">{indicatorCount} indicators · one screen</span>
                  </div>
                  <div className="flex flex-wrap gap-px bg-[var(--border)] p-px">
                    {[
                      ["STRONG BULL", <span key="b" style={{ color: "var(--up)" }}>{strongReads.bull}▲</span>],
                      ["STRONG BEAR", <span key="s" style={{ color: "var(--down)" }}>{strongReads.bear}▼</span>],
                      ["INDICATORS", String(indicatorCount)],
                      ["LAST SYNC", lastUpdated ? new Date(lastUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"],
                    ].map(([label, value]) => (
                      <div key={label as string} className="flex min-w-[6.5rem] flex-col gap-1 bg-[var(--panel)] px-3.5 py-2.5">
                        <span className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-[var(--text-faint)]">{label}</span>
                        <span className="font-mono text-[1rem] font-semibold leading-none text-[var(--text)]">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </header>
              <BoardPage panels={visiblePanels} newsSeries={boardNewsSeries} />
            </>
          ) : isTerminal ? (
            <>
              <header className="mb-6">
                <div className="eyebrow mb-2">Every surface, one command line</div>
                <h1 className="font-display m-0 text-balance text-[2rem] leading-none sm:text-[2.6rem]">
                  <Scramble text="Terminal" />
                </h1>
              </header>
              <TerminalPage panels={panels} markets={markets} />
            </>
          ) : isTesseract ? (
            tesseractAuthed ? (
              <OptionsFlowPage view="terminal" />
            ) : (
              <>
                <header className="mb-6">
                  <div className="eyebrow mb-2">Options Flow</div>
                  <h1 className="font-display m-0 text-balance text-[2rem] leading-none sm:text-[2.6rem]">
                    <Scramble text="Tesseract" />
                  </h1>
                </header>
                <TesseractGate />
              </>
            )
          ) : isNews ? (
            <>
              <header className="mb-6">
                <div className="eyebrow mb-2">Headline sentiment</div>
                <h1 className="font-display m-0 text-balance text-[2rem] leading-none sm:text-[2.6rem]">
                  <Scramble text="News" />
                </h1>
              </header>

              <div className="mb-6 flex flex-wrap gap-1.5">
                {[{ symbol: "", label: "General" }, ...MARKET_SYMBOLS].map((m) => {
                  const isOn = newsAssetTab === m.symbol;
                  return (
                    <button
                      key={m.symbol || "general"}
                      onClick={() => setNewsAssetTab(m.symbol)}
                      className={`border px-3 py-1.5 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.1em] transition-colors duration-150 ${
                        isOn
                          ? "border-[var(--text-dim)] bg-[var(--panel-2)] text-[var(--text)]"
                          : "border-[var(--border)] text-[var(--text-faint)] hover:border-[var(--border-strong)] hover:text-[var(--text-dim)]"
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {activeNewsSeries ? (
                <NewsFeedCard key={activeNewsSeries.id} series={activeNewsSeries} />
              ) : (
                <p className="font-sans text-[0.85rem] text-[var(--text-faint)]">No news data yet.</p>
              )}
            </>
          ) : isMacroBias ? (
            <>
              <header className="mb-8">
                <div className="eyebrow mb-2">Composite regime read</div>
                <h1 className="font-display m-0 text-balance text-[2rem] leading-none sm:text-[2.6rem]">
                  <Scramble text="Macro Bias" />
                </h1>
              </header>
              <MacroBiasPage panels={panels} />
            </>
          ) : isReplay ? (
            <>
              <header className="mb-8">
                <div className="eyebrow mb-2">Point-in-time scrub</div>
                <h1 className="font-display m-0 text-balance text-[2rem] leading-none sm:text-[2.6rem]">
                  <Scramble text="Replay" />
                </h1>
              </header>
              <ReplayPage panels={panels} />
            </>
          ) : isFingerprint ? (
            <>
              <header className="mb-8">
                <div className="eyebrow mb-2">Seven-pillar shape, then vs now</div>
                <h1 className="font-display m-0 text-balance text-[2rem] leading-none sm:text-[2.6rem]">
                  <Scramble text="Regime Fingerprint" />
                </h1>
              </header>
              <RegimeFingerprintPage panels={panels} markets={markets} />
            </>
          ) : isCalendar ? (
            <>
              <header className="mb-8">
                <div className="eyebrow mb-2">Real release dates</div>
                <h1 className="font-display m-0 text-balance text-[2rem] leading-none sm:text-[2.6rem]">
                  <Scramble text="Calendar" />
                </h1>
              </header>
              <CalendarPage panels={panels} />
            </>
          ) : isDocs ? (
            <>
              <header className="mb-8">
                <div className="eyebrow mb-2">Reference</div>
                <h1 className="font-display m-0 text-balance text-[2rem] leading-none sm:text-[2.6rem]">
                  <Scramble text="Documentation" />
                </h1>
              </header>
              <DocumentationPage panels={panels} />
            </>
          ) : active ? (
            <>
              <header className="mb-8">
                <div className="partno mb-2">
                  TF-{String(visiblePanels.findIndex((p) => p.id === active.id) + 1).padStart(2, "0")}
                </div>
                <h1 className="font-display m-0 text-balance text-[2rem] leading-none sm:text-[2.6rem]">
                  <Scramble text={pageTitle} />
                </h1>
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
