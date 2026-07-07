import { supabase } from "@/lib/supabase";
import { macroPanels, type MacroPanel, type SeriesStatus, type HistoryPoint, type ExtraStat, type SeriesPayload } from "@/lib/macroData";

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
  if (!supabase) {
    return { panels: macroPanels, lastUpdated: null };
  }

  // payload is a later migration — retry without it so a pre-migration DB
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
    return { panels: macroPanels, lastUpdated: null };
  }

  const byId = new Map<string, DbRow>(data.map((row) => [row.id, row]));
  let lastUpdated: string | null = null;

  const panels = macroPanels.map((panel) => ({
    ...panel,
    series: panel.series.map((s) => {
      const row = byId.get(s.id);
      if (!row) return s;
      if (!lastUpdated || row.updated_at > lastUpdated) lastUpdated = row.updated_at;
      return {
        ...s,
        value: row.value,
        status: row.status,
        note: row.note,
        zscore: row.zscore,
        sparkline: row.sparkline,
        windowLabel: row.window_label,
        history: row.history,
        extraStats: row.extra_stats,
        payload: row.payload ?? null,
      };
    }),
  }));

  return { panels, lastUpdated };
}
