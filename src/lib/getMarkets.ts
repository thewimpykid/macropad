import { supabase } from "@/lib/supabase";
import type { HistoryPoint, SeriesStatus } from "@/lib/macroData";

export interface MarketRow {
  id: string;
  symbol: string;
  name: string;
  value: string;
  status: SeriesStatus;
  zscore: number | null;
  sparkline: number[] | null;
  history: HistoryPoint[] | null;
  /** Daily bars for the backtest's forward-return windows; weekly bars can't resolve a 1d return. */
  dailyHistory: HistoryPoint[] | null;
}

export async function getMarkets(): Promise<MarketRow[]> {
  if (!supabase) return [];
  // payload is a later migration — retry without it so a pre-migration DB
  // still returns markets (just without daily bars for the backtest).
  interface Row {
    id: string;
    name: string;
    note: string;
    value: string;
    status: SeriesStatus;
    zscore: number | null;
    sparkline: number[] | null;
    history: HistoryPoint[] | null;
    payload?: { dailyHistory?: HistoryPoint[] } | null;
  }
  let data: Row[] | null = null;
  let error: { message: string } | null = null;
  {
    const res = await supabase
      .from("macro_series")
      .select("id, name, note, value, status, zscore, sparkline, history, payload")
      .eq("panel_id", "market");
    data = res.data as Row[] | null;
    error = res.error;
  }
  if (error && /payload/i.test(error.message)) {
    const res = await supabase
      .from("macro_series")
      .select("id, name, note, value, status, zscore, sparkline, history")
      .eq("panel_id", "market");
    data = res.data as Row[] | null;
    error = res.error;
  }

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    symbol: row.note,
    name: row.name,
    value: row.value,
    status: row.status,
    zscore: row.zscore,
    sparkline: row.sparkline,
    history: row.history,
    dailyHistory: row.payload?.dailyHistory ?? null,
  }));
}
