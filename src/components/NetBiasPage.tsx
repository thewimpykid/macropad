"use client";

import { useMemo, useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ReferenceLine, Tooltip, Cell } from "recharts";
import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import { MARKET_SYMBOLS } from "@/lib/markets";
import {
  computeNetBias,
  computeNetBiasAsOf,
  computeHorizonBias,
  backtestNetBias,
  type HorizonBias,
  type Horizon,
  type BiasContributor,
  type NetBiasResult,
} from "@/lib/netBias";

function toneColor(tone: "up" | "down" | "flat"): string {
  return tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text-faint)";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function minDateIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

/** Score gauge with the 7 verdict bands ticked so "how far to Strongly" is visible. */
function ScoreGauge({ score, tone }: { score: number; tone: "up" | "down" | "flat" }) {
  const clamped = Math.max(-1, Math.min(1, score));
  // All percentages rounded to 2dp — the CSSOM re-serializes long floats and
  // trips React hydration diffing. Same reason for backgroundColor longhand.
  const pct = Math.round((clamped + 1) * 5000) / 100;
  const bands = [-0.55, -0.3, -0.12, 0.12, 0.3, 0.55];
  return (
    <div className="relative h-[6px] rounded-[2px] bg-[var(--border)]">
      {bands.map((b) => (
        <div
          key={b}
          className="absolute top-[-2px] h-[10px] w-px bg-[var(--border-strong)]"
          style={{ left: `${Math.round((b + 1) * 5000) / 100}%` }}
        />
      ))}
      <div
        className="absolute top-0 h-full rounded-[2px]"
        style={{
          backgroundColor: toneColor(tone),
          [clamped >= 0 ? "left" : "right"]: "50%",
          width: `${Math.round(Math.abs(clamped) * 5000) / 100}%`,
        }}
      />
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-[var(--panel)]"
        style={{ left: `${pct}%`, backgroundColor: toneColor(tone) }}
      />
    </div>
  );
}

function VerdictTag({ verdict, tone, size = "md" }: { verdict: string; tone: "up" | "down" | "flat"; size?: "md" | "lg" }) {
  return (
    <span
      className={`inline-block border font-semibold ${size === "lg" ? "px-3 py-1 text-[0.82rem]" : "px-2 py-0.5 text-[0.68rem]"} rounded-[3px]`}
      style={{ color: toneColor(tone), borderColor: toneColor(tone) }}
    >
      {verdict}
    </span>
  );
}

