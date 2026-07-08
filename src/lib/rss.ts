export interface RssItem {
  title: string;
  link: string | null;
  pubDate: string | null; // ISO, if parseable
  description: string | null; // article summary/dek, used to enrich sentiment scoring beyond the headline
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return null;
  return decodeXmlEntities(m[1].replace(/^<!\[CDATA\[(.*)\]\]>$/, "$1")).trim();
}

/** Generic RSS 2.0 headline parser — works against any well-formed feed, not just Yahoo. */
export async function fetchRssHeadlines(url: string): Promise<RssItem[]> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .map((block) => {
      const title = extractTag(block, "title");
      if (!title) return null;
      const link = extractTag(block, "link");
      const pubDateRaw = extractTag(block, "pubDate");
      const pubDate = pubDateRaw ? new Date(pubDateRaw).toISOString() : null;
      const descriptionRaw = extractTag(block, "description");
      const description = descriptionRaw ? descriptionRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null : null;
      return { title, link, pubDate, description };
    })
    .filter((h): h is RssItem => h !== null);
}
