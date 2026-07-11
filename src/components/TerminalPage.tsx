"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MacroPanel, MacroSeries } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import { getSignTone } from "@/lib/bias";
import { computeMacroBias, TIMEFRAMES, ASSET_SCOPES, DEFAULT_TIMEFRAME, DEFAULT_ASSET_SCOPE, type PillarResult } from "@/lib/macroBias";
import { findSimilarRegimes, buildDateReport, type SimilarRegime, type ReportLine } from "@/lib/regimeFingerprint";
import { getCalendarEvents } from "@/lib/econCalendar";
import { INDICATOR_DOCS } from "@/lib/indicatorDocs";
import { MARKET_SYMBOLS } from "@/lib/markets";

/*
 * Command-line entry point into every page the desk has: Board (every
 * indicator), Macro Bias, Replay, Regime Fingerprint, News, Calendar, and
 * Documentation. All computed client-side straight off the already-loaded
 * panels/markets — same data, same libs those pages use, so this can never
 * drift out of sync with what they show.
 */

type Token = { t: string; c?: string };
type Line = { id: number; tokens: Token[] };

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
  lookup: "read", find: "read", search: "read",
  cluster: "regime", similar: "regime", fingerprint: "regime", match: "regime", matches: "regime",
  cal: "calendar", releases: "calendar", schedule: "calendar",
  explain: "docs", about: "docs", doc: "docs", info: "docs", learn: "docs",
  chart: "graph", plot: "graph", trend: "graph", history: "graph",
  reset: "clear", cls: "clear",
  "?": "help", commands: "help",
};

const KNOWN_VERBS = [
  "scan", "read", "graph", "stats", "movers",
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

/** Compact 8-level block sparkline, scaled min→max over the given values. */
function asciiSparkline(values: number[]): string {
  const blocks = "▁▂▃▄▅▆▇█";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v) => blocks[Math.min(7, Math.floor(((v - min) / span) * 8))]).join("");
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

