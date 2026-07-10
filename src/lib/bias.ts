export interface BiasConfig {
  /** What this indicator actually measures and why a trader watches it. */
  context: string;
  /** Read when the regime signal is high (rising / elevated vs the current regime). */
  high: { label: string; tone: "up" | "down" };
  /** Read when the regime signal is low (falling / depressed vs the current regime). */
  low: { label: string; tone: "up" | "down" };
  /** Read near zero. */
  neutral: string;
}

const CONFIG: Record<string, BiasConfig> = {
  "us-macro:h41-balance-sheet": {
    context:
      "The Fed's balance sheet is the plumbing behind systemic dollar liquidity. Expansion (QE) pushes cash into the system and tends to support risk assets; contraction (QT) drains it and pressures valuations, especially long-duration and levered trades.",
    high: { label: "Liquidity expanding", tone: "up" },
    low: { label: "Liquidity draining (QT)", tone: "down" },
    neutral: "Balance sheet roughly flat - liquidity impulse neutral.",
  },
  "us-macro:sofr-effr-iorb": {
    context:
      "SOFR vs IORB spread is the cleanest read on repo/funding stress. SOFR printing meaningfully above IORB signals collateral or cash scarcity in the plumbing - historically a precursor to volatility (Sept 2019 repo spike, SVB week).",
    high: { label: "Funding costs elevated - watch repo stress", tone: "down" },
    low: { label: "Funding costs easing", tone: "up" },
    neutral: "Funding stack trading in line with recent norms.",
  },
  "us-macro:hy-credit-spread": {
    context:
      "High yield spreads are the market's own fear gauge for corporate default risk. Widening spreads front-run equity drawdowns; compressing spreads confirm a risk-on credit backdrop and cheap financing for leveraged names.",
    high: { label: "Credit stress rising - risk-off", tone: "down" },
    low: { label: "Spreads compressed - risk-on, easy credit", tone: "up" },
    neutral: "Credit spreads near their regime average - no stress signal.",
  },
  "us-macro:ig-credit-spread": {
    context:
      "Investment grade spreads price default risk in the highest-quality corporate credit. They move less than high yield but when IG widens the stress is systemic, not idiosyncratic - and the HY−IG decompression gap shows whether stress is still contained to the weakest credits.",
    high: { label: "IG spreads widening - systemic credit stress", tone: "down" },
    low: { label: "IG spreads tight - credit fully risk-on", tone: "up" },
    neutral: "IG spreads near their normal range - no systemic signal.",
  },
  "us-macro:cpi-yoy": {
    context:
      "Headline CPI YoY is the single number that moves the Fed reaction function most. Hot prints push out cut expectations and pressure duration; cooling prints open the door to easing and support risk assets, especially rate-sensitive sectors.",
    high: { label: "Inflation hot - hawkish Fed bias", tone: "down" },
    low: { label: "Inflation cooling - dovish Fed bias", tone: "up" },
    neutral: "Inflation tracking close to its recent trend.",
  },
  "us-macro:unemployment": {
    context:
      "The unemployment rate is the labor side of the Fed's dual mandate. A rising rate (Sahm-rule territory) is a classic recession tell; a falling rate signals a tight labor market - supportive for consumption but can keep the Fed cautious on cutting.",
    high: { label: "Labor market weakening - growth risk", tone: "down" },
    low: { label: "Labor market tight - resilient consumer", tone: "up" },
    neutral: "Unemployment steady near trend.",
  },
  "us-macro:payrolls": {
    context:
      "Nonfarm payrolls is the highest-visibility growth print each month. Strong prints confirm expansion and reduce recession odds (but can delay cuts); weak or negative revisions are often the first hard sign of a turning cycle.",
    high: { label: "Robust job growth - resilient economy", tone: "up" },
    low: { label: "Payroll growth slowing - recession watch", tone: "down" },
    neutral: "Payroll growth in line with trend pace.",
  },
  "us-macro:m2": {
    context:
      "M2 growth is the broad money-supply backdrop. Expansion is a multi-quarter liquidity tailwind for asset prices and eventually inflation; contraction (as seen in 2022-23) is a headwind that has historically preceded credit tightening.",
    high: { label: "Money supply expanding - liquidity tailwind", tone: "up" },
    low: { label: "Money supply contracting - liquidity headwind", tone: "down" },
    neutral: "M2 growth near its trailing trend.",
  },
  "us-macro:10y-yield": {
    context:
      "The 10y yield is the risk-free discount rate for every long-duration asset - equities, real estate, growth stocks. Rising yields tighten financial conditions and compress valuation multiples; falling yields ease conditions and support duration-sensitive assets.",
    high: { label: "Yields elevated - tightening financial conditions", tone: "down" },
    low: { label: "Yields low - easier financial conditions", tone: "up" },
    neutral: "10y yield near its regime range.",
  },
  "us-macro:industrial-production": {
    context:
      "Industrial production is a real-economy, non-survey read on manufacturing output. It corroborates (or contradicts) sentiment-based PMI data and is a component of the NBER recession dating toolkit.",
    high: { label: "Manufacturing expanding", tone: "up" },
    low: { label: "Manufacturing contracting", tone: "down" },
    neutral: "Industrial output steady near trend.",
  },
  "us-macro:consumer-sentiment": {
    context:
      "U. Michigan sentiment is a leading indicator for consumer spending, which is ~68% of US GDP. Sharp drops often precede pullbacks in discretionary spending before it shows up in hard data.",
    high: { label: "Consumer optimism elevated - spending tailwind", tone: "up" },
    low: { label: "Sentiment depressed - spending risk", tone: "down" },
    neutral: "Consumer sentiment near its regime average.",
  },
  "yield-rates:10y2y-spread": {
    context:
      "The 2s10s curve is the most-watched recession signal on the desk. Deep inversion means the market expects the Fed to cut aggressively; the re-steepening (un-inversion) that follows has historically been the sharper timing signal for the actual downturn.",
    high: { label: "Curve steepening - normalizing growth outlook", tone: "up" },
    low: { label: "Curve inverted/flattening - recession signal", tone: "down" },
    neutral: "Curve holding its recent shape.",
  },
  "yield-rates:10y3m-spread": {
    context:
      "The NY Fed's own recession probability model is built on this spread, not 2s10s - historically fewer false positives. Inversion means short-term bills yield more than the 10y, an unambiguous market signal the Fed will need to cut.",
    high: { label: "Curve steepening - normalizing outlook", tone: "up" },
    low: { label: "Curve inverted - NY Fed recession signal active", tone: "down" },
    neutral: "Spread holding its recent range.",
  },
  "yield-rates:2y-yield": {
    context:
      "The 2y yield is almost pure Fed-path pricing - it moves on rate expectations more than growth or inflation news directly. Rising 2y = market pricing a more hawkish Fed; falling = pricing cuts.",
    high: { label: "Front end pricing hawkish Fed path", tone: "down" },
    low: { label: "Front end pricing dovish Fed path / cuts", tone: "up" },
    neutral: "2y yield near its regime range.",
  },
  "yield-rates:10y-yield": {
    context:
      "The 10y yield is the risk-free discount rate for every long-duration asset. Rising yields tighten financial conditions and compress valuation multiples; falling yields ease conditions and support duration-sensitive assets.",
    high: { label: "Yields elevated - tightening financial conditions", tone: "down" },
    low: { label: "Yields low - easier financial conditions", tone: "up" },
    neutral: "10y yield near its regime range.",
  },
  "yield-rates:30y-yield": {
    context:
      "The 30y is the most term-premium and fiscal-sensitive point on the curve - it reacts to deficit/issuance concerns independent of Fed policy. A rising 30y with a stable Fed path is a term-premium story, not a growth one.",
    high: { label: "Long-bond yields elevated - term premium/fiscal pressure", tone: "down" },
    low: { label: "Long-bond yields low - term premium compressed", tone: "up" },
    neutral: "30y yield near its regime range.",
  },
  "yield-rates:breakeven": {
    context:
      "Breakeven inflation is the market's own inflation forecast, priced daily. Rising breakevens front-run CPI prints and directly move the Fed's real policy stance; falling breakevens support duration and rate-sensitive assets.",
    high: { label: "Inflation expectations rising - hawkish pressure", tone: "down" },
    low: { label: "Inflation expectations falling - dovish room", tone: "up" },
    neutral: "Inflation expectations anchored near trend.",
  },
  "yield-rates:forward-inflation": {
    context:
      "5y5y forward inflation is the metric the Fed itself watches most for long-run inflation anchoring - it strips out near-term noise to show what the market believes inflation will average five years from now, for five years.",
    high: { label: "Long-run inflation expectations rising - anchor slipping", tone: "down" },
    low: { label: "Long-run inflation expectations well-anchored/falling", tone: "up" },
    neutral: "Long-run inflation expectations stable near target.",
  },
  "yield-rates:10y-cot": {
    context:
      "Net speculative positioning in 10y futures shows how leveraged funds are leaning. Extreme net-short positioning has historically preceded short squeezes and sharp yield drops when the crowded trade unwinds.",
    high: { label: "Specs net long duration - consensus bets on lower yields", tone: "up" },
    low: { label: "Specs net short duration - crowded, squeeze risk", tone: "down" },
    neutral: "10y positioning roughly balanced.",
  },
  "yield-rates:2y-cot": {
    context:
      "Front-end futures positioning shows how leveraged funds are betting on the near-term Fed path specifically, distinct from the 10y's growth/inflation mix. Crowded positioning here has driven some of the sharpest short-squeeze moves in rates.",
    high: { label: "Specs net long the front end", tone: "up" },
    low: { label: "Specs net short the front end - squeeze risk", tone: "down" },
    neutral: "Front-end positioning roughly balanced.",
  },
  "us-macro:core-cpi": {
    context:
      "Core CPI strips food and energy to show underlying inflation - the part the Fed believes it can actually influence. Stickier than headline, and the number that determines whether cuts are defensible.",
    high: { label: "Core inflation above target - hawkish", tone: "down" },
    low: { label: "Core inflation at/below target - dovish room", tone: "up" },
    neutral: "Core CPI tracking near the 2% target.",
  },
  "us-macro:core-pce": {
    context:
      "Core PCE is the Fed's actual target metric - the 2% goal is defined on this series, not CPI. Every dot-plot and every cut decision is framed against this number.",
    high: { label: "Core PCE above the Fed's target - hawkish", tone: "down" },
    low: { label: "Core PCE at/below target - cuts defensible", tone: "up" },
    neutral: "Core PCE tracking near the 2% target.",
  },
  "us-macro:jobless-claims": {
    context:
      "Initial jobless claims are the highest-frequency hard labor data that exists - weekly, nearly unrevised. A sustained rising trend is the earliest hard-data signal of a labor-market turn, well before the unemployment rate moves.",
    high: { label: "Claims trending up - labor market cracking", tone: "down" },
    low: { label: "Claims trending down - labor market solid", tone: "up" },
    neutral: "Claims flat near their recent trend.",
  },
  "us-macro:gdp": {
    context:
      "Real GDP growth vs the ~2% trend/potential rate. Above-trend growth supports earnings but keeps the Fed cautious; below-trend is the recession-risk zone.",
    high: { label: "Growth above trend - expansion intact", tone: "up" },
    low: { label: "Growth below trend - stall risk", tone: "down" },
    neutral: "Growth tracking near trend.",
  },
  "us-macro:reverse-repo": {
    context:
      "The Fed's reverse repo facility is where excess liquidity parks. Rising RRP drains liquidity from markets; falling RRP releases it back - RRP drawdown funded much of the 2023-24 rally while QT ran.",
    high: { label: "Liquidity parking at the Fed - drain", tone: "down" },
    low: { label: "RRP draining - liquidity releasing into markets", tone: "up" },
    neutral: "RRP balance roughly stable.",
  },
  "us-macro:retail-sales": {
    context:
      "Retail sales is the hard-data confirmation of the consumer story - sentiment says what people feel, this says what they spent. Nominal, so judge against ~3% trend (real growth plus inflation).",
    high: { label: "Consumer spending above trend", tone: "up" },
    low: { label: "Consumer spending stalling", tone: "down" },
    neutral: "Spending growth near trend.",
  },
  "us-macro:housing-starts": {
    context:
      "Housing is the most rate-sensitive sector of the economy - starts respond to mortgage rates within months and lead the broader cycle. \"Housing is the business cycle\" (Leamer).",
    high: { label: "Housing activity expanding - rate transmission easing", tone: "up" },
    low: { label: "Housing contracting - rate pain landing", tone: "down" },
    neutral: "Housing activity flat YoY.",
  },
  // --- COT positioning ---
  "cot:es": {
    context:
      "Non-commercial (spec) net position in E-mini S&P 500 futures. Mid-range moves are trend-confirming consensus; extremes (COT index near 0 or 100) mark crowded trades that unwind violently.",
    high: { label: "Specs net long equities - bullish consensus", tone: "up" },
    low: { label: "Specs net short equities - bearish consensus / squeeze fuel", tone: "down" },
    neutral: "ES positioning near its regime average.",
  },
  "cot:nq": {
    context:
      "Spec net position in Nasdaq-100 futures - the leveraged consensus on tech specifically. Divergence from ES positioning flags rotation between tech and the broad market.",
    high: { label: "Specs net long tech", tone: "up" },
    low: { label: "Specs net short tech", tone: "down" },
    neutral: "NQ positioning near its regime average.",
  },
  "cot:zn": {
    context:
      "Spec net position in 10y Treasury note futures - the same duration trade as TLT, levered. The record net shorts of 2023 preceded one of the sharpest bond rallies on record when they covered.",
    high: { label: "Specs net long duration", tone: "up" },
    low: { label: "Specs net short duration - squeeze fuel", tone: "down" },
    neutral: "10y positioning near its regime average.",
  },
  "cot:zt": {
    context:
      "Spec net position in 2y Treasury note futures - a leveraged bet on the near-term Fed path. Basis-trade mechanics keep structural shorts here, so read changes rather than the level.",
    high: { label: "Specs adding front-end length", tone: "up" },
    low: { label: "Specs pressing front-end shorts", tone: "down" },
    neutral: "2y positioning near its regime average.",
  },
  "cot:dxy": {
    context:
      "Spec net position in ICE Dollar Index futures. A small market, but the cleanest single read on how fast money is leaning on the dollar.",
    high: { label: "Specs net long the dollar", tone: "up" },
    low: { label: "Specs net short the dollar", tone: "down" },
    neutral: "Dollar positioning near its regime average.",
  },
  "cot:gold": {
    context:
      "Spec net position in COMEX gold. Managed-money length is the marginal bid in gold - rallies without positioning support tend to fade, and extreme length precedes flushes.",
    high: { label: "Specs net long gold", tone: "up" },
    low: { label: "Spec gold length washed out", tone: "down" },
    neutral: "Gold positioning near its regime average.",
  },
  "cot:wti": {
    context:
      "Spec net position in NYMEX WTI. Crude is the most positioning-driven major commodity - spec flows amplify every supply headline.",
    high: { label: "Specs net long crude", tone: "up" },
    low: { label: "Spec crude length washed out", tone: "down" },
    neutral: "Crude positioning near its regime average.",
  },
  "cot:copper": {
    context:
      "Spec net position in COMEX copper - the fast-money overlay on the world's most cyclical industrial metal.",
    high: { label: "Specs net long copper", tone: "up" },
    low: { label: "Specs net short copper", tone: "down" },
    neutral: "Copper positioning near its regime average.",
  },
  "cot:vix": {
    context:
      "Spec net position in VIX futures. Specs are structurally net short (harvesting the vol risk premium) - positioning moving toward net long means hedging demand is building into stress.",
    high: { label: "Vol hedging demand building", tone: "down" },
    low: { label: "Vol sellers fully loaded - complacency", tone: "up" },
    neutral: "VIX positioning at its structural norm.",
  },
  "cot:silver": {
    context:
      "Spec net position in COMEX silver - a thinner market than gold, so positioning swings amplify price moves in both directions.",
    high: { label: "Specs net long silver", tone: "up" },
    low: { label: "Spec silver length washed out", tone: "down" },
    neutral: "Silver positioning near its regime average.",
  },
  "cot:natgas": {
    context:
      "Spec net position in NYMEX Henry Hub. Nat gas is the most volatile major commodity and specs are frequently caught wrong-footed - extremes here unwind violently (\"widowmaker\").",
    high: { label: "Specs net long nat gas", tone: "up" },
    low: { label: "Specs net short nat gas - squeeze fuel", tone: "down" },
    neutral: "Nat gas positioning near its regime average.",
  },
  // --- Geopolitics / volatility complex ---
  "geo:vix": {
    context:
      "The VIX is the market-implied 30-day volatility of the S&P 500 - the price of portfolio insurance. Sub-15 is a calm regime; sustained 25+ is a stress regime where drawdowns cluster.",
    high: { label: "Implied vol elevated - stress regime", tone: "down" },
    low: { label: "Implied vol suppressed - calm regime", tone: "up" },
    neutral: "VIX in line with its recent regime.",
  },
  "geo:vix-term": {
    context:
      "VIX3M divided by VIX - the shape of the vol curve. Above 1 (contango) is the healthy carry regime; below 1 (backwardation) means near-term panic is priced above the future, which has marked every major drawdown low and onset.",
    high: { label: "Vol curve in contango - calm regime", tone: "up" },
    low: { label: "Vol curve flattening/inverted - acute stress", tone: "down" },
    neutral: "Vol term structure in its normal shape.",
  },
  "geo:ovx": {
    context:
      "OVX is the VIX of crude oil. It spikes on both supply shocks (wars, OPEC surprises) and demand crashes - a clean, tradable proxy for how much geopolitical risk energy markets are actually pricing, versus headlines.",
    high: { label: "Oil vol elevated - supply/geopolitical risk priced", tone: "down" },
    low: { label: "Oil vol calm - no supply fear priced", tone: "up" },
    neutral: "Oil vol in its normal range.",
  },
  "geo:gvz": {
    context:
      "GVZ is the VIX of gold. Elevated gold vol alongside a rising gold price signals genuine flight-to-safety flows; elevated vol with falling gold is usually forced liquidation.",
    high: { label: "Gold vol elevated - safe-haven flows active", tone: "down" },
    low: { label: "Gold vol calm", tone: "up" },
    neutral: "Gold vol in its normal range.",
  },
  "geo:epu": {
    context:
      "The Economic Policy Uncertainty index counts newspaper coverage of policy uncertainty daily. It is noisy but quantifies the headline environment - elevated readings raise the equity risk premium and correlate with wider credit spreads.",
    high: { label: "Policy uncertainty elevated", tone: "down" },
    low: { label: "Policy environment quiet", tone: "up" },
    neutral: "Policy uncertainty near its usual level.",
  },
  "geo:gepu": {
    context:
      "GDP-weighted policy uncertainty across major economies, not just the US - captures global shocks (trade wars, elections, central bank surprises) that a US-only index misses.",
    high: { label: "Global policy uncertainty elevated", tone: "down" },
    low: { label: "Global policy environment quiet", tone: "up" },
    neutral: "Global policy uncertainty near its usual level.",
  },
  "geo:equity-uncertainty": {
    context:
      "Combines news coverage and options-implied measures specifically around equity markets - a faster-moving, more market-focused cousin of the broad EPU index.",
    high: { label: "Equity market uncertainty elevated", tone: "down" },
    low: { label: "Equity market uncertainty low", tone: "up" },
    neutral: "Equity market uncertainty near its usual level.",
  },
  "geo:defense-spy": {
    context:
      "Defense-sector stocks (ITA) relative to the broad market. Defense names have historically outperformed during escalating geopolitical tension and underperformed once tension eases - a market-based read on how seriously investors are pricing conflict risk.",
    high: { label: "Defense sector outperforming - conflict risk being priced", tone: "down" },
    low: { label: "Defense sector lagging - conflict risk fading", tone: "up" },
    neutral: "Defense/market ratio near its usual range.",
  },
  "geo:vvix": {
    context:
      "VVIX is the implied volatility of the VIX itself - how much the market expects volatility to move. It spikes ahead of or alongside major VIX regime shifts, sometimes leading them.",
    high: { label: "Vol-of-vol elevated - regime shift risk", tone: "down" },
    low: { label: "Vol-of-vol calm", tone: "up" },
    neutral: "VVIX near its usual range.",
  },
  "geo:skew": {
    context:
      "CBOE SKEW prices the cost of far out-of-the-money S&P put protection - a direct read on how much tail/crash risk the options market is pricing, independent of the VIX level.",
    high: { label: "Tail risk richly priced", tone: "down" },
    low: { label: "Tail risk cheaply priced", tone: "up" },
    neutral: "SKEW near its usual range.",
  },
  "geo:move": {
    context:
      "The bond market's VIX - implied volatility on Treasury options. Rate uncertainty transmits directly into every duration-sensitive asset, and MOVE often leads equity vol at the start of a stress episode.",
    high: { label: "Bond market vol elevated - rate uncertainty high", tone: "down" },
    low: { label: "Bond market vol calm", tone: "up" },
    neutral: "MOVE near its usual range.",
  },
  // --- Transmission ---
  "transmission:nfci": {
    context:
      "The Chicago Fed's National Financial Conditions Index aggregates 105 measures of risk, credit and leverage into one weekly number. Zero = average conditions; positive = tighter than average. It is the single best summary of whether policy tightening is actually transmitting.",
    high: { label: "Financial conditions tightening - policy is biting", tone: "down" },
    low: { label: "Financial conditions loose - policy not restrictive in practice", tone: "up" },
    neutral: "Financial conditions near their long-run average.",
  },
  "transmission:real-10y": {
    context:
      "The 10y TIPS yield is the market's real (inflation-adjusted) risk-free rate - the true discount rate on long-duration assets and the dominant driver of gold. Positive and rising real yields are the tightening actually reaching the economy.",
    high: { label: "Real yields elevated - genuine tightening", tone: "down" },
    low: { label: "Real yields low/negative - easy money in real terms", tone: "up" },
    neutral: "Real yields near their regime range.",
  },
  "transmission:broad-dollar": {
    context:
      "The Fed's trade-weighted broad dollar index. Dollar strength is global tightening - it squeezes EM dollar borrowers, pressures commodities, and drags on US multinational earnings. \"The dollar is the world's monetary policy.\"",
    high: { label: "Dollar strong - global conditions tightening", tone: "down" },
    low: { label: "Dollar weak - global easing impulse", tone: "up" },
    neutral: "Dollar near its regime range.",
  },
  "transmission:copper-gold": {
    context:
      "Copper (growth demand) over gold (fear demand). The ratio tracks the 10y yield remarkably well - a rising ratio says real demand is beating fear, a falling one says defensiveness is winning regardless of what equities are doing.",
    high: { label: "Growth demand beating fear - reflationary", tone: "up" },
    low: { label: "Fear demand beating growth - defensive", tone: "down" },
    neutral: "Growth/fear balance unchanged.",
  },
  "transmission:gold-silver": {
    context:
      "Gold priced in silver. A high ratio means fear demand (gold) is dominating industrial-monetary demand (silver); historically extreme readings have resolved through silver catching up rather than gold falling.",
    high: { label: "Fear metal dominating - defensive tilt", tone: "down" },
    low: { label: "Silver outperforming - reflationary tilt", tone: "up" },
    neutral: "Gold/silver balance unchanged.",
  },
  "transmission:crude-natgas": {
    context:
      "Crude priced in natural gas - a rough global-vs-domestic energy demand split. Mostly a diagnostic for which energy market is under pressure rather than a directional macro signal.",
    high: { label: "Crude rich vs gas - oil-side pressure priced", tone: "down" },
    low: { label: "Gas rich vs crude - domestic gas squeeze", tone: "up" },
    neutral: "Energy complex balance unchanged.",
  },
  "transmission:hyg-lqd": {
    context:
      "High-yield bonds relative to investment-grade. When junk outperforms, credit investors are reaching for risk; when it lags while equities rally, credit is quietly refusing to confirm - historically a warning.",
    high: { label: "Credit risk appetite on - junk outperforming", tone: "up" },
    low: { label: "Credit risk appetite off - quality outperforming", tone: "down" },
    neutral: "Credit risk appetite unchanged.",
  },
  "transmission:rsp-spy": {
    context:
      "Equal-weight S&P over cap-weight - pure market breadth. Rising means the average stock participates; falling means a handful of megacaps carry the index, which has historically preceded fragility.",
    high: { label: "Breadth healthy - broad participation", tone: "up" },
    low: { label: "Breadth narrowing - megacap-dependent tape", tone: "down" },
    neutral: "Breadth steady.",
  },
  "transmission:smh-spy": {
    context:
      "Semiconductors relative to the S&P 500. Semis lead the cycle in both directions - leadership confirms risk appetite in the market's highest-beta growth complex; breakdown warns the cycle trade is rolling.",
    high: { label: "Semis leading - cycle risk appetite confirmed", tone: "up" },
    low: { label: "Semis lagging - cycle leadership rolling over", tone: "down" },
    neutral: "Semi leadership unchanged.",
  },
};