function AssetSummaryCard({
  symbol,
  label,
  result,
  market,
  onSelect,
}: {
  symbol: string;
  label: string;
  result: NetBiasResult;
  market: MarketRow | undefined;
  onSelect: () => void;
}) {
  const top = result.contributors.slice(0, 3);
  return (
    <button
      onClick={onSelect}
      className="rounded border border-[var(--border)] bg-[var(--panel)] p-4 text-left transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[0.9rem] font-semibold">{label}</div>
          {market && <div className="mt-0.5 font-mono text-[0.76rem] text-[var(--text-faint)]">{market.value}</div>}
        </div>
        <VerdictTag verdict={result.verdict} tone={result.tone} />
      </div>
      <div className="mt-3.5">
        <ScoreGauge score={result.score} tone={result.tone} />
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[0.66rem] text-[var(--text-faint)]">
        <span>
          score {result.score > 0 ? "+" : ""}
          {result.score.toFixed(2)}
        </span>
        <span>{Math.round(result.conviction * 100)}% agree · {result.contributors.length} inputs</span>
      </div>
      {top.length > 0 && (
        <div className="mt-2.5 border-t border-[var(--border)] pt-2">
          {top.map((c) => (
            <div key={c.seriesId} className="flex items-center justify-between gap-2 py-0.5 text-[0.68rem]">
              <span className="truncate text-[var(--text-dim)]">{c.name}</span>
              <span className="shrink-0 font-mono" style={{ color: c.contribution >= 0 ? "var(--up)" : "var(--down)" }}>
                {c.contribution >= 0 ? "+" : ""}
                {(c.contribution * c.weight).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

function HorizonCard({
  label,
  caption,
  data,
  isPrimary,
}: {
  label: string;
  caption: string;
  data: HorizonBias;
  isPrimary: boolean;
}) {
  return (
    <div
      className="rounded border bg-[var(--panel)] p-4"
      style={{ borderColor: isPrimary ? "var(--accent)" : "var(--border)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[0.76rem] font-semibold">
          {label}
          {isPrimary && (
            <span className="text-[0.6rem] font-semibold text-[var(--accent)]">— selected horizon</span>
          )}
        </div>
        <VerdictTag verdict={data.verdict} tone={data.tone} />
      </div>
      <div className="mt-3">
        <ScoreGauge score={data.score} tone={data.tone} />
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[0.66rem] text-[var(--text-faint)]">
        <span>score {data.score > 0 ? "+" : ""}{data.score.toFixed(2)}</span>
        <span>{data.daysUsed}d sampled</span>
      </div>
      <p className="m-0 mt-2 text-[0.68rem] leading-snug text-[var(--text-faint)]">{caption}</p>
    </div>
  );
}

function ContributorRow({ c }: { c: BiasContributor }) {
  const weighted = c.contribution * c.weight;
  const barPct = Math.round(Math.min(100, Math.abs(weighted) * 100) * 100) / 100;
  const color = weighted > 0 ? "var(--up)" : weighted < 0 ? "var(--down)" : "var(--text-faint)";
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[0.82rem] font-semibold">{c.name}</span>
            <span className="shrink-0 text-[0.62rem] text-[var(--text-faint)]">{c.panelTitle} · {c.cadence}</span>
            <span
              className="shrink-0 rounded-[3px] border border-[var(--border-strong)] px-1 py-[1px] font-mono text-[0.58rem] font-medium text-[var(--steel)]"
              title={c.methodRationale}
            >
              {c.method}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[0.74rem]" style={{ color: toneColor(c.tone) }}>
            {c.label}
          </div>
        </div>
        <div className="w-44 shrink-0">
          <div className="relative h-[5px] rounded-[2px] bg-[var(--border)]">
            <div className="absolute left-1/2 top-[-2px] h-[9px] w-px bg-[var(--border-strong)]" />
            <div
              className="absolute top-0 h-full rounded-[2px]"
              style={{ width: `${barPct / 2}%`, backgroundColor: color, [weighted >= 0 ? "left" : "right"]: "50%" }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[0.62rem] text-[var(--text-faint)]">
            <span style={{ color }}>
              {weighted >= 0 ? "+" : ""}
              {weighted.toFixed(2)} wt'd
            </span>
            <span title="Correlation of changes between this indicator and the asset — part of the weight">
              {c.correlation !== null ? `Δr ${c.correlation > 0 ? "+" : ""}${c.correlation.toFixed(2)}` : "Δr —"}
            </span>
            <span>{c.score !== null ? `${c.score > 0 ? "+" : ""}${c.score.toFixed(2)}` : "—"}</span>
          </div>
        </div>
      </div>
      <p className="m-0 mt-1.5 text-[0.68rem] leading-snug text-[var(--text-faint)]">{c.rationale}</p>
    </div>
  );
}

function BacktestSection({
  panels,
  markets,
  symbol,
  horizon,
  label,
}: {
  panels: MacroPanel[];
  markets: MarketRow[];
  symbol: string;
  horizon: Horizon;
  label: string;
}) {
  const backtest = useMemo(() => backtestNetBias(panels, markets, symbol, horizon), [panels, markets, symbol, horizon]);
  const scatterData = backtest.points
    .filter((p) => p.forwardReturnPct !== null)
    .map((p) => ({ score: p.score, forward: p.forwardReturnPct as number, date: p.date }));

  if (backtest.n < 8) {
    return (
      <div className="mt-6 rounded border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="text-[0.9rem] font-semibold">Backtest</div>
        <p className="m-0 mt-1 text-[0.76rem] text-[var(--text-faint)]">
          Not enough price history for {label} yet — needs at least 8 as-of dates with a forward return.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[0.9rem] font-semibold">Backtest — does this score actually predict {label}?</div>
        <span className="font-mono text-[0.68rem] text-[var(--text-faint)]">
          {backtest.n} samples · {backtest.horizonDays}d forward window
        </span>
      </div>
      <p className="m-0 mt-1 max-w-[80ch] text-[0.74rem] leading-snug text-[var(--text-faint)]">
        Recomputes the score at every past weekly date using only data available then (the same no-lookahead
        machinery as the replay), then checks what {label} actually did over the next {backtest.horizonDays} day
        {backtest.horizonDays === 1 ? "" : "s"} against daily price bars. A methodology that doesn't predict forward
        returns isn't a signal — this is how you catch that.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-[3px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
          <div className="text-[0.62rem] text-[var(--text-faint)]">Direction hit rate (|score| &gt; 0.1)</div>
          <div className="mt-0.5 font-mono text-[1.05rem] font-semibold">
            {backtest.hitRate === null ? "—" : `${backtest.hitRate.toFixed(0)}%`}
          </div>
        </div>
        <div className="rounded-[3px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
          <div className="text-[0.62rem] text-[var(--text-faint)]">Avg fwd return when bullish (&gt;0.2)</div>
          <div className="mt-0.5 font-mono text-[1.05rem] font-semibold" style={{ color: "var(--up)" }}>
            {backtest.avgForwardReturnWhenBullish === null
              ? "—"
              : `${backtest.avgForwardReturnWhenBullish > 0 ? "+" : ""}${backtest.avgForwardReturnWhenBullish.toFixed(1)}%`}
          </div>
        </div>
        <div className="rounded-[3px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
          <div className="text-[0.62rem] text-[var(--text-faint)]">Avg fwd return when bearish (&lt;-0.2)</div>
          <div className="mt-0.5 font-mono text-[1.05rem] font-semibold" style={{ color: "var(--down)" }}>
            {backtest.avgForwardReturnWhenBearish === null
              ? "—"
              : `${backtest.avgForwardReturnWhenBearish > 0 ? "+" : ""}${backtest.avgForwardReturnWhenBearish.toFixed(1)}%`}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[0.66rem] text-[var(--text-faint)]">
          <span>Each point: a past week's score vs what happened {backtest.horizonDays}d later</span>
          <span className="font-mono">
            r {backtest.correlation === null ? "—" : `${backtest.correlation > 0 ? "+" : ""}${backtest.correlation.toFixed(2)}`}
          </span>
        </div>
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 6, right: 10, bottom: 4, left: 0 }}>
              <XAxis
                type="number"
                dataKey="score"
                domain={[-1, 1]}
                tick={{ fill: "var(--text-faint)", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                label={{ value: "score at as-of date", position: "insideBottom", offset: -2, fill: "var(--text-faint)", fontSize: 10 }}
              />
              <YAxis
                type="number"
                dataKey="forward"
                tick={{ fill: "var(--text-faint)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={44}
                label={{ value: `${backtest.horizonDays}d fwd %`, angle: -90, position: "insideLeft", fill: "var(--text-faint)", fontSize: 10 }}
              />
              <ReferenceLine x={0} stroke="var(--border-strong)" />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Tooltip
                contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border-strong)", borderRadius: 3, fontSize: 11 }}
                formatter={(v, name) => [Number(v).toFixed(2) + (name === "forward" ? "%" : ""), name === "forward" ? "fwd return" : "score"]}
              />
              <Scatter data={scatterData} isAnimationActive={false}>
                {scatterData.map((p, i) => (
                  <Cell
                    key={i}
                    fill={Math.sign(p.score) === Math.sign(p.forward) && Math.abs(p.score) > 0.1 ? "var(--up)" : "var(--text-faint)"}
                    fillOpacity={0.7}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="m-0 mt-1 text-[0.64rem] text-[var(--text-faint)]">
          Green points = the score called the direction correctly. Top-right and bottom-left quadrants are wins.
        </p>
      </div>
    </div>
  );
}

export default function NetBiasPage({
  panels,
  markets,
  assetFilter,
  onPickAsset,
  horizon,
}: {
  panels: MacroPanel[];
  markets: MarketRow[];
  assetFilter: string;
  onPickAsset: (symbol: string) => void;
  horizon: Horizon;
}) {
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const marketBySymbol = new Map(markets.map((m) => [m.symbol, m]));
  const minDate = minDateIso();
  const maxDate = todayIso();
  const isReplay = asOfDate !== maxDate;

  const result = useMemo(
    () => (assetFilter ? computeNetBiasAsOf(panels, markets, assetFilter, asOfDate, horizon) : null),
    [panels, markets, assetFilter, asOfDate, horizon]
  );
  const horizonBias = useMemo(
    () => (assetFilter ? computeHorizonBias(panels, markets, assetFilter, asOfDate, horizon) : null),
    [panels, markets, assetFilter, asOfDate, horizon]
  );

  if (!assetFilter || !result || !horizonBias) {
    return (
      <div>
        <p className="m-0 mb-5 text-[0.84rem] text-[var(--text-dim)]">
          Every asset's live net read, weighted for the <strong className="text-[var(--text)]">{horizon}</strong>{" "}
          horizon. Pick one for the full breakdown and 30-day replay.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {MARKET_SYMBOLS.map((m) => (
            <AssetSummaryCard
              key={m.symbol}
              symbol={m.symbol}
              label={m.label}
              result={computeNetBias(panels, markets, m.symbol, horizon)}
              market={marketBySymbol.get(m.symbol)}
              onSelect={() => onPickAsset(m.symbol)}
            />
          ))}
        </div>
      </div>
    );
  }

  const label = MARKET_SYMBOLS.find((m) => m.symbol === assetFilter)?.label ?? assetFilter;
  const market = marketBySymbol.get(assetFilter);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-4 rounded border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <label className="text-[0.7rem] font-medium text-[var(--text-faint)]">Replay date</label>
          <input
            type="date"
            value={asOfDate}
            min={minDate}
            max={maxDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="rounded-[3px] border bg-[var(--panel)] px-2.5 py-1.5 font-mono text-[0.78rem] outline-none focus-visible:border-[var(--accent)]"
            style={{ borderColor: isReplay ? "var(--accent)" : "var(--border)", color: isReplay ? "var(--accent)" : "var(--text)" }}
          />
        </div>
        {isReplay && (
          <button
            onClick={() => setAsOfDate(maxDate)}
            className="text-[0.72rem] font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Back to today
          </button>
        )}
        <span className="text-[0.7rem] text-[var(--text-faint)]">
          30 days max. Signals recomputed from data available on that date only — no lookahead.
        </span>
      </div>

      <div className="rounded border border-[var(--border)] bg-[var(--panel)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[0.66rem] text-[var(--text-faint)]">
              {isReplay ? `Net bias as of ${asOfDate}` : "Net bias"}
            </div>
            <div className="font-display mt-0.5 text-[1.7rem] leading-tight">{label}</div>
            {market && !isReplay && (
              <div className="mt-1 flex items-baseline gap-2 font-mono">
                <span className="text-[1.05rem] font-semibold">{market.value}</span>
              </div>
            )}
          </div>
          <div className="text-right">
            <VerdictTag verdict={result.verdict} tone={result.tone} size="lg" />
            <div className="mt-1.5 font-mono text-[0.7rem] text-[var(--text-faint)]">
              {Math.round(result.conviction * 100)}% of weight agrees
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-[0.66rem] text-[var(--text-faint)]">
            <span>Strongly bearish</span>
            <span className="font-mono">
              score {result.score > 0 ? "+" : ""}
              {result.score.toFixed(2)}
            </span>
            <span>Strongly bullish</span>
          </div>
          <ScoreGauge score={result.score} tone={result.tone} />
        </div>

        <p className="m-0 mt-4 max-w-[78ch] text-[0.76rem] leading-snug text-[var(--text-faint)]">
          Each linked indicator contributes sign × its method-based score (anchor / momentum / threshold /
          positioning — whichever fits that indicator), weighted three ways: its mapped impact on {label}, how well
          its release cadence fits the <strong className="text-[var(--text-dim)]">{horizon}</strong> horizon, and
          the measured correlation of its changes with {label}'s moves. Ticks mark the verdict bands (±0.12 lean,
          ±0.30 outright, ±0.55 strong).
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <HorizonCard label="Today" caption={`Point-in-time read on ${asOfDate} only.`} data={horizonBias.daily} isPrimary={horizon === "daily"} />
        <HorizonCard
          label="Trailing week"
          caption="Average of the daily read over 7 calendar days — smooths single-day noise."
          data={horizonBias.weekly}
          isPrimary={horizon === "weekly"}
        />
        <HorizonCard
          label="Trailing month"
          caption="Average over 30 calendar days — the persistent backdrop."
          data={horizonBias.monthly}
          isPrimary={horizon === "monthly"}
        />
      </div>

      <BacktestSection panels={panels} markets={markets} symbol={assetFilter} horizon={horizon} label={label} />

      <div className="mt-6">
        <div className="mb-2 text-[0.7rem] font-medium text-[var(--text-faint)]">
          Contributors as of {asOfDate}, ranked by weighted strength
        </div>
        {result.contributors.length === 0 ? (
          <p className="text-[0.82rem] text-[var(--text-faint)]">No linked indicators have enough history on this date.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {result.contributors.map((c) => (
              <ContributorRow key={c.seriesId} c={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
