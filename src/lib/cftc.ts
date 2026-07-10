const BASE = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";
/** Traders in Financial Futures (futures only) - dealer / asset manager / leveraged funds, for financial contracts. */
const TFF_BASE = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";
/** Disaggregated report (futures only) - producer/merchant / swap dealer / managed money, for physical commodities. */
const DISAGG_BASE = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";

/**
 * CFTC legacy futures-only COT, queried by contract market code - NOT display
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
  /** Net as % of open interest - comparable across time and contracts. */
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
 * actually read - raw contract counts are meaningless across contracts and
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
  if (n === null) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("en-US")}`;
}

/**
 * Which CFTC report carries a contract's trader-category breakdown:
 * financial contracts (equity indices, treasuries, FX, VIX) live in the TFF
 * report; physical commodities live in the Disaggregated report.
 */
export type ContractClass = "financial" | "commodity";

export interface CotCategories {
  /** Fast money: leveraged funds (TFF) or managed money (disaggregated). */
  fastMoney: CotPoint[];
  fastMoneyLabel: string;
  /** The other side's anchor category: asset managers (TFF) or producers/merchants (disaggregated). */
  institutional: CotPoint[];
  institutionalLabel: string;
}

/**
 * Column names differ per dataset AND per category within the disaggregated
 * dataset (managed money has an `_all` suffix, producer/merchant does not) -
 * verified against the live Socrata endpoints; a wrong name silently
 * returns undefined and every net would read NaN.
 */
interface TffRow {
  report_date_as_yyyy_mm_dd: string;
  lev_money_positions_long: string;
  lev_money_positions_short: string;
  asset_mgr_positions_long: string;
  asset_mgr_positions_short: string;
  open_interest_all: string;
}

interface DisaggRow {
  report_date_as_yyyy_mm_dd: string;
  m_money_positions_long_all: string;
  m_money_positions_short_all: string;
  prod_merc_positions_long: string;
  prod_merc_positions_short: string;
  open_interest_all: string;
}

function toCotPoints<T extends { report_date_as_yyyy_mm_dd: string; open_interest_all: string }>(
  rows: T[],
  long: (r: T) => string,
  short: (r: T) => string
): CotPoint[] {
  return rows
    .slice()
    .reverse()
    .map((r) => {
      const net = Number(long(r)) - Number(short(r));
      const oi = Number(r.open_interest_all);
      return {
        date: r.report_date_as_yyyy_mm_dd.slice(0, 10),
        net,
        netPctOi: oi > 0 ? (net / oi) * 100 : null,
      };
    })
    .filter((p) => !Number.isNaN(p.net));
}

/**
 * Trader-category net positions for one contract, from whichever report
 * (TFF / disaggregated) actually covers it. One fetch returns both
 * categories - the datasets carry every category per row.
 */
export async function fetchCotCategories(code: string, klass: ContractClass, limit = 156): Promise<CotCategories> {
  const base = klass === "financial" ? TFF_BASE : DISAGG_BASE;
  const select =
    klass === "financial"
      ? "report_date_as_yyyy_mm_dd,lev_money_positions_long,lev_money_positions_short,asset_mgr_positions_long,asset_mgr_positions_short,open_interest_all"
      : "report_date_as_yyyy_mm_dd,m_money_positions_long_all,m_money_positions_short_all,prod_merc_positions_long,prod_merc_positions_short,open_interest_all";

  const url = new URL(base);
  url.searchParams.set("$where", `cftc_contract_market_code = '${code}'`);
  url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
  url.searchParams.set("$select", select);
  url.searchParams.set("$limit", String(limit));

  const empty: CotCategories =
    klass === "financial"
      ? { fastMoney: [], fastMoneyLabel: "Leveraged funds", institutional: [], institutionalLabel: "Asset managers" }
      : { fastMoney: [], fastMoneyLabel: "Managed money", institutional: [], institutionalLabel: "Producers/merchants" };

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return empty;
  const rows = await res.json();

  if (klass === "financial") {
    const tff = rows as TffRow[];
    return {
      fastMoney: toCotPoints(tff, (r: TffRow) => r.lev_money_positions_long, (r: TffRow) => r.lev_money_positions_short),
      fastMoneyLabel: "Leveraged funds",
      institutional: toCotPoints(tff, (r: TffRow) => r.asset_mgr_positions_long, (r: TffRow) => r.asset_mgr_positions_short),
      institutionalLabel: "Asset managers",
    };
  }
  const dis = rows as DisaggRow[];
  return {
    fastMoney: toCotPoints(dis, (r: DisaggRow) => r.m_money_positions_long_all, (r: DisaggRow) => r.m_money_positions_short_all),
    fastMoneyLabel: "Managed money",
    institutional: toCotPoints(dis, (r: DisaggRow) => r.prod_merc_positions_long, (r: DisaggRow) => r.prod_merc_positions_short),
    institutionalLabel: "Producers/merchants",
  };
}
