"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MacroPanel, MacroSeries } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import { getSignTone, getBias } from "@/lib/bias";
import { computeMacroBias, TIMEFRAMES, ASSET_SCOPES, DEFAULT_TIMEFRAME, DEFAULT_ASSET_SCOPE, type PillarResult } from "@/lib/macroBias";
import { findSimilarRegimes, buildDateReport, type SimilarRegime, type ReportLine } from "@/lib/regimeFingerprint";
import { getCalendarEvents } from "@/lib/econCalendar";
import { INDICATOR_DOCS } from "@/lib/indicatorDocs";
import { MARKET_SYMBOLS, IMPACTS, marketRowId } from "@/lib/markets";
import { changeCorrelation } from "@/lib/stats";

/*
 * Command-line entry point into every page the desk has: Board (every
 * indicator), Macro Bias, Replay, Regime Fingerprint, News, Calendar, and
 * Documentation. All computed client-side straight off the already-loaded
 * panels/markets — same data, same libs those pages use, so this can never
 * drift out of sync with what they show.
 */

type Token = { t: string; c?: string };
type LineContent = Token[] | { node: React.ReactNode };
type Line = { id: number; content: LineContent };

interface FlatIndicator {
  id: string;
  name: string;
  value: string;
  score: number | null;
  tone: "up" | "down" | "flat";
  category: string;
  note: string;
}

const TIMEFRAME_IDS = TIMEFRAMES.map((t) => t.id);
const SCOPE_IDS = ASSET_SCOPES.map((s) => s.id);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

/*
 * Natural-language aliases so a first-time user can type "bias for the month
 * in stocks" instead of memorizing exact ids like "m equities". Every arg in
 * a command gets checked against these maps before falling back to the
 * default — order/wording/extra filler words never break parsing.
 */
const TF_ALIASES: Record<string, string> = {
  day: "d", daily: "d", today: "d",
  week: "w", weekly: "w", wk: "w",
  month: "m", monthly: "m", mo: "m", "1m": "m",
  "2mo": "2m", "2month": "2m", "2months": "2m", bimonthly: "2m",
  quarter: "3m", quarterly: "3m", "3mo": "3m", "3months": "3m",
  half: "6m", "6mo": "6m", "6months": "6m", semiannual: "6m",
  year: "y", yearly: "y", annual: "y", "1y": "y", "12m": "y",
  "2year": "2y", "2years": "2y", "2yr": "2y", "24m": "2y",
};
const SCOPE_ALIASES: Record<string, string> = {
  stock: "equities", stocks: "equities", equity: "equities", spx: "equities", nasdaq: "equities",
  bond: "rates", bonds: "rates", rate: "rates", treasury: "rates", treasuries: "rates", yields: "rates",
  dollar: "fx-dollar", fx: "fx-dollar", usd: "fx-dollar", currency: "fx-dollar", currencies: "fx-dollar",
  commodity: "commodities", gold: "commodities", oil: "commodities", metals: "commodities", energy: "commodities",
  everything: "all", everyone: "all", general: "all",
};
const VERB_ALIASES: Record<string, string> = {
  macro: "bias", overview: "bias", regimescore: "bias",
  board: "scan", overall: "scan", everything: "scan", all: "scan",
  lookup: "read", find: "read", search: "read", get: "read",
  chart: "read", plot: "read", trend: "read", history: "read", graph: "read", stats: "read",
  cluster: "regime", similar: "regime", fingerprint: "regime", match: "regime", matches: "regime",
  cal: "calendar", releases: "calendar", schedule: "calendar",
  explain: "docs", about: "docs", doc: "docs", info: "docs", learn: "docs",
  reset: "clear", cls: "clear",
  "?": "help", commands: "help",
};

const KNOWN_VERBS = [
  "scan", "read", "movers",
  "bias", "pillars", "replay",
  "regime", "footprint",
  "news", "calendar", "docs",
  "help", "clear",
];

function resolveArg(args: string[], validIds: string[], aliases: Record<string, string>): string | null {
  for (const a of args) {
    if (validIds.includes(a)) return a;
    if (aliases[a]) return aliases[a];
  }
  return null;
}

