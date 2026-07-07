import { fetchYahooHeadlines } from "@/lib/yahoo";
import { scoreSentiment } from "@/lib/sentiment";

/** Broad macro-relevant tickers to pool headlines from — indices, rates, and major commodities. */
const NEWS_TICKERS = ["^GSPC", "^IXIC", "^DJI", "CL=F", "GC=F", "SI=F", "NG=F", "HG=F", "DX-Y.NYB", "^VIX", "TLT", "HYG"];

export interface NewsItem {
  title: string;
  link: string | null;
  pubDate: string; // ISO
  source: string; // which ticker feed it came from
  sentimentScore: number; // -1..1
  sentimentLabel: "bullish" | "bearish" | "neutral";
}

/** Fetches headlines across many tickers, dedupes by title, scores each, sorts newest first. */
export async function fetchNewsFeed(maxItems = 100): Promise<NewsItem[]> {
  const results = await Promise.all(
    NEWS_TICKERS.map(async (symbol) => {
      const items = await fetchYahooHeadlines(symbol);
      return items.map((h) => ({ ...h, source: symbol }));
    })
  );

  const seen = new Set<string>();
  const merged: NewsItem[] = [];

  for (const items of results) {
    for (const h of items) {
      const key = h.title.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const sentiment = scoreSentiment(h.title);
      merged.push({
        title: h.title,
        link: h.link,
        pubDate: h.pubDate ?? new Date().toISOString(),
        source: h.source,
        sentimentScore: sentiment.score,
        sentimentLabel: sentiment.label,
      });
    }
  }

  merged.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  return merged.slice(0, maxItems);
}
