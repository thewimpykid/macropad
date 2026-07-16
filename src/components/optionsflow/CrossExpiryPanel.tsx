"use client";

import { useEffect, useMemo, useState } from "react";
import type { GexResponse, GexSymbol } from "@/lib/gex";
import { fmtRaw, fmtUsd } from "@/lib/gex";
import { computeTopWalls, TerminalExposureChart, type WallMarker } from "@/components/optionsflow/TerminalChart";

const STRIKE_WINDOW = 26; // ~+-13 strikes around spot

type Metric = "gex" | "dex" | "vex" | "cex" | "tex" | "vegaex";
const METRIC_LABEL: Record<Metric, string> = { gex: "GEX", dex: "DEX", vex: "VEX", cex: "CHEX", tex: "THETA", vegaex: "VEGA" };
const METRIC_ORDER: Metric[] = ["gex", "dex", "vex", "cex", "tex", "vegaex"];
// Only the symbols /api/gex actually serves (y3os covers QQQ/SPX live) -
// offering SPY/NDX here just renders a guaranteed 400 error panel.
const TICKERS: GexSymbol[] = ["QQQ", "SPX"];

type Mode = "traditional" | "effective" | "shadow";
const MODE_LABEL: Record<Mode, string> = { traditional: "TRADITIONAL", effective: "EFFECTIVE", shadow: "SHADOW" };
const MODE_ORDER: Mode[] = ["traditional", "effective", "shadow"];

function Dropdown<T extends string>({ value, options, labels, onChange }: { value: T; options: T[]; labels?: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="border border-[var(--border)] bg-[var(--panel)] px-2 py-1 font-mono text-[0.68rem] font-semibold text-[var(--text)] outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labels ? labels[o] : o}
        </option>
      ))}
    </select>
  );
}

export function CrossExpiryPanel({ defaultSymbol }: { defaultSymbol: GexSymbol }) {
  const [ticker, setTicker] = useState<GexSymbol>(defaultSymbol);
  const [metric, setMetric] = useState<Metric>("gex");
  const [dteIndex, setDteIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("traditional");
  const [dir, setDir] = useState<"up" | "down">("up");
  const [data, setData] = useState<GexResponse | null>(null);
  const [error, setError] = useState<{ ticker: GexSymbol; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let busy = false;

    async function load() {
      if (busy) return; // never stack a poll on a still-running fetch
      busy = true;
      try {
        const res = await fetch(`/api/gex?symbol=${ticker}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        const json = (await res.json()) as GexResponse;
        if (!json.ok) throw new Error("upstream returned an error");
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (err) {
        if (!cancelled) setError({ ticker, message: err instanceof Error ? err.message : "request failed" });
      } finally {
        busy = false;
      }
    }

    load();
    // Silent refresh keeps the panel live without flashing back to a spinner.
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ticker]);

  // Loading/error are derived from which ticker the on-screen payload belongs
  // to, so a ticker switch needs no synchronous state reset in the effect.
  const current = data && data.symbol === ticker ? data : null;
  const errorMsg = error && error.ticker === ticker ? error.message : null;
  const loading = !current && !errorMsg;

  const grid = current?.strikeExpiryHeatmaps?.[metric] ?? null;
  const columns = grid?.columns ?? [];
  const clampedIndex = Math.min(dteIndex, Math.max(0, columns.length - 1));

  const chartData = useMemo(() => {
    if (!current) return [];
    if (mode !== "traditional") {
      const rows = current.effectiveGex?.rows ?? [];
      const pick = (r: NonNullable<GexResponse["effectiveGex"]>["rows"][number]) =>
        mode === "effective" ? (dir === "up" ? r.upEffective : r.downEffective) : dir === "up" ? r.shadowGammaUp : r.shadowGammaDown;
      return [...rows.map((r) => ({ strike: r.strike, value: pick(r) }))]
        .sort((a, b) => Math.abs(a.strike - current.spot) - Math.abs(b.strike - current.spot))
        .slice(0, STRIKE_WINDOW)
        .sort((a, b) => a.strike - b.strike);
    }
    if (!grid || !grid.strikes.length) return [];
    const all = grid.strikes.map((strike, i) => ({ strike, value: grid.values[i][clampedIndex] ?? 0 }));
    return [...all].sort((a, b) => Math.abs(a.strike - current.spot) - Math.abs(b.strike - current.spot)).slice(0, STRIKE_WINDOW).sort((a, b) => a.strike - b.strike);
  }, [grid, clampedIndex, current, mode, dir]);

  const unitLabel = mode === "traditional" ? METRIC_LABEL[metric] : mode === "effective" ? "EFF GEX" : "SHADOW γ";
  const walls: WallMarker[] = current
    ? [...computeTopWalls(chartData, mode === "traditional" ? metric : "gex", 2), { label: "Max Pain", price: current.maxPain, color: "#d9a441" }, ...(current.gammaFlip !== null ? [{ label: "G-Flip", price: current.gammaFlip, color: "var(--text-faint)" }] : [])]
    : [];

  return (
    <div className="hud flex flex-col gap-3 border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown value={ticker} options={TICKERS} onChange={setTicker} />
        <div className="inline-flex border border-[var(--border)]">
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-1 font-mono text-[0.6rem] font-semibold tracking-[0.04em] transition-colors duration-150 ${
                m === mode ? "bg-[var(--accent)] text-[var(--bg)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {mode === "traditional" ? (
          <>
            <Dropdown value={String(clampedIndex)} options={columns.map((_, i) => String(i))} labels={Object.fromEntries(columns.map((c, i) => [String(i), c.label]))} onChange={(v) => setDteIndex(Number(v))} />
            <Dropdown value={metric} options={METRIC_ORDER} labels={METRIC_LABEL} onChange={(m) => { setMetric(m); setDteIndex(0); }} />
          </>
        ) : (
          <div className="inline-flex border border-[var(--border)]">
            {(["up", "down"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDir(d)}
                className={`px-2 py-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.04em] transition-colors duration-150 ${
                  d === dir ? "bg-[var(--text)] text-[var(--bg)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
                }`}
              >
                {d === "up"
                  ? `+${current?.effectiveGex ? (current.effectiveGex.moveUpPct * 100).toFixed(1) : "—"}%`
                  : `-${current?.effectiveGex ? (current.effectiveGex.moveDownPct * 100).toFixed(1) : "—"}%`}
              </button>
            ))}
          </div>
        )}
      </div>
      {loading && <div className="py-16 text-center font-mono text-[0.72rem] text-[var(--text-faint)]">Loading {ticker}…</div>}
      {!loading && errorMsg && !current && (
        <div className="py-16 text-center font-mono text-[0.72rem]" style={{ color: "var(--down)" }}>
          ERR: {errorMsg}
        </div>
      )}
      {current && (chartData.length ? <TerminalExposureChart data={chartData} unitLabel={unitLabel} spot={current.spot} walls={walls} showAllTicks valueFormatter={mode === "traditional" ? fmtRaw : fmtUsd} /> : <div className="py-16 text-center font-mono text-[0.72rem] text-[var(--text-faint)]">No data for this selection.</div>)}
    </div>
  );
}
