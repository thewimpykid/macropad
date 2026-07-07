const BASE = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";

/**
 * CFTC legacy futures-only COT, queried by contract market code — NOT display
 * name. The commission renames contracts ("10-YEAR U.S. TREASURY NOTES" became
 * "UST 10Y NOTE", "U.S. DOLLAR INDEX" became "USD INDEX", the NQ e-mini became
 * "NASDAQ MINI"), and a name-based query silently returns nothing after a
 * rename. Codes are stable across the full history.
 */
export const COT_CODES = {
  ES: "13874A",
  NQ: "209742",
  UST_10Y: "043602",
  UST_2Y: "042601",
  DXY: "098662",
  GOLD: "088691",
  WTI: "067651",
  COPPER: "085692",
  SILVER: "084691",
  NATGAS: "023651",
  VIX: "1170E1",
} as const;

interface CftcRow {
  report_date_as_yyyy_mm_dd: string;
  noncomm_positions_long_all: string;
  noncomm_positions_short_all: string;
  open_interest_all: string;
}

export interface CotPoint {
  date: string;
  /** Net non-commercial position, contracts. */
  net: number;
  /** Net as % of open interest — comparable across time and contracts. */
  netPctOi: number | null;
}

async function fetchRows(code: string, limit: number): Promise<CftcRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("$where", `cftc_contract_market_code = '${code}'`);
  url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
  url.searchParams.set(
    "$select",
    "report_date_as_yyyy_mm_dd,noncomm_positions_long_all,noncomm_positions_short_all,open_interest_all"
  );
  url.searchParams.set("$limit", String(limit));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

/** Chronological (oldest -> newest) net-position history with dates and %OI. */
export async function fetchCotSeries(code: string, limit = 156): Promise<CotPoint[]> {
  const rows = await fetchRows(code, limit);
  return rows
    .slice()
    .reverse()
    .map((r) => {
      const net = Number(r.noncomm_positions_long_all) - Number(r.noncomm_positions_short_all);
      const oi = Number(r.open_interest_all);
      return {
        date: r.report_date_as_yyyy_mm_dd.slice(0, 10),
        net,
        netPctOi: oi > 0 ? (net / oi) * 100 : null,
      };
    });
}

/**
 * COT Index: where the latest net position sits in its trailing range,
 * 0 = most short of the window, 100 = most long. The standard way COT is
 * actually read — raw contract counts are meaningless across contracts and
 * across years of changing open interest.
 */
export function cotIndex(series: CotPoint[], window = 156): number | null {
  const slice = series.slice(-window);
  if (slice.length < 20) return null;
  const nets = slice.map((p) => p.net);
  const min = Math.min(...nets);
  const max = Math.max(...nets);
  if (max === min) return 50;
  return ((nets[nets.length - 1] - min) / (max - min)) * 100;
}

export function fmtNet(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("en-US")}`;
}
