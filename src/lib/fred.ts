const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

export interface FredPoint {
  date: string;
  value: number | null;
}

async function fetchRaw(seriesId: string, apiKey: string, limit: number): Promise<FredPoint[]> {
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`FRED ${seriesId} failed: ${res.status}`);
  }
  const data = await res.json();
  return (data.observations ?? []).map((o: { date: string; value: string }) => ({
    date: o.date,
    value: o.value === "." ? null : Number(o.value),
  }));
}

/** Latest two points, newest first - for a quick up/down read. */
export async function fetchFredSeries(seriesId: string, apiKey: string): Promise<FredPoint[]> {
  return fetchRaw(seriesId, apiKey, 2);
}

/** Chronological (oldest -> newest) history window, for z-score / sparkline. */
export async function fetchFredHistory(seriesId: string, apiKey: string, limit = 260): Promise<FredPoint[]> {
  const points = await fetchRaw(seriesId, apiKey, limit);
  return points.slice().reverse();
}

/** Release dates for a FRED release_id - real values (past and any future-scheduled) FRED itself publishes, not inferred cadence. */
export async function fetchReleaseDates(releaseId: number, apiKey: string, limit = 30): Promise<string[]> {
  const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}&include_release_dates_with_no_data=true`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FRED release ${releaseId} failed: ${res.status}`);
  const data = await res.json();
  return (data.release_dates ?? []).map((d: { date: string }) => d.date);
}

export function statusFromDelta(latest: number | null, prev: number | null): "up" | "down" | "flat" | "pending" {
  if (latest === null || prev === null) return "pending";
  if (latest > prev) return "up";
  if (latest < prev) return "down";
  return "flat";
}

export function fmt(n: number | null, opts: { decimals?: number; suffix?: string; scale?: number } = {}): string {
  if (n === null) return "-";
  const { decimals = 2, suffix = "", scale = 1 } = opts;
  return `${(n * scale).toFixed(decimals)}${suffix}`;
}
