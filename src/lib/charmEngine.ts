/**
 * Charm Decision Engine - the Charm Exposure page's primary content.
 *
 * Central question, distinct from every other page: if spot and IV stopped
 * moving, how would time alone change dealer delta and the underlying
 * hedge? GEX asks what spot does to hedge sensitivity, DEX asks what
 * inventory exists right now, Theta asks what happens to option value,
 * Vanna asks what IV does to hedge; Charm asks what pure time passage does.
 *
 * Charm sign conventions differ across systems (calendar time vs. time
 * remaining), so this engine never surfaces a raw "charm" sign to the page.
 * Every number is a modeled hedge requirement over a stated horizon:
 * CHEX_i(h) = w_i * OI_i * 100 * [Delta_i(T-h) - Delta_i(T)] where w_i is a
 * positive PARTICIPATION weight on the customer-long/dealer-short book, so
 * sum(CHEX) is the customer book's delta migration. The dealer, short that
 * book, holds a hedge equal to the customer delta, so the theoretical hedge
 * adjustment is H_Charm(h) = +sum(CHEX_i(h)). Positive H_Charm = modeled
 * dealer buying; negative = modeled dealer selling. (An earlier version
 * negated this sum - treating the participation weight as if it already
 * carried the dealer's short sign - which inverted every displayed flow
 * direction: a put-heavy book decaying into the close showed dealer selling
 * where the textbook late-day charm bid is dealer buying.)
 *
 * Two calculation modes, same split as vannaEngine.ts: full delta
 * repricing (reprice every contract's delta at T-h, sum, diff against T)
 * for every headline number, since 0DTE delta migration through time is
 * highly nonlinear near the money; the local Greek approximation
 * (charm-per-day * h) is used only for attribution / linearization-risk
 * comparison, never as the primary number.
 *
 * Same stated-simplification posture as gammaEngine.ts/deltaEngine.ts/
 * thetaEngine.ts/vannaEngine.ts: no discrete-dividend CRR here (available
 * via the page's engine toggle for the static table), single-slice raw SVI,
 * dealer sign fundamentally unobservable from a public chain, current
 * snapshot + deterministic scenario repricing only.
 *
 * /charm_surface (used only for cross-expiry confluence, 0DTE charm
 * control, and the strike x expiry heatmap) returns {strike, dte, charm,
 * is_put} with NO open interest - every aggregate built from it is a raw
 * per-contract-Greek magnitude proxy, not OI-weighted share exposure, and
 * is documented as such everywhere it appears.
 */

import { bsDelta, bsGreeks } from "@/lib/blackScholes";
import { sviImpliedVol, type SviParams } from "@/lib/svi";
import type { ChainStrikeInput, StrikeRow0DTE } from "@/lib/gex";
import { bsGammaAt, quantile, zeroCrossings } from "@/lib/gexAnalytics";

const MULTIPLIER = 100;
const YEAR_MINUTES = 60 * 24 * 365;

function toYears(minutes: number): number {
  return minutes / YEAR_MINUTES;
}

// ---------------------------------------------------------------------------
// Delta / charm primitives
// ---------------------------------------------------------------------------

// Both used to be finite-difference approximations (spot-bumped delta,
// time-bumped charm) with a fixed bump width (0.5% of spot, or a T*0.1/1min
// time step) - inaccurate for 0DTE, where T can be on the order of minutes
// and the true delta curve can be sharply kinked well inside that bump
// window (the exact failure mode blackScholes.ts's own docstring documents
// and already fixed for gamma - this just extends that fix here). Both now
// call the closed-form functions blackScholes.ts already uses everywhere
// else, so there's one accurate pricer, not two.
function bsDeltaAt(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean): number {
  return bsDelta({ spot, strike, T, vol, r, q, isCall });
}

/** d(delta)/dT, scaled per calendar day (matches blackScholes.ts bsGreeks' charm convention - closed form, not bumped). */
function bsCharmAt(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean): number {
  if (T <= 1e-7 || vol <= 0) return 0;
  return bsGreeks({ spot, strike, T, vol, r, q, isCall }).charm;
}

type ChexLadder = { strike: number; chex: number }[];

/**
 * Full delta-repricing theoretical hedge adjustment over horizon h (years),
 * in shares: H_Charm(h) = +sum CHEX_i(h). The weights are PARTICIPATION
 * magnitudes on a customer-long/dealer-short book, so netChex is the
 * CUSTOMER book's delta migration; the dealer, short that book, holds a
 * hedge equal to the customer delta and must adjust it by +netChex (e.g. a
 * put-heavy book decaying into the close migrates customer delta up toward
 * zero -> dealers BUY back short hedges, the textbook late-day charm bid).
 * Negating here inverted every displayed flow direction. Evaluated at
 * evalSpot so the same function serves both the actual-spot flow schedule
 * and the hypothetical-price field.
 */
function hedgeFlowAt(chain: ChainStrikeInput[], evalSpot: number, T: number, r: number, q: number, hYears: number, callWeight: number, putWeight: number): number {
  let netChex = 0;
  const hClamped = Math.min(hYears, T - 1e-9);
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const delta0 = bsDeltaAt(evalSpot, row.strike, T, row.iv, r, q, row.side === "call");
    const deltaH = bsDeltaAt(evalSpot, row.strike, Math.max(1e-8, T - hClamped), row.iv, r, q, row.side === "call");
    const chex = (row.side === "call" ? callWeight : putWeight) * row.oi * MULTIPLIER * (deltaH - delta0);
    netChex += chex;
  }
  return netChex;
}

/** Same as hedgeFlowAt, but with the T-h leg's vol shifted independently of the T leg's - used for the vanna-contamination check (charm assuming IV also moves while time passes). */
function hedgeFlowAtIvShift(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, hYears: number, ivShift: number, callWeight: number, putWeight: number): number {
  let netChex = 0;
  const hClamped = Math.min(hYears, T - 1e-9);
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const delta0 = bsDeltaAt(spot, row.strike, T, row.iv, r, q, row.side === "call");
    const deltaH = bsDeltaAt(spot, row.strike, Math.max(1e-8, T - hClamped), Math.max(1e-4, row.iv + ivShift), r, q, row.side === "call");
    const chex = (row.side === "call" ? callWeight : putWeight) * row.oi * MULTIPLIER * (deltaH - delta0);
    netChex += chex;
  }
  return netChex;
}

/** Static dealer hedge (no time passage): +customer DEX under dealer-short (see hedgeFlowAt). Used only for the gamma-implied comparison in the Charm-Gamma Conflict risk. */
function hedgeAtSpot(chain: ChainStrikeInput[], evalSpot: number, T: number, r: number, q: number, callWeight: number, putWeight: number): number {
  let dex = 0;
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const delta = bsDeltaAt(evalSpot, row.strike, T, row.iv, r, q, row.side === "call");
    dex += (row.side === "call" ? callWeight : putWeight) * row.oi * MULTIPLIER * delta;
  }
  return dex;
}

