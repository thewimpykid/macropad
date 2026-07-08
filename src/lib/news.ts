import { fetchRssHeadlines, type RssItem } from "@/lib/rss";
import { scoreSentiment } from "@/lib/sentiment";

/**
 * Real macro/policy news desks, not per-ticker stock headlines. Every URL
 * below is live-verified (curl'd, 200, real headlines) before being wired
 * in. Federal Reserve points at the monetary-policy-only feed (FOMC
 * statements, rate decisions) rather than the general press feed, which is
 * mostly bank enforcement actions and compliance notices, not macro events.
 * Yahoo Finance's general feed was dropped: it's single-stock commentary
 * ("Is Veralto Trading at a Fair Valuation?"), not macro news.
 */
const NEWS_SOURCES = [
  { label: "CNBC Economy", url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", filterMacro: false },
  { label: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_monetary.xml", filterMacro: false },
  { label: "Federal Reserve Speeches", url: "https://www.federalreserve.gov/feeds/speeches.xml", filterMacro: false },
  { label: "ECB", url: "https://www.ecb.europa.eu/rss/press.html", filterMacro: false },
  // WSJ/FXStreet mix real macro coverage with routine single-name market
  // color ("Comex Gold, Silver Settle Lower") — keyword-gate just these two
  // so the pooled feed stays event-driven instead of daily price chatter.
  { label: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", filterMacro: true },
  { label: "FXStreet", url: "https://www.fxstreet.com/rss/news", filterMacro: true },
];

/**
 * Keyword gate applied to specific sources in the pooled general feed (see
 * filterMacro above). Not applied to per-asset feeds, which are
 * intentionally ticker-specific.
 */
const MACRO_KEYWORDS = [
  "fed", "fomc", "federal reserve", "ecb", "central bank", "boe", "boj", "pboc",
  "rate cut", "rate hike", "rate decision", "interest rate", "monetary policy",
  "inflation", "cpi", "pce", "disinflation", "deflation",
  "gdp", "recession", "economy", "economic", "growth",
  "jobs report", "payrolls", "unemployment", "jobless", "labor market", "labor force",
  "yield", "treasury", "bond market", "dollar", "currency", "fx",
  "tariff", "trade war", "trade deal", "sanctions", "opec", "oil price",
  "geopolitic", "war", "ceasefire", "conflict", "election", "government shutdown",
  "debt ceiling", "budget", "deficit", "stimulus", "quantitative easing", "quantitative tightening",
];

function isMacroRelevant(title: string): boolean {
  const t = title.toLowerCase();
  return MACRO_KEYWORDS.some((k) => t.includes(k));
}

export interface NewsItem {
  title: string;
  link: string | null;
  pubDate: string; // ISO
  source: string; // which desk it came from
  sentimentScore: number; // -1..1
  sentimentLabel: "bullish" | "bearish" | "neutral";
}

/** Dedupes by title, scores each headline, sorts newest first. */
function mergeAndScore(results: { source: string; items: RssItem[] }[], maxItems: number): NewsItem[] {
  const seen = new Set<string>();
  const merged: NewsItem[] = [];

  for (const { source, items } of results) {
    for (const h of items) {
      const key = h.title.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const sentiment = scoreSentiment(h.title);
      merged.push({
        title: h.title,
        link: h.link,
        pubDate: h.pubDate ?? new Date().toISOString(),
        source,
        sentimentScore: sentiment.score,
        sentimentLabel: sentiment.label,
      });
    }
  }

  merged.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  return merged.slice(0, maxItems);
}

/**
 * Stretches an already -1..1 aggregate outward, same shape as the
 * per-headline polarization curve in sentiment.ts — a smoothed average of
 * polarized inputs still regresses toward the middle, so re-polarize after
 * aggregating or the final number reads flatter than the headlines it came from.
 */
function polarize(x: number): number {
  return Math.sign(x) * Math.pow(Math.min(1, Math.abs(x)), 0.6);
}

/**
 * Recency-weighted average sentiment — a headline from 10 minutes ago should
 * move the live score more than one from yesterday. Exponential decay,
 * half-life in hours: a headline's weight halves every `halfLifeHours`.
 * Half-life of 3 (was 6) so recent headlines dominate harder.
 */
export function weightedSentimentAvg(items: NewsItem[], halfLifeHours = 3): number {
  if (items.length === 0) return 0;
  const now = Date.now();
  let weightSum = 0;
  let scoreSum = 0;
  for (const it of items) {
    const ageHours = Math.max(0, (now - new Date(it.pubDate).getTime()) / 3_600_000);
    const weight = Math.pow(0.5, ageHours / halfLifeHours);
    weightSum += weight;
    scoreSum += weight * it.sentimentScore;
  }
  return weightSum > 0 ? polarize(scoreSum / weightSum) : 0;
}

/**
 * Smoothed sentiment trend for charting — an exponentially-weighted running
 * average through time, not the raw per-headline score. Plotting raw scores
 * as a line is meaningless noise: headlines land at irregular intervals from
 * different sources and each one swings between -1 and +1 on its own, so a
 * line connecting them just zigzags. This produces one point per headline
 * (in chronological order) but each point is the decayed rolling average up
 * to that moment, same half-life logic as weightedSentimentAvg. Half-life of
 * 3h (was 6) so the line actually moves when fresh headlines swing hard, and
 * each point is re-polarized so the trend doesn't read flatter than the
 * headlines driving it.
 */
export function sentimentTrend(items: NewsItem[], halfLifeHours = 3): { date: string; value: number }[] {
  const chronological = [...items].reverse(); // oldest -> newest
  const out: { date: string; value: number }[] = [];
  let weightSum = 0;
  let scoreSum = 0;
  let lastTime: number | null = null;

  for (const it of chronological) {
    const t = new Date(it.pubDate).getTime();
    if (lastTime !== null) {
      const elapsedHours = Math.max(0, (t - lastTime) / 3_600_000);
      const decay = Math.pow(0.5, elapsedHours / halfLifeHours);
      weightSum *= decay;
      scoreSum *= decay;
    }
    weightSum += 1;
    scoreSum += it.sentimentScore;
    lastTime = t;
    out.push({ date: it.pubDate, value: weightSum > 0 ? polarize(scoreSum / weightSum) : 0 });
  }

  return out;
}

/** Fetches headlines across macro news desks — the "general" feed. */
export async function fetchNewsFeed(maxItems = 120): Promise<NewsItem[]> {
  const results = await Promise.all(
    NEWS_SOURCES.map(async (src) => {
      const items = await fetchRssHeadlines(src.url);
      return { source: src.label, items: src.filterMacro ? items.filter((h) => isMacroRelevant(h.title)) : items };
    })
  );
  return mergeAndScore(results, maxItems);
}

/**
 * Asset-specific feed for a single ticker — this is exactly what the Yahoo
 * per-ticker headline RSS is actually good at (it was wrong for the pooled
 * "general" feed, which needs real macro desks instead).
 */
export async function fetchAssetNewsFeed(symbol: string, maxItems = 40): Promise<NewsItem[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const items = await fetchRssHeadlines(url);
  return mergeAndScore([{ source: `Yahoo Finance ${symbol}`, items }], maxItems);
}
