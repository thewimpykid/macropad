export interface MarketDef {
  symbol: string;
  label: string;
}

export const MARKET_SYMBOLS: MarketDef[] = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "Nasdaq Composite" },
  { symbol: "CL=F", label: "Crude Oil (WTI)" },
  { symbol: "GC=F", label: "Gold" },
  { symbol: "HG=F", label: "Copper" },
  { symbol: "DX-Y.NYB", label: "Dollar Index (DXY)" },
  { symbol: "HYG", label: "High Yield Bond ETF" },
  { symbol: "TLT", label: "20y+ Treasury ETF" },
  { symbol: "SI=F", label: "Silver" },
  { symbol: "NG=F", label: "Natural Gas" },
];

export interface Impact {
  symbol: string;
  /**
   * +1: indicator printing HIGH vs its regime norm is bullish this asset.
   * -1: high is bearish this asset.
   */
  sign: 1 | -1;
  /** 0..1 — how much this indicator matters for this asset relative to others. */
  weight: number;
  rationale: string;
}

/**
 * Which assets each indicator actually moves, in which direction, and how much.
 * One indicator can (and usually does) matter for several assets — a single
 * link with a generic risk-on/off tone can't express "hot CPI is bearish bonds
 * AND bullish the dollar AND bearish gold via real rates" without contradicting
 * itself somewhere.
 *
 * Sign convention is always stated from the indicator being HIGH/above its
 * regime norm. Weights are relative salience, not statistical betas.
 */