// ---------------------------------------------------------------------------
// Dealer-sign scenarios (mirrors gammaEngine.ts/deltaEngine.ts/vannaEngine.ts)
// ---------------------------------------------------------------------------

interface DealerSignDef {
  name: string;
  label: string;
  callWeight: number;
  putWeight: number;
}

function dealerSignScenarios(flowImbalance: number | null, netGexSign: number): DealerSignDef[] {
  const imb = Number.isFinite(flowImbalance) ? Math.max(-1, Math.min(1, flowImbalance as number)) : 0;
  const gexBias = Math.max(-0.3, Math.min(0.3, netGexSign * 0.3));
  return [
    { name: "conventional", label: "Conventional customer-long/dealer-short", callWeight: 1, putWeight: 1 },
    { name: "reduced", label: "Reduced dealer participation", callWeight: 0.5, putWeight: 0.5 },
    { name: "call_heavy", label: "Call-heavy dealer exposure", callWeight: 1.5, putWeight: 0.5 },
    { name: "put_heavy", label: "Put-heavy dealer exposure", callWeight: 0.5, putWeight: 1.5 },
    { name: "dealer_delta_constrained", label: "Constrained by dealer-flow imbalance", callWeight: 1 + imb * 0.5, putWeight: 1 - imb * 0.5 },
    { name: "conservative_hedge_ratio", label: "Conservative hedge-ratio (full-book GEX sign constrained)", callWeight: 1 + gexBias, putWeight: 1 - gexBias },
  ];
}

// ---------------------------------------------------------------------------
// Consensus at the canonical 30-minute horizon (Pillar 1)
// ---------------------------------------------------------------------------

export interface ModelFlowResult {
  name: string;
  label: string;
  netFlow: number;
}

export interface DealerSignFlowResult {
  name: string;
  label: string;
  netFlow: number;
}

export interface CharmConsensus {
  models: ModelFlowResult[];
  dealerSignScenarios: DealerSignFlowResult[];
  consensusFlow: number;
  dispersion: number;
  signAgreementPct: number;
}

function surfaceHedgeFlowAt(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  hYears: number,
  sviParams: SviParams,
  forward: number,
  callWeight: number,
  putWeight: number
): number {
  let netChex = 0;
  const hClamped = Math.min(hYears, T - 1e-9);
  const T2 = Math.max(1e-8, T - hClamped);
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const vol0 = sviImpliedVol(sviParams, row.strike, forward, T);
    const vol1 = sviImpliedVol(sviParams, row.strike, forward, T2);
    const delta0 = bsDeltaAt(spot, row.strike, T, vol0, r, q, row.side === "call");
    const deltaH = bsDeltaAt(spot, row.strike, T2, vol1, r, q, row.side === "call");
    netChex += (row.side === "call" ? callWeight : putWeight) * row.oi * MULTIPLIER * (deltaH - delta0);
  }
  return netChex;
}

function computeCharmConsensus(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  h30: number,
  sviParams: SviParams,
  forward: number,
  flowImbalance: number | null,
  netGexSign: number
): CharmConsensus {
  const signs = dealerSignScenarios(flowImbalance, netGexSign);

  const all: number[] = [];
  for (const s of signs) {
    all.push(hedgeFlowAt(chain, spot, T, r, q, h30, s.callWeight, s.putWeight));
    all.push(surfaceHedgeFlowAt(chain, spot, T, r, q, h30, sviParams, forward, s.callWeight, s.putWeight));
  }

  const models: ModelFlowResult[] = [
    { name: "static", label: "Static charm (frozen IV)", netFlow: hedgeFlowAt(chain, spot, T, r, q, h30, 1, 1) },
    { name: "surface", label: "Surface-consistent (sticky-moneyness)", netFlow: surfaceHedgeFlowAt(chain, spot, T, r, q, h30, sviParams, forward, 1, 1) },
  ];

  const dealerSignResults: DealerSignFlowResult[] = signs.map((s) => ({
    name: s.name,
    label: s.label,
    netFlow: hedgeFlowAt(chain, spot, T, r, q, h30, s.callWeight, s.putWeight),
  }));

  const sorted = [...all].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const consensusFlow = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const dispersion = quantile(all, 0.75) - quantile(all, 0.25);

  const positiveCount = dealerSignResults.filter((d) => d.netFlow > 0).length;
  const negativeCount = dealerSignResults.filter((d) => d.netFlow < 0).length;
  const signAgreementPct = (Math.max(positiveCount, negativeCount) / dealerSignResults.length) * 100;

  return { models, dealerSignScenarios: dealerSignResults, consensusFlow, dispersion, signAgreementPct };
}

// ---------------------------------------------------------------------------
// Core regime metric 1: horizon flows
// ---------------------------------------------------------------------------

export interface HorizonFlow {
  label: string;
  minutes: number;
  hedgeChangeShares: number;
  impactRatio5m: number | null;
  impactRatio15m: number | null;
}

