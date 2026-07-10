import { MARKET_SYMBOLS } from "@/lib/markets";

export type SeriesStatus = "up" | "down" | "flat" | "pending";

export interface HistoryPoint {
  date: string;
  value: number;
}

export interface ExtraStat {
  label: string;
  value: string;
  flag?: boolean;
  caption?: string;
  history?: HistoryPoint[];
  zscore?: number | null;
  threshold?: number;
  windowLabel?: string;
}

export interface NewsHeadlinePayload {
  title: string;
  link: string | null;
  pubDate: string;
  source: string;
  sentimentScore: number;
  sentimentLabel: "bullish" | "bearish" | "neutral";
  /** "headline" = real scraped article. "indicator"/"metric" = generated from actual FRED/CFTC data, not text. */
  kind?: "headline" | "indicator" | "metric";
  /** Explanation shown for indicator/metric events instead of a clickable link (there is no article to link to). */
  description?: string;
}

/** Row-specific extra data too structured for extra_stats: scored headlines, daily price bars. */
export interface SeriesPayload {
  headlines?: NewsHeadlinePayload[];
  dailyHistory?: HistoryPoint[];
}

export interface MacroSeries {
  id: string;
  name: string;
  note: string;
  value: string;
  status: SeriesStatus;
  zscore: number | null;
  sparkline: number[] | null;
  windowLabel: string | null;
  history: HistoryPoint[] | null;
  extraStats: ExtraStat[] | null;
  payload: SeriesPayload | null;
  source: string;
}

export interface MacroPanel {
  id: string;
  title: string;
  description: string;
  series: MacroSeries[];
}

const blank = (
  id: string,
  name: string,
  note: string,
  source: string
): MacroSeries => ({
  id,
  name,
  note,
  value: "-",
  status: "pending",
  zscore: null,
  sparkline: null,
  windowLabel: null,
  history: null,
  extraStats: null,
  payload: null,
  source,
});

