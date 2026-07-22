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
  // color ("Comex Gold, Silver Settle Lower") - keyword-gate just these two
  // so the pooled feed stays event-driven instead of daily price chatter.
  { label: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", filterMacro: true },
  { label: "FXStreet", url: "https://www.fxstreet.com/rss/news", filterMacro: true },
  { label: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", filterMacro: true },
];

/**
 * Keyword gate applied to specific sources in the pooled general feed (see
 * filterMacro above). Not applied to per-asset feeds, which are
 * intentionally ticker-specific.
 */
const MACRO_KEYWORDS = [
  "fed", "fomc", "federal reserve", "powell", "warsh", "ecb", "lagarde", "central bank",
  "boe", "boj", "pboc", "rate cut", "rate hike", "rate decision", "rate pause",
  "interest rate", "monetary policy", "hawkish", "dovish",
  "inflation", "cpi", "pce", "disinflation", "deflation", "stagflation",
  "gdp", "recession", "economy", "economic", "growth", "soft landing", "hard landing",
  "jobs report", "payrolls", "unemployment", "jobless", "labor market", "labor force",
  "yield", "yields", "treasury", "bond market", "bond yields", "dollar", "currency", "fx",
  "tariff", "trade war", "trade deal", "sanctions", "opec", "oil price", "supply chain",
  "geopolitic", "war", "ceasefire", "truce", "conflict", "election", "government shutdown",
  "debt ceiling", "budget", "deficit", "stimulus", "quantitative easing", "quantitative tightening",
  "stock market", "wall street", "risk assets", "equity market", "market selloff", "rally",
];

function isMacroRelevant(item: RssItem): boolean {
  const t = `${item.title} ${item.description ?? ""}`.toLowerCase();
  return MACRO_KEYWORDS.some((k) => t.includes(k));
}

/**
 * Per-asset feeds used to hit Yahoo's ticker headline RSS, which for these
 * symbols (mostly futures/ETFs, not single stocks) mostly returns generic
 * "Gold Price Forecast" technical-analysis churn rather than the actual
 * macro drivers of that asset. Instead, asset feeds are now built by
 * filtering the SAME pooled macro desks used for the general feed down to
 * headlines that are actually about that asset's fundamental drivers -
 * real Fed/ECB/OPEC/growth coverage, keyword-matched per symbol, not price
 * chatter from a random forecasting site.
 */
const ASSET_KEYWORDS: Record<string, string[]> = {
  "^GSPC": ["s&p 500", "s&p500", "wall street", "stock market", "stocks", "equities", "equity market", "dow jones", "risk assets", "market selloff", "rally", "wall st"],
  "^IXIC": ["nasdaq", "tech stocks", "big tech", "ai stocks", "chipmakers", "semiconductor", "growth stocks", "technology sector", "megacap", "wall street", "stock market"],
  "CL=F": ["oil", "crude", "wti", "brent", "opec", "barrel", "energy prices", "petroleum", "xti"],
  "GC=F": ["gold", "bullion", "safe haven", "safe-haven", "precious metal", "xau"],
  "HG=F": ["copper", "industrial metal", "dr. copper"],
  "DX-Y.NYB": ["dollar", "dxy", "greenback", "usd", "dollar index", "currency market", "forex", "eur/usd", "gbp/usd"],
  "HYG": ["high yield", "high-yield", "junk bond", "credit spread", "corporate bond", "corporate debt", "credit market", "leveraged loan", "credit conditions", "default risk"],
  "TLT": ["treasury", "treasuries", "bond market", "10-year", "10 year yield", "30-year", "long bond", "yield curve", "bond yields", "government debt", "duration", "yield", "yields"],
  "SI=F": ["silver", "precious metal", "xag"],
  "NG=F": ["natural gas", "henry hub", "natgas", "lng", "gas prices"],
};

function isAssetRelevant(item: RssItem, symbol: string): boolean {
  const keywords = ASSET_KEYWORDS[symbol];
  if (!keywords) return false;
  const t = `${item.title} ${item.description ?? ""}`.toLowerCase();
  return keywords.some((k) => t.includes(k));
}

export interface NewsItem {
  title: string;
  link: string | null;
  pubDate: string | null; // ISO, or null when the feed gave no date - never fabricated as "now"
  source: string; // which desk it came from
  sentimentScore: number; // -1..1
  sentimentLabel: "bullish" | "bearish" | "neutral";
}

/**
 * Scoring text for a headline: title plus its description/dek when the feed
 * provides one (most of them do, and it's real article content, not just
 * the headline), skipped when the description just duplicates the title
 * verbatim, which some gov press feeds do.
 */
function scoringText(h: RssItem): string {
  const desc = h.description?.trim();
  if (!desc || desc.toLowerCase() === h.title.trim().toLowerCase()) return h.title;
  return `${h.title}. ${desc}`;
}

/** Dedupes by title, scores each headline (title + description) sorts newest first. */
function mergeAndScore(results: { source: string; items: RssItem[] }[], maxItems: number): NewsItem[] {
  const seen = new Set<string>();
  const merged: NewsItem[] = [];

  for (const { source, items } of results) {
    for (const h of items) {
      const key = h.title.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const sentiment = scoreSentiment(scoringText(h));
      merged.push({
        title: h.title,
        link: h.link,
        // Never fabricate a date. An undated headline used to be stamped
        // "now", which shot it to the top of the feed AND gave it maximum
        // weight in the recency-weighted sentiment score - a single stale
        // undated item could then dominate the live read. Left null instead:
        // sorted last, minimum weight, rendered as "undated".
        pubDate: h.pubDate ?? null,
        source,
        sentimentScore: sentiment.score,
        sentimentLabel: sentiment.label,
      });
    }
  }

  // Dated newest-first; undated (null) always last.
  merged.sort((a, b) => (b.pubDate ? new Date(b.pubDate).getTime() : 0) - (a.pubDate ? new Date(a.pubDate).getTime() : 0));
  return merged.slice(0, maxItems);
}

/**
 * Stretches an already -1..1 aggregate outward, same shape as the
 * per-headline polarization curve in sentiment.ts - a smoothed average of
 * polarized inputs still regresses toward the middle, so re-polarize after
 * aggregating or the final number reads flatter than the headlines it came from.
 */
function polarize(x: number): number {
  return Math.sign(x) * Math.pow(Math.min(1, Math.abs(x)), 0.6);
}

/**
 * Recency-weighted average sentiment - a headline from 10 minutes ago should
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
    // Undated headlines get the floor weight (treated as maximally old), not
    // the "now" weight a fabricated timestamp used to hand them.
    const ts = it.pubDate ? new Date(it.pubDate).getTime() : NaN;
    const ageHours = Number.isFinite(ts) ? Math.max(0, (now - ts) / 3_600_000) : Infinity;
    const weight = Math.pow(0.5, ageHours / halfLifeHours);
    weightSum += weight;
    scoreSum += weight * it.sentimentScore;
  }
  return weightSum > 0 ? polarize(scoreSum / weightSum) : 0;
}

/**
 * Smoothed sentiment trend for charting - an exponentially-weighted running
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
  // Undated items can't be placed on a timeline - they're excluded from the
  // trend line entirely (they still count in the aggregate score above).
  const chronological = [...items].filter((it) => it.pubDate).reverse(); // oldest -> newest
  const out: { date: string; value: number }[] = [];
  let weightSum = 0;
  let scoreSum = 0;
  let lastTime: number | null = null;

  for (const it of chronological) {
    const t = new Date(it.pubDate as string).getTime();
    if (lastTime !== null) {
      const elapsedHours = Math.max(0, (t - lastTime) / 3_600_000);
      const decay = Math.pow(0.5, elapsedHours / halfLifeHours);
      weightSum *= decay;
      scoreSum *= decay;
    }
    weightSum += 1;
    scoreSum += it.sentimentScore;
    lastTime = t;
    out.push({ date: it.pubDate as string, value: weightSum > 0 ? polarize(scoreSum / weightSum) : 0 });
  }

  return out;
}

export interface NewsPool {
  source: string;
  items: RssItem[];
}

/**
 * Fetches every macro desk once so both the general feed and all ten
 * per-asset feeds can be built from the same data instead of each asset
 * hitting its own separate source (which is how the old Yahoo-per-ticker
 * approach worked, and why it needed 10 extra network calls per refresh).
 */
export async function fetchMacroNewsPool(): Promise<NewsPool[]> {
  return Promise.all(
    NEWS_SOURCES.map(async (src) => {
      const items = await fetchRssHeadlines(src.url);
      return { source: src.label, items: src.filterMacro ? items.filter(isMacroRelevant) : items };
    })
  );
}

/** Scores the pooled macro desks as-is - the "general" feed. */
export function scoreGeneralFeed(pool: NewsPool[], maxItems = 120): NewsItem[] {
  return mergeAndScore(pool, maxItems);
}

/**
 * Asset-specific feed for a single tracked symbol, built by filtering the
 * same pooled macro desks down to headlines about that asset's actual
 * fundamental drivers (Fed/ECB/OPEC/growth coverage mentioning it), not a
 * per-ticker RSS feed full of generic price-forecast churn.
 */
export function scoreAssetFeed(pool: NewsPool[], symbol: string, maxItems = 40): NewsItem[] {
  const filtered = pool.map(({ source, items }) => ({ source, items: items.filter((h) => isAssetRelevant(h, symbol)) }));
  return mergeAndScore(filtered, maxItems);
}