function computeHorizonFlows(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  totalMinutesToExpiry: number,
  recentVolume5m: number | null,
  recentVolume15m: number | null
): HorizonFlow[] {
  const horizons = [
    { label: "Next 5 minutes", minutes: 5 },
    { label: "Next 15 minutes", minutes: 15 },
    { label: "Next 30 minutes", minutes: 30 },
    { label: "Next 60 minutes", minutes: 60 },
    { label: "Until close", minutes: totalMinutesToExpiry },
  ].filter((h) => h.minutes <= totalMinutesToExpiry || h.label === "Until close");

  return horizons.map((h) => {
    const minutes = Math.min(h.minutes, totalMinutesToExpiry);
    const flow = hedgeFlowAt(chain, spot, T, r, q, toYears(minutes), 1, 1);
    return {
      label: h.label,
      minutes,
      hedgeChangeShares: flow,
      impactRatio5m: recentVolume5m && recentVolume5m > 0 ? Math.abs(flow) / recentVolume5m : null,
      impactRatio15m: recentVolume15m && recentVolume15m > 0 ? Math.abs(flow) / recentVolume15m : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Core regime metric 3: Charm Acceleration
// ---------------------------------------------------------------------------

export interface CharmAcceleration {
  flowPerMinuteNow: number;
  flowPerMinuteAt15: number;
  peakFlowRate: number;
  peakFlowMinutes: number | null;
}

function computeCharmAcceleration(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number): CharmAcceleration {
  const points = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120].filter((m) => m < totalMinutesToExpiry);
  points.push(totalMinutesToExpiry);
  const cumulative = points.map((m) => ({ minutes: m, flow: hedgeFlowAt(chain, spot, T, r, q, toYears(m), 1, 1) }));

  const rates: { minutes: number; rate: number }[] = [];
  for (let i = 1; i < cumulative.length; i++) {
    const dm = cumulative[i].minutes - cumulative[i - 1].minutes;
    if (dm <= 0) continue;
    rates.push({ minutes: cumulative[i - 1].minutes, rate: (cumulative[i].flow - cumulative[i - 1].flow) / dm });
  }

  const flowPerMinuteNow = rates[0]?.rate ?? 0;
  const flowPerMinuteAt15 = rates.find((r2) => r2.minutes >= 15)?.rate ?? flowPerMinuteNow;

  let peakFlowRate = flowPerMinuteNow;
  let peakFlowMinutes: number | null = rates[0]?.minutes ?? null;
  for (const r2 of rates) {
    if (Math.abs(r2.rate) > Math.abs(peakFlowRate)) {
      peakFlowRate = r2.rate;
      peakFlowMinutes = r2.minutes;
    }
  }

  return { flowPerMinuteNow, flowPerMinuteAt15, peakFlowRate, peakFlowMinutes };
}

// ---------------------------------------------------------------------------
// Pillar 1: Charm regime classification
// ---------------------------------------------------------------------------

export type CharmPhase = "passive_buy_drift" | "passive_sell_drift" | "balanced_decay" | "fragile_cancellation" | "late_day_surge" | "charm_light";

const PHASE_INFO: Record<CharmPhase, { label: string; interpretation: string }> = {
  passive_buy_drift: { label: "Passive buy drift", interpretation: "If spot and IV hold, time passage alone implies net dealer buying - not automatically bullish, since the hedge may already be partly executed or offset elsewhere." },
  passive_sell_drift: { label: "Passive sell drift", interpretation: "If spot and IV hold, time passage alone implies net dealer selling - not automatically bearish for the same reason." },
  balanced_decay: { label: "Balanced decay", interpretation: "Net time-driven hedge flow is small, and gross flow is also modest." },
  fragile_cancellation: { label: "Fragile cancellation", interpretation: "Large opposing time-driven flows nearly cancel - a small shift in dealer positioning could flip the net." },
  late_day_surge: { label: "Late-day surge", interpretation: "Modeled time-driven hedge flow accelerates sharply later in the session." },
  charm_light: { label: "Charm-light", interpretation: "Time-driven delta migration is immaterial relative to liquidity today." },
};

export interface CharmPhaseClassification {
  phase: CharmPhase;
  label: string;
  interpretation: string;
  net30mFlow: number;
  gross30mFlow: number;
  cancellationRatio: number;
  signAgreementPct: number;
  surgeDetected: boolean;
}

function classifyCharmPhase(net30mFlow: number, gross30mFlow: number, signAgreementPct: number, acceleration: CharmAcceleration): CharmPhaseClassification {
  const cancellationRatio = 1 - Math.abs(net30mFlow) / (gross30mFlow + 1e-9);
  const light = gross30mFlow < 100_000;
  const fragile = !light && cancellationRatio > 0.75 && signAgreementPct < 70;
  const surgeDetected = Math.abs(acceleration.flowPerMinuteNow) > 1e-6 && Math.abs(acceleration.peakFlowRate) > Math.abs(acceleration.flowPerMinuteNow) * 2.5 && (acceleration.peakFlowMinutes ?? 0) > 0;

  let phase: CharmPhase;
  if (light) phase = "charm_light";
  else if (fragile) phase = "fragile_cancellation";
  else if (surgeDetected) phase = "late_day_surge";
  else if (Math.abs(net30mFlow) < gross30mFlow * 0.1) phase = "balanced_decay";
  else phase = net30mFlow >= 0 ? "passive_buy_drift" : "passive_sell_drift";

  const info = PHASE_INFO[phase];
  return { phase, label: info.label, interpretation: info.interpretation, net30mFlow, gross30mFlow, cancellationRatio, signAgreementPct, surgeDetected };
}

// ---------------------------------------------------------------------------
// Signature feature 1: Charm Flow Schedule
// ---------------------------------------------------------------------------

export interface FlowScheduleInterval {
  startMinutes: number;
  endMinutes: number;
  label: string;
  hedgeChangeShares: number;
  cumulativeShares: number;
}

function computeFlowSchedule(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number): FlowScheduleInterval[] {
  const step = totalMinutesToExpiry <= 60 ? 5 : 15;
  const boundaries: number[] = [0];
  for (let m = step; m < totalMinutesToExpiry; m += step) boundaries.push(m);
  boundaries.push(totalMinutesToExpiry);

  const cumulativeAt = new Map<number, number>();
  for (const m of boundaries) cumulativeAt.set(m, hedgeFlowAt(chain, spot, T, r, q, toYears(m), 1, 1));

  const intervals: FlowScheduleInterval[] = [];
  let cumulative = 0;
  for (let i = 1; i < boundaries.length; i++) {
    const t1 = boundaries[i - 1];
    const t2 = boundaries[i];
    const flow = (cumulativeAt.get(t2) ?? 0) - (cumulativeAt.get(t1) ?? 0);
    cumulative += flow;
    intervals.push({ startMinutes: t1, endMinutes: t2, label: `${t1}-${t2}m`, hedgeChangeShares: flow, cumulativeShares: cumulative });
  }
  return intervals;
}

// ---------------------------------------------------------------------------
// Signature feature 2: Price x Time Charm Field
// ---------------------------------------------------------------------------

export interface CharmFieldPoint {
  spot: number;
  minutesAhead: number;
  hedgeChangeShares: number;
}

function computeCharmField(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number, priceRangePct: number, priceSteps: number): { grid: CharmFieldPoint[]; spotValues: number[]; minutesValues: number[] } {
  const spotValues: number[] = [];
  for (let i = 0; i <= priceSteps; i++) spotValues.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / priceSteps));

  const minutesValues: number[] = [];
  const timeSteps = 8;
  for (let i = 0; i <= timeSteps; i++) minutesValues.push((totalMinutesToExpiry * i) / timeSteps);

  const grid: CharmFieldPoint[] = [];
  for (const minutesAhead of minutesValues) {
    for (const s of spotValues) {
      grid.push({ spot: s, minutesAhead, hedgeChangeShares: hedgeFlowAt(chain, s, T, r, q, toYears(minutesAhead), 1, 1) });
    }
  }
  return { grid, spotValues, minutesValues };
}

// ---------------------------------------------------------------------------
// Pillar 2: Key levels
// ---------------------------------------------------------------------------

export interface CharmPivot {
  horizonLabel: string;
  minutes: number;
  price: number | null;
}

function computeCharmPivots(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number, priceGrid: number[]): CharmPivot[] {
  const horizons = [
    { label: "Next 15 minutes", minutes: 15 },
    { label: "Next 30 minutes", minutes: 30 },
    { label: "Next 60 minutes", minutes: 60 },
    { label: "Until expiration", minutes: totalMinutesToExpiry },
  ];
  return horizons.map((h) => {
    const minutes = Math.min(h.minutes, totalMinutesToExpiry);
    const rows = priceGrid.map((price) => ({ strike: price, gex: hedgeFlowAt(chain, price, T, r, q, toYears(minutes), 1, 1) }));
    const crossings = zeroCrossings(rows, spot);
    return { horizonLabel: h.label, minutes, price: crossings.length ? crossings[0] : null };
  });
}

export interface CharmRotationZone {
  low: number | null;
  high: number | null;
}

function computeCharmRotationZone(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, h30: number, priceGrid: number[], recentVolume5m: number | null): CharmRotationZone {
  const eta = recentVolume5m && recentVolume5m > 0 ? recentVolume5m * 0.05 : Infinity;
  const points = priceGrid.map((price) => ({ price, flow: hedgeFlowAt(chain, price, T, r, q, h30, 1, 1) })).sort((a, b) => a.price - b.price);
  const inZone = points.filter((p) => Math.abs(p.flow) < eta);
  if (!inZone.length) return { low: null, high: null };
  return { low: inZone[0].price, high: inZone[inZone.length - 1].price };
}

export type CharmShelfType = "time_buy" | "time_sell" | "cancelling" | "expiry_sensitive";

export interface CharmShelf {
  low: number;
  high: number;
  center: number;
  type: CharmShelfType;
  sharePct: number;
  widthPoints: number;
}

function computeCharmShelves(perStrike: { strike: number; chex: number; callChex: number; putChex: number }[], spot: number): CharmShelf[] {
  const sorted = [...perStrike].sort((a, b) => a.strike - b.strike);
  const totalAbs = sorted.reduce((s, r) => s + Math.abs(r.chex), 0) || 1;
  const window = 3;

  const shelves: CharmShelf[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const windowRows = sorted.slice(Math.max(0, i - window), Math.min(sorted.length, i + window + 1));
    const shelfShare = windowRows.reduce((s, r) => s + Math.abs(r.chex), 0) / totalAbs;
    const strikeShare = Math.abs(sorted[i].chex) / totalAbs;
    if (strikeShare < 0.03) continue;

    const row = sorted[i];
    const nearAtm = Math.abs(row.strike - spot) < spot * 0.005;
    const cancellationRatio = 1 - Math.abs(row.chex) / (Math.abs(row.callChex) + Math.abs(row.putChex) + 1e-9);
    let type: CharmShelfType;
    if (nearAtm) type = "expiry_sensitive";
    else if (cancellationRatio > 0.6) type = "cancelling";
    else type = row.chex >= 0 ? "time_buy" : "time_sell";

    shelves.push({ low: windowRows[0].strike, high: windowRows[windowRows.length - 1].strike, center: row.strike, type, sharePct: shelfShare * 100, widthPoints: windowRows[windowRows.length - 1].strike - windowRows[0].strike });
  }

  const sortedByShare = shelves.sort((a, b) => b.sharePct - a.sharePct);
  const kept: CharmShelf[] = [];
  for (const shelf of sortedByShare) {
    if (kept.some((k) => Math.abs(k.center - shelf.center) < shelf.widthPoints)) continue;
    kept.push(shelf);
  }
  return kept.slice(0, 6);
}

export interface CharmGate {
  price: number | null;
  direction: "upside" | "downside" | null;
  impactRatio: number | null;
}

function computeCharmGate(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, h30: number, priceGrid: number[], recentVolume15m: number | null): CharmGate {
  let best: { price: number; ratio: number } | null = null;
  for (const price of priceGrid) {
    const flow = hedgeFlowAt(chain, price, T, r, q, h30, 1, 1);
    const ratio = recentVolume15m && recentVolume15m > 0 ? Math.abs(flow) / recentVolume15m : 0;
    if (!best || ratio > best.ratio) best = { price, ratio };
  }
  if (!best) return { price: null, direction: null, impactRatio: null };
  return { price: best.price, direction: best.price >= spot ? "upside" : "downside", impactRatio: best.ratio };
}

export interface CharmDeadZone {
  ranges: { low: number; high: number }[];
}

function computeCharmDeadZone(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, h30: number, priceGrid: number[], recentVolume5m: number | null): CharmDeadZone {
  const eta = recentVolume5m && recentVolume5m > 0 ? recentVolume5m * 0.05 : Infinity;
  const sorted = [...priceGrid].sort((a, b) => a - b);
  const flows = sorted.map((price) => ({ price, flow: hedgeFlowAt(chain, price, T, r, q, h30, 1, 1) }));

  const ranges: { low: number; high: number }[] = [];
  let start: number | null = null;
  for (let i = 0; i < flows.length; i++) {
    const isDead = Math.abs(flows[i].flow) < eta;
    if (isDead && start === null) start = flows[i].price;
    if (!isDead && start !== null) {
      ranges.push({ low: start, high: flows[i - 1].price });
      start = null;
    }
  }
  if (start !== null) ranges.push({ low: start, high: flows[flows.length - 1].price });
  return { ranges };
}

export interface CharmConfluence {
  nextExpiry: { dte: number; grossCharmRaw: number } | null;
  classification: "reinforcing" | "cancelling" | "zero_dte_only" | "next_expiry_only" | "unavailable";
  alignmentPct: number;
}

function computeCharmConfluence(zeroDteRawSign: number, surfaceByDte: Map<number, { net: number; gross: number }>): CharmConfluence {
  const others = [...surfaceByDte.entries()].filter(([dte]) => dte > 0);
  if (!others.length) return { nextExpiry: null, classification: "unavailable", alignmentPct: 0 };
  const [nextDte, nextStats] = others.sort((a, b) => b[1].gross - a[1].gross)[0];

  const totalGross = [...surfaceByDte.values()].reduce((s, v) => s + v.gross, 0) || 1;
  const zeroDteEntry = surfaceByDte.get(0);
  const p0 = zeroDteEntry ? zeroDteEntry.gross / totalGross : 0;
  const pT = nextStats.gross / totalGross;
  const agree = Math.sign(zeroDteRawSign || 1) === Math.sign(nextStats.net || 1) ? 1 : -1;
  const alignmentPct = Math.sqrt(Math.max(0, p0 * pT)) * agree * 100;

  let classification: CharmConfluence["classification"];
  if (Math.abs(alignmentPct) < 15) classification = p0 > pT ? "zero_dte_only" : "next_expiry_only";
  else classification = alignmentPct > 0 ? "reinforcing" : "cancelling";

  return { nextExpiry: { dte: nextDte, grossCharmRaw: nextStats.gross }, classification, alignmentPct };
}

// ---------------------------------------------------------------------------
// Pillar 3: Key risks
// ---------------------------------------------------------------------------

export interface LateDaySurgeRisk {
  surgeStartMinutes: number | null;
  peakFlowMinutes: number | null;
  peakFlowRate: number;
}

function computeLateDaySurge(acceleration: CharmAcceleration, flowSchedule: FlowScheduleInterval[], recentVolume5m: number | null, thresholdPct = 0.1): LateDaySurgeRisk {
  let surgeStartMinutes: number | null = null;
  if (recentVolume5m && recentVolume5m > 0) {
    for (const interval of flowSchedule) {
      const intervalMinutes = interval.endMinutes - interval.startMinutes;
      const per5m = Math.abs(interval.hedgeChangeShares) * (5 / Math.max(1, intervalMinutes));
      if (per5m / recentVolume5m > thresholdPct) {
        surgeStartMinutes = interval.startMinutes;
        break;
      }
    }
  }
  return { surgeStartMinutes, peakFlowMinutes: acceleration.peakFlowMinutes, peakFlowRate: acceleration.peakFlowRate };
}

export interface ReversalRisk {
  pivotPrice: number | null;
  distancePoints: number | null;
  distanceEm: number | null;
  belowDirection: "buy" | "sell" | null;
  aboveDirection: "buy" | "sell" | null;
}

function computeReversalRisk(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, h30: number, pivot30: number | null, expectedMove1s: number | null): ReversalRisk {
  if (pivot30 === null) return { pivotPrice: null, distancePoints: null, distanceEm: null, belowDirection: null, aboveDirection: null };
  const below = hedgeFlowAt(chain, pivot30 - Math.max(0.1, spot * 0.001), T, r, q, h30, 1, 1);
  const above = hedgeFlowAt(chain, pivot30 + Math.max(0.1, spot * 0.001), T, r, q, h30, 1, 1);
  const distancePoints = pivot30 - spot;
  const distanceEm = expectedMove1s && expectedMove1s > 0 ? Math.abs(distancePoints) / expectedMove1s : null;
  return {
    pivotPrice: pivot30,
    distancePoints,
    distanceEm,
    belowDirection: below >= 0 ? "buy" : "sell",
    aboveDirection: above >= 0 ? "buy" : "sell",
  };
}

export interface GammaConflict {
  charmFlow: number;
  gammaImpliedFlow: number;
  conflict: number;
  classification: "reinforcing" | "partially_offsetting" | "strongly_conflicting";
}

function computeGammaConflict(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, h30: number, expectedMove1s: number | null): GammaConflict {
  const charmFlow = hedgeFlowAt(chain, spot, T, r, q, h30, 1, 1);
  const em = expectedMove1s && expectedMove1s > 0 ? expectedMove1s : spot * 0.005;
  const gammaImpliedFlow = hedgeAtSpot(chain, spot - em, T, r, q, 1, 1) - hedgeAtSpot(chain, spot, T, r, q, 1, 1);
  const conflict = 1 - Math.abs(charmFlow + gammaImpliedFlow) / (Math.abs(charmFlow) + Math.abs(gammaImpliedFlow) + 1e-9);
  const classification: GammaConflict["classification"] = conflict > 0.6 ? "strongly_conflicting" : conflict > 0.25 ? "partially_offsetting" : "reinforcing";
  return { charmFlow, gammaImpliedFlow, conflict, classification };
}

export interface VannaContaminationRisk {
  pureCharm: number;
  ivDown1: number;
  ivUnchanged: number;
  ivUp1: number;
  fragile: boolean;
}

function computeVannaContamination(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, h30: number): VannaContaminationRisk {
  const ivDown1 = hedgeFlowAtIvShift(chain, spot, T, r, q, h30, -0.01, 1, 1);
  const ivUnchanged = hedgeFlowAtIvShift(chain, spot, T, r, q, h30, 0, 1, 1);
  const ivUp1 = hedgeFlowAtIvShift(chain, spot, T, r, q, h30, 0.01, 1, 1);
  const signs = new Set([Math.sign(ivDown1), Math.sign(ivUnchanged), Math.sign(ivUp1)]);
  return { pureCharm: ivUnchanged, ivDown1, ivUnchanged, ivUp1, fragile: signs.size > 1 };
}

export interface LinearizationRisk {
  errorPct: number;
  level: "low" | "moderate" | "high";
}

function computeLinearizationRisk(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, h30: number): LinearizationRisk {
  const full = hedgeFlowAt(chain, spot, T, r, q, h30, 1, 1);
  let linearNetChex = 0;
  const hInDays = h30 * 365;
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const charmPerDay = bsCharmAt(spot, row.strike, T, row.iv, r, q, row.side === "call");
    linearNetChex += row.oi * MULTIPLIER * charmPerDay * hInDays;
  }
  const linear = linearNetChex; // same +customer-CHEX sign as hedgeFlowAt, so the error compares like with like
  const errorPct = Math.abs(full) > 1e-6 ? (Math.abs(full - linear) / Math.abs(full)) * 100 : 0;
  return { errorPct, level: errorPct > 60 ? "high" : errorPct > 25 ? "moderate" : "low" };
}