export const macroPanels: MacroPanel[] = [
  {
    id: "us-macro",
    title: "US Macroeconomics",
    description: "Liquidity, rates, inflation, labor, growth, and consumer - full macro stack.",
    series: [
      blank("us-macro:h41-balance-sheet", "H.4.1 Fed Balance Sheet", "Weekly, Fed H.4.1 release", "FRED WALCL"),
      blank("us-macro:sofr-effr-iorb", "SOFR / EFFR / IORB", "Funding rate spread stack", "FRED SOFR/EFFR/IORB"),
      blank("us-macro:hy-credit-spread", "High Yield Credit Spread", "ICE BofA HY OAS", "FRED BAMLH0A0HYM2"),
      blank("us-macro:ig-credit-spread", "IG Corporate Credit Spread", "ICE BofA US Corporate (investment grade) OAS", "FRED BAMLC0A0CM"),
      blank("us-macro:cpi-yoy", "CPI Inflation (YoY)", "Headline CPI, year-over-year", "FRED CPIAUCSL"),
      blank("us-macro:core-cpi", "Core CPI (YoY)", "Ex food & energy - the sticky part", "FRED CPILFESL"),
      blank("us-macro:core-pce", "Core PCE (YoY)", "The Fed's actual target metric", "FRED PCEPILFE"),
      blank("us-macro:unemployment", "Unemployment Rate", "U-3 headline unemployment", "FRED UNRATE"),
      blank("us-macro:payrolls", "Nonfarm Payrolls", "3m average monthly gain", "FRED PAYEMS"),
      blank("us-macro:jobless-claims", "Initial Jobless Claims", "Weekly - earliest hard labor data", "FRED ICSA"),
      blank("us-macro:gdp", "Real GDP (YoY)", "Judged against ~2% trend growth", "FRED GDPC1"),
      blank("us-macro:m2", "M2 Money Supply", "YoY growth of broad money", "FRED M2SL"),
      blank("us-macro:reverse-repo", "Reverse Repo (RRP)", "Liquidity parked at the Fed, $B", "FRED RRPONTSYD"),
      blank("us-macro:retail-sales", "Retail Sales (YoY)", "Hard-data consumer confirmation", "FRED RSAFS"),
      blank("us-macro:housing-starts", "Housing Starts (YoY)", "Most rate-sensitive sector", "FRED HOUST"),
      blank("us-macro:10y-yield", "10y Treasury Yield", "Benchmark long rate", "FRED DGS10"),
      blank("us-macro:industrial-production", "Industrial Production", "YoY growth of the output index", "FRED INDPRO"),
      blank("us-macro:consumer-sentiment", "Consumer Sentiment", "U. Michigan index", "FRED UMCSENT"),
    ],
  },
  {
    id: "yield-rates",
    title: "Yield Rates",
    description: "Curve shape, levels, positioning, and inflation expectations across the Treasury complex.",
    series: [
      blank("yield-rates:10y2y-spread", "US 10y-2y Yield Spread", "Curve inversion watch", "FRED T10Y2Y"),
      blank("yield-rates:10y3m-spread", "US 10y-3m Yield Spread", "NY Fed's preferred recession spread", "FRED T10Y3M"),
      blank("yield-rates:2y-yield", "2y Treasury Yield", "Front-end rate, prices Fed path", "FRED DGS2"),
      blank("yield-rates:10y-yield", "10y Treasury Yield", "Benchmark long rate", "FRED DGS10"),
      blank("yield-rates:30y-yield", "30y Treasury Yield", "Long-bond, fiscal/term-premium sensitive", "FRED DGS30"),
      blank("yield-rates:10y-cot", "10y Treasury Futures COT", "Net spec positioning, ZN", "CFTC Legacy COT"),
      blank("yield-rates:2y-cot", "2y Treasury Futures COT", "Net spec positioning, front end", "CFTC Legacy COT"),
      blank("yield-rates:breakeven", "5y/10y Breakeven Inflation", "Market inflation expectation", "FRED T5YIE/T10YIE"),
      blank("yield-rates:forward-inflation", "5y5y Forward Inflation", "Long-run Fed-relevant inflation gauge", "FRED T5YIFR"),
    ],
  },
  {
    id: "cot-positioning",
    title: "COT Positioning",
    description:
      "Net positioning per market across trader categories - large specs plus leveraged funds / managed money and the institutional side, with 36M and 6M COT indexes and net-as-%-of-open-interest.",
    series: [
      blank("cot:es", "S&P 500 (ES)", "Spec net position, e-mini", "CFTC Legacy COT 13874A"),
      blank("cot:nq", "Nasdaq-100 (NQ)", "Spec net position, e-mini", "CFTC Legacy COT 209742"),
      blank("cot:zn", "10y Treasury (ZN)", "Spec net position", "CFTC Legacy COT 043602"),
      blank("cot:zt", "2y Treasury (ZT)", "Spec net position", "CFTC Legacy COT 042601"),
      blank("cot:gold", "Gold (GC)", "Spec net position, COMEX", "CFTC Legacy COT 088691"),
      blank("cot:wti", "Crude Oil (CL)", "Spec net position, NYMEX WTI", "CFTC Legacy COT 067651"),
      blank("cot:copper", "Copper (HG)", "Spec net position, COMEX", "CFTC Legacy COT 085692"),
      blank("cot:silver", "Silver (SI)", "Spec net position, COMEX", "CFTC Legacy COT 084691"),
      blank("cot:natgas", "Natural Gas (NG)", "Spec net position, NYMEX Henry Hub", "CFTC Legacy COT 023651"),
      blank("cot:dxy", "Dollar Index (DX)", "Spec net position, ICE", "CFTC Legacy COT 098662"),
      blank("cot:vix", "VIX Futures", "Spec net position - structurally short", "CFTC Legacy COT 1170E1"),
    ],
  },
  {
    id: "transmission",
    title: "Transmission Check",
    description:
      "Is the macro impulse actually reaching markets? Financial conditions, real rates, the dollar, credit appetite, breadth, and cycle leadership.",
    series: [
      blank("transmission:nfci", "Financial Conditions (NFCI)", "Chicago Fed, 0 = average, + = tight", "FRED NFCI"),
      blank("transmission:real-10y", "10y Real Yield (TIPS)", "The true discount rate", "FRED DFII10"),
      blank("transmission:broad-dollar", "Broad Dollar Index", "Fed trade-weighted, global tightening proxy", "FRED DTWEXBGS"),
      blank("transmission:copper-gold", "Copper/Gold Ratio", "Growth vs fear - tracks the 10y", "Yahoo Finance HG=F / GC=F"),
      blank("transmission:gold-silver", "Gold/Silver Ratio", "Fear metal vs industrial metal", "Yahoo Finance GC=F / SI=F"),
      blank("transmission:crude-natgas", "Crude/NatGas Ratio", "Global vs domestic energy split", "Yahoo Finance CL=F / NG=F"),
      blank("transmission:hyg-lqd", "HYG / LQD Ratio", "Junk vs quality - credit risk appetite", "Yahoo Finance HYG / LQD"),
      blank("transmission:rsp-spy", "RSP / SPY Ratio", "Equal-weight vs cap-weight - breadth", "Yahoo Finance RSP / SPY"),
      blank("transmission:smh-spy", "SMH / SPY Ratio", "Semis vs market - cycle leadership", "Yahoo Finance SMH / SPY"),
    ],
  },
  {
    id: "geopolitics",
    title: "Geopolitics",
    description: "Policy and macro uncertainty, and how markets are positioning around it - not headlines.",
    series: [
      blank("geo:epu", "US Policy Uncertainty (EPU)", "News-based daily index, 30d average", "FRED USEPUINDXD"),
      blank("geo:gepu", "Global Policy Uncertainty", "GDP-weighted across major economies", "FRED GEPUCURRENT"),
      blank("geo:equity-uncertainty", "Equity Market Uncertainty", "News + options-based, daily", "FRED WLEMUINDXD"),
      blank("geo:defense-spy", "Defense / Market Ratio", "ITA vs SPY - risk-on tilt toward defense names", "Yahoo Finance ITA / SPY"),
      blank("geo:news-feed", "News Sentiment", "Pooled macro headlines, keyword-lexicon scored", "CNBC · Fed · WSJ · Yahoo · FXStreet"),
    ],
  },
  {
    // Not shown in the main nav - pulled directly by id from the News page's
    // asset tabs. Kept as its own panel only so getPanels() has a catalogue
    // entry to hydrate against.
    id: "asset-news",
    title: "Asset News",
    description: "Per-asset headline sentiment.",
    series: MARKET_SYMBOLS.map((m) =>
      blank(`asset-news:${m.symbol}`, `${m.label} News`, "Real indicator events (FRED/CFTC) plus matching headlines, not headline-only sentiment", "FRED · CFTC · CNBC · Fed · ECB · WSJ · FXStreet · MarketWatch")
    ),
  },
  {
    id: "volatility",
    title: "Volatility",
    description: "What markets are actually pricing for risk - the implied-vol complex and its term structure.",
    series: [
      blank("geo:vix", "VIX", "S&P 500 implied vol, 30d", "FRED VIXCLS"),
      blank("geo:vix-term", "VIX Term Structure", "VIX3M / VIX - below 1 = backwardation = stress", "Yahoo ^VIX3M / ^VIX"),
      blank("geo:vvix", "VVIX", "Vol-of-vol - implied vol of the VIX itself", "Yahoo ^VVIX"),
      blank("geo:skew", "CBOE SKEW", "Tail-risk gauge - priced crash probability", "Yahoo ^SKEW"),
      blank("geo:ovx", "OVX", "Crude oil implied vol - supply-shock gauge", "FRED OVXCLS"),
      blank("geo:gvz", "GVZ", "Gold implied vol - safe-haven flow gauge", "FRED GVZCLS"),
      blank("geo:move", "MOVE Index", "Bond market implied vol", "Yahoo ^MOVE"),
    ],
  },
];
