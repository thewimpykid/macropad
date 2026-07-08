import { fetchRssHeadlines, type RssItem } from "@/lib/rss";
import { scoreSentiment } from "@/lib/sentiment";

/**
 * Real macro/policy news desks, not per-ticker stock headlines — this is
 * what actually moves the macro picture (Fed action, employment, rates,
 * geopolitics), not "Apple shares rise." Every URL below is live-verified
 * (curl'd, 200, real headlines) before being wired in.
 */
const NEWS_SOURCES = [
  { label: "CNBC Economy", url: "https://www.cnbc.com/id/20910258/device/rss/rss.html" },
  { label: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { label: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml" },
  { label: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex" },
  { label: "FXStreet", url: "https://www.fxstreet.com/rss/news" },
];

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
 * Recency-weighted average sentiment — a headline from 10 minutes ago should
 * move the live score more than one from yesterday. Exponential decay,
 * half-life in hours: a headline's weight halves every `halfLifeHours`.
 */
export function weightedSentimentAvg(items: NewsItem[], halfLifeHours = 6): number {
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
  return weightSum > 0 ? scoreSum / weightSum : 0;
}

/** Fetches headlines across macro news desks — the "general" feed. */
export async function fetchNewsFeed(maxItems = 120): Promise<NewsItem[]> {
  const results = await Promise.all(
    NEWS_SOURCES.map(async (src) => ({ source: src.label, items: await fetchRssHeadlines(src.url) }))
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