export interface ExpiryDiscontinuityRisk {
  atmGamma: number;
  level: "low" | "moderate" | "high";
}

function computeExpiryDiscontinuityRisk(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): ExpiryDiscontinuityRisk {
  const atmRows = chain.filter((row) => Math.abs(row.strike - spot) <= spot * 0.01 && row.iv > 0);
  const atmGamma = atmRows.length ? atmRows.reduce((s, row) => s + bsGammaAt(spot, row.strike, T, row.iv, r, q, row.side === "call"), 0) / atmRows.length : 0;
  const totalMinutes = T * YEAR_MINUTES;
  const level: ExpiryDiscontinuityRisk["level"] = totalMinutes < 30 ? "high" : totalMinutes < 90 ? "moderate" : "low";
  return { atmGamma, level };
}

export interface DealerSignUncertainty {
  uncertainty: number;
  positiveScenarios: number;
  negativeScenarios: number;
  totalScenarios: number;
}

function computeDealerSignUncertainty(dealerSignResults: DealerSignFlowResult[]): DealerSignUncertainty {
  const positiveScenarios = dealerSignResults.filter((d) => d.netFlow > 0).length;
  const negativeScenarios = dealerSignResults.filter((d) => d.netFlow < 0).length;
  const total = dealerSignResults.length;
  return { uncertainty: 1 - Math.abs(positiveScenarios - negativeScenarios) / total, positiveScenarios, negativeScenarios, totalScenarios: total };
}