export const IMPACTS: Record<string, Impact[]> = {
  "us-macro:h41-balance-sheet": [
    { symbol: "^GSPC", sign: 1, weight: 0.8, rationale: "Fed balance-sheet expansion is systemic liquidity — a primary tailwind for risk assets; QT is the headwind." },
    { symbol: "^IXIC", sign: 1, weight: 0.8, rationale: "Long-duration growth equity is the most liquidity-sensitive corner of the market." },
    { symbol: "GC=F", sign: 1, weight: 0.4, rationale: "Balance-sheet expansion debases the unit of account gold is priced in." },
  ],
  "us-macro:sofr-effr-iorb": [
    { symbol: "HYG", sign: -1, weight: 0.9, rationale: "Funding stress hits levered, credit-sensitive names first (Sept 2019 repo, SVB week)." },
    { symbol: "^GSPC", sign: -1, weight: 0.5, rationale: "Repo stress precedes broader volatility when the plumbing seizes." },
    { symbol: "DX-Y.NYB", sign: 1, weight: 0.4, rationale: "SOFR spiking above IORB is a direct dollar-scarcity signal — scarce dollars bid the dollar." },
  ],
  "us-macro:hy-credit-spread": [
    { symbol: "HYG", sign: -1, weight: 1.0, rationale: "This spread is HYG's price, inverted — widening is direct mark-to-market loss." },
    { symbol: "^GSPC", sign: -1, weight: 0.8, rationale: "Credit stress front-runs equity drawdowns; spreads widen before indices crack." },
    { symbol: "TLT", sign: 1, weight: 0.4, rationale: "Credit stress drives flight-to-quality into Treasuries." },
  ],
  "us-macro:cpi-yoy": [
    { symbol: "TLT", sign: -1, weight: 0.9, rationale: "Hot inflation pushes out cuts and lifts yields — direct duration loss." },
    { symbol: "DX-Y.NYB", sign: 1, weight: 0.5, rationale: "Hot CPI = hawkish Fed = rate support for the dollar." },
    { symbol: "GC=F", sign: -1, weight: 0.4, rationale: "Hot CPI raises real yields near-term — empirically gold's dominant (inverse) driver. Gold hedges the inflation that debases policy, not the print that provokes a hawkish response." },
    { symbol: "^GSPC", sign: -1, weight: 0.4, rationale: "Hawkish repricing compresses equity multiples." },
  ],
  "us-macro:unemployment": [
    { symbol: "^GSPC", sign: -1, weight: 0.8, rationale: "Rising unemployment (Sahm territory) is the classic already-in-recession tell." },
    { symbol: "TLT", sign: 1, weight: 0.7, rationale: "Labor deterioration forces cuts — bullish duration." },
    { symbol: "HYG", sign: -1, weight: 0.5, rationale: "Labor weakness is the earliest read on rising default risk in credit." },
  ],
  "us-macro:payrolls": [
    { symbol: "^GSPC", sign: 1, weight: 0.7, rationale: "Strong payrolls confirm expansion and reduce recession odds." },
    { symbol: "TLT", sign: -1, weight: 0.7, rationale: "Strong labor delays cuts and lifts yields." },
    { symbol: "DX-Y.NYB", sign: 1, weight: 0.5, rationale: "NFP strength is among the sharpest scheduled hawkish repricers of the dollar." },
  ],
  "us-macro:m2": [
    { symbol: "GC=F", sign: 1, weight: 0.6, rationale: "Broad money growth is a multi-quarter tailwind for hard assets." },
    { symbol: "^GSPC", sign: 1, weight: 0.4, rationale: "M2 expansion eventually shows up in asset prices." },
    { symbol: "SI=F", sign: 1, weight: 0.4, rationale: "Silver rides the same monetary-debasement bid as gold, with more beta." },
  ],
  "us-macro:core-cpi": [
    { symbol: "TLT", sign: -1, weight: 0.7, rationale: "Sticky core inflation is what actually keeps the Fed from cutting — direct duration risk." },
    { symbol: "DX-Y.NYB", sign: 1, weight: 0.4, rationale: "Core surprises move real-rate expectations and the dollar with them." },
  ],
  "us-macro:core-pce": [
    { symbol: "TLT", sign: -1, weight: 0.8, rationale: "The exact metric the Fed's reaction function targets — it moves the rate path directly." },
    { symbol: "GC=F", sign: -1, weight: 0.4, rationale: "Target-metric inflation running hot forces real rates up — gold's dominant inverse driver." },
    { symbol: "DX-Y.NYB", sign: 1, weight: 0.4, rationale: "Hawkish reaction-function pressure supports the dollar." },
  ],
  "us-macro:jobless-claims": [
    { symbol: "^GSPC", sign: -1, weight: 0.6, rationale: "Rising claims are the earliest hard-data labor signal — equities react fast." },
    { symbol: "HYG", sign: -1, weight: 0.5, rationale: "The highest-frequency read on deteriorating default risk." },
    { symbol: "TLT", sign: 1, weight: 0.6, rationale: "A cracking labor market is the Fed's clearest cutting trigger." },
  ],
  "us-macro:gdp": [
    { symbol: "^GSPC", sign: 1, weight: 0.5, rationale: "The headline growth number equities are ultimately pricing." },
    { symbol: "CL=F", sign: 1, weight: 0.4, rationale: "Growth surprises move expected energy demand directly." },
    { symbol: "HG=F", sign: 1, weight: 0.4, rationale: "Copper is priced as a real-time growth proxy — GDP is what it's tracking." },
  ],
  "us-macro:reverse-repo": [
    { symbol: "^GSPC", sign: -1, weight: 0.4, rationale: "Rising RRP parks liquidity at the Fed instead of in markets; the 2023-24 drawdown funded risk assets through QT." },
    { symbol: "GC=F", sign: -1, weight: 0.3, rationale: "Liquidity draining into the facility is the same headwind for gold, softer." },
  ],
  "us-macro:retail-sales": [
    { symbol: "^GSPC", sign: 1, weight: 0.5, rationale: "Hard-data confirmation of the consumer that is ~68% of GDP." },
    { symbol: "HYG", sign: 1, weight: 0.4, rationale: "Retail strength is a direct read on consumer-credit health." },
  ],
  "us-macro:housing-starts": [
    { symbol: "^GSPC", sign: 1, weight: 0.3, rationale: "Housing leads the broad cycle — expanding starts confirm the expansion." },
    { symbol: "TLT", sign: -1, weight: 0.4, rationale: "Resilient rate-sensitive activity means rates can stay higher for longer." },
    { symbol: "HYG", sign: 1, weight: 0.3, rationale: "Housing-linked credit is a meaningful chunk of high-yield issuance." },
  ],
  "us-macro:industrial-production": [
    { symbol: "HG=F", sign: 1, weight: 0.8, rationale: "\"Dr. Copper\" is priced off exactly this — real industrial demand." },
    { symbol: "NG=F", sign: 1, weight: 0.4, rationale: "Industrial and power-sector demand is a core natural gas consumption driver." },
    { symbol: "CL=F", sign: 1, weight: 0.4, rationale: "Industrial output is a direct driver of energy demand." },
    { symbol: "^GSPC", sign: 1, weight: 0.3, rationale: "Hard-data output growth corroborates the earnings cycle." },
  ],
  "us-macro:consumer-sentiment": [
    { symbol: "^GSPC", sign: 1, weight: 0.5, rationale: "Sentiment leads the consumer spending that is ~68% of GDP." },
  ],
  "yield-rates:10y2y-spread": [
    { symbol: "^GSPC", sign: 1, weight: 0.35, rationale: "A steep curve is the normal-expansion shape; inversion is the recession warning. Half-weighted vs 10y-3m to avoid double-counting the curve." },
  ],
  "yield-rates:10y3m-spread": [
    { symbol: "^GSPC", sign: 1, weight: 0.35, rationale: "The NY Fed's preferred recession spread. Half-weighted vs 2s10s to avoid double-counting the curve." },
  ],
  "yield-rates:2y-yield": [
    { symbol: "HYG", sign: -1, weight: 0.6, rationale: "The front end sets the cost of leverage for credit-sensitive borrowers." },
    { symbol: "DX-Y.NYB", sign: 1, weight: 0.6, rationale: "Front-end rate differentials are the dollar's main fundamental driver." },
    { symbol: "^GSPC", sign: -1, weight: 0.5, rationale: "Hawkish path pricing tightens financial conditions." },
  ],
  "yield-rates:10y-yield": [
    { symbol: "TLT", sign: -1, weight: 1.0, rationale: "TLT is long-duration Treasuries — priced almost exactly inverse to the 10y." },
    { symbol: "^IXIC", sign: -1, weight: 0.6, rationale: "Growth equity is the longest-duration equity — most sensitive to the discount rate." },
    { symbol: "GC=F", sign: -1, weight: 0.5, rationale: "Higher nominal yields raise the opportunity cost of holding zero-yield gold." },
  ],
  "yield-rates:30y-yield": [
    { symbol: "TLT", sign: -1, weight: 0.8, rationale: "The 30y is the duration risk TLT holders are directly underwriting." },
  ],
  "yield-rates:breakeven": [
    { symbol: "GC=F", sign: 1, weight: 0.8, rationale: "Rising market-priced inflation expectations are gold's core demand driver." },
    { symbol: "SI=F", sign: 1, weight: 0.5, rationale: "Silver trades the same inflation-expectation bid with more volatility." },
    { symbol: "TLT", sign: -1, weight: 0.6, rationale: "Breakevens are the inflation-compensation component of nominal yields." },
  ],
  "yield-rates:forward-inflation": [
    { symbol: "GC=F", sign: 1, weight: 0.5, rationale: "Long-run inflation anchor slipping = structural gold bid." },
    { symbol: "TLT", sign: -1, weight: 0.4, rationale: "An un-anchoring long run is the long bond's worst case." },
  ],
  "yield-rates:10y-cot": [
    { symbol: "TLT", sign: 1, weight: 0.3, rationale: "Spec net length = consensus bet on lower yields. Low weight: at extremes positioning is contrarian, so treat as a tilt, not a driver." },
  ],
  "yield-rates:2y-cot": [
    { symbol: "TLT", sign: 1, weight: 0.2, rationale: "Front-end positioning bleeds into broader duration bets; weakest tilt in the stack." },
  ],
  // --- COT positioning: consensus tilts, deliberately low-weighted ---
  "cot:es": [
    { symbol: "^GSPC", sign: 1, weight: 0.4, rationale: "Spec net length in ES is the leveraged consensus on this exact index." },
  ],
  "cot:nq": [
    { symbol: "^IXIC", sign: 1, weight: 0.4, rationale: "Spec net length in NQ is the leveraged consensus on tech." },
  ],
  "cot:zn": [
    { symbol: "TLT", sign: 1, weight: 0.3, rationale: "Same duration trade as TLT, levered." },
  ],
  "cot:zt": [
    { symbol: "TLT", sign: 1, weight: 0.2, rationale: "Front-end positioning tilt." },
  ],
  "cot:dxy": [
    { symbol: "DX-Y.NYB", sign: 1, weight: 0.4, rationale: "Spec positioning in the index itself." },
  ],
  "cot:gold": [
    { symbol: "GC=F", sign: 1, weight: 0.4, rationale: "Managed-money length is the marginal gold bid." },
  ],
  "cot:wti": [
    { symbol: "CL=F", sign: 1, weight: 0.4, rationale: "Spec length is the marginal crude bid." },
  ],
  "cot:copper": [
    { symbol: "HG=F", sign: 1, weight: 0.4, rationale: "Spec length is the marginal copper bid." },
  ],
  "cot:vix": [
    { symbol: "^GSPC", sign: -1, weight: 0.3, rationale: "Specs are structurally short VIX; net length rising = hedging demand building." },
  ],
  "cot:silver": [
    { symbol: "SI=F", sign: 1, weight: 0.4, rationale: "Managed-money length is the marginal bid in a thin market." },
  ],
  "cot:natgas": [
    { symbol: "NG=F", sign: 1, weight: 0.4, rationale: "Spec positioning is the marginal flow in the most vol-prone major commodity." },
  ],
  // --- Geopolitics / volatility complex ---
  "geo:vix": [
    { symbol: "^GSPC", sign: -1, weight: 0.6, rationale: "Elevated implied vol = stress regime; equities compound poorly above ~VIX 25." },
    { symbol: "HYG", sign: -1, weight: 0.4, rationale: "Equity vol and credit spreads are the same risk premium in two markets." },
  ],
  "geo:vix-term": [
    { symbol: "^GSPC", sign: 1, weight: 0.5, rationale: "VIX3M/VIX above 1 (contango) is the calm-regime shape; inversion (backwardation) marks acute stress — it inverted in every major drawdown." },
  ],
  "geo:ovx": [
    { symbol: "CL=F", sign: -1, weight: 0.3, rationale: "Crude vol spikes cluster around supply shocks and demand crashes — either way, unstable price." },
  ],
  "geo:epu": [
    { symbol: "^GSPC", sign: -1, weight: 0.3, rationale: "Policy uncertainty raises the equity risk premium — a headwind to multiples." },
  ],
  // --- Transmission: is the macro impulse reaching markets? ---
  "transmission:nfci": [
    { symbol: "^GSPC", sign: -1, weight: 0.9, rationale: "NFCI above 0 = financial conditions tighter than average — the single best summary of whether policy is biting." },
    { symbol: "HYG", sign: -1, weight: 0.9, rationale: "Credit is the first casualty of tightening conditions." },
  ],
  "transmission:real-10y": [
    { symbol: "GC=F", sign: -1, weight: 0.9, rationale: "The 10y real yield is gold's dominant driver — gold competes with a real risk-free return." },
    { symbol: "SI=F", sign: -1, weight: 0.6, rationale: "Same real-rate competition as gold, higher beta." },
    { symbol: "^IXIC", sign: -1, weight: 0.6, rationale: "Real rates are the discount rate on long-duration growth cash flows." },
    { symbol: "DX-Y.NYB", sign: 1, weight: 0.4, rationale: "High US real yields pull capital into dollars." },
  ],
  "transmission:broad-dollar": [
    { symbol: "DX-Y.NYB", sign: 1, weight: 0.9, rationale: "The Fed's broad index is the trade-weighted version of DXY itself." },
    { symbol: "GC=F", sign: -1, weight: 0.6, rationale: "Gold is priced in dollars — a strong dollar is a direct headwind." },
    { symbol: "HG=F", sign: -1, weight: 0.5, rationale: "Dollar strength tightens conditions for the EM economies that drive copper demand." },
    { symbol: "CL=F", sign: -1, weight: 0.4, rationale: "Dollar-priced crude gets more expensive for the rest of the world." },
    { symbol: "SI=F", sign: -1, weight: 0.5, rationale: "Dollar-priced like gold, with higher beta to the same headwind." },
  ],
  "transmission:gold-silver": [
    { symbol: "SI=F", sign: -1, weight: 0.3, rationale: "An elevated gold/silver ratio has historically resolved through silver catching up — a mild contrarian silver signal at extremes." },
  ],
  "transmission:copper-gold": [
    { symbol: "HG=F", sign: 1, weight: 0.4, rationale: "Ratio rising = growth demand outpacing fear demand." },
    { symbol: "TLT", sign: -1, weight: 0.5, rationale: "Copper/gold tracks the 10y yield remarkably well (Gundlach's indicator) — rising ratio = rising yields." },
    { symbol: "^GSPC", sign: 1, weight: 0.4, rationale: "Growth-over-fear is the equity-friendly regime." },
  ],
  "transmission:hyg-lqd": [
    { symbol: "HYG", sign: 1, weight: 0.6, rationale: "Junk outperforming investment grade = reach for yield is on." },
    { symbol: "^GSPC", sign: 1, weight: 0.5, rationale: "Credit risk appetite confirms (or diverges from) the equity tape." },
  ],
  "transmission:rsp-spy": [
    { symbol: "^GSPC", sign: 1, weight: 0.5, rationale: "Equal-weight outperforming cap-weight = broad participation; narrowing breadth has preceded index tops." },
  ],
  "transmission:smh-spy": [
    { symbol: "^IXIC", sign: 1, weight: 0.6, rationale: "Semis are the cycle's tip of the spear — leadership here confirms tech risk appetite." },
  ],
};

/** All impacts pointing at a given asset symbol. */
export function impactsForSymbol(symbol: string): { seriesId: string; impact: Impact }[] {
  const out: { seriesId: string; impact: Impact }[] = [];
  for (const [seriesId, impacts] of Object.entries(IMPACTS)) {
    for (const impact of impacts) {
      if (impact.symbol === symbol) out.push({ seriesId, impact });
    }
  }
  return out;
}

/** The single strongest impact for a series — used for the card's "linked market" display. */
export function primaryImpact(seriesId: string): Impact | null {
  const impacts = IMPACTS[seriesId];
  if (!impacts || impacts.length === 0) return null;
  return impacts.reduce((best, i) => (i.weight > best.weight ? i : best), impacts[0]);
}

/** Does this series affect this symbol at all? (Used by the asset filter.) */
export function seriesAffectsSymbol(seriesId: string, symbol: string): boolean {
  return (IMPACTS[seriesId] ?? []).some((i) => i.symbol === symbol);
}

export function marketRowId(symbol: string): string {
  return `market:${symbol}`;
}
