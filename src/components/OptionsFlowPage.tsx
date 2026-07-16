"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GexResponse, GexSymbol } from "@/lib/gex";
import { fmtNum, fmtRaw, fmtUsd } from "@/lib/gex";
import { computeTopWalls, StrikeExpiryHeatmapChart, TerminalDualBarChart, TerminalExposureChart, type WallMarker } from "@/components/optionsflow/TerminalChart";
import { CrossExpiryPanel } from "@/components/optionsflow/CrossExpiryPanel";
import TopoSurface from "@/components/optionsflow/TopoSurface";
import { AiPromptPanel } from "@/components/optionsflow/AiPromptPanel";
import { SpineProfile, type SpineAnnotation, type SpinePoint } from "@/components/optionsflow/SpineProfile";
import { TesseractMark } from "@/components/optionsflow/TesseractMark";
import { IvSmileChart } from "@/components/optionsflow/IvSmileChart";

export type OptionsFlowView = "terminal";

// y3os (this terminal's data source) only covers QQQ and SPX live - SPY/NDX
// return an explicit SYMBOL_NOT_AVAILABLE, confirmed directly against the
// feed rather than silently substituted.
const SYMBOLS: GexSymbol[] = ["QQQ", "SPX"];

function SymbolToggle({ symbol, onChange }: { symbol: GexSymbol; onChange: (s: GexSymbol) => void }) {
  return (
    <div className="inline-flex border border-[var(--border)]">
      {SYMBOLS.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`px-4 py-1.5 font-mono text-[0.72rem] font-semibold tracking-[0.08em] transition-colors duration-150 ${
            s === symbol ? "bg-[var(--text)] text-[var(--bg)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export interface SpotTick {
  dir: "up" | "down" | null;
  /** asOf of the update that produced this tick - keys the flash animation so it re-fires per update, not per render. */
  at: number;
}

/** Pulsing feed indicator + seconds-since-update, self-ticking so the rest of the page doesn't re-render every second. */
function LiveStatus({ asOf, deepReady, degraded }: { asOf: number; deepReady: boolean; degraded: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - asOf) / 1000));
  const age = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const dotColor = degraded ? "var(--amber)" : "var(--up)";
  return (
    <div className="flex items-center gap-3 font-mono text-[0.62rem] text-[var(--text-faint)]">
      {!deepReady && (
        <span className="flex items-center gap-1.5 border border-[var(--border)] px-2 py-0.5 uppercase tracking-[0.1em]">
          <span className="live-dot h-1 w-1 rounded-full" style={{ background: "var(--amber)" }} />
          deep sync
        </span>
      )}
      <span className="flex items-center gap-1.5 uppercase tracking-[0.1em]">
        <span className="live-dot h-1.5 w-1.5 rounded-full" style={{ background: dotColor }} />
        {degraded ? "reconnecting" : "live"} · {age} ago
      </span>
    </div>
  );
}

/** Placeholder for panels whose data rides the slow full tier - shown from first paint until the deep payload lands. The tumbling 4-cube is the app's working spinner. */
function DeepSyncPanel({ title, note }: { title: string; note?: string }) {
  return (
    <div className="hud border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-display text-[0.95rem] text-[var(--text)]">{title}</div>
        <span className="eyebrow flex items-center gap-1.5">
          <span className="live-dot h-1 w-1 rounded-full" style={{ background: "var(--amber)" }} />
          deep sync
        </span>
      </div>
      <div className="eyebrow mt-1">{note ?? "streaming the full depth computation — this view fills in as it lands"}</div>
      <div className="mt-4 flex items-center gap-5">
        <TesseractMark size={96} />
        <div className="flex flex-1 flex-col gap-2">
          {[0.85, 0.55, 0.7, 0.45].map((w, i) => (
            <div key={i} className="shimmer h-6" style={{ width: `${w * 100}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Collapsed utility drawer - heavy or secondary modules live here so the main screen stays a single view with no tab-switching. Content mounts only when opened (the stack panels fetch on mount). */
function Drawer({ index, title, hint, open, onToggle, children }: { index: string; title: string; hint: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--panel)]">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-baseline gap-2 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-dim)]">
          <span className="text-[0.55rem] text-[var(--text-faint)]">{index}</span>
          {title}
          <span className="hidden font-normal normal-case tracking-normal text-[var(--text-faint)] sm:inline">— {hint}</span>
        </span>
        <span className="font-mono text-[0.8rem] leading-none text-[var(--text-faint)]">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="border-t border-[var(--border)] p-4">{children}</div>}
    </div>
  );
}

function StripCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col justify-center gap-0.5 border-l border-[var(--border)] px-4 py-2">
      <span className="eyebrow">{label}</span>
      <span className="font-mono text-[0.82rem] font-semibold leading-none" style={{ color: color ?? "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}

/** The chyron: every headline number in one hairline-divided broadcast strip - replaces the big-spot-hero + stat-card grid this product used to share with every other exposure dashboard. */
function InstrumentStrip({
  data,
  tick,
  callWall,
  putWall,
  phaseColor,
  deepReady,
}: {
  data: GexResponse;
  tick: SpotTick;
  callWall: number | null;
  putWall: number | null;
  phaseColor: string;
  deepReady: boolean;
}) {
  const gammaEngine = data.gammaEngine;
  return (
    <div className="hud flex flex-wrap items-stretch border border-[var(--border)] bg-[var(--panel)] px-4 py-1.5">
      <div className="flex flex-col justify-center gap-0.5 py-2 pr-4">
        <span className="eyebrow">
          {data.symbol} · 0DTE {data.resolvedExpiry}
        </span>
        <span
          key={tick.at}
          className={`glow-accent font-mono text-[1.35rem] font-bold leading-none text-[var(--text)] ${tick.dir === "up" ? "tick-up" : tick.dir === "down" ? "tick-down" : ""}`}
        >
          {fmtNum(data.spot, 2)}
          {tick.dir && (
            <span className="ml-1.5 text-[0.7rem]" style={{ color: tick.dir === "up" ? "var(--up)" : "var(--down)" }}>
              {tick.dir === "up" ? "▲" : "▼"}
            </span>
          )}
        </span>
      </div>
      <StripCell label="Call Wall" value={callWall !== null ? fmtNum(callWall, 2) : "—"} color="var(--up)" />
      <StripCell label="Put Wall" value={putWall !== null ? fmtNum(putWall, 2) : "—"} color="var(--down)" />
      <StripCell label="Max Pain" value={fmtNum(data.maxPain, 2)} />
      <StripCell label="G-Flip" value={data.gammaFlip !== null ? fmtNum(data.gammaFlip, 2) : "—"} />
      <StripCell label="Σ GEX" value={fmtUsd(data.totalGex0dte)} />
      <StripCell label="±1σ" value={data.zeroDte ? fmtNum(data.zeroDte.expectedMove1s, 2) : "—"} />
      <StripCell label="P/C" value={data.zeroDte ? fmtNum(data.zeroDte.pcRatio, 2) : "—"} />
      <StripCell label="ATM IV" value={data.atmIv !== undefined ? `${fmtNum(data.atmIv * 100, 1)}%` : "—"} />
      <div className="ml-auto flex items-center pl-4">
        {gammaEngine ? (
          <span className="flex items-center gap-1.5 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.06em]" style={{ color: phaseColor }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: phaseColor }} />
            {gammaEngine.phase.label}
          </span>
        ) : (
          !deepReady && (
            <span className="flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.06em] text-[var(--text-faint)]">
              <span className="live-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--amber)" }} />
              regime syncing
            </span>
          )
        )}
      </div>
    </div>
  );
}

const PHASE_COLOR: Record<string, string> = {
  pinned: "var(--up)",
  damped: "var(--up)",
  fragile_balance: "#d9a441",
  transition: "#d9a441",
  reflexive: "var(--down)",
  open_field: "var(--down)",
};

// One Greek selector drives the whole room (spine, terrain, grid) - full
// Greek names, not the GEX/DEX/VEX ticker soup other dashboards use.
type Metric = "gex" | "dex" | "vex" | "cex" | "tex" | "vegaex";
const METRIC_LABEL: Record<Metric, string> = { gex: "GAMMA", dex: "DELTA", vex: "VANNA", cex: "CHARM", tex: "THETA", vegaex: "VEGA" };
const METRIC_ORDER: Metric[] = ["gex", "dex", "vex", "cex", "tex", "vegaex"];

