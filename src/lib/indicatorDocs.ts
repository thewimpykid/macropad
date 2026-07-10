/**
 * Long-form explanation per indicator id, shown in the Documentation page's
 * search. Kept separate from macroData.ts because these are teaching copy,
 * not data catalogue entries, and change independently of the series list.
 */
export const INDICATOR_DOCS: Record<string, string> = {
  "us-macro:h41-balance-sheet":
    "Total size of the Federal Reserve balance sheet from the weekly H.4.1 release, in trillions of dollars. A rising balance sheet means the Fed is expanding its holdings of Treasuries and mortgage bonds, adding liquidity to the system. A falling balance sheet means quantitative tightening is underway, draining liquidity. The 13 week annualized pace is the cleanest read on whether QT or QE is actively running right now, since the raw level moves slowly.",
  "us-macro:sofr-effr-iorb":
    "Three overnight funding rates shown together. SOFR is the secured repo rate, EFFR is the effective fed funds rate, and IORB is interest on reserve balances, the Fed's floor rate. The signal here tracks the spread between SOFR and IORB. When SOFR prints meaningfully above IORB, it means cash or collateral is scarce in the repo market, a sign of funding stress building beneath the surface.",
  "us-macro:hy-credit-spread":
    "The ICE BofA High Yield Option Adjusted Spread, the extra yield junk bonds pay over Treasuries of the same maturity. Wide spreads mean investors demand more compensation for default risk, usually because credit conditions are tightening or a recession is feared. Narrow spreads mean credit markets are calm and risk appetite is healthy. The implied 5 year default rate is back solved from the spread assuming a 40 percent recovery rate, the standard high yield market convention.",
  "us-macro:ig-credit-spread":
    "The ICE BofA US Corporate Index Option Adjusted Spread, the extra yield investment grade corporate bonds pay over Treasuries. IG spreads are the market's price on default risk in the highest quality credit - they move less than high yield, but when they widen the stress is systemic rather than confined to weak credits. The HY minus IG decompression stat tracks whether credit stress is concentrating in the weakest names first, the classic early warning that precedes broader risk-off.",
  "us-macro:cpi-yoy":
    "Headline Consumer Price Index, year over year change. This is the broadest, most watched inflation number, including food and energy. The Fed's informal comfort zone is around 2 percent. The 3 month and 6 month annualized rates are more forward looking than the year over year figure, since year over year can hide a recent inflection by averaging in months that are no longer relevant.",
  "us-macro:core-cpi":
    "Consumer Price Index excluding food and energy, year over year. Food and energy prices swing on things like weather and oil supply shocks that have little to do with underlying demand, so core CPI strips them out to show the stickier, trend component of inflation that policy actually responds to.",
  "us-macro:core-pce":
    "Core Personal Consumption Expenditures price index, year over year, excluding food and energy. This is the Fed's actual preferred inflation gauge, referenced explicitly in its 2 percent target. It differs from CPI in how it weights spending categories and tends to run a bit lower than CPI over time.",
  "us-macro:unemployment":
    "The U-3 headline unemployment rate, the standard reported jobless rate. The signal here is read against roughly 4.2 percent, an estimate of NAIRU, the non accelerating inflation rate of unemployment. The Sahm Rule extra stat compares the 3 month average unemployment rate to its own 12 month low. A reading of 0.50 percentage points or more has historically meant a recession was already underway by the time it triggered.",
  "us-macro:payrolls":
    "Nonfarm payrolls, the monthly change in US jobs outside farming, government, and a few other categories. Stored here as a 3 month average monthly gain rather than the noisy single month print, since that smoothing is how traders actually read the labor market's underlying trend. Above roughly 100k per month is generally considered consistent with a healthy labor market.",
  "us-macro:jobless-claims":
    "Initial jobless claims, the weekly count of new unemployment insurance filings. This is the earliest hard labor market data available, released weekly instead of monthly, which makes it a useful leading indicator before payroll revisions catch up. The 4 week average smooths out the holiday and calendar noise that hits the raw weekly number.",
  "us-macro:gdp":
    "Real Gross Domestic Product, year over year, adjusted for inflation. Judged against roughly 2 percent trend growth for the US economy. Quarterly data, so it updates far less often than the other series here, but it is the single broadest measure of economic output.",
  "us-macro:m2":
    "M2 money supply, year over year growth. Covers cash, checking deposits, savings, and money market funds. Negative year over year M2 growth, which happened in 2022 and 2023, has historically coincided with tightening credit conditions, since it means the pool of money available to spend and lend is actually shrinking.",
  "us-macro:reverse-repo":
    "Balance at the Fed's overnight reverse repo facility, in billions of dollars. This is cash that money market funds and other counterparties park directly at the Fed overnight instead of lending it elsewhere. A high RRP balance means there is a lot of idle liquidity in the system with nowhere better to go. A falling balance means that liquidity is being drawn down and redeployed elsewhere, or drained by QT.",
  "us-macro:retail-sales":
    "Retail sales, year over year. This is a hard data confirmation of the consumer spending story, as opposed to survey based sentiment measures which can diverge from what people actually do with their money.",
  "us-macro:housing-starts":
    "New residential construction starts, year over year. Housing is the most interest rate sensitive sector of the economy, so this series tends to turn early in both rate hiking and rate cutting cycles, making it a useful leading indicator for the broader economy.",
  "us-macro:10y-yield":
    "The 10 year Treasury yield, the benchmark long term interest rate that anchors mortgage rates, corporate borrowing costs, and equity valuation models. The real yield extra stat subtracts the market implied 10 year inflation expectation (breakeven) from the nominal yield, giving the rate that actually matters for real economic activity and asset valuations.",
  "us-macro:industrial-production":
    "The Industrial Production index, year over year, covering manufacturing, mining, and utilities output. A cleaner read on the goods producing side of the economy than GDP, which also includes services.",
  "us-macro:consumer-sentiment":
    "The University of Michigan Consumer Sentiment index, a survey based measure of how households feel about their finances and the broader economy. Historically volatile month to month, so the 3 month average smooths out survey noise to show the underlying trend.",
  "yield-rates:10y2y-spread":
    "The spread between the 10 year and 2 year Treasury yields. When this goes negative, the curve is inverted, meaning short term rates pay more than long term rates. Yield curve inversions have historically preceded recessions by 6 to 24 months. The un-inversion, when the spread crosses back positive after a period of inversion, is often the sharper signal than the inversion itself.",
  "yield-rates:10y3m-spread":
    "The spread between the 10 year Treasury yield and the 3 month Treasury bill yield. This is the New York Fed's own preferred recession indicator, built into their published recession probability model, and it has historically had a better hit rate with fewer false positives than the more commonly cited 10y-2y spread.",
  "yield-rates:2y-yield":
    "The 2 year Treasury yield, the front end rate most sensitive to the market's expectations for the Fed's policy path over the next couple of years. Moves here reflect changing expectations for rate cuts or hikes more than long run growth or inflation views.",
  "yield-rates:10y-yield":
    "Same series as the 10 year yield shown under US Macro, repeated here in the Yield Rates panel where it belongs alongside the rest of the curve.",
  "yield-rates:30y-yield":
    "The 30 year Treasury yield, the long bond. Most sensitive to fiscal concerns and term premium, the extra compensation investors demand for the risk of holding a bond that far out, as opposed to near term Fed policy expectations which matter more for the front end.",
  "yield-rates:10y-cot":
    "CFTC Commitment of Traders net speculative positioning in 10 year Treasury futures (ZN). Shows whether leveraged funds and other large speculators are net long or net short the contract, which can flag crowded positioning that is vulnerable to a sharp reversal when it unwinds.",
  "yield-rates:2y-cot":
    "CFTC Commitment of Traders net speculative positioning in 2 year Treasury futures (ZT), the front end equivalent of the 10 year COT read above.",
  "yield-rates:breakeven":
    "5 year and 10 year breakeven inflation rates, the market implied inflation expectation derived from the spread between nominal Treasuries and Treasury Inflation Protected Securities (TIPS) of the same maturity. This is what bond markets are actually pricing for future inflation, as opposed to survey based expectations. The 5s10s breakeven spread extra stat shows whether the market expects inflation further out to run hotter or cooler than the near term.",
  "yield-rates:forward-inflation":
    "The 5 year, 5 year forward inflation rate, meaning the market's expected average inflation rate for the five year period starting five years from now. This strips out near term noise and is the specific long run inflation anchoring metric the Fed itself watches most closely, since it reflects the market's confidence that inflation will eventually return to target.",
  "cot:es": "CFTC Commitment of Traders net speculative positioning in S&P 500 e-mini futures (ES). Shows whether large speculators are net long or net short US large cap equities, and the COT index shows where that positioning sits within its own 3 year range, with readings past 90 or below 10 marking crowded trades that have historically unwound violently.",
  "cot:nq": "CFTC Commitment of Traders net speculative positioning in Nasdaq-100 e-mini futures (NQ), the tech heavy equivalent of the ES read above.",
  "cot:zn": "CFTC Commitment of Traders net speculative positioning in 10 year Treasury futures (ZN). Duplicated here in the COT Positioning panel alongside the other tracked markets, and also shown under Yield Rates.",
  "cot:zt": "CFTC Commitment of Traders net speculative positioning in 2 year Treasury futures (ZT), the front end rate exposure equivalent.",
  "cot:gold": "CFTC Commitment of Traders net speculative positioning in COMEX gold futures (GC). Large net long positioning often reflects safe haven demand or inflation hedging flows building up.",
  "cot:wti": "CFTC Commitment of Traders net speculative positioning in NYMEX WTI crude oil futures (CL). Tracks how leveraged funds are positioned on the direction of oil prices.",
  "cot:copper": "CFTC Commitment of Traders net speculative positioning in COMEX copper futures (HG). Copper positioning is often read as a growth expectations signal, since the metal is used broadly across construction and manufacturing.",
  "cot:silver": "CFTC Commitment of Traders net speculative positioning in COMEX silver futures (SI). Silver has both a monetary, gold-like role and an industrial demand component, so positioning here can reflect either story.",
  "cot:natgas": "CFTC Commitment of Traders net speculative positioning in NYMEX Henry Hub natural gas futures (NG).",
  "cot:dxy": "CFTC Commitment of Traders net speculative positioning in ICE US Dollar Index futures (DX). Net long positioning means speculators are betting on further dollar strength against a basket of major currencies.",
  "cot:vix": "CFTC Commitment of Traders net speculative positioning in VIX futures. This market is structurally net short most of the time, since selling volatility has historically been a positive carry trade, so unusual shifts away from that structural short are worth noting.",
  "transmission:nfci": "The Chicago Fed National Financial Conditions Index. Zero represents average financial conditions relative to history, positive values mean conditions are tighter than average, negative values mean looser than average. Built from a broad set of money market, debt, and equity market indicators, so it is a single number summary of overall financial stress.",
  "transmission:real-10y": "The 10 year Treasury Inflation Protected Securities (TIPS) yield, the market's real, inflation adjusted long term interest rate. This is the discount rate that actually matters for valuing future cash flows and for the cost of capital, since it strips out the inflation component embedded in the nominal 10 year yield.",
  "transmission:broad-dollar": "The Federal Reserve's broad trade weighted dollar index (DTWEXBGS). A rising dollar acts like a global tightening force, since it makes dollar denominated debt more expensive to service for foreign borrowers and tightens financial conditions outside the US.",
  "transmission:copper-gold": "The ratio of copper futures to gold futures prices. Copper tends to rise on growth optimism while gold tends to rise on fear and safe haven demand, so this ratio is a rough growth versus fear gauge, and it has historically tracked the direction of the 10 year Treasury yield.",
  "transmission:gold-silver": "The ratio of gold futures to silver futures prices. Gold is the purer fear and monetary metal, silver has more industrial demand exposure, so a rising ratio can mean fear is outpacing industrial optimism.",
  "transmission:crude-natgas": "The ratio of WTI crude oil futures to Henry Hub natural gas futures prices. Crude is priced globally while natural gas in the US is largely a domestic market, so this ratio reflects the split between global energy demand and domestic energy conditions.",
  "transmission:hyg-lqd": "The ratio of the HYG high yield corporate bond ETF to the LQD investment grade corporate bond ETF. A rising ratio means junk bonds are outperforming quality bonds, a sign of healthy risk appetite in credit markets. A falling ratio means investors are rotating toward safety within credit.",
  "transmission:rsp-spy": "The ratio of the RSP equal weight S&P 500 ETF to the SPY cap weight S&P 500 ETF. When RSP outperforms SPY, market gains are broad based across many stocks rather than concentrated in the largest names, which is generally read as healthier market breadth.",
  "transmission:smh-spy": "The ratio of the SMH semiconductor ETF to the SPY S&P 500 ETF. Semiconductors sit early in the economic cycle and are highly sensitive to global demand, so this ratio is used as a read on which part of the cycle the market is pricing, since semis have historically led the broader market at turning points.",
  "geo:epu": "The US Economic Policy Uncertainty index, a news based measure built by counting newspaper articles that discuss policy related economic uncertainty. Shown as a 30 day average. Spikes reflect periods where businesses and investors face unusually high uncertainty about future policy, which tends to depress investment and hiring.",
  "geo:gepu": "The Global Economic Policy Uncertainty index, the same methodology as the US EPU index but aggregated across major economies and GDP weighted. Captures uncertainty on a global rather than purely domestic basis.",
  "geo:equity-uncertainty": "The Equity Market Uncertainty index, built from both news coverage and options market pricing. Combines a text based measure with a market based one to capture uncertainty specifically about equity markets rather than the economy broadly.",
  "geo:defense-spy": "The ratio of the ITA defense and aerospace ETF to the SPY S&P 500 ETF. A rising ratio means defense stocks are outperforming the broad market, often a signal that markets are pricing in geopolitical risk or expecting higher defense spending.",
  "geo:news-feed": "Pooled macro and policy headlines from CNBC Economy, the Federal Reserve, WSJ Markets, Yahoo Finance, and FXStreet, each scored by a finance specific keyword lexicon for bullish or bearish tone. The displayed value is a recency weighted average, where headlines from the last few hours count for more than older ones, using an exponential half life decay. See the Documentation page's News section for the full scoring method.",
  "geo:vix": "The VIX, the CBOE's 30 day implied volatility index for the S&P 500, derived from S&P 500 option prices. The market's own forward looking estimate of how much the index is expected to move over the next month. Below roughly 15 is considered a calm, vol selling regime. Sustained readings above 25 mark a stress regime where drawdowns cluster and asset correlations tend to rise toward 1.",
  "geo:vix-term": "The ratio of VIX3M, 3 month implied volatility, to spot VIX. Above 1 means the vol curve is in contango, the normal state where longer dated volatility is priced higher than near term. Below 1 means backwardation, where near term volatility is priced above longer dated volatility. The curve inverted into backwardation in every major drawdown, including February 2018, March 2020, and the 2022 lows, so inversion means acute stress is being priced right now rather than expected later.",
  "geo:vvix": "The VVIX index, the implied volatility of the VIX itself, sometimes called the vol of vol. Measures how uncertain the options market is about future changes in the VIX, which can spike even when the VIX itself is still relatively low, flagging that a volatility regime change may be coming.",
  "geo:skew": "The CBOE SKEW index, built from the pricing of far out of the money S&P 500 put options. Designed to gauge the market implied probability of a tail risk crash, a large sudden decline, that a normal VIX reading would not fully capture since VIX weights near the money options more heavily.",
  "geo:ovx": "The OVX, the CBOE crude oil ETF volatility index, implied volatility on oil derived from options on the USO crude oil ETF. Serves as a supply shock gauge, since oil vol tends to spike hardest around geopolitical events that threaten supply.",
  "geo:gvz": "The GVZ, the CBOE gold ETF volatility index, implied volatility on gold derived from options on the GLD gold ETF. Used as a safe haven flow gauge, since gold volatility often rises alongside safe haven demand during periods of market or geopolitical stress.",
  "geo:move": "The ICE BofA MOVE index, implied volatility for the Treasury bond market, the fixed income equivalent of the VIX. Rising MOVE alongside a calm VIX can flag that stress is building specifically in rates markets before it spreads to equities.",
};

/** Longer indicators fall back to their catalogue note when no custom doc exists yet. */
export function getIndicatorDoc(id: string, fallback: string): string {
  return INDICATOR_DOCS[id] ?? fallback;
}