const SUGGESTIONS = ["bias", "bias this month stocks", "news", "calendar", "docs cpi", "graph vix", "help"];

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
      return KNOWN_VERBS.filter((v) => v.startsWith(rawFirst)).slice(0, 6);
    }

    const verb = VERB_ALIASES[rawFirst] ?? rawFirst;
    const argQuery = words.slice(1).join(" ").toLowerCase();

    if (verb === "read" || verb === "stats" || verb === "graph" || verb === "docs") {
      const pool = verb === "docs" ? allSeries.filter((s) => INDICATOR_DOCS[s.id]) : allSeries;
      return pool
        .filter((s) => s.name.toLowerCase().includes(argQuery))
        .slice(0, 6)
        .map((s) => `${rawFirst} ${s.name}`);
    }
    if (verb === "scan") {
      return categories
        .filter((c) => c.toLowerCase().includes(argQuery))
        .slice(0, 6)
        .map((c) => `scan ${c.toLowerCase()}`);
    }
    if (verb === "news") {
      return MARKET_SYMBOLS.filter(
        (m) => m.label.toLowerCase().includes(argQuery) || m.symbol.toLowerCase().includes(argQuery)
      )
        .slice(0, 6)
        .map((m) => `news ${m.symbol}`);
    }
    if (verb === "bias" || verb === "pillars" || verb === "replay") {
      const lastWord = words[words.length - 1]?.toLowerCase() ?? "";
      if (endsWithSpace || lastWord.length === 0) return [];
      const wordPool = [...Object.keys(TF_ALIASES), ...TIMEFRAME_IDS, ...Object.keys(SCOPE_ALIASES), ...SCOPE_IDS];
      const matches = wordPool.filter((w) => w.startsWith(lastWord) && w !== lastWord).slice(0, 6);
      return matches.map((w) => [...words.slice(0, -1), w].join(" "));
    }
    return [];
  }, [input, isEmptyInput, allSeries, categories]);

  const nextId = () => ++idRef.current;
  const emit = (batch: Token[][]) =>
    setLines((prev) => [...prev, ...batch.map((tokens) => ({ id: nextId(), tokens }))]);

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
        [{ t: "  read <name>", c: "var(--text)" }, { t: "           look up any indicator's live read", c: "var(--text-faint)" }],
        [{ t: "  graph <name>", c: "var(--text)" }, { t: "          trend chart for any indicator", c: "var(--text-faint)" }],
        [{ t: "  stats <name>", c: "var(--text)" }, { t: "          extra stats behind that indicator's card", c: "var(--text-faint)" }],
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

    if (verb === "read" || verb === "get") {
      const arg = args.join(" ");
      if (!arg) {
        emit([[{ t: "usage: read <name>  e.g. read cpi", c: "var(--text-faint)" }]]);
        return;
      }
      const hits = indicators.filter((i) => i.name.toLowerCase().includes(arg) || i.id.toLowerCase().includes(arg));
      if (hits.length === 0) {
        emit([[{ t: `no indicator matching "${arg}"`, c: "var(--down)" }]]);
        return;
      }
      const shown = hits.slice(0, 10);
      emit([
        ...shown.map(indicatorLine),
        ...(shown.length === 1 ? [[{ t: shown[0].note, c: "var(--text-faint)" }] as Token[]] : []),
        ...(hits.length > shown.length ? [[{ t: `…${hits.length - shown.length} more`, c: "var(--text-faint)" }] as Token[]] : []),
      ]);
      return;
    }

    if (verb === "stats") {
      const arg = args.join(" ");
      if (!arg) {
        emit([[{ t: "usage: stats <name>  e.g. stats cpi", c: "var(--text-faint)" }]]);
        return;
      }
      const hit = allSeries.find((s) => s.name.toLowerCase().includes(arg) || s.id.toLowerCase().includes(arg));
      if (!hit) {
        emit([[{ t: `no indicator matching "${arg}"`, c: "var(--down)" }]]);
        return;
      }
      const extra = hit.extraStats ?? [];
      emit([
        [{ t: hit.name, c: "var(--text)" }, { t: `  ${hit.windowLabel ?? ""}`, c: "var(--text-faint)" }],
        [{ t: `source: ${hit.source}`, c: "var(--text-faint)" }],
        ...(extra.length === 0
          ? [[{ t: "no extra stats stored for this indicator", c: "var(--text-faint)" }] as Token[]]
          : extra.map(
              (e): Token[] => [
                { t: pad(e.label, 26), c: "var(--text-dim)" },
                { t: e.value, c: e.flag ? "var(--down)" : "var(--text)" },
                ...(e.caption ? [{ t: `  ${e.caption}`, c: "var(--text-faint)" }] : []),
              ]
            )),
      ]);
      return;
    }

    if (verb === "graph") {
      const arg = args.join(" ");
      if (!arg) {
        emit([[{ t: "usage: graph <name>  e.g. graph cpi", c: "var(--text-faint)" }]]);
        return;
      }
      const hit = allSeries.find((s) => s.name.toLowerCase().includes(arg) || s.id.toLowerCase().includes(arg));
      if (!hit) {
        emit([[{ t: `no indicator matching "${arg}"`, c: "var(--down)" }]]);
        return;
      }
      const series = hit.sparkline && hit.sparkline.length >= 5 ? hit.sparkline : (hit.history ?? []).map((p) => p.value);
      if (series.length < 5) {
        emit([[{ t: `not enough history to chart ${hit.name} yet`, c: "var(--text-faint)" }]]);
        return;
      }
      const first = series[0];
      const last = series[series.length - 1];
      const changePct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
      emit([
        [{ t: hit.name, c: "var(--text)" }, { t: `  ${hit.windowLabel ?? ""}`, c: "var(--text-faint)" }],
        [
          { t: asciiSparkline(series), c: changePct >= 0 ? "var(--up)" : "var(--down)" },
        ],
        [
          { t: `low ${Math.min(...series).toFixed(2)}`, c: "var(--text-faint)" },
          { t: "   " },
          { t: `high ${Math.max(...series).toFixed(2)}`, c: "var(--text-faint)" },
          { t: "   " },
          { t: `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}% over window`, c: changePct >= 0 ? "var(--up)" : "var(--down)" },
        ],
      ]);
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

  return (
    <div
      className="hud relative flex h-[calc(100vh-11rem)] min-h-[520px] flex-col overflow-hidden border border-[var(--border-strong)] bg-[var(--panel)]"
      style={{ boxShadow: "0 0 60px -20px color-mix(in srgb, var(--text) 18%, transparent)" }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, var(--text-dim), transparent)" }}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[0.76rem] leading-[1.55]" onClick={() => inputRef.current?.focus()}>
        {lines.map((line) => (
          <div key={line.id} className="terminal-line whitespace-pre-wrap break-words">
            {line.tokens.map((tok, i) => (
              <span key={i} style={tok.c ? { color: tok.c } : undefined}>
                {tok.t}
              </span>
            ))}
          </div>
        ))}
        {busy && (
          <div className="terminal-line" style={{ color: "var(--text-faint)" }}>
            <span className="animate-pulse">…computing</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--border)] px-4 py-2">
        {liveSuggestions.length === 0 ? (
          <span className="font-mono text-[0.62rem] text-[var(--text-faint)]">no matches — try help</span>
        ) : (
          liveSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                if (isEmptyInput) {
                  void run(s);
                  setInput("");
                } else {
                  setInput(s + " ");
                }
                inputRef.current?.focus();
              }}
              disabled={busy}
              className="border border-[var(--border)] px-2.5 py-1 font-mono text-[0.64rem] text-[var(--text-dim)] transition-colors duration-150 hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40"
            >
              {s}
            </button>
          ))
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
  );
}
