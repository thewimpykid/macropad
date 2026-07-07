export async function fetchYahooPrice(symbol: string): Promise<{ price: number | null; prevClose: number | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return { price: null, prevClose: null };
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) return { price: null, prevClose: null };
  return {
    price: meta.regularMarketPrice ?? null,
    prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
  };
}

export interface YahooSeries {
  timestamps: number[];
  closes: (number | null)[];
}

/** Closes over `range` (e.g. "2y") at `interval` (default weekly), chronological (oldest -> newest). */
export async function fetchYahooHistory(symbol: string, range = "2y", interval = "1wk"): Promise<YahooSeries> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return { timestamps: [], closes: [] };
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return { timestamps: [], closes: [] };
  return {
    timestamps: result.timestamp ?? [],
    closes: result.indicators?.quote?.[0]?.close ?? [],
  };
}

/** Align two series by day and divide a/b, keeping dates. Chronological. */
export function ratioSeriesDated(a: YahooSeries, b: YahooSeries): { date: string; value: number }[] {
  const bByWeek = new Map<number, number>();
  b.timestamps.forEach((t, i) => {
    const close = b.closes[i];
    if (close !== null) bByWeek.set(Math.round(t / 86400), close);
  });
  const out: { date: string; value: number }[] = [];
  a.timestamps.forEach((t, i) => {
    const aClose = a.closes[i];
    const bClose = bByWeek.get(Math.round(t / 86400));
    if (aClose !== null && bClose) {
      out.push({ date: new Date(t * 1000).toISOString().slice(0, 10), value: aClose / bClose });
    }
  });
  return out;
}

/** Align two weekly series by nearest timestamp and divide a/b, chronological. */
export function ratioSeries(a: YahooSeries, b: YahooSeries): number[] {
  const bByWeek = new Map<number, number>();
  b.timestamps.forEach((t, i) => {
    const close = b.closes[i];
    if (close !== null) bByWeek.set(Math.round(t / 86400), close);
  });
  const out: number[] = [];
  a.timestamps.forEach((t, i) => {
    const aClose = a.closes[i];
    const bClose = bByWeek.get(Math.round(t / 86400));
    if (aClose !== null && bClose) out.push(aClose / bClose);
  });
  return out;
}

/** YahooSeries -> [{date, value}], skipping null closes. Chronological. */
export function toDatedSeries(series: YahooSeries): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  series.timestamps.forEach((t, i) => {
    const close = series.closes[i];
    if (close !== null) out.push({ date: new Date(t * 1000).toISOString().slice(0, 10), value: close });
  });
  return out;
}

export interface YahooHeadline {
  title: string;
  link: string | null;
  pubDate: string | null; // ISO
}

/** All headlines from a ticker's RSS feed, not just the first. */
export async function fetchYahooHeadlines(symbol: string): Promise<YahooHeadline[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: YahooHeadline[] = [];
  for (const item of items) {
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/^<!\[CDATA\[(.*)\]\]>$/, "$1").trim();
    if (!title) continue;
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? null;
    const rawDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim();
    const pubDate = rawDate && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate).toISOString() : null;
    out.push({ title, link, pubDate });
  }
  return out;
}

export async function fetchYahooHeadline(symbol: string): Promise<string | null> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/);
  if (!itemMatch) return null;
  const titleMatch = itemMatch[1].match(/<title>([\s\S]*?)<\/title>/);
  return titleMatch ? titleMatch[1].replace(/^<!\[CDATA\[(.*)\]\]>$/, "$1").trim() : null;
}
