import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { fetchFredHistory, statusFromDelta, fmt } from "@/lib/fred";
import { fetchCotSeries, cotIndex, fmtNet, COT_CODES, type CotPoint } from "@/lib/cftc";
import { fetchYahooHistory, ratioSeriesDated, toDatedSeries } from "@/lib/yahoo";
import { fetchNewsFeed, fetchAssetNewsFeed, weightedSentimentAvg } from "@/lib/news";
import {
  computeStats,
  lastValidPair,
  annualizedChange,
  avgChange,
  sahmRule,
  sahmRuleHistory,
  annualizedChangeHistory,
  avgChangeHistory,
  subtractHistory,
  movingAverage,
  inferCadence,
  type HistPoint,
} from "@/lib/stats";
import { computeIndicatorSignal } from "@/lib/indicatorSignal";
import type { ExtraStat, SeriesPayload } from "@/lib/macroData";
import { MARKET_SYMBOLS, marketRowId } from "@/lib/markets";

export const dynamic = "force-dynamic";

interface UpsertRow {
  id: string;
  panel_id: string;
  name: string;
  note: string;
  value: string;
  status: "up" | "down" | "flat" | "pending";
  source: string;
  zscore: number | null;
  sparkline: number[] | null;
  window_label: string | null;
  history?: HistPoint[] | null;
  extra_stats?: ExtraStat[] | null;
  payload?: SeriesPayload | null;
  updated_at?: string;
}

/** Rows that older versions of this route wrote and the app no longer reads. */
const STALE_ROW_IDS = [
  "cot:equities",
  "cot:treasury",
  "cot:commodities-dxy",
  "transmission:copper-crude",
  "transmission:walcl",
  "geo:news",
];

function toHistory(dates: string[], values: (number | null)[]): HistPoint[] {
  const out: HistPoint[] = [];
  dates.forEach((d, i) => {
    const v = values[i];
    if (v !== null && !Number.isNaN(v)) out.push({ date: d, value: v });
  });
  return out;
}

/**
 * The `zscore` column stores the METHOD-BASED indicator score, -1..1 (see
 * indicatorSignal.ts: positioning / momentum / anchor / threshold, whichever
 * fits the series economically). Not a z-score — the column name is legacy.
 */
function signalStats(seriesId: string, history: HistPoint[]): { signal: number | null; sparkline: number[] | null } {
  const spark = history.slice(-30).map((p) => p.value);
  const cadence = inferCadence(history).cadence;
  const sig = computeIndicatorSignal(seriesId, history.map((p) => p.value), cadence);
  return { signal: sig?.score ?? null, sparkline: spark.length >= 5 ? spark : null };
}