/** Real line chart straight off an indicator's own history/sparkline values — no ascii. */
function LineChart({ values, tone }: { values: number[]; tone: "up" | "down" | "flat" }) {
  const w = 460;
  const h = 96;
  const padX = 6;
  const padY = 10;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (w - padX * 2) / (values.length - 1);
  const x = (i: number) => padX + i * stepX;
  const y = (v: number) => h - padY - ((v - min) / span) * (h - padY * 2);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`);
  const color = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text-faint)";
  const areaPts = `${x(0)},${h - padY} ${pts.join(" ")} ${x(values.length - 1)},${h - padY}`;
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="block w-full" style={{ height: `${h}px` }} preserveAspectRatio="none">
      <polygon points={areaPts} fill={color} opacity={0.12} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={3} fill={color} />
    </svg>
  );
}

const toneColor = (tone: "up" | "down" | "flat") =>
  tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text-faint)";
const toneTag = (tone: "up" | "down" | "flat") => (tone === "up" ? "BULL" : tone === "down" ? "BEAR" : "FLAT");
const strengthTag = (s: string | null) => (s ? s.toUpperCase() : "FLAT");
const importanceColor = (imp: "high" | "medium" | "low") =>
  imp === "high" ? "var(--down)" : imp === "medium" ? "var(--amber)" : "var(--text-faint)";
const sentimentColor: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "var(--up)",
  bearish: "var(--down)",
  neutral: "var(--text-faint)",
};

function scoreToken(score: number | null, tone: "up" | "down" | "flat"): Token {
  if (score === null) return { t: "[ — ]", c: "var(--text-faint)" };
  return { t: `[${toneTag(tone)} ${score > 0 ? "+" : ""}${score.toFixed(2)}]`, c: toneColor(tone) };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s.padEnd(n);
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      if (line) out.push(line);
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) out.push(line);
  return out;
}

const SUGGESTIONS = ["scan", "bias", "bias this month stocks", "movers", "news", "calendar", "regime", "docs cpi", "read cpi", "help"];

/*
 * Always-on command reference, independent of what's typed. A first-time
 * user should never have to guess or memorize syntax — this is the full
 * menu of everything the terminal can do, one click away, grouped by the
 * page it pulls from. Zero-arg entries run immediately on click; entries
 * that need a specific name/date just fill the input so the user can edit
 * before hitting enter.
 */
interface MenuItem { cmd: string; desc: string; fill?: boolean }
interface MenuGroup { title: string; items: MenuItem[] }
const COMMAND_MENU: MenuGroup[] = [
  {
    title: "Board",
    items: [
      { cmd: "scan", desc: "every indicator, every category" },
      { cmd: "scan macro", desc: "just one category", fill: true },
      { cmd: "read cpi", desc: "full card: value, score, chart, every stat", fill: true },
      { cmd: "movers", desc: "strongest signals right now" },
    ],
  },
  {
    title: "Macro Bias / Replay",
    items: [
      { cmd: "bias", desc: "composite bias, 1 week lookback" },
      { cmd: "bias month stocks", desc: "e.g. month lookback, equities scope", fill: true },
      { cmd: "pillars", desc: "pillar scores only, no indicator rows" },
      { cmd: "replay 2024-01-05", desc: "bias as of any past date", fill: true },
    ],
  },
  {
    title: "Regime Fingerprint",
    items: [
      { cmd: "regime", desc: "nearest historical regime matches" },
      { cmd: "footprint 1", desc: "daily returns for match #1 (run regime first)", fill: true },
    ],
  },
  {
    title: "News / Calendar / Docs",
    items: [
      { cmd: "news", desc: "general macro news feed" },
      { cmd: "news spx", desc: "news for one asset", fill: true },
      { cmd: "calendar", desc: "release calendar, next 30 days" },
      { cmd: "docs cpi", desc: "full write-up for any indicator", fill: true },
    ],
  },
  {
    title: "",
    items: [
      { cmd: "help", desc: "list every command, right here in the log" },
      { cmd: "clear", desc: "wipe the screen" },
    ],
  },
];

function flattenIndicators(panels: MacroPanel[]): FlatIndicator[] {
  const out: FlatIndicator[] = [];
  for (const panel of panels) {
    if (panel.id === "asset-news" || panel.id === "calendar" || panel.id === "market") continue;
    for (const s of panel.series as MacroSeries[]) {
      out.push({
        id: s.id,
        name: s.name,
        value: s.value,
        score: s.zscore,
        tone: getSignTone(s.id, s.zscore),
        category: panel.title,
        note: s.note,
      });
    }
  }
  return out;
}

export default function TerminalPage({ panels, markets }: { panels: MacroPanel[]; markets: MarketRow[] }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyPos = useRef(0);
  const lastMatchesRef = useRef<SimilarRegime[]>([]);

  const indicators = useMemo(() => flattenIndicators(panels), [panels]);
  const categories = useMemo(() => Array.from(new Set(indicators.map((i) => i.category))), [indicators]);
  const allSeries = useMemo(() => panels.flatMap((p) => p.series), [panels]);

  // Live, context-aware autocomplete: while typing a verb, suggest matching
  // commands; once a verb is resolved, suggest the arguments that verb
  // actually takes (indicator names, timeframe/scope words, asset symbols) —
  // so a first-time user never has to memorize exact syntax.
  const isEmptyInput = input.trim() === "";
  const liveSuggestions = useMemo(() => {
    if (isEmptyInput) return SUGGESTIONS;
    const words = input.trim().split(/\s+/);
    const endsWithSpace = /\s$/.test(input);
    const rawFirst = words[0].toLowerCase();

    if (words.length === 1 && !endsWithSpace) {
      return KNOWN_VERBS.filter((v) => v.startsWith(rawFirst));
    }

    const verb = VERB_ALIASES[rawFirst] ?? rawFirst;
    const argQuery = words.slice(1).join(" ").toLowerCase();

    if (verb === "read" || verb === "docs") {
      const pool = verb === "docs" ? allSeries.filter((s) => INDICATOR_DOCS[s.id]) : allSeries;
      return pool
        .filter((s) => s.name.toLowerCase().includes(argQuery))
        .map((s) => `${rawFirst} ${s.name}`);
    }
    if (verb === "scan") {
      return categories
        .filter((c) => c.toLowerCase().includes(argQuery))
        .map((c) => `scan ${c.toLowerCase()}`);
    }
    if (verb === "news") {
      return MARKET_SYMBOLS.filter(
        (m) => m.label.toLowerCase().includes(argQuery) || m.symbol.toLowerCase().includes(argQuery)
      ).map((m) => `news ${m.symbol}`);
    }
    if (verb === "bias" || verb === "pillars" || verb === "replay") {
      const lastWord = words[words.length - 1]?.toLowerCase() ?? "";
      if (endsWithSpace || lastWord.length === 0) return [];
      const wordPool = [...Object.keys(TF_ALIASES), ...TIMEFRAME_IDS, ...Object.keys(SCOPE_ALIASES), ...SCOPE_IDS];
      const matches = wordPool.filter((w) => w.startsWith(lastWord) && w !== lastWord);
      return matches.map((w) => [...words.slice(0, -1), w].join(" "));
    }
    return [];
  }, [input, isEmptyInput, allSeries, categories]);

  const nextId = () => ++idRef.current;
  const emit = (batch: LineContent[]) =>
    setLines((prev) => [...prev, ...batch.map((content) => ({ id: nextId(), content }))]);

  function indicatorLine(ind: FlatIndicator): Token[] {
    return [
      { t: pad(ind.name, 26), c: "var(--text)" },
      { t: ind.value.padStart(9).slice(0, 9) + " ", c: "var(--text-dim)" },
      scoreToken(ind.score, ind.tone),
    ];
  }

  function pillarLines(p: PillarResult, full: boolean): Token[][] {
    const head: Token[] = [
      { t: pad(p.label, 30), c: "var(--text)" },
      { t: `${strengthTag(p.strength).padEnd(8)} `, c: "var(--text-faint)" },
      scoreToken(p.score, p.tone),
    ];
    if (!full) return [head];
    const rows = p.indicators.map(
      (i): Token[] => [
        { t: `  ${pad(i.name, 28)}`, c: "var(--text-dim)" },
        { t: "  " },
        scoreToken(i.score, i.tone),
      ]
    );
    return [head, ...rows];
  }

  async function run(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    emit([[{ t: "› ", c: "var(--up)" }, { t: cmd, c: "var(--text)" }]]);
    historyRef.current.push(cmd);
    historyPos.current = historyRef.current.length;

    const [rawVerb, ...rest] = cmd.toLowerCase().split(/\s+/);
    const verb = VERB_ALIASES[rawVerb] ?? rawVerb;
    const args = rest;

    if (verb === "help") {
      emit([
        [{ t: "board", c: "var(--text-faint)" }],
        [{ t: "  scan [category]", c: "var(--text)" }, { t: "        every indicator, or one category", c: "var(--text-faint)" }],
        [{ t: "  read <name>", c: "var(--text)" }, { t: "           full card for any indicator: value, score, chart, every stat", c: "var(--text-faint)" }],
        [{ t: "  movers", c: "var(--text)" }, { t: "                strongest signals right now", c: "var(--text-faint)" }],
        [{ t: "macro bias / replay", c: "var(--text-faint)" }],
        [{ t: "  bias [timeframe] [scope]", c: "var(--text)" }, { t: "  e.g. bias, or bias month stocks", c: "var(--text-faint)" }],
        [{ t: "  pillars [timeframe] [scope]", c: "var(--text)" }, { t: "pillar scores only, no indicator rows", c: "var(--text-faint)" }],
        [{ t: "  replay <date> [timeframe] [scope]", c: "var(--text)" }, { t: " bias as of a past date", c: "var(--text-faint)" }],
        [{ t: "regime fingerprint", c: "var(--text-faint)" }],
        [{ t: "  regime [date]", c: "var(--text)" }, { t: "          nearest historical regime matches", c: "var(--text-faint)" }],
        [{ t: "  footprint <1-8>", c: "var(--text)" }, { t: "        daily returns for a regime match", c: "var(--text-faint)" }],
        [{ t: "news / calendar / docs", c: "var(--text-faint)" }],
        [{ t: "  news [symbol]", c: "var(--text)" }, { t: "        general feed, or one asset's feed", c: "var(--text-faint)" }],
        [{ t: "  calendar [n]", c: "var(--text)" }, { t: "          release calendar, next n days (default 30)", c: "var(--text-faint)" }],
        [{ t: "  docs <term>", c: "var(--text)" }, { t: "           full write-up for any indicator", c: "var(--text-faint)" }],
        [{ t: "  clear", c: "var(--text)" }, { t: "                  wipe the screen", c: "var(--text-faint)" }],
        [{ t: "words like week, month, quarter, year, stocks, bonds, dollar, gold all work too — try plain English.", c: "var(--text-faint)" }],
        [{ t: `categories: ${categories.join(", ").toLowerCase()}`, c: "var(--text-faint)" }],
        [{ t: `assets: ${MARKET_SYMBOLS.map((m) => m.symbol).join(", ")}`, c: "var(--text-faint)" }],
      ]);
      return;
    }

    if (verb === "clear") {
      setLines([]);
      return;
    }

    if (verb === "scan") {
      const arg = args.join(" ");
      const pool = arg ? indicators.filter((i) => i.category.toLowerCase().includes(arg)) : indicators;
      if (pool.length === 0) {
        emit([[{ t: `no category matching "${arg}". try: ${categories.join(", ").toLowerCase()}`, c: "var(--down)" }]]);
        return;
      }
      const bull = pool.filter((i) => i.tone === "up" && i.score !== null && Math.abs(i.score) >= 0.15).length;
      const bear = pool.filter((i) => i.tone === "down" && i.score !== null && Math.abs(i.score) >= 0.15).length;
      emit([
        [
          { t: `${pool.length} indicators`, c: "var(--text-dim)" },
          { t: "   " },
          { t: `${bull}▲`, c: "var(--up)" },
          { t: "  " },
          { t: `${bear}▼`, c: "var(--down)" },
        ],
        ...pool.map(indicatorLine),
      ]);
      return;
    }

    if (verb === "read") {
      const arg = args.join(" ");
      if (!arg) {
        emit([[{ t: "usage: read <name>  e.g. read cpi", c: "var(--text-faint)" }]]);
        return;
      }
      const hits = allSeries.filter((s) => s.name.toLowerCase().includes(arg) || s.id.toLowerCase().includes(arg));
      if (hits.length === 0) {
        emit([[{ t: `no indicator matching "${arg}"`, c: "var(--down)" }]]);
        return;
      }
      if (hits.length > 1) {
        emit([
          [{ t: `${hits.length} indicators matching "${arg}" — pick one:`, c: "var(--text-dim)" }],
          ...hits.slice(0, 10).map((s): Token[] => [
            { t: pad(s.name, 26), c: "var(--text)" },
            scoreToken(s.zscore, getSignTone(s.id, s.zscore)),
          ]),
        ]);
        return;
      }
      // Holistic card — everything the Board card shows when expanded, in
      // one command: value/score, bias read, every linked asset with its
      // live correlation, every specialized metric with its own chart, and
      // the full history chart. No need to remember separate graph/stats/
      // linked-assets verbs, or open the Board to see the rest of the card.
      const hit = hits[0];
      const tone = getSignTone(hit.id, hit.zscore);
      const bias = getBias(hit.id, hit.zscore);
      const biasColor = bias ? toneColor(bias.tone) : "var(--text-faint)";
      const extra = hit.extraStats ?? [];
      const series = hit.sparkline && hit.sparkline.length >= 5 ? hit.sparkline : (hit.history ?? []).map((p) => p.value);
      const batch: LineContent[] = [
        [
          { t: pad(hit.name, 26), c: "var(--text)" },
          { t: hit.value.padStart(9).slice(0, 9) + " ", c: "var(--text-dim)" },
          scoreToken(hit.zscore, tone),
        ],
        [{ t: hit.note, c: "var(--text-faint)" }],
        ...(bias ? [[{ t: bias.label, c: biasColor }] as Token[]] : []),
        ...(hit.windowLabel ? [[{ t: hit.windowLabel, c: "var(--text-faint)" }] as Token[]] : []),
      ];

      const impacts = IMPACTS[hit.id] ?? [];
      const linked = impacts
        .map((impact) => ({ impact, market: markets.find((m) => m.id === marketRowId(impact.symbol)) }))
        .filter((x): x is { impact: (typeof impacts)[number]; market: MarketRow } => !!x.market);
      if (linked.length > 0) {
        batch.push([{ t: `linked assets (${linked.length})`, c: "var(--text-dim)" }]);
        for (const { impact, market } of linked) {
          const r =
            hit.history && market.history && market.history.length >= 20
              ? changeCorrelation(hit.history, market.history, 6)
              : null;
          batch.push([
            { t: `  ${impact.sign > 0 ? "↑" : "↓"} `, c: impact.sign > 0 ? "var(--up)" : "var(--down)" },
            { t: pad(market.name, 22), c: "var(--text)" },
            { t: market.value.padStart(9) + "  ", c: "var(--text-dim)" },
            { t: `wt ${(impact.weight * 100).toFixed(0)}%`, c: "var(--text-faint)" },
            ...(r !== null ? [{ t: `  r ${r > 0 ? "+" : ""}${r.toFixed(2)}`, c: "var(--text-faint)" }] : []),
          ]);
        }
      }

      if (series.length >= 5) {
        const first = series[0];
        const last = series[series.length - 1];
        const changePct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
        const chartTone: "up" | "down" | "flat" = changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
        batch.push(
          [{ t: "history", c: "var(--text-dim)" }],
          { node: <LineChart key={`chart-${hit.id}-${Date.now()}`} values={series} tone={chartTone} /> },
          [
            { t: `low ${Math.min(...series).toFixed(2)}`, c: "var(--text-faint)" },
            { t: "   " },
            { t: `high ${Math.max(...series).toFixed(2)}`, c: "var(--text-faint)" },
            { t: "   " },
            { t: `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}% over window`, c: changePct >= 0 ? "var(--up)" : "var(--down)" },
          ]
        );
      }

      if (extra.length > 0) {
        batch.push([{ t: `specialized metrics (${extra.length})`, c: "var(--text-dim)" }]);
        for (const e of extra) {
          batch.push([
            { t: pad(e.label, 26), c: "var(--text-dim)" },
            { t: e.value, c: e.flag ? "var(--down)" : "var(--text)" },
            ...(e.flag ? [{ t: "  ⚑ flagged", c: "var(--down)" }] : []),
          ]);
          if (e.caption) batch.push([{ t: `  ${e.caption}`, c: "var(--text-faint)" }]);
          if (e.history && e.history.length >= 10) {
            const vals = e.history.map((p) => p.value);
            batch.push({ node: <LineChart key={`stat-${hit.id}-${e.label}-${Date.now()}`} values={vals} tone={e.flag ? "down" : "flat"} /> });
            if (e.threshold !== undefined) {
              batch.push([{ t: `  threshold ${e.threshold}`, c: "var(--text-faint)" }]);
            }
          }
          if (e.windowLabel) batch.push([{ t: `  ${e.windowLabel}`, c: "var(--text-faint)" }]);
        }
      }

      emit(batch);
      return;
    }

    if (verb === "movers") {
      const top = [...indicators]
        .filter((i) => i.score !== null)
        .sort((a, b) => Math.abs(b.score as number) - Math.abs(a.score as number))
        .slice(0, 10);
      emit([[{ t: "biggest signals right now", c: "var(--text-dim)" }], ...top.map(indicatorLine)]);
      return;
    }

    if (verb === "bias" || verb === "pillars") {
      const tfId = resolveArg(args, TIMEFRAME_IDS, TF_ALIASES) ?? DEFAULT_TIMEFRAME;
      const scopeId = resolveArg(args, SCOPE_IDS, SCOPE_ALIASES) ?? DEFAULT_ASSET_SCOPE;
      const tf = TIMEFRAMES.find((t) => t.id === tfId)!;
      const scope = ASSET_SCOPES.find((s) => s.id === scopeId)!;
      setBusy(true);
      await Promise.resolve();
      try {
        const bias = computeMacroBias(panels, { historyDays: tf.days, horizon: tf.horizon, indicatorWeights: scope.indicatorWeights });
        emit([
          [{ t: `MACRO BIAS  ·  ${tf.label}  ·  ${scope.label}`, c: "var(--text-dim)" }],
          [
            { t: pad("Overall", 30), c: "var(--text)" },
            { t: `${strengthTag(bias.overall.strength).padEnd(8)} `, c: "var(--text-faint)" },
            scoreToken(bias.overall.score, bias.overall.tone),
          ],
          ...bias.pillars.flatMap((p) => pillarLines(p, verb === "bias")),
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (verb === "replay") {
      const date = args.find((a) => DATE_RE.test(a));
      if (!date) {
        emit([[{ t: "usage: replay <YYYY-MM-DD> [tf] [scope]", c: "var(--text-faint)" }]]);
        return;
      }
      if (date > today()) {
        emit([[{ t: "date can't be in the future", c: "var(--down)" }]]);
        return;
      }
      const tfId = resolveArg(args, TIMEFRAME_IDS, TF_ALIASES) ?? DEFAULT_TIMEFRAME;
      const scopeId = resolveArg(args, SCOPE_IDS, SCOPE_ALIASES) ?? DEFAULT_ASSET_SCOPE;
      const tf = TIMEFRAMES.find((t) => t.id === tfId)!;
      const scope = ASSET_SCOPES.find((s) => s.id === scopeId)!;
      setBusy(true);
      await Promise.resolve();
      try {
        const bias = computeMacroBias(panels, {
          historyDays: tf.days,
          horizon: tf.horizon,
          indicatorWeights: scope.indicatorWeights,
          asOfDate: date,
        });
        emit([
          [{ t: `REPLAY  ·  ${date}  ·  ${tf.label}  ·  ${scope.label}`, c: "var(--text-dim)" }],
          [
            { t: pad("Overall", 30), c: "var(--text)" },
            { t: `${strengthTag(bias.overall.strength).padEnd(8)} `, c: "var(--text-faint)" },
            scoreToken(bias.overall.score, bias.overall.tone),
          ],
          ...bias.pillars.map((p) => pillarLines(p, false)[0]),
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (verb === "regime" || verb === "fingerprint") {
      const date = args.find((a) => DATE_RE.test(a)) ?? today();
      if (date > today()) {
        emit([[{ t: "date can't be in the future", c: "var(--down)" }]]);
        return;
      }
      setBusy(true);
      await Promise.resolve();
      try {
        const matches = findSimilarRegimes(panels, date, { topN: 8 });
        lastMatchesRef.current = matches;
        if (matches.length === 0) {
          emit([[{ t: "not enough comparable history to cluster yet", c: "var(--text-faint)" }]]);
          return;
        }
        emit([
          [{ t: `REGIME FINGERPRINT  ·  target ${date}`, c: "var(--text-dim)" }],
          [{ t: "closest historical matches (Euclidean, 7-pillar)", c: "var(--text-faint)" }],
          ...matches.map(
            (m, i): Token[] => [
              { t: `  ${i + 1}. `, c: "var(--text-faint)" },
              { t: m.date.padEnd(12), c: "var(--text)" },
              { t: `dist ${m.distance.toFixed(3)}`, c: "var(--text-dim)" },
            ]
          ),
          [{ t: "type: footprint <1-8> to see what happened that day", c: "var(--text-faint)" }],
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (verb === "footprint") {
      const n = parseInt(args[0], 10);
      const matches = lastMatchesRef.current;
      if (matches.length === 0) {
        emit([[{ t: "run regime first", c: "var(--text-faint)" }]]);
        return;
      }
      const match = matches[n - 1];
      if (!match) {
        emit([[{ t: `usage: footprint <1-${matches.length}>`, c: "var(--text-faint)" }]]);
        return;
      }
      const report: ReportLine[] = buildDateReport(panels, markets, match.date);
      emit([
        [{ t: `${match.date}  ·  1-day returns  ·  dist ${match.distance.toFixed(3)}`, c: "var(--text-dim)" }],
        ...report.map(
          (r): Token[] => [
            { t: pad(r.label, 24), c: "var(--text)" },
            r.dailyReturnPct === null
              ? { t: "—", c: "var(--text-faint)" }
              : { t: `${r.dailyReturnPct > 0 ? "+" : ""}${r.dailyReturnPct.toFixed(2)}%`, c: r.dailyReturnPct > 0 ? "var(--up)" : r.dailyReturnPct < 0 ? "var(--down)" : "var(--text-faint)" },
          ]
        ),
      ]);
      return;
    }

    if (verb === "news") {
      const arg = args.join(" ").toUpperCase();
      const symbolMatch = MARKET_SYMBOLS.find((m) => m.symbol.toUpperCase() === arg || m.label.toLowerCase().includes(arg.toLowerCase()));
      const seriesId = symbolMatch ? `asset-news:${symbolMatch.symbol}` : "geo:news-feed";
      const feed = allSeries.find((s) => s.id === seriesId);
      const headlines = feed?.payload?.headlines ?? [];
      if (headlines.length === 0) {
        emit([[{ t: symbolMatch ? `no feed yet for ${symbolMatch.label}` : "no headlines yet", c: "var(--text-faint)" }]]);
        return;
      }
      emit([
        [{ t: symbolMatch ? `NEWS  ·  ${symbolMatch.label}` : "NEWS  ·  general macro feed", c: "var(--text-dim)" }],
        ...headlines.slice(0, 10).flatMap((h): Token[][] => {
          const day = new Date(h.pubDate);
          const dayStr = Number.isNaN(day.getTime()) ? "" : day.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const tag = h.sentimentLabel.toUpperCase().slice(0, 4);
          return [
            [
              { t: `[${tag}] `, c: sentimentColor[h.sentimentLabel] },
              { t: dayStr.padEnd(7), c: "var(--text-faint)" },
              { t: h.title, c: "var(--text)" },
            ],
          ];
        }),
      ]);
      return;
    }

    if (verb === "calendar") {
      const windowDays = parseInt(args[0], 10) || 30;
      const events = getCalendarEvents(panels);
      const now = today();
      const cutoff = new Date(Date.now() + windowDays * 86400000).toISOString().slice(0, 10);
      const past = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
      const relevant = events.filter((e) => e.date >= past && e.date <= cutoff).sort((a, b) => a.date.localeCompare(b.date));
      if (relevant.length === 0) {
        emit([[{ t: "no releases in that window", c: "var(--text-faint)" }]]);
        return;
      }
      emit([
        [{ t: `CALENDAR  ·  ±${windowDays}d`, c: "var(--text-dim)" }],
        ...relevant.map((e): Token[] => {
          const isFuture = e.date > now;
          const beatMiss =
            e.actual !== undefined && e.actual !== null && e.previous !== undefined && e.previous !== null
              ? e.actual > e.previous
                ? "▲"
                : e.actual < e.previous
                  ? "▼"
                  : "="
              : "";
          return [
            { t: pad(e.date, 12), c: isFuture ? "var(--text)" : "var(--text-dim)" },
            { t: `[${e.importance.toUpperCase().slice(0, 3)}] `, c: importanceColor(e.importance) },
            { t: pad(e.label, 32), c: "var(--text)" },
            beatMiss ? { t: beatMiss, c: beatMiss === "▲" ? "var(--up)" : beatMiss === "▼" ? "var(--down)" : "var(--text-faint)" } : { t: "" },
          ];
        }),
      ]);
      return;
    }

    if (verb === "docs" || verb === "doc") {
      const arg = args.join(" ");
      if (!arg) {
        emit([[{ t: "usage: docs <term>  e.g. docs cpi", c: "var(--text-faint)" }]]);
        return;
      }
      const hitId = Object.keys(INDICATOR_DOCS).find((id) => {
        const s = allSeries.find((x) => x.id === id);
        return id.toLowerCase().includes(arg) || (s && s.name.toLowerCase().includes(arg));
      });
      if (!hitId) {
        emit([[{ t: `no documentation matching "${arg}"`, c: "var(--down)" }]]);
        return;
      }
      const s = allSeries.find((x) => x.id === hitId);
      emit([
        [{ t: s?.name ?? hitId, c: "var(--text)" }],
        ...wrap(INDICATOR_DOCS[hitId], 68).map((l): Token[] => [{ t: l, c: "var(--text-dim)" }]),
      ]);
      return;
    }

    const guess = KNOWN_VERBS.find((v) => v.startsWith(rawVerb) || rawVerb.startsWith(v));
    emit([
      guess
        ? [{ t: `unknown command: ${rawVerb}`, c: "var(--down)" }, { t: `   did you mean "${guess}"?`, c: "var(--text-faint)" }]
        : [{ t: `unknown command: ${rawVerb}`, c: "var(--down)" }, { t: "   type help", c: "var(--text-faint)" }],
    ]);
  }

  useEffect(() => {
    emit([
      [{ t: "trifekta terminal", c: "var(--text)" }],
      [
        {
          t: `${indicators.length} indicators · bias · replay · regime fingerprint · news · calendar · docs — all wired in, live.`,
          c: "var(--text-faint)",
        },
      ],
      [{ t: "type help, or tap a command below.", c: "var(--text-faint)" }],
      [{ t: "" }],
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    void run(input);
    setInput("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Tab" && !isEmptyInput && liveSuggestions.length > 0) {
      e.preventDefault();
      setInput(liveSuggestions[0] + " ");
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyPos.current > 0) {
        historyPos.current -= 1;
        setInput(historyRef.current[historyPos.current] ?? "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyPos.current < historyRef.current.length) {
        historyPos.current += 1;
        setInput(historyRef.current[historyPos.current] ?? "");
      }
    }
  }

  function runOrFill(item: MenuItem) {
    if (item.fill) {
      setInput(item.cmd + " ");
    } else {
      void run(item.cmd);
      setInput("");
    }
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[560px] gap-4">
      <div
        className="hud relative flex min-w-0 flex-1 flex-col overflow-hidden border border-[var(--border-strong)] bg-[var(--panel)]"
        style={{ boxShadow: "0 0 60px -20px color-mix(in srgb, var(--text) 18%, transparent)" }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, var(--text-dim), transparent)" }}
        />

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[0.76rem] leading-[1.55]" onClick={() => inputRef.current?.focus()}>
          {lines.map((line) => (
            <div key={line.id} className="terminal-line whitespace-pre-wrap break-words">
              {Array.isArray(line.content)
                ? line.content.map((tok, i) => (
                    <span key={i} style={tok.c ? { color: tok.c } : undefined}>
                      {tok.t}
                    </span>
                  ))
                : <div className="max-w-md py-1">{line.content.node}</div>}
            </div>
          ))}
          {busy && (
            <div className="terminal-line" style={{ color: "var(--text-faint)" }}>
              <span className="animate-pulse">…computing</span>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--border)]">
          {isEmptyInput ? (
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    void run(s);
                    setInput("");
                    inputRef.current?.focus();
                  }}
                  disabled={busy}
                  className="border border-[var(--border)] px-2.5 py-1 font-mono text-[0.64rem] text-[var(--text-dim)] transition-colors duration-150 hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : liveSuggestions.length === 0 ? (
            <div className="px-4 py-2">
              <span className="font-mono text-[0.62rem] text-[var(--text-faint)]">no matches — try help</span>
            </div>
          ) : (
            // Every possible next word, not a truncated top-N — first-time
            // users shouldn't have to guess or memorize. Wrapped chips in a
            // height-capped scroll area keep this compact instead of a tall
            // one-per-row list eating the screen, while still holding every match.
            <div className="flex max-h-20 flex-wrap items-center gap-1 overflow-y-auto px-3 py-1.5">
              {liveSuggestions.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInput(s + " ");
                    inputRef.current?.focus();
                  }}
                  disabled={busy}
                  title={i === 0 ? "Tab to accept" : undefined}
                  className={`border px-1.5 py-0.5 font-mono text-[0.62rem] transition-colors duration-100 hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40 ${
                    i === 0
                      ? "border-[var(--up)] text-[var(--text)]"
                      : "border-[var(--border)] text-[var(--text-dim)]"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-[var(--border-strong)] bg-[var(--panel-2)] px-4 py-3">
          <span className="shrink-0 text-[var(--up)]">›</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
            enterKeyHint="go"
            autoFocus
            aria-label="Terminal command"
            className="w-full bg-transparent font-mono text-[16px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] sm:text-[0.8rem]"
            placeholder="try: bias this month stocks"
          />
          <span className="blink-cursor h-[1em] w-[0.55ch] shrink-0 bg-[var(--text-dim)]" aria-hidden />
        </form>
      </div>

      <aside className="hud hidden w-[30%] max-w-xs shrink-0 flex-col overflow-hidden border border-[var(--border)] bg-[var(--panel)] lg:flex xl:max-w-sm">
        <div className="shrink-0 border-b border-[var(--border)] px-4 py-2.5">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[var(--text-faint)]">Command reference</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {COMMAND_MENU.map((group) => (
            <div key={group.title || "misc"} className="mb-4 last:mb-0">
              {group.title && (
                <div className="mb-1.5 px-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                  {group.title}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <button
                    key={item.cmd}
                    type="button"
                    onClick={() => runOrFill(item)}
                    disabled={busy}
                    className="group flex flex-col items-start gap-0.5 px-2 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--panel-2)] disabled:opacity-40"
                  >
                    <span className="font-mono text-[0.7rem] text-[var(--text)] group-hover:text-[var(--up)]">
                      {item.cmd}
                      {item.fill && <span className="ml-1 text-[var(--text-faint)]">…</span>}
                    </span>
                    <span className="font-sans text-[0.65rem] leading-tight text-[var(--text-faint)]">{item.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-2 border-t border-[var(--border)] px-1 pt-3 font-sans text-[0.62rem] leading-relaxed text-[var(--text-faint)]">
            Type plain English too — words like <em>week</em>, <em>quarter</em>, <em>stocks</em>, <em>gold</em> all
            resolve on their own. Click anything above to run it, or to drop it into the command line if it needs a
            name or date.
          </div>
        </div>
      </aside>
    </div>
  );
}
