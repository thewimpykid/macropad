"use client";

import { useMemo, useState } from "react";
import type { MacroPanel, MacroSeries } from "@/lib/macroData";
import { getSignTone } from "@/lib/bias";
import { getBacktestEvidence } from "@/lib/backtestImportance";
import { seriesAffectsSymbol } from "@/lib/markets";

function toneColor(tone: "up" | "down" | "flat"): string {
  return tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text-faint)";
}

/** Thin centered-zero score bar; widths rounded to whole % so SSR and client agree. */
function ScoreBar({ score, tone }: { score: number; tone: "up" | "down" | "flat" }) {
  const half = Math.round(Math.min(1, Math.abs(score)) * 50);
  return (
    <div className="relative h-[2px] w-full overflow-hidden bg-[var(--border)]">
      <div
        className="absolute top-0 h-full"
        style={
          score >= 0
            ? { left: "50%", width: `${half}%`, background: toneColor(tone) }
            : { right: "50%", width: `${half}%`, background: toneColor(tone) }
        }
      />
      <div className="absolute left-1/2 top-0 h-full w-px bg-[var(--border-strong)]" />
    </div>
  );
}

function Tile({
  series,
  dimmed,
  onOpen,
}: {
  series: MacroSeries;
  dimmed: boolean;
  onOpen: () => void;
}) {
  const score = series.zscore;
  const tone = score === null ? "flat" : getSignTone(series.id, score);
  const ev = getBacktestEvidence(series.id);
  return (
    <button
      onClick={onOpen}
      className="-mb-px -mr-px flex flex-col gap-1.5 border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-left transition-colors hover:bg-[var(--panel-2)] focus-visible:relative focus-visible:z-10"
      style={dimmed ? { opacity: 0.35 } : undefined}
      title={series.note}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="truncate font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">{series.name}</span>
        {ev && (
          <span className="shrink-0 font-mono text-[0.56rem] tracking-wide text-[var(--amber)]" title={`Backtest evidence rank ${ev.rank} of ${ev.rankedCount}`}>
            bt{ev.rank}
          </span>
        )}
      </div>
      <div className="flex w-full items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[1rem] font-semibold text-[var(--text)]">{series.value}</span>
        {score !== null && (
          <span className="shrink-0 font-mono text-[0.68rem]" style={{ color: toneColor(tone) }}>
            {score > 0 ? "+" : ""}
            {Math.round(score * 100)}%
          </span>
        )}
      </div>
      {score !== null ? (
        <ScoreBar score={score} tone={tone} />
      ) : (
        <div className="h-[2px] w-full bg-[var(--border)] opacity-60" />
      )}
    </button>
  );
}

export default function OverviewBoard({
  panels,
  assetFilter,
  onOpen,
}: {
  panels: MacroPanel[];
  assetFilter: string | null;
  onOpen: (panelId: string, seriesId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return panels
      .map((panel) => ({
        panel,
        series: panel.series.filter(
          (s) =>
            s.id !== "geo:news-feed" &&
            (!q || s.name.toLowerCase().includes(q) || s.note.toLowerCase().includes(q))
        ),
      }))
      .filter((x) => x.series.length > 0);
  }, [panels, query]);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="find a series"
        className="mb-7 w-full max-w-xs border-0 border-b border-[var(--border)] bg-transparent px-0 py-1.5 font-mono text-[0.76rem] text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus-visible:border-[var(--text-dim)] focus-visible:outline-none"
      />

      {sections.map(({ panel, series }) => {
        const strong = series.filter((s) => s.zscore !== null && Math.abs(s.zscore) >= 0.5);
        const bull = strong.filter((s) => getSignTone(s.id, s.zscore) === "up").length;
        const bear = strong.filter((s) => getSignTone(s.id, s.zscore) === "down").length;
        return (
          <section key={panel.id} className="mb-9">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="m-0 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">
                {panel.title}
              </h2>
              <span className="font-mono text-[0.62rem] text-[var(--text-faint)]">
                {bull > 0 && <span className="text-[var(--up)]">{bull}▲</span>}
                {bull > 0 && bear > 0 && " "}
                {bear > 0 && <span className="text-[var(--down)]">{bear}▼</span>}
                {bull + bear === 0 && "quiet"}
              </span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {series.map((s) => (
                <Tile
                  key={s.id}
                  series={s}
                  dimmed={!!assetFilter && !seriesAffectsSymbol(s.id, assetFilter)}
                  onOpen={() => onOpen(panel.id, s.id)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {sections.length === 0 && (
        <p className="font-mono text-[0.76rem] text-[var(--text-faint)]">no series match “{query}”</p>
      )}
    </div>
  );
}