/** Plain YoY % change history for a series at any cadence (periodsPerYear apart). */
function yoyHistory(hist: HistPoint[], periodsPerYear: number): HistPoint[] {
  const out: HistPoint[] = [];
  for (let i = periodsPerYear; i < hist.length; i++) {
    const prior = hist[i - periodsPerYear].value;
    if (prior !== 0) out.push({ date: hist[i].date, value: (hist[i].value / prior - 1) * 100 });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const fredKey = process.env.FRED_API_KEY;
  if (!fredKey) {
    return NextResponse.json({ error: "FRED_API_KEY not set" }, { status: 500 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase service role not configured" }, { status: 500 });
  }

  const rows: UpsertRow[] = [];

  try {
    // ================= US MACRO =================

    // ---- H.4.1 Fed Balance Sheet (WALCL, weekly, $ millions -> $T) ----
    const walclHist = await fetchFredHistory("WALCL", fredKey, 520);
    const walclNums = walclHist.map((p) => (p.value === null ? null : p.value / 1_000_000));
    const [walclLatest, walclPrev] = lastValidPair(walclNums);
    const walclHistory = toHistory(walclHist.map((p) => p.date), walclNums);
    const walclSig = signalStats("us-macro:h41-balance-sheet", walclHistory);
    const walcl4wAnn = annualizedChange(walclNums, 4);
    const walcl13wAnn = annualizedChange(walclNums, 13);
    const walcl13wHist = annualizedChangeHistory(walclHistory, 13);
    const walcl13wStats = computeStats(walcl13wHist.map((p) => p.value));
    rows.push({
      id: "us-macro:h41-balance-sheet",
      panel_id: "us-macro",
      name: "H.4.1 Fed Balance Sheet",
      note: "Weekly, Fed H.4.1 release",
      value: fmt(walclLatest, { decimals: 3, suffix: "T" }),
      status: statusFromDelta(walclLatest, walclPrev),
      source: "FRED WALCL",
      zscore: walclSig.signal,
      sparkline: walclSig.sparkline,
      window_label: "10y weekly · momentum 13w",
      history: walclHistory,
      extra_stats: [
        { label: "4w pace (annualized)", value: walcl4wAnn === null ? "—" : `${walcl4wAnn > 0 ? "+" : ""}${walcl4wAnn.toFixed(1)}%` },
        {
          label: "13w pace (annualized)",
          value: walcl13wAnn === null ? "—" : `${walcl13wAnn > 0 ? "+" : ""}${walcl13wAnn.toFixed(1)}%`,
          flag: walcl13wAnn !== null && walcl13wAnn <= -5,
          caption: "Annualized 13-week pace of balance sheet change — the cleanest read on whether QT or QE is actively running.",
          history: walcl13wHist,
          zscore: walcl13wStats.zscore,
          threshold: -5,
          windowLabel: "10y weekly",
        },
      ],
    });

    // ---- Funding rate stack (SOFR / EFFR / IORB) ----
    const [sofrHist, effrHist, iorbHist] = await Promise.all([
      fetchFredHistory("SOFR", fredKey, 750),
      fetchFredHistory("EFFR", fredKey, 750),
      fetchFredHistory("IORB", fredKey, 750),
    ]);
    const sofrNums = sofrHist.map((p) => p.value);
    const effrNums = effrHist.map((p) => p.value);
    const iorbNums = iorbHist.map((p) => p.value);
    const [sofrV] = lastValidPair(sofrNums);
    const [effrV] = lastValidPair(effrNums);
    const [iorbV] = lastValidPair(iorbNums);
    const sofrIorbBps = sofrV !== null && iorbV !== null ? (sofrV - iorbV) * 100 : null;
    const effrIorbBps = effrV !== null && iorbV !== null ? (effrV - iorbV) * 100 : null;
    const sofrHistoryPts = toHistory(sofrHist.map((p) => p.date), sofrNums);
    const iorbHistoryPts = toHistory(iorbHist.map((p) => p.date), iorbNums);
    const sofrIorbSpreadHist = subtractHistory(sofrHistoryPts, iorbHistoryPts).map((p) => ({ date: p.date, value: p.value * 100 }));
    const spreadSig = signalStats("us-macro:sofr-effr-iorb", sofrIorbSpreadHist);
    const sofrIorbStats = computeStats(sofrIorbSpreadHist.map((p) => p.value));
    const effrHistoryPts = toHistory(effrHist.map((p) => p.date), effrNums);
    const effrIorbSpreadHist = subtractHistory(effrHistoryPts, iorbHistoryPts).map((p) => ({ date: p.date, value: p.value * 100 }));
    const effrIorbStats = computeStats(effrIorbSpreadHist.map((p) => p.value));
    rows.push({
      id: "us-macro:sofr-effr-iorb",
      panel_id: "us-macro",
      name: "SOFR / EFFR / IORB",
      note: "Funding stress — signal reads the SOFR−IORB spread",
      value: `${fmt(sofrV, { suffix: "%" })} / ${fmt(effrV, { suffix: "%" })} / ${fmt(iorbV, { suffix: "%" })}`,
      status: statusFromDelta(sofrIorbBps, sofrIorbSpreadHist.length > 1 ? sofrIorbSpreadHist[sofrIorbSpreadHist.length - 2].value : null),
      source: "FRED SOFR/EFFR/IORB",
      zscore: spreadSig.signal,
      sparkline: spreadSig.sparkline,
      window_label: "3y daily · anchor 0bp",
      history: sofrIorbSpreadHist,
      extra_stats: [
        {
          label: "SOFR − IORB (bps)",
          value: sofrIorbBps === null ? "—" : `${sofrIorbBps > 0 ? "+" : ""}${sofrIorbBps.toFixed(0)}bp`,
          flag: sofrIorbBps !== null && sofrIorbBps >= 10,
          caption: "Repo/funding stress gauge — SOFR printing meaningfully above IORB signals collateral or cash scarcity.",
          history: sofrIorbSpreadHist,
          zscore: sofrIorbStats.zscore,
          threshold: 10,
          windowLabel: "3y daily",
        },
        {
          label: "EFFR − IORB (bps)",
          value: effrIorbBps === null ? "—" : `${effrIorbBps > 0 ? "+" : ""}${effrIorbBps.toFixed(0)}bp`,
          caption: "Effective fed funds vs IORB — a second read on funding conditions alongside SOFR.",
          history: effrIorbSpreadHist,
          zscore: effrIorbStats.zscore,
          windowLabel: "3y daily",
        },
      ],
    });

    // ---- HY credit spread ----
    const hyHist = await fetchFredHistory("BAMLH0A0HYM2", fredKey, 750);
    const hyNums = hyHist.map((p) => p.value);
    const [hyLatest, hyPrev] = lastValidPair(hyNums);
    const impliedDefault = (spreadPct: number) => (1 - Math.pow(1 - spreadPct / 100 / (1 - 0.4), 5)) * 100;
    const impliedDefault5y = hyLatest === null ? null : impliedDefault(hyLatest);
    const hyHistoryPts = toHistory(hyHist.map((p) => p.date), hyNums);
    const hySig = signalStats("us-macro:hy-credit-spread", hyHistoryPts);
    const impliedDefaultHist = hyHistoryPts.map((p) => ({ date: p.date, value: impliedDefault(p.value) }));
    const impliedDefaultStats = computeStats(impliedDefaultHist.map((p) => p.value));
    rows.push({
      id: "us-macro:hy-credit-spread",
      panel_id: "us-macro",
      name: "High Yield Credit Spread",
      note: "ICE BofA HY OAS",
      value: fmt(hyLatest, { suffix: "%" }),
      status: statusFromDelta(hyLatest, hyPrev),
      history: hyHistoryPts,
      source: "FRED BAMLH0A0HYM2",
      zscore: hySig.signal,
      sparkline: hySig.sparkline,
      window_label: "3y daily · anchor 4%",
      extra_stats: [
        {
          label: "Implied 5y default rate",
          value: impliedDefault5y === null ? "—" : `≈${impliedDefault5y.toFixed(1)}%`,
          caption: "Back-solved from the spread assuming 40% recovery — the standard HY convention. Rises well before actual defaults do.",
          history: impliedDefaultHist,
          zscore: impliedDefaultStats.zscore,
          windowLabel: "3y daily",
        },
        { label: "Recovery assumption", value: "40% (HY convention)" },
      ],
    });

    // ---- Inflation trio: headline CPI, core CPI, core PCE (all YoY vs 2% target) ----
    const [cpiHist, coreCpiHist, corePceHist] = await Promise.all([
      fetchFredHistory("CPIAUCSL", fredKey, 240),
      fetchFredHistory("CPILFESL", fredKey, 240),
      fetchFredHistory("PCEPILFE", fredKey, 240),
    ]);

    const cpiIndexHistoryPts = toHistory(cpiHist.map((p) => p.date), cpiHist.map((p) => p.value));
    const cpiYoy = yoyHistory(cpiIndexHistoryPts, 12);
    const cpiSig = signalStats("us-macro:cpi-yoy", cpiYoy);
    const [cpiLatest, cpiPrev] = lastValidPair(cpiYoy.map((p): number | null => p.value));
    const cpiIndexNums = cpiHist.map((p) => p.value);
    const cpi3mAnn = annualizedChange(cpiIndexNums, 3);
    const cpi6mAnn = annualizedChange(cpiIndexNums, 6);
    const cpi3mHist = annualizedChangeHistory(cpiIndexHistoryPts, 3);
    const cpi6mHist = annualizedChangeHistory(cpiIndexHistoryPts, 6);
    const cpi3mStats = computeStats(cpi3mHist.map((p) => p.value));
    const cpi6mStats = computeStats(cpi6mHist.map((p) => p.value));
    rows.push({
      id: "us-macro:cpi-yoy",
      panel_id: "us-macro",
      name: "CPI Inflation (YoY)",
      note: "Headline CPI, year-over-year",
      value: fmt(cpiLatest, { suffix: "%" }),
      status: statusFromDelta(cpiLatest, cpiPrev),
      source: "FRED CPIAUCSL (derived YoY)",
      zscore: cpiSig.signal,
      sparkline: cpiSig.sparkline,
      window_label: "15y monthly · anchor 2%",
      history: cpiYoy,
      extra_stats: [
        {
          label: "3m annualized",
          value: cpi3mAnn === null ? "—" : `${cpi3mAnn > 0 ? "+" : ""}${cpi3mAnn.toFixed(1)}%`,
          flag: cpi3mAnn !== null && cpiLatest !== null && cpi3mAnn > cpiLatest + 1,
          caption: "3-month annualized rate — the most forward-looking read on where inflation momentum is heading, vs YoY which is backward-looking.",
          history: cpi3mHist,
          zscore: cpi3mStats.zscore,
          windowLabel: "15y monthly",
        },
        {
          label: "6m annualized",
          value: cpi6mAnn === null ? "—" : `${cpi6mAnn > 0 ? "+" : ""}${cpi6mAnn.toFixed(1)}%`,
          history: cpi6mHist,
          zscore: cpi6mStats.zscore,
          windowLabel: "15y monthly",
        },
      ],
    });

    const inflationRow = (
      id: string,
      name: string,
      note: string,
      source: string,
      indexHist: { date: string; value: number | null }[]
    ): UpsertRow | null => {
      const pts = toHistory(indexHist.map((p) => p.date), indexHist.map((p) => p.value));
      const yoy = yoyHistory(pts, 12);
      if (yoy.length < 10) return null;
      const sig = signalStats(id, yoy);
      const latest = yoy[yoy.length - 1].value;
      const prev = yoy[yoy.length - 2]?.value ?? null;
      return {
        id,
        panel_id: "us-macro",
        name,
        note,
        value: `${latest.toFixed(2)}%`,
        status: statusFromDelta(latest, prev),
        source,
        zscore: sig.signal,
        sparkline: sig.sparkline,
        window_label: "15y monthly · anchor 2%",
        history: yoy,
        extra_stats: [
          {
            label: "Distance from 2% target",
            value: `${latest - 2 > 0 ? "+" : ""}${(latest - 2).toFixed(2)}pp`,
            flag: latest - 2 >= 0.5,
            caption: "The number the Fed's reaction function actually keys off — not where inflation sits vs its own history.",
            threshold: 0,
          },
        ],
      };
    };
    const coreCpiRow = inflationRow("us-macro:core-cpi", "Core CPI (YoY)", "Ex food & energy — the sticky part", "FRED CPILFESL (derived YoY)", coreCpiHist);
    if (coreCpiRow) rows.push(coreCpiRow);
    const corePceRow = inflationRow("us-macro:core-pce", "Core PCE (YoY)", "The Fed's actual target metric", "FRED PCEPILFE (derived YoY)", corePceHist);
    if (corePceRow) rows.push(corePceRow);

    // ---- Unemployment rate ----
    const unrateHist = await fetchFredHistory("UNRATE", fredKey, 240);
    const unrateNums = unrateHist.map((p) => p.value);
    const [unrateLatest, unratePrev] = lastValidPair(unrateNums);
    const sahm = sahmRule(unrateNums);
    const unrateHistoryPts = toHistory(unrateHist.map((p) => p.date), unrateNums);
    const unrateSig = signalStats("us-macro:unemployment", unrateHistoryPts);
    const sahmHist = sahmRuleHistory(unrateHistoryPts);
    const sahmStats = computeStats(sahmHist.map((p) => p.value));
    rows.push({
      id: "us-macro:unemployment",
      panel_id: "us-macro",
      name: "Unemployment Rate",
      note: "U-3 headline unemployment",
      value: fmt(unrateLatest, { suffix: "%" }),
      status: statusFromDelta(unrateLatest, unratePrev),
      source: "FRED UNRATE",
      zscore: unrateSig.signal,
      sparkline: unrateSig.sparkline,
      window_label: "20y monthly · anchor 4.2% (NAIRU)",
      history: unrateHistoryPts,
      extra_stats: [
        {
          label: "Sahm Rule indicator",
          value: sahm.value === null ? "—" : `${sahm.value.toFixed(2)}pp`,
          flag: sahm.triggered,
          caption: "3-month avg unemployment minus its own 12-month low. ≥0.50pp has historically meant a recession is already underway.",
          history: sahmHist,
          zscore: sahmStats.zscore,
          threshold: 0.5,
          windowLabel: "20y monthly",
        },
        { label: "Recession trigger at", value: "≥0.50pp" },
      ],
    });

    // ---- Nonfarm payrolls (stored series = 3m avg monthly gain) ----
    const payemsHist = await fetchFredHistory("PAYEMS", fredKey, 240);
    const payemsNums = payemsHist.map((p) => p.value);
    const [payemsLatest, payemsPrev] = lastValidPair(payemsNums);
    const payems3mAvg = avgChange(payemsNums, 3);
    const payems6mAvg = avgChange(payemsNums, 6);
    const payemsHistoryPts = toHistory(payemsHist.map((p) => p.date), payemsNums);
    const payems3mHist = avgChangeHistory(payemsHistoryPts, 3);
    const payems6mHist = avgChangeHistory(payemsHistoryPts, 6);
    const payemsSig = signalStats("us-macro:payrolls", payems3mHist);
    const payems3mStats = computeStats(payems3mHist.map((p) => p.value));
    const payems6mStats = computeStats(payems6mHist.map((p) => p.value));
    rows.push({
      id: "us-macro:payrolls",
      panel_id: "us-macro",
      name: "Nonfarm Payrolls",
      note: "3m average monthly gain",
      value: payems3mAvg === null ? fmt(payemsLatest, { decimals: 0 }) : `${payems3mAvg > 0 ? "+" : ""}${payems3mAvg.toFixed(0)}k/mo`,
      status: statusFromDelta(payemsLatest, payemsPrev),
      source: "FRED PAYEMS",
      zscore: payemsSig.signal,
      sparkline: payemsSig.sparkline,
      window_label: "20y monthly · anchor +100k/mo",
      history: payems3mHist,
      extra_stats: [
        {
          label: "3m avg monthly gain",
          value: payems3mAvg === null ? "—" : `${payems3mAvg > 0 ? "+" : ""}${payems3mAvg.toFixed(0)}k`,
          flag: payems3mAvg !== null && payems3mAvg < 50,
          caption: "Smooths the noisy single-month print — the standard way traders actually read the labor market's trend.",
          history: payems3mHist,
          zscore: payems3mStats.zscore,
          threshold: 50,
          windowLabel: "20y monthly",
        },
        {
          label: "6m avg monthly gain",
          value: payems6mAvg === null ? "—" : `${payems6mAvg > 0 ? "+" : ""}${payems6mAvg.toFixed(0)}k`,
          history: payems6mHist,
          zscore: payems6mStats.zscore,
          windowLabel: "20y monthly",
        },
        { label: "Total employment", value: fmt(payemsLatest, { decimals: 0, suffix: "k" }) },
      ],
    });

    // ---- Initial jobless claims (weekly) ----
    const icsaHist = await fetchFredHistory("ICSA", fredKey, 520);
    const icsaNums = icsaHist.map((p) => (p.value === null ? null : p.value / 1000));
    const [icsaLatest, icsaPrev] = lastValidPair(icsaNums);
    const icsaHistoryPts = toHistory(icsaHist.map((p) => p.date), icsaNums);
    const icsaSig = signalStats("us-macro:jobless-claims", icsaHistoryPts);
    const icsa4w = movingAverage(icsaNums, 4);
    const icsa4wHist = toHistory(icsaHist.map((p) => p.date), icsa4w);
    const icsa4wLatest = icsa4wHist.length ? icsa4wHist[icsa4wHist.length - 1].value : null;
    const icsa4wStats = computeStats(icsa4wHist.map((p) => p.value));
    rows.push({
      id: "us-macro:jobless-claims",
      panel_id: "us-macro",
      name: "Initial Jobless Claims",
      note: "Weekly — earliest hard labor data",
      value: icsaLatest === null ? "—" : `${icsaLatest.toFixed(0)}k`,
      status: statusFromDelta(icsaLatest, icsaPrev),
      source: "FRED ICSA",
      zscore: icsaSig.signal,
      sparkline: icsaSig.sparkline,
      window_label: "10y weekly · momentum 8w",
      history: icsaHistoryPts,
      extra_stats: [
        {
          label: "4-week average",
          value: icsa4wLatest === null ? "—" : `${icsa4wLatest.toFixed(0)}k`,
          caption: "The standard smoothing for a series that jumps on every holiday week and strike.",
          history: icsa4wHist,
          zscore: icsa4wStats.zscore,
          windowLabel: "10y weekly",
        },
      ],
    });

    // ---- Real GDP YoY (quarterly) ----
    const gdpHist = await fetchFredHistory("GDPC1", fredKey, 120);
    const gdpHistoryPts = toHistory(gdpHist.map((p) => p.date), gdpHist.map((p) => p.value));
    const gdpYoy = yoyHistory(gdpHistoryPts, 4);
    if (gdpYoy.length >= 10) {
      const gdpSig = signalStats("us-macro:gdp", gdpYoy);
      const gdpLatest = gdpYoy[gdpYoy.length - 1].value;
      const gdpPrev = gdpYoy[gdpYoy.length - 2]?.value ?? null;
      rows.push({
        id: "us-macro:gdp",
        panel_id: "us-macro",
        name: "Real GDP (YoY)",
        note: "Judged against ~2% trend growth",
        value: `${gdpLatest > 0 ? "+" : ""}${gdpLatest.toFixed(1)}%`,
        status: statusFromDelta(gdpLatest, gdpPrev),
        source: "FRED GDPC1 (derived YoY)",
        zscore: gdpSig.signal,
        sparkline: gdpSig.sparkline,
        window_label: "30y quarterly · anchor +2%",
        history: gdpYoy,
      });
    }

    // ---- M2 money supply (stored series = YoY growth) ----
    const m2Hist = await fetchFredHistory("M2SL", fredKey, 240);
    const m2Nums = m2Hist.map((p) => (p.value === null ? null : p.value / 1000));
    const [m2Latest, m2Prev] = lastValidPair(m2Nums);
    const m2YoyAnn = annualizedChange(m2Nums, 12);
    const m2HistoryPts = toHistory(m2Hist.map((p) => p.date), m2Nums);
    const m2YoyHist = annualizedChangeHistory(m2HistoryPts, 12);
    const m2Sig = signalStats("us-macro:m2", m2YoyHist);
    const m2YoyStats = computeStats(m2YoyHist.map((p) => p.value));
    rows.push({
      id: "us-macro:m2",
      panel_id: "us-macro",
      name: "M2 Money Supply",
      note: "YoY growth of broad money",
      value: m2YoyAnn === null ? fmt(m2Latest, { decimals: 3, suffix: "T" }) : `${m2YoyAnn > 0 ? "+" : ""}${m2YoyAnn.toFixed(1)}% YoY`,
      status: statusFromDelta(m2Latest, m2Prev),
      source: "FRED M2SL",
      zscore: m2Sig.signal,
      sparkline: m2Sig.sparkline,
      window_label: "20y monthly · anchor +5% YoY",
      history: m2YoyHist,
      extra_stats: [
        {
          label: "YoY growth",
          value: m2YoyAnn === null ? "—" : `${m2YoyAnn > 0 ? "+" : ""}${m2YoyAnn.toFixed(1)}%`,
          flag: m2YoyAnn !== null && m2YoyAnn < 0,
          caption: "Negative YoY M2 growth (2022-23) has historically coincided with tightening credit conditions.",
          history: m2YoyHist,
          zscore: m2YoyStats.zscore,
          threshold: 0,
          windowLabel: "20y monthly",
        },
        { label: "Level", value: fmt(m2Latest, { decimals: 3, suffix: "T" }) },
      ],
    });

    // ---- Reverse repo facility ----
    const rrpHist = await fetchFredHistory("RRPONTSYD", fredKey, 750);
    const rrpNums = rrpHist.map((p) => p.value);
    const [rrpLatest, rrpPrev] = lastValidPair(rrpNums);
    const rrpHistoryPts = toHistory(rrpHist.map((p) => p.date), rrpNums);
    const rrpSig = signalStats("us-macro:reverse-repo", rrpHistoryPts);
    rows.push({
      id: "us-macro:reverse-repo",
      panel_id: "us-macro",
      name: "Reverse Repo (RRP)",
      note: "Liquidity parked at the Fed, $B",
      value: rrpLatest === null ? "—" : `$${rrpLatest.toFixed(0)}B`,
      status: statusFromDelta(rrpLatest, rrpPrev),
      source: "FRED RRPONTSYD",
      zscore: rrpSig.signal,
      sparkline: rrpSig.sparkline,
      window_label: "3y daily · momentum 20d",
      history: rrpHistoryPts,
    });

    // ---- Retail sales YoY ----
    const rsafsHist = await fetchFredHistory("RSAFS", fredKey, 240);
    const rsafsHistoryPts = toHistory(rsafsHist.map((p) => p.date), rsafsHist.map((p) => p.value));
    const rsafsYoy = yoyHistory(rsafsHistoryPts, 12);
    if (rsafsYoy.length >= 10) {
      const rsafsSig = signalStats("us-macro:retail-sales", rsafsYoy);
      const rsafsLatest = rsafsYoy[rsafsYoy.length - 1].value;
      const rsafsPrev = rsafsYoy[rsafsYoy.length - 2]?.value ?? null;
      rows.push({
        id: "us-macro:retail-sales",
        panel_id: "us-macro",
        name: "Retail Sales (YoY)",
        note: "Hard-data consumer confirmation",
        value: `${rsafsLatest > 0 ? "+" : ""}${rsafsLatest.toFixed(1)}%`,
        status: statusFromDelta(rsafsLatest, rsafsPrev),
        source: "FRED RSAFS (derived YoY)",
        zscore: rsafsSig.signal,
        sparkline: rsafsSig.sparkline,
        window_label: "15y monthly · anchor +3%",
        history: rsafsYoy,
      });
    }

    // ---- Housing starts YoY ----
    const houstHist = await fetchFredHistory("HOUST", fredKey, 240);
    const houstHistoryPts = toHistory(houstHist.map((p) => p.date), houstHist.map((p) => p.value));
    const houstYoy = yoyHistory(houstHistoryPts, 12);
    if (houstYoy.length >= 10) {
      const houstSig = signalStats("us-macro:housing-starts", houstYoy);
      const houstLatest = houstYoy[houstYoy.length - 1].value;
      const houstPrev = houstYoy[houstYoy.length - 2]?.value ?? null;
      const houstLevel = houstHistoryPts.length ? houstHistoryPts[houstHistoryPts.length - 1].value : null;
      rows.push({
        id: "us-macro:housing-starts",
        panel_id: "us-macro",
        name: "Housing Starts (YoY)",
        note: "Most rate-sensitive sector",
        value: `${houstLatest > 0 ? "+" : ""}${houstLatest.toFixed(1)}%`,
        status: statusFromDelta(houstLatest, houstPrev),
        source: "FRED HOUST (derived YoY)",
        zscore: houstSig.signal,
        sparkline: houstSig.sparkline,
        window_label: "15y monthly · anchor 0%",
        history: houstYoy,
        extra_stats: [
          { label: "Level (SAAR)", value: houstLevel === null ? "—" : `${(houstLevel / 1000).toFixed(2)}M units` },
        ],
      });
    }

    // ---- 10y Treasury yield (fetched once, used in two panels) ----
    const [dgs10Hist, t10yieForRealHist] = await Promise.all([
      fetchFredHistory("DGS10", fredKey, 750),
      fetchFredHistory("T10YIE", fredKey, 750),
    ]);
    const dgs10Nums = dgs10Hist.map((p) => p.value);
    const [dgs10Latest, dgs10Prev] = lastValidPair(dgs10Nums);
    const [breakevenForReal] = lastValidPair(t10yieForRealHist.map((p) => p.value));
    const realYield = dgs10Latest !== null && breakevenForReal !== null ? dgs10Latest - breakevenForReal : null;
    const dgs10HistoryPts = toHistory(dgs10Hist.map((p) => p.date), dgs10Nums);
    const dgs10SigUs = signalStats("us-macro:10y-yield", dgs10HistoryPts);
    const dgs10SigYr = signalStats("yield-rates:10y-yield", dgs10HistoryPts);
    const t10yieHistoryForReal = toHistory(t10yieForRealHist.map((p) => p.date), t10yieForRealHist.map((p) => p.value));
    const realYieldHist = subtractHistory(dgs10HistoryPts, t10yieHistoryForReal);
    const realYieldStats = computeStats(realYieldHist.map((p) => p.value));
    const dgs10Extra: ExtraStat[] = [
      {
        label: "Real yield (less 10y breakeven)",
        value: realYield === null ? "—" : `${realYield.toFixed(2)}%`,
        flag: realYield !== null && realYield >= 2,
        caption: "Nominal 10y minus market-implied inflation (breakeven) — the rate that actually matters for real economic activity and valuations.",
        history: realYieldHist,
        zscore: realYieldStats.zscore,
        threshold: 2,
        windowLabel: "3y daily",
      },
    ];
    rows.push({
      id: "us-macro:10y-yield",
      panel_id: "us-macro",
      name: "10y Treasury Yield",
      note: "Benchmark long rate",
      value: fmt(dgs10Latest, { suffix: "%" }),
      status: statusFromDelta(dgs10Latest, dgs10Prev),
      source: "FRED DGS10",
      zscore: dgs10SigUs.signal,
      sparkline: dgs10SigUs.sparkline,
      window_label: "3y daily · momentum 20d",
      history: dgs10HistoryPts,
      extra_stats: dgs10Extra,
    });
    rows.push({
      id: "yield-rates:10y-yield",
      panel_id: "yield-rates",
      name: "10y Treasury Yield",
      note: "Benchmark long rate",
      value: fmt(dgs10Latest, { suffix: "%" }),
      status: statusFromDelta(dgs10Latest, dgs10Prev),
      source: "FRED DGS10",
      zscore: dgs10SigYr.signal,
      sparkline: dgs10SigYr.sparkline,
      window_label: "3y daily · momentum 20d",
      history: dgs10HistoryPts,
    });

    // ---- Industrial production (stored series = YoY growth) ----
    const indproHist = await fetchFredHistory("INDPRO", fredKey, 240);
    const indproNums = indproHist.map((p) => p.value);
    const [indproLatest, indproPrev] = lastValidPair(indproNums);
    const indproYoy = annualizedChange(indproNums, 12);
    const indproHistoryPts = toHistory(indproHist.map((p) => p.date), indproNums);
    const indproYoyHist = annualizedChangeHistory(indproHistoryPts, 12);
    const indproSig = signalStats("us-macro:industrial-production", indproYoyHist);
    const indproYoyStats = computeStats(indproYoyHist.map((p) => p.value));
    rows.push({
      id: "us-macro:industrial-production",
      panel_id: "us-macro",
      name: "Industrial Production",
      note: "YoY growth of the output index",
      value: indproYoy === null ? fmt(indproLatest, { decimals: 1 }) : `${indproYoy > 0 ? "+" : ""}${indproYoy.toFixed(1)}% YoY`,
      status: statusFromDelta(indproLatest, indproPrev),
      source: "FRED INDPRO",
      zscore: indproSig.signal,
      sparkline: indproSig.sparkline,
      window_label: "20y monthly · anchor +1% YoY",
      history: indproYoyHist,
      extra_stats: [
        {
          label: "YoY change",
          value: indproYoy === null ? "—" : `${indproYoy > 0 ? "+" : ""}${indproYoy.toFixed(1)}%`,
          flag: indproYoy !== null && indproYoy < 0,
          caption: "Standard quoting convention for this series — the level index alone doesn't tell you the growth rate.",
          history: indproYoyHist,
          zscore: indproYoyStats.zscore,
          threshold: 0,
          windowLabel: "20y monthly",
        },
        { label: "Index level (2017=100)", value: fmt(indproLatest, { decimals: 1 }) },
      ],
    });

    // ---- Consumer sentiment ----
    const umcsentHist = await fetchFredHistory("UMCSENT", fredKey, 240);
    const umcsentNums = umcsentHist.map((p) => p.value);
    const [umcsentLatest, umcsentPrev] = lastValidPair(umcsentNums);
    const umcsentHistoryPts = toHistory(umcsentHist.map((p) => p.date), umcsentNums);
    const umcsentSig = signalStats("us-macro:consumer-sentiment", umcsentHistoryPts);
    const umcsent3mLevelHist: HistPoint[] = [];
    for (let i = 2; i < umcsentHistoryPts.length; i++) {
      const slice = umcsentHistoryPts.slice(i - 2, i + 1);
      umcsent3mLevelHist.push({
        date: umcsentHistoryPts[i].date,
        value: slice.reduce((a, b) => a + b.value, 0) / slice.length,
      });
    }
    const umcsent3mAvg = umcsent3mLevelHist.length ? umcsent3mLevelHist[umcsent3mLevelHist.length - 1].value : null;
    const umcsent3mLevelStats = computeStats(umcsent3mLevelHist.map((p) => p.value));
    rows.push({
      id: "us-macro:consumer-sentiment",
      panel_id: "us-macro",
      name: "Consumer Sentiment",
      note: "U. Michigan index",
      value: fmt(umcsentLatest, { decimals: 1 }),
      status: statusFromDelta(umcsentLatest, umcsentPrev),
      source: "FRED UMCSENT",
      zscore: umcsentSig.signal,
      sparkline: umcsentSig.sparkline,
      window_label: "20y monthly · positioning 2y",
      history: umcsentHistoryPts,
      extra_stats: [
        {
          label: "3m average",
          value: umcsent3mAvg === null ? "—" : umcsent3mAvg.toFixed(1),
          caption: "Smooths month-to-month survey noise in a series that's historically volatile.",
          history: umcsent3mLevelHist,
          zscore: umcsent3mLevelStats.zscore,
          windowLabel: "20y monthly",
        },
      ],
    });

    // ================= YIELD RATES =================

    // ---- 10y-2y spread ----
    const t10y2yHist = await fetchFredHistory("T10Y2Y", fredKey, 750);
    const t10y2yNums = t10y2yHist.map((p) => p.value);
    const [t10y2yLatest, t10y2yPrev] = lastValidPair(t10y2yNums);
    const t10y2yHistoryPts = toHistory(t10y2yHist.map((p) => p.date), t10y2yNums);
    const t10y2ySig = signalStats("yield-rates:10y2y-spread", t10y2yHistoryPts);
    let inversionStreak = 0;
    for (let i = t10y2yHistoryPts.length - 1; i >= 0; i--) {
      if (t10y2yHistoryPts[i].value < 0) inversionStreak++;
      else break;
    }
    rows.push({
      id: "yield-rates:10y2y-spread",
      panel_id: "yield-rates",
      name: "US 10y-2y Yield Spread",
      note: "Curve inversion watch",
      value: fmt(t10y2yLatest, { suffix: "%" }),
      status: statusFromDelta(t10y2yLatest, t10y2yPrev),
      source: "FRED T10Y2Y",
      zscore: t10y2ySig.signal,
      sparkline: t10y2ySig.sparkline,
      window_label: "3y daily · threshold 0",
      history: t10y2yHistoryPts,
      extra_stats: [
        {
          label: "Days inverted (current streak)",
          value: inversionStreak === 0 ? "Not inverted" : `${inversionStreak}d`,
          flag: inversionStreak > 0,
          caption: "Inversions have historically preceded recessions by 6-24 months — the un-inversion (crossing back positive) is often the sharper signal.",
        },
      ],
    });

    // ---- Breakevens ----
    const t5yieHist = await fetchFredHistory("T5YIE", fredKey, 750);
    const t5yieNums = t5yieHist.map((p) => p.value);
    const t10yieNums = t10yieForRealHist.map((p) => p.value);
    const [t5yieV] = lastValidPair(t5yieNums);
    const [t10yieV, t10yiePrev] = lastValidPair(t10yieNums);
    const t5yieHistoryPts = toHistory(t5yieHist.map((p) => p.date), t5yieNums);
    const t10yieHistoryPts = t10yieHistoryForReal;
    const t10yieSig = signalStats("yield-rates:breakeven", t10yieHistoryPts);
    const breakeven5s10sHist = subtractHistory(t10yieHistoryPts, t5yieHistoryPts);
    const breakeven5s10sStats = computeStats(breakeven5s10sHist.map((p) => p.value));
    const [breakeven5s10sLatest] = lastValidPair(breakeven5s10sHist.map((p) => p.value));
    rows.push({
      id: "yield-rates:breakeven",
      panel_id: "yield-rates",
      name: "5y/10y Breakeven Inflation",
      note: "Market inflation expectation",
      value: `${fmt(t5yieV, { suffix: "%" })} / ${fmt(t10yieV, { suffix: "%" })}`,
      status: statusFromDelta(t10yieV, t10yiePrev),
      source: "FRED T5YIE/T10YIE",
      zscore: t10yieSig.signal,
      sparkline: t10yieSig.sparkline,
      window_label: "3y daily · anchor 2.2%",
      history: t10yieHistoryPts,
      extra_stats: [
        {
          label: "5s10s breakeven spread",
          value: breakeven5s10sLatest === null ? "—" : `${breakeven5s10sLatest > 0 ? "+" : ""}${breakeven5s10sLatest.toFixed(2)}%`,
          caption: "10y breakeven minus 5y — positive means the market expects inflation further out to run hotter than the near term.",
          history: breakeven5s10sHist,
          zscore: breakeven5s10sStats.zscore,
          windowLabel: "3y daily",
        },
      ],
    });

    // ---- 10y-3m spread ----
    const t10y3mHist = await fetchFredHistory("T10Y3M", fredKey, 750);
    const t10y3mNums = t10y3mHist.map((p) => p.value);
    const [t10y3mLatest, t10y3mPrev] = lastValidPair(t10y3mNums);
    const t10y3mHistoryPts = toHistory(t10y3mHist.map((p) => p.date), t10y3mNums);
    const t10y3mSig = signalStats("yield-rates:10y3m-spread", t10y3mHistoryPts);
    let inversionStreak3m = 0;
    for (let i = t10y3mHistoryPts.length - 1; i >= 0; i--) {
      if (t10y3mHistoryPts[i].value < 0) inversionStreak3m++;
      else break;
    }
    rows.push({
      id: "yield-rates:10y3m-spread",
      panel_id: "yield-rates",
      name: "US 10y-3m Yield Spread",
      note: "NY Fed's preferred recession spread",
      value: fmt(t10y3mLatest, { suffix: "%" }),
      status: statusFromDelta(t10y3mLatest, t10y3mPrev),
      source: "FRED T10Y3M",
      zscore: t10y3mSig.signal,
      sparkline: t10y3mSig.sparkline,
      window_label: "3y daily · threshold 0",
      history: t10y3mHistoryPts,
      extra_stats: [
        {
          label: "Days inverted (current streak)",
          value: inversionStreak3m === 0 ? "Not inverted" : `${inversionStreak3m}d`,
          flag: inversionStreak3m > 0,
          caption: "The NY Fed's own recession model is built on this spread, not 2s10s — it has the better historical hit rate with fewer false positives.",
        },
      ],
    });

    // ---- 2y Treasury yield ----
    const dgs2Hist = await fetchFredHistory("DGS2", fredKey, 750);
    const dgs2Nums = dgs2Hist.map((p) => p.value);
    const [dgs2Latest, dgs2Prev] = lastValidPair(dgs2Nums);
    const dgs2HistoryPts = toHistory(dgs2Hist.map((p) => p.date), dgs2Nums);
    const dgs2Sig = signalStats("yield-rates:2y-yield", dgs2HistoryPts);
    rows.push({
      id: "yield-rates:2y-yield",
      panel_id: "yield-rates",
      name: "2y Treasury Yield",
      note: "Front-end rate, prices Fed path",
      value: fmt(dgs2Latest, { suffix: "%" }),
      status: statusFromDelta(dgs2Latest, dgs2Prev),
      source: "FRED DGS2",
      zscore: dgs2Sig.signal,
      sparkline: dgs2Sig.sparkline,
      window_label: "3y daily · momentum 20d",
      history: dgs2HistoryPts,
    });

    // ---- 30y Treasury yield ----
    const dgs30Hist = await fetchFredHistory("DGS30", fredKey, 750);
    const dgs30Nums = dgs30Hist.map((p) => p.value);
    const [dgs30Latest, dgs30Prev] = lastValidPair(dgs30Nums);
    const dgs30HistoryPts = toHistory(dgs30Hist.map((p) => p.date), dgs30Nums);
    const dgs30Sig = signalStats("yield-rates:30y-yield", dgs30HistoryPts);
    rows.push({
      id: "yield-rates:30y-yield",
      panel_id: "yield-rates",
      name: "30y Treasury Yield",
      note: "Long-bond, fiscal/term-premium sensitive",
      value: fmt(dgs30Latest, { suffix: "%" }),
      status: statusFromDelta(dgs30Latest, dgs30Prev),
      source: "FRED DGS30",
      zscore: dgs30Sig.signal,
      sparkline: dgs30Sig.sparkline,
      window_label: "3y daily · momentum 20d",
      history: dgs30HistoryPts,
    });

    // ---- 5y5y forward inflation ----
    const t5yifrHist = await fetchFredHistory("T5YIFR", fredKey, 750);
    const t5yifrNums = t5yifrHist.map((p) => p.value);
    const [t5yifrLatest, t5yifrPrev] = lastValidPair(t5yifrNums);
    const t5yifrHistoryPts = toHistory(t5yifrHist.map((p) => p.date), t5yifrNums);
    const t5yifrSig = signalStats("yield-rates:forward-inflation", t5yifrHistoryPts);
    const vsBreakevenHist = subtractHistory(t5yifrHistoryPts, t10yieHistoryPts);
    const vsBreakevenStats = computeStats(vsBreakevenHist.map((p) => p.value));
    const [vsBreakevenLatest] = lastValidPair(vsBreakevenHist.map((p) => p.value));
    rows.push({
      id: "yield-rates:forward-inflation",
      panel_id: "yield-rates",
      name: "5y5y Forward Inflation",
      note: "Long-run Fed-relevant inflation gauge",
      value: fmt(t5yifrLatest, { suffix: "%" }),
      status: statusFromDelta(t5yifrLatest, t5yifrPrev),
      source: "FRED T5YIFR",
      zscore: t5yifrSig.signal,
      sparkline: t5yifrSig.sparkline,
      window_label: "3y daily · anchor 2.2%",
      history: t5yifrHistoryPts,
      extra_stats: [
        {
          label: "vs. 10y breakeven",
          value: vsBreakevenLatest === null ? "—" : `${vsBreakevenLatest > 0 ? "+" : ""}${vsBreakevenLatest.toFixed(2)}%`,
          caption: "This is the metric the Fed itself watches most for long-run inflation anchoring — divergence from the 10y breakeven signals near-term vs. long-run views decoupling.",
          history: vsBreakevenHist,
          zscore: vsBreakevenStats.zscore,
          windowLabel: "3y daily",
        },
      ],
    });

    // ================= COT POSITIONING =================
    // Queried by CFTC contract code (names get renamed and silently break).

    const COT_MARKETS: { code: string; id: string; name: string; note: string }[] = [
      { code: COT_CODES.ES, id: "cot:es", name: "S&P 500 (ES)", note: "Spec net position, e-mini" },
      { code: COT_CODES.NQ, id: "cot:nq", name: "Nasdaq-100 (NQ)", note: "Spec net position, e-mini" },
      { code: COT_CODES.UST_10Y, id: "cot:zn", name: "10y Treasury (ZN)", note: "Spec net position" },
      { code: COT_CODES.UST_2Y, id: "cot:zt", name: "2y Treasury (ZT)", note: "Spec net position" },
      { code: COT_CODES.GOLD, id: "cot:gold", name: "Gold (GC)", note: "Spec net position, COMEX" },
      { code: COT_CODES.WTI, id: "cot:wti", name: "Crude Oil (CL)", note: "Spec net position, NYMEX WTI" },
      { code: COT_CODES.COPPER, id: "cot:copper", name: "Copper (HG)", note: "Spec net position, COMEX" },
      { code: COT_CODES.SILVER, id: "cot:silver", name: "Silver (SI)", note: "Spec net position, COMEX" },
      { code: COT_CODES.NATGAS, id: "cot:natgas", name: "Natural Gas (NG)", note: "Spec net position, NYMEX Henry Hub" },
      { code: COT_CODES.DXY, id: "cot:dxy", name: "Dollar Index (DX)", note: "Spec net position, ICE" },
      { code: COT_CODES.VIX, id: "cot:vix", name: "VIX Futures", note: "Spec net position — structurally short" },
    ];

    const cotSeriesByCode = new Map<string, CotPoint[]>(
      await Promise.all(
        COT_MARKETS.map(async (m) => [m.code, await fetchCotSeries(m.code, 156)] as [string, CotPoint[]])
      )
    );

    const cotRow = (m: { code: string; id: string; name: string; note: string }, panel_id: string): UpsertRow | null => {
      const series = cotSeriesByCode.get(m.code) ?? [];
      if (series.length < 20) return null;
      const netHist: HistPoint[] = series.map((p) => ({ date: p.date, value: p.net }));
      const pctHist: HistPoint[] = series
        .filter((p) => p.netPctOi !== null)
        .map((p) => ({ date: p.date, value: p.netPctOi as number }));
      const sig = signalStats(m.id, netHist);
      const latest = series[series.length - 1];
      const prev = series[series.length - 2];
      const idx = cotIndex(series);
      const idxHist: HistPoint[] = [];
      for (let i = 20; i < series.length; i++) {
        const v = cotIndex(series.slice(0, i + 1));
        if (v !== null) idxHist.push({ date: series[i].date, value: v });
      }
      const pctStats = computeStats(pctHist.map((p) => p.value));
      return {
        id: m.id,
        panel_id,
        name: m.name,
        note: m.note,
        value: fmtNet(latest.net),
        status: statusFromDelta(latest.net, prev?.net ?? null),
        source: `CFTC Legacy COT ${m.code}`,
        zscore: sig.signal,
        sparkline: sig.sparkline,
        window_label: "3y weekly · positioning 2y",
        history: netHist,
        extra_stats: [
          {
            label: "COT index (3y)",
            value: idx === null ? "—" : `${idx.toFixed(0)} / 100`,
            flag: idx !== null && (idx <= 10 || idx >= 90),
            caption: "Where today's net position sits in its 3-year range. 0 = most short, 100 = most long — readings past 90/10 mark crowded trades that unwind violently.",
            history: idxHist,
            zscore: null,
            threshold: 90,
            windowLabel: "3y weekly",
          },
          {
            label: "Net as % of open interest",
            value: latest.netPctOi === null ? "—" : `${latest.netPctOi > 0 ? "+" : ""}${latest.netPctOi.toFixed(1)}%`,
            caption: "Normalizes the position by market size — the only way raw contract counts are comparable across years and contracts.",
            history: pctHist,
            zscore: pctStats.zscore,
            windowLabel: "3y weekly",
          },
        ],
      };
    };

    for (const m of COT_MARKETS) {
      const row = cotRow(m, "cot-positioning");
      if (row) rows.push(row);
    }
    const znRow = cotRow({ code: COT_CODES.UST_10Y, id: "yield-rates:10y-cot", name: "10y Treasury Futures COT", note: "Net spec positioning, ZN" }, "yield-rates");
    if (znRow) rows.push(znRow);
    const ztRow = cotRow({ code: COT_CODES.UST_2Y, id: "yield-rates:2y-cot", name: "2y Treasury Futures COT", note: "Net spec positioning, front end" }, "yield-rates");
    if (ztRow) rows.push(ztRow);

    // ================= GEOPOLITICS & VOL =================

    // ---- VIX ----
    const vixHist = await fetchFredHistory("VIXCLS", fredKey, 750);
    const vixNums = vixHist.map((p) => p.value);
    const [vixLatest, vixPrev] = lastValidPair(vixNums);
    const vixHistoryPts = toHistory(vixHist.map((p) => p.date), vixNums);
    const vixSig = signalStats("geo:vix", vixHistoryPts);
    rows.push({
      id: "geo:vix",
      panel_id: "volatility",
      name: "VIX",
      note: "S&P 500 implied vol, 30d",
      value: fmt(vixLatest),
      status: statusFromDelta(vixLatest, vixPrev),
      source: "FRED VIXCLS",
      zscore: vixSig.signal,
      sparkline: vixSig.sparkline,
      window_label: "3y daily · anchor 17",
      history: vixHistoryPts,
      extra_stats: [
        {
          label: "Regime bands",
          value: vixLatest === null ? "—" : vixLatest < 15 ? "Calm (<15)" : vixLatest < 25 ? "Normal (15-25)" : "Stress (25+)",
          flag: vixLatest !== null && vixLatest >= 25,
          caption: "Sub-15 = vol-selling regime; sustained 25+ = drawdowns cluster and correlations go to 1.",
        },
      ],
    });

    // ---- VIX term structure (VIX3M / VIX) ----
    const [vixDaily, vix3mDaily] = await Promise.all([
      fetchYahooHistory("^VIX", "2y", "1d"),
      fetchYahooHistory("^VIX3M", "2y", "1d"),
    ]);
    const vixTermHist = ratioSeriesDated(vix3mDaily, vixDaily);
    if (vixTermHist.length > 20) {
      const termSig = signalStats("geo:vix-term", vixTermHist);
      const termLatest = vixTermHist[vixTermHist.length - 1].value;
      const termPrev = vixTermHist[vixTermHist.length - 2]?.value ?? null;
      rows.push({
        id: "geo:vix-term",
        panel_id: "volatility",
        name: "VIX Term Structure",
        note: "VIX3M / VIX — below 1 = backwardation = stress",
        value: termLatest.toFixed(3),
        status: statusFromDelta(termLatest, termPrev),
        source: "Yahoo ^VIX3M / ^VIX",
        zscore: termSig.signal,
        sparkline: termSig.sparkline,
        window_label: "2y daily · anchor 1.05",
        history: vixTermHist,
        extra_stats: [
          {
            label: "Curve shape",
            value: termLatest >= 1 ? `Contango (+${((termLatest - 1) * 100).toFixed(1)}%)` : `BACKWARDATION (${((termLatest - 1) * 100).toFixed(1)}%)`,
            flag: termLatest < 1,
            caption: "The vol curve inverted (spot above 3-month) in every major drawdown — Feb 2018, Mar 2020, 2022 lows. Inversion = acute stress being priced now.",
            history: vixTermHist,
            zscore: null,
            threshold: 1,
            windowLabel: "2y daily",
          },
        ],
      });
    }

    // ---- OVX / GVZ ----
    const ovxHist = await fetchFredHistory("OVXCLS", fredKey, 750);
    const ovxNums = ovxHist.map((p) => p.value);
    const [ovxLatest, ovxPrev] = lastValidPair(ovxNums);
    const ovxHistoryPts = toHistory(ovxHist.map((p) => p.date), ovxNums);
    const ovxSig = signalStats("geo:ovx", ovxHistoryPts);
    rows.push({
      id: "geo:ovx",
      panel_id: "volatility",
      name: "OVX",
      note: "Crude oil implied vol — supply-shock gauge",
      value: fmt(ovxLatest),
      status: statusFromDelta(ovxLatest, ovxPrev),
      source: "FRED OVXCLS",
      zscore: ovxSig.signal,
      sparkline: ovxSig.sparkline,
      window_label: "3y daily · anchor 35",
      history: ovxHistoryPts,
    });

    const gvzHist = await fetchFredHistory("GVZCLS", fredKey, 750);
    const gvzNums = gvzHist.map((p) => p.value);
    const [gvzLatest, gvzPrev] = lastValidPair(gvzNums);
    const gvzHistoryPts = toHistory(gvzHist.map((p) => p.date), gvzNums);
    const gvzSig = signalStats("geo:gvz", gvzHistoryPts);
    rows.push({
      id: "geo:gvz",
      panel_id: "volatility",
      name: "GVZ",
      note: "Gold implied vol — safe-haven flow gauge",
      value: fmt(gvzLatest),
      status: statusFromDelta(gvzLatest, gvzPrev),
      source: "FRED GVZCLS",
      zscore: gvzSig.signal,
      sparkline: gvzSig.sparkline,
      window_label: "3y daily · anchor 17",
      history: gvzHistoryPts,
    });

    // ---- VVIX / SKEW / MOVE ----
    const [vvixDaily, skewDaily, moveDaily] = await Promise.all([
      fetchYahooHistory("^VVIX", "2y", "1d"),
      fetchYahooHistory("^SKEW", "2y", "1d"),
      fetchYahooHistory("^MOVE", "2y", "1d"),
    ]);

    const vvixHistoryPts = toDatedSeries(vvixDaily);
    if (vvixHistoryPts.length > 20) {
      const vvixSig = signalStats("geo:vvix", vvixHistoryPts);
      const vvixLatest = vvixHistoryPts[vvixHistoryPts.length - 1].value;
      const vvixPrev = vvixHistoryPts[vvixHistoryPts.length - 2]?.value ?? null;
      rows.push({
        id: "geo:vvix",
        panel_id: "volatility",
        name: "VVIX",
        note: "Vol-of-vol — implied vol of the VIX itself",
        value: vvixLatest.toFixed(1),
        status: statusFromDelta(vvixLatest, vvixPrev),
        source: "Yahoo ^VVIX",
        zscore: vvixSig.signal,
        sparkline: vvixSig.sparkline,
        window_label: "2y daily · anchor 90",
        history: vvixHistoryPts,
      });
    }

    const skewHistoryPts = toDatedSeries(skewDaily);
    if (skewHistoryPts.length > 20) {
      const skewSig = signalStats("geo:skew", skewHistoryPts);
      const skewLatest = skewHistoryPts[skewHistoryPts.length - 1].value;
      const skewPrev = skewHistoryPts[skewHistoryPts.length - 2]?.value ?? null;
      rows.push({
        id: "geo:skew",
        panel_id: "volatility",
        name: "CBOE SKEW",
        note: "Tail-risk gauge — priced crash probability",
        value: skewLatest.toFixed(1),
        status: statusFromDelta(skewLatest, skewPrev),
        source: "Yahoo ^SKEW",
        zscore: skewSig.signal,
        sparkline: skewSig.sparkline,
        window_label: "2y daily · anchor 120",
        history: skewHistoryPts,
      });
    }

    const moveHistoryPts = toDatedSeries(moveDaily);
    if (moveHistoryPts.length > 20) {
      const moveSig = signalStats("geo:move", moveHistoryPts);
      const moveLatest = moveHistoryPts[moveHistoryPts.length - 1].value;
      const movePrev = moveHistoryPts[moveHistoryPts.length - 2]?.value ?? null;
      rows.push({
        id: "geo:move",
        panel_id: "volatility",
        name: "MOVE Index",
        note: "Bond market implied vol",
        value: moveLatest.toFixed(1),
        status: statusFromDelta(moveLatest, movePrev),
        source: "Yahoo ^MOVE",
        zscore: moveSig.signal,
        sparkline: moveSig.sparkline,
        window_label: "2y daily · anchor 100",
        history: moveHistoryPts,
      });
    }

    // ---- Economic Policy Uncertainty (30d MA of the daily index) ----
    const epuHist = await fetchFredHistory("USEPUINDXD", fredKey, 750);
    const epuNums = epuHist.map((p) => p.value);
    const epuMa = movingAverage(epuNums, 30);
    const epuMaHist = toHistory(epuHist.map((p) => p.date), epuMa);
    if (epuMaHist.length > 20) {
      const epuSig = signalStats("geo:epu", epuMaHist);
      const epuLatest = epuMaHist[epuMaHist.length - 1].value;
      const epuPrev = epuMaHist[epuMaHist.length - 2]?.value ?? null;
      rows.push({
        id: "geo:epu",
        panel_id: "geopolitics",
        name: "Policy Uncertainty (EPU)",
        note: "News-based daily index, 30d average",
        value: epuLatest.toFixed(0),
        status: statusFromDelta(epuLatest, epuPrev),
        source: "FRED USEPUINDXD",
        zscore: epuSig.signal,
        sparkline: epuSig.sparkline,
        window_label: "3y daily · positioning 2y",
        history: epuMaHist,
        extra_stats: [
          {
            label: "Why the 30d average",
            value: "Daily prints swing 3x on single headlines",
            caption: "The raw daily index is far too noisy to read — the smoothed level is what correlates with risk premia.",
          },
        ],
      });
    }

    // ---- Global Economic Policy Uncertainty (monthly) ----
    const gepuHist = await fetchFredHistory("GEPUCURRENT", fredKey, 240);
    const gepuHistoryPts = toHistory(gepuHist.map((p) => p.date), gepuHist.map((p) => p.value));
    if (gepuHistoryPts.length >= 10) {
      const gepuSig = signalStats("geo:gepu", gepuHistoryPts);
      const gepuLatest = gepuHistoryPts[gepuHistoryPts.length - 1].value;
      const gepuPrev = gepuHistoryPts[gepuHistoryPts.length - 2]?.value ?? null;
      rows.push({
        id: "geo:gepu",
        panel_id: "geopolitics",
        name: "Global Policy Uncertainty",
        note: "GDP-weighted across major economies",
        value: gepuLatest.toFixed(0),
        status: statusFromDelta(gepuLatest, gepuPrev),
        source: "FRED GEPUCURRENT",
        zscore: gepuSig.signal,
        sparkline: gepuSig.sparkline,
        window_label: "20y monthly · positioning 2y",
        history: gepuHistoryPts,
      });
    }

    // ---- Equity Market-related Economic Uncertainty (daily) ----
    const equNcHist = await fetchFredHistory("WLEMUINDXD", fredKey, 750);
    const equNcHistoryPts = toHistory(equNcHist.map((p) => p.date), equNcHist.map((p) => p.value));
    if (equNcHistoryPts.length >= 10) {
      const equNcSig = signalStats("geo:equity-uncertainty", equNcHistoryPts);
      const equNcLatest = equNcHistoryPts[equNcHistoryPts.length - 1].value;
      const equNcPrev = equNcHistoryPts[equNcHistoryPts.length - 2]?.value ?? null;
      rows.push({
        id: "geo:equity-uncertainty",
        panel_id: "geopolitics",
        name: "Equity Market Uncertainty",
        note: "News + options-based, daily",
        value: equNcLatest.toFixed(0),
        status: statusFromDelta(equNcLatest, equNcPrev),
        source: "FRED WLEMUINDXD",
        zscore: equNcSig.signal,
        sparkline: equNcSig.sparkline,
        window_label: "3y daily · positioning 2y",
        history: equNcHistoryPts,
      });
    }

    // ---- Defense sector vs market (ITA / SPY) ----
    const [itaW, spyGeoW] = await Promise.all([fetchYahooHistory("ITA", "2y"), fetchYahooHistory("SPY", "2y")]);
    const defenseSpyHist = ratioSeriesDated(itaW, spyGeoW);
    if (defenseSpyHist.length >= 20) {
      const defenseSpySig = signalStats("geo:defense-spy", defenseSpyHist);
      const defenseSpyLatest = defenseSpyHist[defenseSpyHist.length - 1].value;
      const defenseSpyPrev = defenseSpyHist[defenseSpyHist.length - 2]?.value ?? null;
      rows.push({
        id: "geo:defense-spy",
        panel_id: "geopolitics",
        name: "Defense / Market Ratio",
        note: "ITA vs SPY — risk-on tilt toward defense names",
        value: defenseSpyLatest.toFixed(4),
        status: statusFromDelta(defenseSpyLatest, defenseSpyPrev),
        source: "Yahoo Finance ITA / SPY",
        zscore: defenseSpySig.signal,
        sparkline: defenseSpySig.sparkline,
        window_label: "2y weekly · positioning 2y",
        history: defenseSpyHist,
      });
    }

    // ---- News sentiment feed (pooled headlines, keyword-lexicon scored) ----
    const newsItems = await fetchNewsFeed(100);
    if (newsItems.length > 0) {
      const sentimentHistory: HistPoint[] = newsItems
        .slice()
        .reverse()
        .map((item) => ({ date: item.pubDate, value: item.sentimentScore }));
      const bull = newsItems.filter((n) => n.sentimentLabel === "bullish").length;
      const bear = newsItems.filter((n) => n.sentimentLabel === "bearish").length;
      const avgScore = weightedSentimentAvg(newsItems);
      rows.push({
        id: "geo:news-feed",
        panel_id: "geopolitics",
        name: "News Sentiment",
        note: "Pooled macro headlines, keyword-lexicon scored",
        value: `${bull}▲ ${bear}▼`,
        status: avgScore > 0.05 ? "up" : avgScore < -0.05 ? "down" : "flat",
        source: "CNBC · Fed · WSJ · Yahoo · FXStreet",
        zscore: null,
        sparkline: null,
        window_label: `${newsItems.length} headlines`,
        history: sentimentHistory,
        payload: { headlines: newsItems.slice(0, 100) },
      });
    }

    // ---- Asset-specific news feeds (one per tradable symbol) ----
    await Promise.all(
      MARKET_SYMBOLS.map(async (m) => {
        const items = await fetchAssetNewsFeed(m.symbol, 40);
        if (items.length === 0) return;
        const sentimentHistory: HistPoint[] = items
          .slice()
          .reverse()
          .map((item) => ({ date: item.pubDate, value: item.sentimentScore }));
        const bull = items.filter((n) => n.sentimentLabel === "bullish").length;
        const bear = items.filter((n) => n.sentimentLabel === "bearish").length;
        const avgScore = weightedSentimentAvg(items);
        rows.push({
          id: `asset-news:${m.symbol}`,
          panel_id: "asset-news",
          name: `${m.label} News`,
          note: "Ticker-specific headlines, keyword-lexicon scored",
          value: `${bull}▲ ${bear}▼`,
          status: avgScore > 0.05 ? "up" : avgScore < -0.05 ? "down" : "flat",
          source: `Yahoo Finance RSS (${m.symbol})`,
          zscore: null,
          sparkline: null,
          window_label: `${items.length} headlines`,
          history: sentimentHistory,
          payload: { headlines: items },
        });
      })
    );

    // ================= TRANSMISSION =================

    // ---- NFCI (weekly, 0 = average conditions by construction) ----
    const nfciHist = await fetchFredHistory("NFCI", fredKey, 260);
    const nfciNums = nfciHist.map((p) => p.value);
    const [nfciLatest, nfciPrev] = lastValidPair(nfciNums);
    const nfciHistoryPts = toHistory(nfciHist.map((p) => p.date), nfciNums);
    const nfciSig = signalStats("transmission:nfci", nfciHistoryPts);
    rows.push({
      id: "transmission:nfci",
      panel_id: "transmission",
      name: "Financial Conditions (NFCI)",
      note: "Chicago Fed, 0 = average, + = tight",
      value: nfciLatest === null ? "—" : nfciLatest.toFixed(3),
      status: statusFromDelta(nfciLatest, nfciPrev),
      source: "FRED NFCI",
      zscore: nfciSig.signal,
      sparkline: nfciSig.sparkline,
      window_label: "5y weekly · anchor 0",
      history: nfciHistoryPts,
      extra_stats: [
        {
          label: "Absolute stance",
          value: nfciLatest === null ? "—" : nfciLatest > 0 ? "Tighter than average" : "Looser than average",
          flag: nfciLatest !== null && nfciLatest > 0,
          caption: "The index is built so 0 = the historical average of US financial conditions. Sign matters as much as direction here.",
          history: nfciHistoryPts,
          zscore: null,
          threshold: 0,
          windowLabel: "5y weekly",
        },
      ],
    });

    // ---- 10y real yield (TIPS) ----
    const dfii10Hist = await fetchFredHistory("DFII10", fredKey, 750);
    const dfii10Nums = dfii10Hist.map((p) => p.value);
    const [dfii10Latest, dfii10Prev] = lastValidPair(dfii10Nums);
    const dfii10HistoryPts = toHistory(dfii10Hist.map((p) => p.date), dfii10Nums);
    const dfii10Sig = signalStats("transmission:real-10y", dfii10HistoryPts);
    rows.push({
      id: "transmission:real-10y",
      panel_id: "transmission",
      name: "10y Real Yield (TIPS)",
      note: "The true discount rate",
      value: fmt(dfii10Latest, { suffix: "%" }),
      status: statusFromDelta(dfii10Latest, dfii10Prev),
      source: "FRED DFII10",
      zscore: dfii10Sig.signal,
      sparkline: dfii10Sig.sparkline,
      window_label: "3y daily · anchor 1% (r*)",
      history: dfii10HistoryPts,
    });

    // ---- Broad dollar ----
    const dollarHist = await fetchFredHistory("DTWEXBGS", fredKey, 750);
    const dollarNums = dollarHist.map((p) => p.value);
    const [dollarLatest, dollarPrev] = lastValidPair(dollarNums);
    const dollarHistoryPts = toHistory(dollarHist.map((p) => p.date), dollarNums);
    const dollarSig = signalStats("transmission:broad-dollar", dollarHistoryPts);
    rows.push({
      id: "transmission:broad-dollar",
      panel_id: "transmission",
      name: "Broad Dollar Index",
      note: "Fed trade-weighted, global tightening proxy",
      value: fmt(dollarLatest),
      status: statusFromDelta(dollarLatest, dollarPrev),
      source: "FRED DTWEXBGS",
      zscore: dollarSig.signal,
      sparkline: dollarSig.sparkline,
      window_label: "3y daily · momentum 20d",
      history: dollarHistoryPts,
    });

    // ---- Ratio series via Yahoo (weekly, 2y) ----
    const [copperW, goldW, silverW, crudeW, natgasW, hygW, lqdW, rspW, spyW, smhW] = await Promise.all([
      fetchYahooHistory("HG=F", "2y"),
      fetchYahooHistory("GC=F", "2y"),
      fetchYahooHistory("SI=F", "2y"),
      fetchYahooHistory("CL=F", "2y"),
      fetchYahooHistory("NG=F", "2y"),
      fetchYahooHistory("HYG", "2y"),
      fetchYahooHistory("LQD", "2y"),
      fetchYahooHistory("RSP", "2y"),
      fetchYahooHistory("SPY", "2y"),
      fetchYahooHistory("SMH", "2y"),
    ]);

    const ratioRow = (
      id: string,
      name: string,
      note: string,
      source: string,
      hist: HistPoint[],
      decimals = 4
    ): UpsertRow | null => {
      if (hist.length < 20) return null;
      const sig = signalStats(id, hist);
      const latest = hist[hist.length - 1].value;
      const prev = hist[hist.length - 2]?.value ?? null;
      return {
        id,
        panel_id: "transmission",
        name,
        note,
        value: latest.toFixed(decimals),
        status: statusFromDelta(latest, prev),
        source,
        zscore: sig.signal,
        sparkline: sig.sparkline,
        window_label: "2y weekly · positioning 2y",
        history: hist,
      };
    };

    const ratioRows = [
      ratioRow("transmission:copper-gold", "Copper/Gold Ratio", "Growth vs fear — tracks the 10y", "Yahoo Finance HG=F / GC=F", ratioSeriesDated(copperW, goldW)),
      ratioRow("transmission:gold-silver", "Gold/Silver Ratio", "Fear metal vs industrial metal", "Yahoo Finance GC=F / SI=F", ratioSeriesDated(goldW, silverW), 2),
      ratioRow("transmission:crude-natgas", "Crude/NatGas Ratio", "Global vs domestic energy split", "Yahoo Finance CL=F / NG=F", ratioSeriesDated(crudeW, natgasW), 2),
      ratioRow("transmission:hyg-lqd", "HYG / LQD Ratio", "Junk vs quality — credit risk appetite", "Yahoo Finance HYG / LQD", ratioSeriesDated(hygW, lqdW)),
      ratioRow("transmission:rsp-spy", "RSP / SPY Ratio", "Equal-weight vs cap-weight — breadth", "Yahoo Finance RSP / SPY", ratioSeriesDated(rspW, spyW)),
      ratioRow("transmission:smh-spy", "SMH / SPY Ratio", "Semis vs market — cycle leadership", "Yahoo Finance SMH / SPY", ratioSeriesDated(smhW, spyW)),
    ];
    for (const r of ratioRows) if (r) rows.push(r);

    // ================= MARKET TICKERS =================
    // Weekly bars for display/correlation; daily bars (payload) let the
    // backtest resolve 1-day forward returns.
    await Promise.all(
      MARKET_SYMBOLS.map(async ({ symbol, label }) => {
        const [series, dailySeries] = await Promise.all([
          fetchYahooHistory(symbol, "2y"),
          fetchYahooHistory(symbol, "2y", "1d"),
        ]);
        const closes = series.closes.filter((v): v is number => v !== null);
        if (closes.length < 10) return;
        const history = toDatedSeries(series);
        const dailyHistory = toDatedSeries(dailySeries);
        const stats = computeStats(series.closes);
        const [latest, prev] = lastValidPair(series.closes);
        rows.push({
          id: marketRowId(symbol),
          panel_id: "market",
          name: label,
          note: symbol,
          value: fmt(latest, { decimals: latest && latest < 20 ? 3 : 2 }),
          status: statusFromDelta(latest, prev),
          source: `Yahoo Finance ${symbol}`,
          zscore: stats.zscore,
          sparkline: stats.sparkline,
          window_label: "2y weekly",
          history,
          payload: dailyHistory.length > 10 ? { dailyHistory } : null,
        });
      })
    );

    // ---- Upsert, tolerating a missing payload column (pre-migration DBs) ----
    // updated_at has a DB default that only fires on INSERT, not on the
    // UPDATE half of an upsert — stamp it explicitly so "synced HH:MM" in
    // the UI reflects the actual last refresh, not the row's original insert time.
    const nowIso = new Date().toISOString();
    for (const r of rows) r.updated_at = nowIso;

    let payloadColumnMissing = false;
    let { error } = await supabaseAdmin.from("macro_series").upsert(rows, { onConflict: "id" });
    if (error && /payload/i.test(error.message)) {
      payloadColumnMissing = true;
      const stripped = rows.map((r) => {
        const rest = { ...r };
        delete rest.payload;
        return rest;
      });
      ({ error } = await supabaseAdmin.from("macro_series").upsert(stripped, { onConflict: "id" }));
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabaseAdmin.from("macro_series").delete().in("id", STALE_ROW_IDS);

    return NextResponse.json({
      ok: true,
      updated: rows.length,
      at: new Date().toISOString(),
      ...(payloadColumnMissing && {
        warning:
          "payload column missing — run `alter table macro_series add column if not exists payload jsonb;` in the Supabase SQL editor to enable the news feed and backtest daily bars",
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