export interface OiFreshnessRisk {
  refreshRatio: number;
  level: "low" | "moderate" | "high";
}

function computeOiFreshness(zeroDteVolume: number, zeroDteOi: number): OiFreshnessRisk {
  const refreshRatio = zeroDteVolume / (zeroDteOi + 1e-9);
  return { refreshRatio, level: refreshRatio < 0.5 ? "low" : refreshRatio < 1.5 ? "moderate" : "high" };
}

// ---------------------------------------------------------------------------
// Pillar 4: Key structure
// ---------------------------------------------------------------------------

export interface CharmBalanceSheet {
  chexPositive: number;
  chexNegative: number;
  grossChex: number;
  netChex: number;
  theoreticalHedge: number;
  cancellationRatio: number;
}

export interface DeltaDestinationRow {
  strike: number;
  currentDelta: number;
  nearCloseDelta: number;
  remainingMigrationShares: number;
}

export interface DeltaDestinationMap {
  rows: DeltaDestinationRow[];
  totalRemainingMigrationShares: number;
  theoreticalHedgeAdjustment: number;
  nearCloseMinutes: number;
}

function computeDeltaDestination(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number): DeltaDestinationMap {
  const nearCloseMinutes = Math.max(0.5, Math.min(5, totalMinutesToExpiry * 0.5));
  const tNearClose = Math.max(1e-8, toYears(nearCloseMinutes));

  const byStrike = new Map<number, { currentDelta: number; nearCloseDelta: number }>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const isCall = row.side === "call";
    const currentDelta = bsDeltaAt(spot, row.strike, T, row.iv, r, q, isCall) * row.oi * MULTIPLIER;
    const nearCloseDelta = bsDeltaAt(spot, row.strike, tNearClose, row.iv, r, q, isCall) * row.oi * MULTIPLIER;
    const entry = byStrike.get(row.strike) ?? { currentDelta: 0, nearCloseDelta: 0 };
    entry.currentDelta += currentDelta;
    entry.nearCloseDelta += nearCloseDelta;
    byStrike.set(row.strike, entry);
  }

  const rows: DeltaDestinationRow[] = [...byStrike.entries()]
    .map(([strike, v]) => ({ strike, currentDelta: v.currentDelta, nearCloseDelta: v.nearCloseDelta, remainingMigrationShares: v.nearCloseDelta - v.currentDelta }))
    .sort((a, b) => a.strike - b.strike);

  const totalRemainingMigrationShares = rows.reduce((s, row) => s + Math.abs(row.remainingMigrationShares), 0);
  const netMigration = rows.reduce((s, row) => s + row.remainingMigrationShares, 0);

  // Dealer hedge tracks the customer book's delta (dealer-short convention, see hedgeFlowAt) - the adjustment is +netMigration, not its negation.
  return { rows, totalRemainingMigrationShares, theoreticalHedgeAdjustment: netMigration, nearCloseMinutes };
}