/** Nearest strikes to spot (~±11), keeping the grid's row/column shape - windowed tighter than the spine's 30 so the grid panel stays about the same height as its neighbors instead of dominating the page. */
function windowHeatmap(grid: { columns: { label: string; dte: number | null }[]; strikes: number[]; values: (number | null)[][] } | null | undefined, spot: number, count = 22) {
  if (!grid) return null;
  const indexed = grid.strikes.map((strike, i) => ({ strike, i }));
  const kept = indexed
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, count)
    .sort((a, b) => a.strike - b.strike);
  return { columns: grid.columns, strikes: kept.map((k) => k.strike), values: kept.map((k) => grid.values[k.i]) };
}

/** Reshapes Effective/Shadow's per-strike up/down scenario rows into the same {columns,strikes,values} grid shape the heatmap renders, so it's just two columns ("+X%"/"-X%") instead of a DTE axis. */
function effectiveGexAsGrid(result: GexResponse["effectiveGex"] | undefined, mode: "effective" | "shadow") {
  if (!result || !result.rows.length) return null;
  const columns = [
    { label: `+${(result.moveUpPct * 100).toFixed(1)}%`, dte: null },
    { label: `-${(result.moveDownPct * 100).toFixed(1)}%`, dte: null },
  ];
  const sorted = [...result.rows].sort((a, b) => a.strike - b.strike);
  return {
    columns,
    strikes: sorted.map((r) => r.strike),
    values: sorted.map((r) => (mode === "effective" ? [r.upEffective, r.downEffective] : [r.shadowGammaUp, r.shadowGammaDown])),
  };
}

type ChartMode = "traditional" | "effective" | "shadow";
const CHART_MODE_LABEL: Record<ChartMode, string> = { traditional: "TRADITIONAL", effective: "EFFECTIVE", shadow: "SHADOW" };
const CHART_MODE_ORDER: ChartMode[] = ["traditional", "effective", "shadow"];

