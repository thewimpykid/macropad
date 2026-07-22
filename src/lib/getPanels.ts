import { supabaseAdmin } from "@/lib/supabaseServer";
import { macroPanels, type MacroPanel, type MacroSeries, type SeriesStatus, type HistoryPoint, type ExtraStat, type SeriesPayload } from "@/lib/macroData";
import { decodeXmlEntities } from "@/lib/rss";

/*
 * Headlines ingested before the RSS decoder handled numeric/named entities
 * were stored with raw "&apos;"/"&#x2018;" sequences, and refreshes only
 * append - old rows never get rewritten. Decode again on the way out so the
 * whole stored history is clean regardless of when it was ingested.
 */
function cleanPayload(payload: SeriesPayload | null): SeriesPayload | null {
  if (!payload?.headlines?.length) return payload;
  return {
    ...payload,
    headlines: payload.headlines.map((h) => ({
      ...h,
      title: decodeXmlEntities(h.title),
      description: h.description ? decodeXmlEntities(h.description) : h.description,
    })),
  };
}

/*
 * `source` is never sent to the client. It lives only in the static catalogue
 * for internal reference; the browser must not learn where any series comes
 * from, so we blank it on every series before it can reach a client component.
 */
function stripSource(s: MacroSeries): MacroSeries {
  return s.source === "" ? s : { ...s, source: "" };
}

interface DbRow {
  id: string;
  value: string;
  status: SeriesStatus;
  note: string;
  zscore: number | null;
  sparkline: number[] | null;
  window_label: string | null;
  history: HistoryPoint[] | null;
  extra_stats: ExtraStat[] | null;
  payload: SeriesPayload | null;
  updated_at: string;
}

export async function getPanels(): Promise<{ panels: MacroPanel[]; lastUpdated: string | null }> {
  // Read with the service-role client (server-only, bypasses RLS). The table
  // has NO public-read policy, so this is the only path in; the public anon
  // key in the browser can no longer dump macro_series directly.
  const supabase = supabaseAdmin;
  if (!supabase) {
    const panels = macroPanels.map((p) => ({ ...p, series: p.series.map(stripSource) }));
    return { panels, lastUpdated: null };
  }

  // payload is a later migration - retry without it so a pre-migration DB
  // degrades to "no news feed" instead of a blank dashboard.
  let data: DbRow[] | null = null;
  let error: { message: string } | null = null;
  {
    const res = await supabase
      .from("macro_series")
      .select("id, value, status, note, zscore, sparkline, window_label, history, extra_stats, payload, updated_at");
    data = res.data as DbRow[] | null;
    error = res.error;
  }
  if (error && /payload/i.test(error.message)) {
    const res = await supabase
      .from("macro_series")
      .select("id, value, status, note, zscore, sparkline, window_label, history, extra_stats, updated_at");
    data = res.data as DbRow[] | null;
    error = res.error;
  }

  if (error || !data) {
    const panels = macroPanels.map((p) => ({ ...p, series: p.series.map(stripSource) }));
    return { panels, lastUpdated: null };
  }

  const byId = new Map<string, DbRow>(data.map((row) => [row.id, row]));

  // The newest updated_at across the whole table = when the last successful
  // refresh ran. A successful refresh stamps every row it fetched with this
  // same instant, so any row whose updated_at trails it by more than a small
  // margin was SKIPPED that run (its upstream failed) and is showing a stale
  // value. Compute the max first so every row can be judged against it.
  const newestUpdatedAt = data.reduce<string | null>((max, row) => (!max || row.updated_at > max ? row.updated_at : max), null);
  const newestMs = newestUpdatedAt ? new Date(newestUpdatedAt).getTime() : 0;
  const STALE_ROW_LAG_MS = 5 * 60 * 1000; // same-run rows share an identical stamp; anything materially behind was skipped

  const panels = macroPanels.map((panel) => ({
    ...panel,
    series: panel.series.map((s) => {
      const row = byId.get(s.id);
      if (!row) return stripSource(s);
      const rowMs = new Date(row.updated_at).getTime();
      const stale = newestMs - rowMs > STALE_ROW_LAG_MS;
      const history = row.history;
      return {
        ...s,
        value: row.value,
        status: row.status,
        note: row.note,
        zscore: row.zscore,
        sparkline: row.sparkline,
        windowLabel: row.window_label,
        history,
        extraStats: row.extra_stats,
        payload: row.payload ?? null,
        source: "",
        stale,
        dataThrough: history?.length ? history[history.length - 1].date : null,
      };
    }),
  }));

  return { panels, lastUpdated: newestUpdatedAt };
}