export interface CharmSurfacePoint {
  strike: number;
  dte: number;
  charm: number;
  isPut: boolean;
}

export interface CharmHeatmapRow {
  strike: number;
  cells: (number | null)[];
}

export interface CharmHeatmap {
  expiriesDte: number[];
  rows: CharmHeatmapRow[];
}

export function parseCharmHeatmap(points: CharmSurfacePoint[]): CharmHeatmap | null {
  if (!points.length) return null;
  const dteSet = [...new Set(points.map((p) => p.dte))].sort((a, b) => a - b);
  const strikeMap = new Map<number, Map<number, number>>();
  for (const p of points) {
    const byDte = strikeMap.get(p.strike) ?? new Map<number, number>();
    byDte.set(p.dte, (byDte.get(p.dte) ?? 0) + p.charm);
    strikeMap.set(p.strike, byDte);
  }
  const rows: CharmHeatmapRow[] = [...strikeMap.entries()]
    .map(([strike, byDte]) => ({ strike, cells: dteSet.map((dte) => (byDte.has(dte) ? byDte.get(dte)! : null)) }))
    .sort((a, b) => a.strike - b.strike);
  return { expiriesDte: dteSet, rows };
}

export interface ConcentrationStats {
  hhi: number;
  entropy: number;
  effectiveStrikes: number;
}

function computeConcentration(perStrike: { strike: number; chex: number }[]): ConcentrationStats {
  const totalAbs = perStrike.reduce((s, r) => s + Math.abs(r.chex), 0) || 1;
  const shares = perStrike.map((r) => Math.abs(r.chex) / totalAbs).filter((p) => p > 0);
  const hhi = shares.reduce((s, p) => s + p * p, 0);
  const entropy = -shares.reduce((s, p) => s + p * Math.log(p), 0);
  return { hhi, entropy, effectiveStrikes: Math.exp(entropy) };
}

export interface ZeroDteCharmControl {
  zeroDteGrossRaw: number;
  totalGrossRaw: number;
  controlPct: number;
}

export interface CharmCenters {
  callCenter: number | null;
  putCenter: number | null;
  separation: number | null;
  callDistanceFromSpot: number | null;
  putDistanceFromSpot: number | null;
  callDirection: "buy" | "sell" | null;
  putDirection: "buy" | "sell" | null;
}

function weightedCenter(rows: { strike: number; weight: number }[]): number | null {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return null;
  return rows.reduce((s, r) => s + r.strike * r.weight, 0) / total;
}

function computeCharmCenters(callPutLadder: { strike: number; callChex: number; putChex: number }[], spot: number): CharmCenters {
  const callCenter = weightedCenter(callPutLadder.map((r) => ({ strike: r.strike, weight: Math.abs(r.callChex) })));
  const putCenter = weightedCenter(callPutLadder.map((r) => ({ strike: r.strike, weight: Math.abs(r.putChex) })));
  const netCall = callPutLadder.reduce((s, r) => s + r.callChex, 0);
  const netPut = callPutLadder.reduce((s, r) => s + r.putChex, 0);
  return {
    callCenter,
    putCenter,
    separation: callCenter !== null && putCenter !== null ? callCenter - putCenter : null,
    callDistanceFromSpot: callCenter !== null ? callCenter - spot : null,
    putDistanceFromSpot: putCenter !== null ? putCenter - spot : null,
    callDirection: netCall === 0 ? null : netCall >= 0 ? "buy" : "sell",
    putDirection: netPut === 0 ? null : netPut >= 0 ? "buy" : "sell",
  };
}

export interface ForwardCharmClockPoint {
  label: string;
  minutesAhead: number;
  net30mFlow: number;
  gross30mFlow: number;
  pivot30m: number | null;
  cancellationRatio: number;
}

function computeForwardCharmClock(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number, priceGrid: number[]): ForwardCharmClockPoint[] {
  const points = [
    { label: "Now", minutesAhead: 0 },
    { label: "+15m", minutesAhead: 15 },
    { label: "+30m", minutesAhead: 30 },
    { label: "+60m", minutesAhead: 60 },
    { label: "60m before close", minutesAhead: Math.max(0, totalMinutesToExpiry - 60) },
    { label: "30m before close", minutesAhead: Math.max(0, totalMinutesToExpiry - 30) },
    { label: "10m before close", minutesAhead: Math.max(0, totalMinutesToExpiry - 10) },
  ].filter((p) => p.minutesAhead < totalMinutesToExpiry);

  return points.map((p) => {
    const tBase = Math.max(1e-8, T - toYears(p.minutesAhead));
    const remaining = totalMinutesToExpiry - p.minutesAhead;
    const h30 = toYears(Math.min(30, remaining));

    let netChex = 0;
    let grossChex = 0;
    for (const row of chain) {
      if (row.oi <= 0 || row.iv <= 0) continue;
      const delta0 = bsDeltaAt(spot, row.strike, tBase, row.iv, r, q, row.side === "call");
      const deltaH = bsDeltaAt(spot, row.strike, Math.max(1e-8, tBase - h30), row.iv, r, q, row.side === "call");
      const chex = row.oi * MULTIPLIER * (deltaH - delta0);
      netChex += chex;
      grossChex += Math.abs(chex);
    }
    const net30mFlow = netChex; // +customer delta migration = dealer hedge flow (see hedgeFlowAt)
    const gross30mFlow = grossChex;

    const rows = priceGrid.map((price) => {
      let net = 0;
      for (const row of chain) {
        if (row.oi <= 0 || row.iv <= 0) continue;
        const delta0 = bsDeltaAt(price, row.strike, tBase, row.iv, r, q, row.side === "call");
        const deltaH = bsDeltaAt(price, row.strike, Math.max(1e-8, tBase - h30), row.iv, r, q, row.side === "call");
        net += row.oi * MULTIPLIER * (deltaH - delta0);
      }
      return { strike: price, gex: net };
    });
    const crossings = zeroCrossings(rows, spot);

    return { label: p.label, minutesAhead: p.minutesAhead, net30mFlow, gross30mFlow, pivot30m: crossings.length ? crossings[0] : null, cancellationRatio: 1 - Math.abs(net30mFlow) / (gross30mFlow + 1e-9) };
  });
}