export interface Bias {
  context: string;
  label: string;
  tone: "up" | "down" | "flat";
  strength: "mild" | "strong" | "extreme" | null;
}

/**
 * `score` is the method-based indicator signal, bounded -1..1 (see
 * indicatorSignal.ts - positioning / momentum / anchor / threshold, whichever
 * fits the series). Bands: ±0.15 neutral, ±0.5 strong, ±0.8 extreme.
 */
export function getBias(seriesId: string, score: number | null): Bias | null {
  const cfg = CONFIG[seriesId];
  if (!cfg) return null;
  if (score === null) return { context: cfg.context, label: "Insufficient history for a read", tone: "flat", strength: null };

  const abs = Math.abs(score);
  if (abs < 0.15) return { context: cfg.context, label: cfg.neutral, tone: "flat", strength: null };

  const strength = abs >= 0.8 ? "extreme" : abs >= 0.5 ? "strong" : "mild";
  const side = score > 0 ? cfg.high : cfg.low;
  return { context: cfg.context, label: side.label, tone: side.tone, strength };
}

/**
 * The period-over-period status chip (up/down/flat/pending) is a literal
 * direction. Whether "up" is good or bad depends on the indicator - rising
 * credit spreads are bad, rising payrolls are good. This maps the literal
 * direction onto the same good/bad tone the bias box uses, so the chip
 * color and the bias box never disagree. Falls back to literal (up=up-tone)
 * for series with no bias config.
 */
export function getDirectionTone(
  seriesId: string,
  status: "up" | "down" | "flat" | "pending"
): "up" | "down" | "flat" | "pending" {
  if (status === "flat" || status === "pending") return status;
  const cfg = CONFIG[seriesId];
  if (!cfg) return status;
  return status === "up" ? cfg.high.tone : cfg.low.tone;
}

/**
 * Same good/bad remapping as getDirectionTone, but for any signed number
 * (signal, momentum delta) rather than the literal status chip. Positive
 * numbers use the indicator's "high" tone, negative use "low" - falls back
 * to literal (positive=up) for series with no bias config.
 */
export function getSignTone(seriesId: string, value: number | null): "up" | "down" | "flat" {
  if (value === null || value === 0) return "flat";
  const cfg = CONFIG[seriesId];
  const literal = value > 0 ? "up" : "down";
  if (!cfg) return literal;
  return value > 0 ? cfg.high.tone : cfg.low.tone;
}