function TerminalView({
  data,
  deepReady,
  tick,
  movePctDraft,
  onMovePctDraftChange,
  onApplyMovePct,
  onAutoMovePct,
}: {
  data: GexResponse;
  /** False until the slow full tier (heatmaps/topo/engines) has landed at least once. */
  deepReady: boolean;
  tick: SpotTick;
  movePctDraft: string;
  onMovePctDraftChange: (v: string) => void;
  onApplyMovePct: () => void;
  onAutoMovePct: () => void;
}) {
  const [metric, setMetric] = useState<Metric>("gex");
  const [mode, setMode] = useState<ChartMode>("traditional");
  // The per-strike panel offers both forms: the spine (this terminal's own
  // mirrored-terrain read) and the industry-standard diverging bars.
  const [strikeView, setStrikeView] = useState<"spine" | "bars">("spine");
  const [effectiveDir, setEffectiveDir] = useState<"up" | "down" | "both">("up");
  const [chartDteIndex, setChartDteIndex] = useState(0);
  const [dteScope, setDteScope] = useState<"single" | "cumulative">("single");
  const [stackOpen, setStackOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  const gammaEngine = data.gammaEngine;

  const dteColumns = data.strikeExpiryHeatmaps?.[metric]?.columns ?? [];
  const clampedDteIndex = Math.min(chartDteIndex, Math.max(0, dteColumns.length - 1));

  // TRADITIONAL: every column, including 0DTE, comes from the /heatmap
  // endpoint - the same real per-strike, per-expiry source the heatmap/topo
  // views use (see strikeExpiryHeatmaps.ts). This app's own self-computed
  // 0DTE chain is NOT used here: it's ATM-dominated and doesn't reflect
  // real OI walls away from spot, confirmed directly against a live vendor
  // $-GEX table. "Single" isolates the selected expiration; "cumulative"
  // sums every expiration up to and including it.
  //
  // EFFECTIVE / SHADOW: a full delta reprice of this app's own 0DTE chain
  // at a scenario spot (+/-1%), 0DTE-only - there's no per-contract chain
  // for other expirations to run the same reprice on. See
  // effectiveGexEngine.ts.
  const chartDualData = useMemo(() => {
    if (mode === "traditional" || effectiveDir !== "both") return [];
    const rows = data.effectiveGex?.rows ?? [];
    const mapped = rows.map((r) => ({
      strike: r.strike,
      up: mode === "effective" ? r.upEffective : r.shadowGammaUp,
      down: mode === "effective" ? r.downEffective : r.shadowGammaDown,
    }));
    return [...mapped].sort((a, b) => Math.abs(a.strike - data.spot) - Math.abs(b.strike - data.spot)).slice(0, 30).sort((a, b) => a.strike - b.strike);
  }, [data, mode, effectiveDir]);

  const chartData = useMemo(() => {
    const windowNearest = (rows: { strike: number; value: number }[]) =>
      [...rows].sort((a, b) => Math.abs(a.strike - data.spot) - Math.abs(b.strike - data.spot)).slice(0, 30).sort((a, b) => a.strike - b.strike);

    if (mode !== "traditional") {
      if (effectiveDir === "both") return [];
      const rows = data.effectiveGex?.rows ?? [];
      const pick = (r: NonNullable<GexResponse["effectiveGex"]>["rows"][number]) =>
        mode === "effective" ? (effectiveDir === "up" ? r.upEffective : r.downEffective) : effectiveDir === "up" ? r.shadowGammaUp : r.shadowGammaDown;
      return windowNearest(rows.map((r) => ({ strike: r.strike, value: pick(r) })));
    }

    const grid = data.strikeExpiryHeatmaps?.[metric];
    if (!grid) {
      // /heatmap occasionally fails the request entirely (upstream timeout)
      // even after the server's own retry - fall back to this app's
      // self-computed static GEX (always available, no external dependency)
      // rather than showing an empty spine/no walls. GEX-only: there's no
      // fallback source for the other five metrics.
      if (metric !== "gex" || !data.effectiveGex) return [];
      return windowNearest(data.effectiveGex.rows.map((r) => ({ strike: r.strike, value: r.staticGex })));
    }

    if (dteScope === "single") {
      return windowNearest(grid.strikes.map((strike, i) => ({ strike, value: grid.values[i][clampedDteIndex] ?? 0 })));
    }

    const acc = new Map<number, number>();
    for (let col = 0; col <= clampedDteIndex; col++) {
      grid.strikes.forEach((strike, i) => {
        const v = grid.values[i][col];
        if (v !== null) acc.set(strike, (acc.get(strike) ?? 0) + v);
      });
    }
    return windowNearest([...acc.entries()].map(([strike, value]) => ({ strike, value })));
  }, [data, metric, clampedDteIndex, dteScope, mode, effectiveDir]);
  const walls: WallMarker[] = computeTopWalls(
    effectiveDir === "both" && mode !== "traditional" ? chartDualData.map((d) => ({ strike: d.strike, value: d.up })) : chartData,
    mode === "traditional" ? metric : "gex",
    2
  );
  const chartUnitLabel = mode === "traditional" ? METRIC_LABEL[metric] : mode === "effective" ? "EFF GEX" : "SHADOW γ";

  // Strip Call Wall/Put Wall - same computeTopWalls the spine/grid use
  // (top-magnitude GEX strikes), always the traditional 0DTE GEX column
  // regardless of whatever Greek/mode is selected, so the headline stat
  // doesn't silently change meaning when someone switches to DELTA.
  const heroWalls: WallMarker[] = useMemo(() => {
    const grid = data.strikeExpiryHeatmaps?.gex;
    if (!grid) {
      // Same /heatmap-unavailable fallback as the spine data above.
      if (!data.effectiveGex) return [];
      const rows = data.effectiveGex.rows
        .map((r) => ({ strike: r.strike, value: r.staticGex }))
        .sort((a, b) => Math.abs(a.strike - data.spot) - Math.abs(b.strike - data.spot))
        .slice(0, 30);
      return computeTopWalls(rows, "gex", 2);
    }
    const rows = grid.strikes
      .map((strike, i) => ({ strike, value: grid.values[i][0] ?? 0 }))
      .sort((a, b) => Math.abs(a.strike - data.spot) - Math.abs(b.strike - data.spot))
      .slice(0, 30);
    return computeTopWalls(rows, "gex", 2);
  }, [data]);
  const heroCallWall = heroWalls.find((w) => w.label === "Call Wall")?.price ?? null;
  const heroPutWall = heroWalls.find((w) => w.label === "Put Wall")?.price ?? null;

  const heatmapWalls: WallMarker[] = useMemo(() => {
    if (mode === "traditional" || !data.effectiveGex) return [];
    const rows = data.effectiveGex.rows.map((r) => ({ strike: r.strike, value: mode === "effective" ? r.upEffective : r.shadowGammaUp }));
    return computeTopWalls(rows, "gex", 2);
  }, [data, mode]);

  // TERRAIN's surface is built around a time/scenario axis. Traditional
  // mode uses the real expiry columns this fetch has (0DTE + next 5 - no
  // coarse "1W/2W/M+" bucketing implying timeframes with no actual data).
  // Effective/Shadow are single 0DTE scenarios with a 2-slot +move/-move
  // axis instead; only the GEX surface carries real data in this mode
  // since this app doesn't compute a per-Greek scenario delta.
  const topoRows = useMemo(() => {
    if (mode === "traditional") return data.topo ?? [];
    return (data.effectiveGex?.rows ?? []).map((r) => ({
      strike: r.strike,
      gex: [mode === "effective" ? r.upEffective : r.shadowGammaUp, mode === "effective" ? r.downEffective : r.shadowGammaDown],
      dex: [0, 0],
      vanna: [0, 0],
      charm: [0, 0],
      theta: [0, 0],
      vega: [0, 0],
    }));
  }, [data, mode]);
  const topoTenorLabels =
    mode === "traditional"
      ? data.topoTenorLabels
      : [`+${data.effectiveGex ? (data.effectiveGex.moveUpPct * 100).toFixed(1) : "—"}%`, `-${data.effectiveGex ? (data.effectiveGex.moveDownPct * 100).toFixed(1) : "—"}%`];

  const phaseColor = gammaEngine ? PHASE_COLOR[gammaEngine.phase.phase] ?? "var(--text-faint)" : "var(--text-faint)";

  // The spine consumes whatever the Greek selector picks: signed mode
  // splits one series into call-side (right) / put-side (left) lobes;
  // scenario "both" puts the +move reprice on the right and -move on the
  // left so the asymmetry is the shape itself.
  const scenarioBoth = mode !== "traditional" && effectiveDir === "both";
  const spinePoints: SpinePoint[] = useMemo(() => {
    if (scenarioBoth) {
      return chartDualData.map((d) => ({ strike: d.strike, right: Math.abs(d.up), left: Math.abs(d.down), readout: `↑${fmtUsd(d.up)} ↓${fmtUsd(d.down)}` }));
    }
    const fmt = mode === "traditional" ? fmtRaw : fmtUsd;
    return chartData.map((d) => ({ strike: d.strike, right: Math.max(0, d.value), left: Math.max(0, -d.value), readout: fmt(d.value) }));
  }, [scenarioBoth, chartDualData, chartData, mode]);
  const spineAnnotations: SpineAnnotation[] = [
    ...walls.map((w) => ({ label: w.label, price: w.price, color: w.color })),
    ...(data.maxPain > 0 ? [{ label: "Max Pain", price: data.maxPain, color: "var(--text-dim)" }] : []),
    ...(data.gammaFlip !== null ? [{ label: "G-Flip", price: data.gammaFlip, color: "var(--text-dim)" }] : []),
    { label: data.kingNode.type === "pin" ? "King·Pin" : "King·Repel", price: data.kingNode.strike, color: "var(--text-faint)" },
  ];
  const spineBand = data.zeroDte && data.zeroDte.expectedMove1s > 0 ? { lo: data.spot - data.zeroDte.expectedMove1s, hi: data.spot + data.zeroDte.expectedMove1s } : null;
  const spineLobeLabels: [string, string] = scenarioBoth
    ? [`−${data.effectiveGex ? fmtNum(data.effectiveGex.moveDownPct * 100, 1) : "—"}% move`, `+${data.effectiveGex ? fmtNum(data.effectiveGex.moveUpPct * 100, 1) : "—"}% move`]
    : [`− ${chartUnitLabel}`, `+ ${chartUnitLabel}`];

  return (
    <div className="flex flex-col gap-4">
      <InstrumentStrip data={data} tick={tick} callWall={heroCallWall} putWall={heroPutWall} phaseColor={phaseColor} deepReady={deepReady} />

      {gammaEngine && (
        <p className="m-0 border-l-2 pl-3 font-sans text-[0.72rem] leading-relaxed text-[var(--text-dim)]" style={{ borderColor: phaseColor }}>
          {gammaEngine.phase.interpretation}
        </p>
      )}

      {/* The one control that matters: which Greek the whole room is tuned
          to. Spine, terrain and grid all re-tune together - no tabs. */}
      <div className="hud flex flex-wrap items-center gap-x-4 gap-y-2 border border-[var(--border)] bg-[var(--panel)] px-4 py-2.5">
        <div className="inline-flex flex-wrap border border-[var(--border)]">
          {METRIC_ORDER.map((m) => (
            <button
              key={m}
              onClick={() => {
                setMetric(m);
                setChartDteIndex(0);
              }}
              className={`px-4 py-2 font-mono text-[0.74rem] font-bold tracking-[0.08em] transition-colors duration-150 ${
                m === metric ? "bg-[var(--accent)] text-[var(--bg)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
              }`}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex border border-[var(--border)]">
            {CHART_MODE_ORDER.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 font-mono text-[0.6rem] font-semibold tracking-[0.05em] transition-colors duration-150 ${
                  m === mode ? "bg-[var(--accent)] text-[var(--bg)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
                }`}
              >
                {CHART_MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {mode === "traditional" ? (
            dteColumns.length > 1 && (
              <>
                <div className="inline-flex border border-[var(--border)]">
                  {(["single", "cumulative"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setDteScope(s)}
                      className={`px-2.5 py-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.05em] transition-colors duration-150 ${
                        s === dteScope ? "bg-[var(--text)] text-[var(--bg)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
                      }`}
                      title={s === "single" ? "This expiration only" : "Sum of every real expiration up to this one"}
                    >
                      {s === "single" ? "One Expiry" : "Through"}
                    </button>
                  ))}
                </div>
                <select
                  value={clampedDteIndex}
                  onChange={(e) => setChartDteIndex(Number(e.target.value))}
                  className="border border-[var(--border)] bg-[var(--panel)] px-2 py-1 font-mono text-[0.62rem] font-semibold text-[var(--text)] outline-none"
                >
                  {dteColumns.map((c, i) => (
                    <option key={i} value={i}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </>
            )
          ) : (
            <>
              <div className="inline-flex border border-[var(--border)]">
                {(["up", "down", "both"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setEffectiveDir(d)}
                    className={`px-2.5 py-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.05em] transition-colors duration-150 ${
                      d === effectiveDir ? "bg-[var(--text)] text-[var(--bg)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
                    }`}
                  >
                    {d === "up"
                      ? `+${data.effectiveGex ? fmtNum(data.effectiveGex.moveUpPct * 100, 1) : "—"}%`
                      : d === "down"
                        ? `-${data.effectiveGex ? fmtNum(data.effectiveGex.moveDownPct * 100, 1) : "—"}%`
                        : "+/- BOTH"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0.1}
                  max={50}
                  step={0.1}
                  value={movePctDraft}
                  onChange={(e) => onMovePctDraftChange(e.target.value)}
                  placeholder="auto"
                  className="w-16 border border-[var(--border)] bg-[var(--panel)] px-2 py-1 font-mono text-[0.62rem] font-semibold text-[var(--text)] outline-none"
                />
                <span className="font-mono text-[0.6rem] text-[var(--text-faint)]">%</span>
                <button onClick={onApplyMovePct} className="btn-primary px-2.5 py-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.05em]">
                  Apply
                </button>
                <button onClick={onAutoMovePct} className="btn-ghost px-2.5 py-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.05em]">
                  Auto
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {mode !== "traditional" && (
        <p className="m-0 font-sans text-[0.68rem] leading-relaxed text-[var(--text-dim)]">
          {mode === "effective"
            ? "This guesses what would actually happen to dealer hedging if the price moved by the % above, instead of just assuming today's numbers stay the same. Pick a strike, pick a direction, and see how much bigger (or smaller) the reaction really looks once price gets there."
            : "This shows just the part of that reaction that comes from volatility shifting along with price, separated out from the plain price-move effect. Usually small, but it can matter more near the money."}
        </p>
      )}

      {/* The chart room, as equal-weight rows - no panel outranks another.
          Row 1: spine/bars and terrain side by side at matching heights.
          Row 2: grid + smile. Row 3: the two utility drawers, side by side
          at the top level (not buried at the bottom of a nested column). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="blueprint hud flex flex-col gap-2 border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="partno">01 · {strikeView === "spine" ? "spine" : "bars"}</span>
            <div className="flex items-center gap-2">
              <span className="eyebrow">
                {chartUnitLabel}
                {mode === "traditional" && dteColumns.length ? ` · ${dteColumns[clampedDteIndex]?.label ?? "0DTE"}${dteScope === "cumulative" && clampedDteIndex > 0 ? " ∑" : ""}` : ""}
              </span>
              <div className="inline-flex border border-[var(--border)]">
                {(["spine", "bars"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setStrikeView(v)}
                    className={`px-2 py-0.5 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.06em] transition-colors duration-150 ${
                      v === strikeView ? "bg-[var(--text)] text-[var(--bg)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {strikeView === "spine" ? (
            <SpineProfile points={spinePoints} spot={data.spot} tickDir={tick.dir} annotations={spineAnnotations} band={spineBand} lobeLabels={spineLobeLabels} height={520} />
          ) : scenarioBoth ? (
            <TerminalDualBarChart data={chartDualData} unitLabel={chartUnitLabel} spot={data.spot} walls={walls} height={520} valueFormatter={fmtUsd} />
          ) : (
            <TerminalExposureChart data={chartData} unitLabel={chartUnitLabel} spot={data.spot} walls={walls} height={520} valueFormatter={mode === "traditional" ? fmtRaw : fmtUsd} />
          )}
          {!deepReady && mode === "traditional" && !data.strikeExpiryHeatmaps?.[metric] && (
            <p className="m-0 font-mono text-[0.58rem] leading-relaxed text-[var(--text-faint)]">
              {metric === "gex" ? "live self-computed 0DTE — full expiry stack syncing" : "this greek rides the full payload — syncing"}
            </p>
          )}
        </div>

        {deepReady || mode !== "traditional" ? (
          <div className="blueprint hud border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <span className="partno">02 · terrain</span>
              <span className="eyebrow">
                {mode === "traditional"
                  ? `${data.symbol} · dealer book as 3D relief — strike × expiry tenor`
                  : `${data.symbol} · scenario reprice as relief — GEX only, other Greeks are flat in this mode`}
              </span>
            </div>
            <TopoSurface rows={topoRows} spot={data.spot} tenorLabels={topoTenorLabels} metric={mode === "traditional" ? metric : "gex"} walls={walls} height={430} />
          </div>
        ) : (
          <DeepSyncPanel title="Terrain" note="the 3D relief is built from the full strike × expiry payload" />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        {deepReady || mode !== "traditional" ? (
          <div className="hud border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <span className="partno">03 · grid</span>
              <span className="eyebrow">
                {mode === "traditional" ? `${data.symbol} · ${METRIC_LABEL[metric]} by strike × expiry` : "+move / −move columns instead of a DTE axis"}
              </span>
            </div>
            {mode === "traditional" ? (
              <StrikeExpiryHeatmapChart grid={windowHeatmap(data.strikeExpiryHeatmaps?.[metric], data.spot)} spot={data.spot} walls={walls} unitLabel={METRIC_LABEL[metric]} valueFormatter={fmtRaw} />
            ) : (
              <StrikeExpiryHeatmapChart
                grid={windowHeatmap(effectiveGexAsGrid(data.effectiveGex, mode), data.spot)}
                spot={data.spot}
                walls={heatmapWalls}
                unitLabel={mode === "effective" ? "EFF GEX" : "SHADOW γ"}
                valueFormatter={fmtUsd}
              />
            )}
          </div>
        ) : (
          <DeepSyncPanel title="Grid" note="the strike × expiry grid is part of the full payload" />
        )}

        <div className="hud border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <span className="partno">04 · smile</span>
            <span className="eyebrow">{data.symbol} · live-quoted 0DTE call/put IV vs fitted curve</span>
          </div>
          <IvSmileChart points={data.ivSmile} spot={data.spot} />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Drawer index="05" title="cross-expiry stack" hint="compare expirations, Greeks and tickers side by side" open={stackOpen} onToggle={() => setStackOpen((o) => !o)}>
          <div className="grid grid-cols-1 gap-4">
            <CrossExpiryPanel defaultSymbol={data.symbol} />
            <CrossExpiryPanel defaultSymbol={data.symbol} />
          </div>
        </Drawer>

        <Drawer index="06" title="ai prompt" hint="this request's real data as a ready-made LLM prompt" open={promptOpen} onToggle={() => setPromptOpen((o) => !o)}>
          {deepReady ? (
            <AiPromptPanel data={data} />
          ) : (
            <div className="flex flex-col gap-2">
              {[0.9, 0.6, 0.75].map((w, i) => (
                <div key={i} className="shimmer h-6" style={{ width: `${w * 100}%` }} />
              ))}
            </div>
          )}
        </Drawer>
      </div>
    </div>
  );
}

// Core rides /zero_dte + /gex only (~3-4s server-side) - polling it is what
// keeps spot and every self-computed Greek live. Full is the heavy pipeline
// (~15-20s); it hydrates the deep panels and refreshes less often.
// Single-pipeline poll: every field on the page comes from the same
// request, so the walls/heatmap/terrain/hero-stats can never disagree with
// each other (a core/full split briefly did exactly that - the fast tier's
// self-computed walls and the /heatmap-sourced grid drifted apart mid-poll).
const POLL_MS = 30_000;

function FlowSession({ symbol, onSymbolChange }: { symbol: GexSymbol; onSymbolChange: (s: GexSymbol) => void }) {
  const [data, setData] = useState<GexResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A poll failed but older data is still on screen - degrade the status
  // chip instead of blanking a working page over one bad request.
  const [degraded, setDegraded] = useState(false);
  const [tick, setTick] = useState<SpotTick>({ dir: null, at: 0 });
  const lastSpotRef = useRef<number | null>(null);

  // Effective GEX/Shadow Gamma's scenario move % - null means "let the
  // server pick" (auto, spans the displayed +/-15 strikes). Only refetches
  // on explicit Apply/Auto, not every keystroke.
  const [movePct, setMovePct] = useState<number | null>(null);
  const [movePctDraft, setMovePctDraft] = useState("");

  useEffect(() => {
    let disposed = false;
    const ctrl = new AbortController();
    let busy = false;

    async function load() {
      if (busy) return; // never stack a poll on a still-running fetch
      busy = true;
      try {
        const res = await fetch(`/api/gex?symbol=${symbol}${movePct !== null ? `&movePct=${movePct}` : ""}`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        const json = (await res.json()) as GexResponse;
        if (!json.ok) throw new Error("upstream returned an error");
        if (disposed) return;
        const prevSpot = lastSpotRef.current;
        if (prevSpot !== null && json.spot !== prevSpot) {
          setTick({ dir: json.spot > prevSpot ? "up" : "down", at: json.asOf });
        }
        lastSpotRef.current = json.spot;
        setData(json);
        setError(null);
        setDegraded(false);
      } catch (err) {
        if (disposed || ctrl.signal.aborted) return;
        setDegraded(true);
        setError(err instanceof Error ? err.message : "request failed");
      } finally {
        busy = false;
      }
    }

    load();
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      ctrl.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [symbol, movePct]);

  const deepReady = !!data;
  const hardError = error !== null && !data;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SymbolToggle symbol={symbol} onChange={onSymbolChange} />
        {data && <LiveStatus asOf={data.asOf} deepReady={deepReady} degraded={degraded} />}
      </div>

      {!data && !hardError && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="hud flex flex-col gap-3 border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="shimmer h-10 w-44" />
            <div className="shimmer h-3 w-28" />
            <div className="mt-6 grid grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="shimmer h-8" />
              ))}
            </div>
          </div>
          <div className="hud flex items-center justify-center border border-[var(--border)] bg-[var(--panel)] p-5">
            <TesseractMark size={130} />
          </div>
        </div>
      )}

      {hardError && (
        <div className="border border-[var(--border)] bg-[var(--panel)] p-8 text-center font-mono text-[0.8rem]" style={{ color: "var(--down)" }}>
          ERR: {error}
        </div>
      )}

      {data && (
        <TerminalView
          data={data}
          deepReady={deepReady}
          tick={tick}
          movePctDraft={movePctDraft}
          onMovePctDraftChange={setMovePctDraft}
          onApplyMovePct={() => {
            const n = Number(movePctDraft);
            if (Number.isFinite(n) && n > 0) setMovePct(n);
          }}
          onAutoMovePct={() => {
            setMovePctDraft("");
            setMovePct(null);
          }}
        />
      )}
    </>
  );
}

export default function OptionsFlowPage({ view }: { view: OptionsFlowView }) {
  const [symbol, setSymbol] = useState<GexSymbol>("QQQ");
  return (
    <div className="flex flex-col gap-6" data-view={view}>
      {/* key={symbol} resets the whole data session on a ticker switch, so the old symbol's numbers never render under the new header */}
      <FlowSession key={symbol} symbol={symbol} onSymbolChange={setSymbol} />
    </div>
  );
}