// ---------------------------------------------------------------------------
// Hero statement
// ---------------------------------------------------------------------------

function buildHeroStatement(symbol: string, phase: CharmPhaseClassification, horizonFlows: HorizonFlow[], pivot30: CharmPivot | undefined, acceleration: CharmAcceleration, oiFreshness: OiFreshnessRisk): string {
  const parts: string[] = [];
  parts.push(`${symbol} is in a ${phase.label.toLowerCase()} regime.`);

  const flow30 = horizonFlows.find((h) => h.label === "Next 30 minutes");
  const flowClose = horizonFlows.find((h) => h.label === "Until close");
  if (flow30) parts.push(`If spot and IV remain unchanged, time-driven delta migration implies approximately ${Math.round(Math.abs(flow30.hedgeChangeShares)).toLocaleString()} shares of modeled dealer ${flow30.hedgeChangeShares >= 0 ? "buying" : "selling"} over the next 30 minutes.`);
  if (flowClose) parts.push(`Through expiration, that grows to approximately ${(Math.abs(flowClose.hedgeChangeShares) / 1_000_000).toFixed(1)} million shares.`);

  if (pivot30?.price !== undefined && pivot30.price !== null) parts.push(`The 30-minute charm pivot is ${pivot30.price.toFixed(1)}.`);

  if (phase.surgeDetected && acceleration.peakFlowMinutes !== null) parts.push(`Charm acceleration becomes material after approximately ${acceleration.peakFlowMinutes.toFixed(0)} minutes from now.`);

  parts.push("IV and dealer-inventory uncertainty reduce confidence in the exact hedge outcome.");
  if (oiFreshness.level === "high") parts.push("High 0DTE volume further reduces confidence.");

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Diagnostics + assembly
// ---------------------------------------------------------------------------

export interface CharmEngineDiagnostics {
  pricingModel: string;
  surfaceModel: string;
  contractsIncluded: number;
  invalidContracts: number;
  dealerSignConvention: string;
  oiFreshnessLabel: OiFreshnessRisk["level"];
  crossProductWarning: string;
  charmSurfaceDataNote: string;
  hedgeTimingNote: string;
  lastCalculatedAt: number;
}

export interface CharmEngineResult {
  heroStatement: string;
  consensus: CharmConsensus;
  phase: CharmPhaseClassification;
  horizonFlows: HorizonFlow[];
  acceleration: CharmAcceleration;
  flowSchedule: FlowScheduleInterval[];
  charmField: { grid: CharmFieldPoint[]; spotValues: number[]; minutesValues: number[] };
  pivots: CharmPivot[];
  rotationZone: CharmRotationZone;
  shelves: CharmShelf[];
  gate: CharmGate;
  deadZone: CharmDeadZone;
  confluence: CharmConfluence;
  lateDaySurge: LateDaySurgeRisk;
  reversalRisk: ReversalRisk;
  gammaConflict: GammaConflict;
  vannaContamination: VannaContaminationRisk;
  linearizationRisk: LinearizationRisk;
  expiryDiscontinuityRisk: ExpiryDiscontinuityRisk;
  dealerSignUncertainty: DealerSignUncertainty;
  oiFreshness: OiFreshnessRisk;
  balanceSheet: CharmBalanceSheet;
  deltaDestination: DeltaDestinationMap;
  heatmap: CharmHeatmap | null;
  concentration: ConcentrationStats;
  zeroDteControl: ZeroDteCharmControl | null;
  centers: CharmCenters;
  forwardClock: ForwardCharmClockPoint[];
  diagnostics: CharmEngineDiagnostics;
}

export function computeCharmEngine(params: {
  symbol: string;
  chain: ChainStrikeInput[];
  perStrike: StrikeRow0DTE[];
  spot: number;
  r: number;
  q: number;
  dteHours: number;
  forward: number;
  sviParams: SviParams;
  charmSurfacePoints: CharmSurfacePoint[];
  expectedMove1s: number | null;
  recentVolume5m: number | null;
  recentVolume15m: number | null;
  flowImbalance: number | null;
  netGexSign: number;
  validContracts: number;
  invalidContracts: number;
}): CharmEngineResult {
  const {
    symbol,
    chain,
    perStrike,
    spot,
    r,
    q,
    dteHours,
    forward,
    sviParams,
    charmSurfacePoints,
    expectedMove1s,
    recentVolume5m,
    recentVolume15m,
    flowImbalance,
    netGexSign,
    validContracts,
    invalidContracts,
  } = params;

  const T = Math.max(dteHours, 0.05) / 24 / 365;
  const totalMinutesToExpiry = Math.max(dteHours * 60, 3);
  const h30 = toYears(Math.min(30, totalMinutesToExpiry));

  const consensus = computeCharmConsensus(chain, spot, T, r, q, h30, sviParams, forward, flowImbalance, netGexSign);

  const callPutLadder: { strike: number; callChex: number; putChex: number }[] = (() => {
    const byStrike = new Map<number, { callChex: number; putChex: number }>();
    for (const row of chain) {
      if (row.oi <= 0 || row.iv <= 0) continue;
      const delta0 = bsDeltaAt(spot, row.strike, T, row.iv, r, q, row.side === "call");
      const deltaH = bsDeltaAt(spot, row.strike, Math.max(1e-8, T - h30), row.iv, r, q, row.side === "call");
      const chex = row.oi * MULTIPLIER * (deltaH - delta0);
      const entry = byStrike.get(row.strike) ?? { callChex: 0, putChex: 0 };
      if (row.side === "call") entry.callChex += chex;
      else entry.putChex += chex;
      byStrike.set(row.strike, entry);
    }
    return [...byStrike.entries()].map(([strike, v]) => ({ strike, ...v })).sort((a, b) => a.strike - b.strike);
  })();

  const netChex = callPutLadder.reduce((s, r2) => s + r2.callChex + r2.putChex, 0);
  const grossChex = callPutLadder.reduce((s, r2) => s + Math.abs(r2.callChex) + Math.abs(r2.putChex), 0);
  const net30mFlow = netChex; // +customer delta migration = dealer hedge flow (see hedgeFlowAt)

  const horizonFlows = computeHorizonFlows(chain, spot, T, r, q, totalMinutesToExpiry, recentVolume5m, recentVolume15m);
  const acceleration = computeCharmAcceleration(chain, spot, T, r, q, totalMinutesToExpiry);
  const phase = classifyCharmPhase(net30mFlow, grossChex, consensus.signAgreementPct, acceleration);

  const flowSchedule = computeFlowSchedule(chain, spot, T, r, q, totalMinutesToExpiry);
  const charmField = computeCharmField(chain, spot, T, r, q, totalMinutesToExpiry, 0.05, 20);

  const priceRangePct = 0.05;
  const priceGrid: number[] = [];
  for (let i = 0; i <= 24; i++) priceGrid.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / 24));

  const pivots = computeCharmPivots(chain, spot, T, r, q, totalMinutesToExpiry, priceGrid);
  const pivot30 = pivots.find((p) => p.horizonLabel === "Next 30 minutes");
  const rotationZone = computeCharmRotationZone(chain, spot, T, r, q, h30, priceGrid, recentVolume5m);

  const chexPerStrike = callPutLadder.map((r2) => ({ strike: r2.strike, chex: r2.callChex + r2.putChex, callChex: r2.callChex, putChex: r2.putChex }));
  const shelves = computeCharmShelves(chexPerStrike, spot);
  const gate = computeCharmGate(chain, spot, T, r, q, h30, priceGrid, recentVolume15m);
  const deadZone = computeCharmDeadZone(chain, spot, T, r, q, h30, priceGrid, recentVolume5m);

  const surfaceByDte = new Map<number, { net: number; gross: number }>();
  for (const p of charmSurfacePoints) {
    const entry = surfaceByDte.get(p.dte) ?? { net: 0, gross: 0 };
    entry.net += p.charm;
    entry.gross += Math.abs(p.charm);
    surfaceByDte.set(p.dte, entry);
  }
  const zeroDteRawSign = surfaceByDte.get(0)?.net ?? Math.sign(net30mFlow);
  const confluence = computeCharmConfluence(zeroDteRawSign, surfaceByDte);

  const lateDaySurge = computeLateDaySurge(acceleration, flowSchedule, recentVolume5m);
  const reversalRisk = computeReversalRisk(chain, spot, T, r, q, h30, pivot30?.price ?? null, expectedMove1s);
  const gammaConflict = computeGammaConflict(chain, spot, T, r, q, h30, expectedMove1s);
  const vannaContamination = computeVannaContamination(chain, spot, T, r, q, h30);
  const linearizationRisk = computeLinearizationRisk(chain, spot, T, r, q, h30);
  const expiryDiscontinuityRisk = computeExpiryDiscontinuityRisk(chain, spot, T, r, q);
  const dealerSignUncertainty = computeDealerSignUncertainty(consensus.dealerSignScenarios);

  const zeroDteOi = perStrike.reduce((s, row) => s + row.callOi + row.putOi, 0);
  const zeroDteVolume = recentVolume5m ?? 0;
  const oiFreshness = computeOiFreshness(zeroDteVolume, zeroDteOi);

  const balanceSheet: CharmBalanceSheet = {
    chexPositive: callPutLadder.reduce((s, r2) => s + Math.max(r2.callChex, 0) + Math.max(r2.putChex, 0), 0),
    chexNegative: callPutLadder.reduce((s, r2) => s + Math.min(r2.callChex, 0) + Math.min(r2.putChex, 0), 0),
    grossChex,
    netChex,
    theoreticalHedge: net30mFlow,
    cancellationRatio: 1 - Math.abs(netChex) / (grossChex + 1e-9),
  };

  const deltaDestination = computeDeltaDestination(chain, spot, T, r, q, totalMinutesToExpiry);
  const heatmap = parseCharmHeatmap(charmSurfacePoints);
  const concentration = computeConcentration(chexPerStrike);

  const totalGrossRaw = [...surfaceByDte.values()].reduce((s, v) => s + v.gross, 0);
  const zeroDteGrossRaw = surfaceByDte.get(0)?.gross ?? 0;
  const zeroDteControl: ZeroDteCharmControl | null = totalGrossRaw > 0 ? { zeroDteGrossRaw, totalGrossRaw, controlPct: (zeroDteGrossRaw / totalGrossRaw) * 100 } : null;

  const centers = computeCharmCenters(callPutLadder, spot);
  const forwardClock = computeForwardCharmClock(chain, spot, T, r, q, totalMinutesToExpiry, priceGrid);

  const heroStatement = buildHeroStatement(symbol, phase, horizonFlows, pivot30, acceleration, oiFreshness);

  const diagnostics: CharmEngineDiagnostics = {
    pricingModel: "Black-Scholes bump-and-reprice delta on SVI-smoothed 0DTE smile, full finite-horizon repricing (not linear charm x h) for every headline number (American/CRR trees available via the page's engine toggle for the static table)",
    surfaceModel: "Single-slice raw SVI, sticky-moneyness for surface-consistent/scenario views",
    contractsIncluded: validContracts,
    invalidContracts,
    dealerSignConvention: "6 scenarios modeled (see Charm Regime tab) - conventional customer-long/dealer-short is not asserted as known fact",
    oiFreshnessLabel: oiFreshness.level,
    crossProductWarning: "Product-local exposure only (this symbol's own listed options) - cross-product offsets in futures, index options, ETF baskets, or other expirations are unobserved.",
    charmSurfaceDataNote: "Cross-expiry confluence, the strike x expiry heatmap, and 0DTE charm control use the source's own /charm_surface points, which carry no open-interest field - these are raw-Greek-magnitude proxies, not OI-weighted share exposure.",
    hedgeTimingNote: "This is a modeled hedge requirement, not a guaranteed market order - dealers may rehedge at thresholds, internalize customer flow, offset with new options, hedge with futures, or accept temporary delta inventory.",
    lastCalculatedAt: Date.now(),
  };

  return {
    heroStatement,
    consensus,
    phase,
    horizonFlows,
    acceleration,
    flowSchedule,
    charmField,
    pivots,
    rotationZone,
    shelves,
    gate,
    deadZone,
    confluence,
    lateDaySurge,
    reversalRisk,
    gammaConflict,
    vannaContamination,
    linearizationRisk,
    expiryDiscontinuityRisk,
    dealerSignUncertainty,
    oiFreshness,
    balanceSheet,
    deltaDestination,
    heatmap,
    concentration,
    zeroDteControl,
    centers,
    forwardClock,
    diagnostics,
  };
}
