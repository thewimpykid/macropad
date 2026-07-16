/**
 * Vanna Decision Engine - the Vanna Exposure page's primary content.
 *
 * Central question: how will an implied-volatility change alter dealer
 * delta, and therefore the theoretical underlying hedge? Vanna is d(delta)/d(vol)
 * (equivalently d(vega)/d(spot)) - it does NOT predict direction on its own.
 * Every hedge-flow number here is stated against an explicit assumed IV or
 * skew move; nothing is presented as a directional prediction in isolation.
 *
 * Sign convention warning (load-bearing, repeated at every call site that
 * could mislead): vanna sign depends on moneyness, not option side. An OTM
 * put and an OTM call can both carry positive vanna; an ITM put and ITM call
 * can both carry negative vanna. Never assume "calls positive / puts
 * negative" - each strike's vanna is computed from its own bumped-vol delta,
 * so sign falls out naturally per strike.
 *
 * VEX_i = w_i * Vanna_i * OI_i * 100, where Vanna_i is already expressed per
 * one full vol point (bsVannaAt matches blackScholes.ts's bsGreeks vanna
 * scaling), so no extra *0.01 factor is applied here. Units are underlying
 * shares of theoretical hedge per 1-vol-point IV move, not dollars. w_i is
 * a positive participation weight on the customer-long/dealer-short book,
 * so sum(VEX) is CUSTOMER-signed; the dealer hedge tracks it directly
 * (H = +DEX, hedge flow = +delta-change) - see hedgeAt's doc for the
 * direction cross-check and the inversion this replaces.
 *
 * Two distinct calculation modes, used for different purposes:
 *  - Linear vanna attribution (VEX * shock): fast, per-strike attributable,
 *    used for shelves/concentration/balance-sheet structure.
 *  - Full delta repricing (reprice every contract's delta at the shocked
 *    vol, sum, diff against baseline): used for every headline hedge-flow
 *    number, because vanna is a local derivative and large or skewed IV
 *    moves are not well approximated by a single linear term - the gap
 *    between the two is itself reported as Linearization Risk.
 *
 * Same stated-simplification posture as gammaEngine.ts/deltaEngine.ts/
 * thetaEngine.ts: no discrete-dividend CRR, single-slice raw SVI (not full
 * arbitrage-free SSVI), dealer sign fundamentally unobservable from a public
 * chain (6 scenarios modeled, not asserted as fact), current-snapshot +
 * scenario repricing only (never history).
 *
 * /vanna_surface (used only for cross-expiry confluence and the strike x
 * expiry heatmap) returns {strike, dte, vanna, is_put} with NO open
 * interest - cross-expiry aggregates from it are raw-Greek-magnitude
 * proxies, not OI-weighted share/dollar exposure, and are documented as such
 * everywhere they appear.
 */

import { bsDelta, bsGreeks } from "@/lib/blackScholes";
import { sviImpliedVol, type SviParams } from "@/lib/svi";
import type { ChainStrikeInput, StrikeRow0DTE } from "@/lib/gex";
import { quantile, touchProbability, zeroCrossings } from "@/lib/gexAnalytics";

const MULTIPLIER = 100;

// ---------------------------------------------------------------------------
// Vanna / delta primitives
// ---------------------------------------------------------------------------

// Both used to be finite-difference approximations (price-bumped delta,
// vol-bumped vanna) with a fixed bump width (0.5% of spot, 1 full vol
// point) - inaccurate for 0DTE, where T can be on the order of minutes and
// the true delta/vanna curve can be sharply kinked well inside that bump
// window (the exact failure mode blackScholes.ts's own docstring documents
// and already fixed for gamma - this just extends that fix here). Both now
// call the closed-form functions blackScholes.ts already uses everywhere
// else, so there's one accurate pricer, not two.
function bsDeltaAt(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean): number {
  return bsDelta({ spot, strike, T, vol, r, q, isCall });
}

/** d(delta)/d(vol), scaled per 1 full vol point (matches blackScholes.ts bsGreeks' vanna convention - closed form, not bumped). */
function bsVannaAt(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean): number {
  if (T <= 0 || vol <= 0) return 0;
  return bsGreeks({ spot, strike, T, vol, r, q, isCall }).vanna;
}

type VexLadder = { strike: number; vex: number }[];

/** Static (frozen-IV) VEX ladder in shares-per-vol-point, dealer-sign-weighted. */
function vexLadderAt(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, callWeight: number, putWeight: number): VexLadder {
  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const vanna = bsVannaAt(spot, row.strike, T, row.iv, r, q, row.side === "call");
    const shares = vanna * row.oi * MULTIPLIER;
    const weighted = row.side === "call" ? shares * callWeight : shares * putWeight;
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + weighted);
  }
  return [...byStrike.entries()].map(([strike, vex]) => ({ strike, vex })).sort((a, b) => a.strike - b.strike);
}

/** Surface-consistent (sticky-moneyness) VEX ladder for the flip-band and scenario views. */
function surfaceVexLadderAt(
  chain: ChainStrikeInput[],
  evalPrice: number,
  actualSpot: number,
  T: number,
  r: number,
  q: number,
  sviParams: SviParams,
  forward: number,
  callWeight: number,
  putWeight: number
): VexLadder {
  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const vol = sviImpliedVol(sviParams, row.strike * (actualSpot / evalPrice), forward, T);
    const vanna = bsVannaAt(evalPrice, row.strike, T, vol, r, q, row.side === "call");
    const shares = vanna * row.oi * MULTIPLIER;
    const weighted = row.side === "call" ? shares * callWeight : shares * putWeight;
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + weighted);
  }
  return [...byStrike.entries()].map(([strike, vex]) => ({ strike, vex })).sort((a, b) => a.strike - b.strike);
}

function ladderSum(ladder: VexLadder): number {
  return ladder.reduce((s, r) => s + r.vex, 0);
}

/**
 * Full delta-repricing theoretical dealer hedge, in shares, under a uniform
 * parallel IV shock (ivShift, in vol points e.g. 0.01 = +1pt) applied on
 * top of each contract's own quoted IV. H = +DEX: the weights are positive
 * PARTICIPATION magnitudes on a customer-long/dealer-short book, so dex is
 * the CUSTOMER book's delta and the dealer's offsetting hedge equals it.
 * (E.g. customer-long OTM puts into a vol crush: put deltas rise toward 0,
 * dex rises, dealers BUY - the textbook vanna bid. An earlier version
 * returned -dex, which inverted every displayed flow direction.)
 */
function hedgeAt(chain: ChainStrikeInput[], evalSpot: number, T: number, r: number, q: number, ivShift: number, callWeight: number, putWeight: number): number {
  let dex = 0;
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const vol = Math.max(1e-4, row.iv + ivShift);
    const delta = bsDeltaAt(evalSpot, row.strike, T, vol, r, q, row.side === "call");
    const shares = delta * row.oi * MULTIPLIER;
    dex += row.side === "call" ? shares * callWeight : shares * putWeight;
  }
  return dex;
}

/** Full delta-repricing hedge under a per-strike log-moneyness-dependent vol shock (skew/curvature shocks): shiftFn(k) where k = ln(strike/forward). */
function hedgeAtShiftFn(chain: ChainStrikeInput[], evalSpot: number, T: number, r: number, q: number, forward: number, shiftFn: (k: number) => number, callWeight: number, putWeight: number): number {
  let dex = 0;
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const k = Math.log(row.strike / forward);
    const vol = Math.max(1e-4, row.iv + shiftFn(k));
    const delta = bsDeltaAt(evalSpot, row.strike, T, vol, r, q, row.side === "call");
    const shares = delta * row.oi * MULTIPLIER;
    dex += row.side === "call" ? shares * callWeight : shares * putWeight;
  }
  return dex;
}

// ---------------------------------------------------------------------------
// Dealer-sign scenarios (mirrors gammaEngine.ts/deltaEngine.ts's 6-scenario framework)
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
    { name: "dealer_flow_constrained", label: "Constrained by dealer-flow imbalance", callWeight: 1 + imb * 0.5, putWeight: 1 - imb * 0.5 },
    { name: "gex_constrained", label: "Constrained by full-book GEX sign", callWeight: 1 + gexBias, putWeight: 1 - gexBias },
  ];
}

// ---------------------------------------------------------------------------
// Consensus (Pillar 1)
// ---------------------------------------------------------------------------

export interface ModelVexResult {
  name: string;
  label: string;
  netVex: number;
}

export interface DealerSignVexResult {
  name: string;
  label: string;
  netVex: number;
}

export interface VannaConsensus {
  models: ModelVexResult[];
  dealerSignScenarios: DealerSignVexResult[];
  consensusVex: number;
  dispersion: number;
  signAgreementPct: number;
}

function computeVannaConsensus(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  sviParams: SviParams,
  forward: number,
  flowImbalance: number | null,
  netGexSign: number
): VannaConsensus {
  const signs = dealerSignScenarios(flowImbalance, netGexSign);

  const all: number[] = [];
  for (const s of signs) {
    all.push(ladderSum(vexLadderAt(chain, spot, T, r, q, s.callWeight, s.putWeight)));
    all.push(ladderSum(surfaceVexLadderAt(chain, spot, spot, T, r, q, sviParams, forward, s.callWeight, s.putWeight)));
  }

  const models: ModelVexResult[] = [
    { name: "static", label: "Static vanna (frozen IV)", netVex: ladderSum(vexLadderAt(chain, spot, T, r, q, 1, 1)) },
    { name: "surface", label: "Surface-consistent (sticky-moneyness)", netVex: ladderSum(surfaceVexLadderAt(chain, spot, spot, T, r, q, sviParams, forward, 1, 1)) },
  ];

  const dealerSignResults: DealerSignVexResult[] = signs.map((s) => ({
    name: s.name,
    label: s.label,
    netVex: ladderSum(vexLadderAt(chain, spot, T, r, q, s.callWeight, s.putWeight)),
  }));

  const sorted = [...all].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const consensusVex = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const dispersion = quantile(all, 0.75) - quantile(all, 0.25);

  const positiveCount = dealerSignResults.filter((d) => d.netVex > 0).length;
  const negativeCount = dealerSignResults.filter((d) => d.netVex < 0).length;
  const signAgreementPct = (Math.max(positiveCount, negativeCount) / dealerSignResults.length) * 100;

  return { models, dealerSignScenarios: dealerSignResults, consensusVex, dispersion, signAgreementPct };
}

// ---------------------------------------------------------------------------
// Headline hedge-flow scenarios (full delta repricing, not linear vanna)
// ---------------------------------------------------------------------------

export interface IvShockScenario {
  shockPoints: number;
  label: string;
  hedgeChangeSharesFull: number;
  hedgeChangeSharesLinear: number;
  linearizationErrorPct: number;
  impactRatio: number | null;
  riskLevel: "low" | "moderate" | "high" | "extreme";
}

function classifyImpact(ratio: number | null): IvShockScenario["riskLevel"] {
  if (ratio === null) return "low";
  if (ratio > 0.6) return "extreme";
  if (ratio > 0.3) return "high";
  if (ratio > 0.1) return "moderate";
  return "low";
}

function computeIvShockScenarios(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, netVex: number, recentVolume15m: number | null): IvShockScenario[] {
  const shocks = [-2, -1, -0.5, 0.5, 1, 2];
  const h0 = hedgeAt(chain, spot, T, r, q, 0, 1, 1);
  return shocks.map((pts) => {
    const shift = pts * 0.01;
    const full = hedgeAt(chain, spot, T, r, q, shift, 1, 1) - h0;
    const linear = netVex * pts; // netVex per +1 point, customer-signed; dealer hedge change = +VEX*shock (same sign as hedgeAt - see its doc)
    const linearizationErrorPct = Math.abs(full) > 1e-6 ? (Math.abs(full - linear) / Math.abs(full)) * 100 : 0;
    const impactRatio = recentVolume15m && recentVolume15m > 0 ? Math.abs(full) / recentVolume15m : null;
    return {
      shockPoints: pts,
      label: `${pts > 0 ? "+" : ""}${pts} vol pt${Math.abs(pts) !== 1 ? "s" : ""}`,
      hedgeChangeSharesFull: full,
      hedgeChangeSharesLinear: linear,
      linearizationErrorPct,
      impactRatio,
      riskLevel: classifyImpact(impactRatio),
    };
  });
}

// ---------------------------------------------------------------------------
// Pillar 1: Vanna regime classification
// ---------------------------------------------------------------------------

export type VannaPhase = "compression_support" | "compression_drag" | "expansion_support" | "expansion_pressure" | "fragile_neutral" | "vanna_light";

const PHASE_INFO: Record<VannaPhase, { label: string; interpretation: string }> = {
  compression_support: { label: "Compression support", interpretation: "If IV falls, estimated dealer hedge flow is a net buy - dampening a move lower." },
  compression_drag: { label: "Compression drag", interpretation: "If IV falls, estimated dealer hedge flow is a net sell - dragging price further." },
  expansion_support: { label: "Expansion support", interpretation: "If IV rises, estimated dealer hedge flow is a net buy - dampening a move higher." },
  expansion_pressure: { label: "Expansion pressure", interpretation: "If IV rises, estimated dealer hedge flow is a net sell - pressuring price lower." },
  fragile_neutral: { label: "Fragile neutral", interpretation: "Net vanna is small, but large opposing call/put vanna almost fully cancel - a small skew shift can flip the net." },
  vanna_light: { label: "Vanna-light", interpretation: "Gross vanna is small relative to the book - IV moves are estimated to have limited hedge-flow consequence today." },
};

export interface VannaPhaseClassification {
  phase: VannaPhase;
  label: string;
  interpretation: string;
  netVex: number;
  grossVex: number;
  cancellationRatio: number;
  compressionHedgeFlow: number;
  expansionHedgeFlow: number;
  signAgreementPct: number;
}

function classifyVannaPhase(netVex: number, grossVex: number, compressionHedgeFlow: number, expansionHedgeFlow: number, signAgreementPct: number): VannaPhaseClassification {
  const cancellationRatio = 1 - Math.abs(netVex) / (grossVex + 1e-9);
  const lightThreshold = grossVex < 200_000;
  const fragile = !lightThreshold && cancellationRatio > 0.75 && signAgreementPct < 70;

  let phase: VannaPhase;
  if (lightThreshold) phase = "vanna_light";
  else if (fragile) phase = "fragile_neutral";
  else if (Math.abs(compressionHedgeFlow) >= Math.abs(expansionHedgeFlow)) phase = compressionHedgeFlow >= 0 ? "compression_support" : "compression_drag";
  else phase = expansionHedgeFlow >= 0 ? "expansion_support" : "expansion_pressure";

  const info = PHASE_INFO[phase];
  return { phase, label: info.label, interpretation: info.interpretation, netVex, grossVex, cancellationRatio, compressionHedgeFlow, expansionHedgeFlow, signAgreementPct };
}

// ---------------------------------------------------------------------------
// Signature metric: Spot-Vol Interaction (isolated cross-effect)
// ---------------------------------------------------------------------------

export interface SpotVolInteraction {
  dSpotPct: number;
  dVolPoints: number;
  interactionShares: number;
  note: string;
}

/** H(S+dS,vol+dvol) - H(S+dS,vol) - H(S,vol+dvol) + H(S,vol) - the part of the hedge change that neither a spot-only nor a vol-only move would explain, i.e. vanna's genuinely cross-effect contribution. */
function computeSpotVolInteraction(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): SpotVolInteraction {
  const dSpotPct = 0.0025;
  const dVolPoints = 0.01;
  const dS = spot * dSpotPct;

  const h00 = hedgeAt(chain, spot, T, r, q, 0, 1, 1);
  const h01 = hedgeAt(chain, spot, T, r, q, dVolPoints, 1, 1);
  const h10 = hedgeAt(chain, spot + dS, T, r, q, 0, 1, 1);
  const h11 = hedgeAt(chain, spot + dS, T, r, q, dVolPoints, 1, 1);

  const interactionShares = h11 - h10 - h01 + h00;
  return {
    dSpotPct: dSpotPct * 100,
    dVolPoints: dVolPoints * 100,
    interactionShares,
    note: "Isolated cross-effect only - excludes the pure spot-driven (delta/gamma) and pure vol-driven (vanna-at-current-spot) components already captured elsewhere.",
  };
}

// ---------------------------------------------------------------------------
// Signature visualization: Spot x IV Hedge Field
// ---------------------------------------------------------------------------

export interface HedgeFieldPoint {
  spot: number;
  ivShockPoints: number;
  hedgeChangeShares: number;
}

function computeHedgeField(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, priceRangePct: number, priceSteps: number): { grid: HedgeFieldPoint[]; spotValues: number[]; ivShockValues: number[] } {
  const spotValues: number[] = [];
  for (let i = 0; i <= priceSteps; i++) spotValues.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / priceSteps));
  const ivShockValues = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3];

  const h0 = hedgeAt(chain, spot, T, r, q, 0, 1, 1);
  const grid: HedgeFieldPoint[] = [];
  for (const ivShockPoints of ivShockValues) {
    for (const s of spotValues) {
      const h = hedgeAt(chain, s, T, r, q, ivShockPoints * 0.01, 1, 1);
      grid.push({ spot: s, ivShockPoints, hedgeChangeShares: h - h0 });
    }
  }
  return { grid, spotValues, ivShockValues };
}

// ---------------------------------------------------------------------------
// Pillar 2: Key levels
// ---------------------------------------------------------------------------

export interface VannaFlipBand {
  center: number | null;
  low: number | null;
  high: number | null;
  signAgreementPct: number;
}

function computeVannaFlipBand(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, sviParams: SviParams, forward: number, flowImbalance: number | null, netGexSign: number): VannaFlipBand {
  const signs = dealerSignScenarios(flowImbalance, netGexSign);
  const flips: number[] = [];
  const signsAtSpot: number[] = [];

  for (const s of signs) {
    const ladder = vexLadderAt(chain, spot, T, r, q, s.callWeight, s.putWeight);
    const crossings = zeroCrossings(ladder.map((row) => ({ strike: row.strike, gex: row.vex })), spot);
    if (crossings.length) flips.push(crossings[0]);
    const nearest = [...ladder].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (nearest) signsAtSpot.push(Math.sign(nearest.vex));
  }
  const surfaceLadder = surfaceVexLadderAt(chain, spot, spot, T, r, q, sviParams, forward, 1, 1);
  const surfaceCrossings = zeroCrossings(surfaceLadder.map((row) => ({ strike: row.strike, gex: row.vex })), spot);
  if (surfaceCrossings.length) flips.push(surfaceCrossings[0]);

  const positiveCount = signsAtSpot.filter((s) => s > 0).length;
  const negativeCount = signsAtSpot.filter((s) => s < 0).length;
  const signAgreementPct = signsAtSpot.length ? (Math.max(positiveCount, negativeCount) / signsAtSpot.length) * 100 : 0;

  return {
    center: flips.length ? flips[Math.floor(flips.length / 2)] : null,
    low: flips.length ? Math.min(...flips) : null,
    high: flips.length ? Math.max(...flips) : null,
    signAgreementPct,
  };
}

function findPivot(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, ivShift: number, priceGrid: number[]): number | null {
  const h0 = hedgeAt(chain, spot, T, r, q, 0, 1, 1);
  const rows = priceGrid.map((price) => ({ strike: price, gex: hedgeAt(chain, price, T, r, q, ivShift, 1, 1) - h0 }));
  const crossings = zeroCrossings(rows, spot);
  return crossings.length ? crossings[0] : null;
}

export type VannaShelfType = "compression_buy_expansion_sell" | "compression_sell_expansion_buy";

export interface VannaShelf {
  low: number;
  high: number;
  center: number;
  type: VannaShelfType;
  sharePct: number;
  widthPoints: number;
}

function computeVannaShelves(perStrike: { strike: number; vex: number }[]): VannaShelf[] {
  const sorted = [...perStrike].sort((a, b) => a.strike - b.strike);
  const totalAbs = sorted.reduce((s, r) => s + Math.abs(r.vex), 0) || 1;
  const window = 3;

  const shelves: VannaShelf[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const windowRows = sorted.slice(Math.max(0, i - window), Math.min(sorted.length, i + window + 1));
    const shelfShare = windowRows.reduce((s, r) => s + Math.abs(r.vex), 0) / totalAbs;
    const strikeShare = Math.abs(sorted[i].vex) / totalAbs;
    if (strikeShare < 0.03) continue;
    shelves.push({
      low: windowRows[0].strike,
      high: windowRows[windowRows.length - 1].strike,
      center: sorted[i].strike,
      type: sorted[i].vex >= 0 ? "compression_buy_expansion_sell" : "compression_sell_expansion_buy",
      sharePct: shelfShare * 100,
      widthPoints: windowRows[windowRows.length - 1].strike - windowRows[0].strike,
    });
  }

  const sortedByShare = shelves.sort((a, b) => b.sharePct - a.sharePct);
  const kept: VannaShelf[] = [];
  for (const shelf of sortedByShare) {
    if (kept.some((k) => Math.abs(k.center - shelf.center) < shelf.widthPoints)) continue;
    kept.push(shelf);
  }
  return kept.slice(0, 6);
}

export interface VolatilityGate {
  price: number | null;
  hedgeImpactShares: number | null;
  impactRatio: number | null;
}

function computeVolatilityGate(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, priceGrid: number[], recentVolume5m: number | null): VolatilityGate {
  let best: { price: number; impact: number } | null = null;
  for (const price of priceGrid) {
    const h0 = hedgeAt(chain, price, T, r, q, 0, 1, 1);
    const h1 = hedgeAt(chain, price, T, r, q, 0.01, 1, 1);
    const impact = Math.abs(h1 - h0);
    if (!best || impact > best.impact) best = { price, impact };
  }
  if (!best) return { price: null, hedgeImpactShares: null, impactRatio: null };
  const impactRatio = recentVolume5m && recentVolume5m > 0 ? best.impact / recentVolume5m : null;
  return { price: best.price, hedgeImpactShares: best.impact, impactRatio };
}

export interface VannaVacuum {
  price: number | null;
  vacuumScore: number | null;
}

function computeVannaVacuum(perStrike: { strike: number; vex: number }[], spot: number): VannaVacuum {
  if (!perStrike.length) return { price: null, vacuumScore: null };
  const window = 3;
  const sorted = [...perStrike].sort((a, b) => a.strike - b.strike);
  const totalAbs = sorted.reduce((s, r) => s + Math.abs(r.vex), 0) || 1;
  const densities = sorted.map((row, i) => {
    const windowRows = sorted.slice(Math.max(0, i - window), Math.min(sorted.length, i + window + 1));
    return { strike: row.strike, density: windowRows.reduce((s, r) => s + Math.abs(r.vex), 0) / totalAbs };
  });
  const maxDensity = Math.max(...densities.map((d) => d.density)) || 1;
  const nearSpot = densities.filter((d) => Math.abs(d.strike - spot) <= spot * 0.03);
  if (!nearSpot.length) return { price: null, vacuumScore: null };
  const lowest = nearSpot.reduce((a, b) => (b.density < a.density ? b : a));
  return { price: lowest.strike, vacuumScore: 1 - lowest.density / maxDensity };
}

export interface VannaConfluence {
  nextExpiry: { dte: number; grossVannaRaw: number } | null;
  classification: "reinforcing" | "cancelling" | "zero_dte_only" | "next_expiry_only" | "unavailable";
  alignmentPct: number;
}

function computeVannaConfluence(zeroDteRawVanna: number, surfaceByDte: Map<number, { net: number; gross: number }>): VannaConfluence {
  const others = [...surfaceByDte.entries()].filter(([dte]) => dte > 0);
  if (!others.length) return { nextExpiry: null, classification: "unavailable", alignmentPct: 0 };
  const [nextDte, nextStats] = others.sort((a, b) => b[1].gross - a[1].gross)[0];

  const totalGross = [...surfaceByDte.values()].reduce((s, v) => s + v.gross, 0) || 1;
  const zeroDteEntry = surfaceByDte.get(0);
  const p0 = zeroDteEntry ? zeroDteEntry.gross / totalGross : 0;
  const pT = nextStats.gross / totalGross;
  const agree = Math.sign(zeroDteRawVanna || 1) === Math.sign(nextStats.net || 1) ? 1 : -1;
  const alignmentPct = Math.sqrt(Math.max(0, p0 * pT)) * agree * 100;

  let classification: VannaConfluence["classification"];
  if (Math.abs(alignmentPct) < 15) classification = p0 > pT ? "zero_dte_only" : "next_expiry_only";
  else classification = alignmentPct > 0 ? "reinforcing" : "cancelling";

  return { nextExpiry: { dte: nextDte, grossVannaRaw: nextStats.gross }, classification, alignmentPct };
}

// ---------------------------------------------------------------------------
// Pillar 3: Key risks
// ---------------------------------------------------------------------------

export interface SurfaceShapeRisk {
  levelShockShares: number;
  skewShockShares: number;
  curvatureShockShares: number;
  skewAmplificationPct: number;
}

function computeSurfaceShapeRisk(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, forward: number): SurfaceShapeRisk {
  const h0 = hedgeAt(chain, spot, T, r, q, 0, 1, 1);
  const levelShockShares = hedgeAt(chain, spot, T, r, q, 0.01, 1, 1) - h0;
  const skewShockShares = hedgeAtShiftFn(chain, spot, T, r, q, forward, (k) => -0.02 * k, 1, 1) - h0;
  const curvatureShockShares = hedgeAtShiftFn(chain, spot, T, r, q, forward, (k) => 0.5 * k * k, 1, 1) - h0;
  const skewAmplificationPct = Math.abs(levelShockShares) > 1e-6 ? (Math.abs(skewShockShares) / Math.abs(levelShockShares)) * 100 : 0;
  return { levelShockShares, skewShockShares, curvatureShockShares, skewAmplificationPct };
}

export interface LinearizationRisk {
  worstErrorPct: number;
  level: "low" | "moderate" | "high";
}

function computeLinearizationRisk(ivShockScenarios: IvShockScenario[]): LinearizationRisk {
  const worstErrorPct = Math.max(...ivShockScenarios.map((s) => s.linearizationErrorPct), 0);
  return { worstErrorPct, level: worstErrorPct > 60 ? "high" : worstErrorPct > 25 ? "moderate" : "low" };
}

/** Binary search for the forward horizon (minutes) at which gross |VEX| first falls to half its current value, null if it never does within the session. */
function findVannaHalfLife(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number): number | null {
  const gross0 = vexLadderAt(chain, spot, T, r, q, 1, 1).reduce((s, row) => s + Math.abs(row.vex), 0);
  if (gross0 <= 0) return null;
  const target = gross0 * 0.5;
  const tEnd = Math.max(1e-8, T - totalMinutesToExpiry / 60 / 24 / 365);
  const grossEnd = vexLadderAt(chain, spot, tEnd, r, q, 1, 1).reduce((s, row) => s + Math.abs(row.vex), 0);
  if (grossEnd > target) return null;

  let lo = 0,
    hi = totalMinutesToExpiry;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const tMid = Math.max(1e-8, T - mid / 60 / 24 / 365);
    const gross = vexLadderAt(chain, spot, tMid, r, q, 1, 1).reduce((s, row) => s + Math.abs(row.vex), 0);
    if (gross > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface DealerSignUncertainty {
  uncertainty: number;
  positiveScenarios: number;
  negativeScenarios: number;
  totalScenarios: number;
}

function computeDealerSignUncertainty(dealerSignResults: DealerSignVexResult[]): DealerSignUncertainty {
  const positiveScenarios = dealerSignResults.filter((d) => d.netVex > 0).length;
  const negativeScenarios = dealerSignResults.filter((d) => d.netVex < 0).length;
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

export interface VannaBalanceSheet {
  callVex: number;
  putVex: number;
  netVex: number;
  grossVex: number;
  cancellationRatio: number;
}

export interface VannaSurfacePoint {
  strike: number;
  dte: number;
  vanna: number;
  isPut: boolean;
}

export interface VannaHeatmapRow {
  strike: number;
  cells: (number | null)[];
}

export interface VannaHeatmap {
  expiriesDte: number[];
  rows: VannaHeatmapRow[];
}

export function parseVannaHeatmap(points: VannaSurfacePoint[]): VannaHeatmap | null {
  if (!points.length) return null;
  const dteSet = [...new Set(points.map((p) => p.dte))].sort((a, b) => a - b);
  const strikeMap = new Map<number, Map<number, number>>();
  for (const p of points) {
    const byDte = strikeMap.get(p.strike) ?? new Map<number, number>();
    byDte.set(p.dte, (byDte.get(p.dte) ?? 0) + p.vanna);
    strikeMap.set(p.strike, byDte);
  }
  const rows: VannaHeatmapRow[] = [...strikeMap.entries()]
    .map(([strike, byDte]) => ({ strike, cells: dteSet.map((dte) => (byDte.has(dte) ? byDte.get(dte)! : null)) }))
    .sort((a, b) => a.strike - b.strike);
  return { expiriesDte: dteSet, rows };
}

export interface ConcentrationStats {
  hhi: number;
  entropy: number;
  effectiveStrikes: number;
}

function computeConcentration(perStrike: { strike: number; vex: number }[]): ConcentrationStats {
  const totalAbs = perStrike.reduce((s, r) => s + Math.abs(r.vex), 0) || 1;
  const shares = perStrike.map((r) => Math.abs(r.vex) / totalAbs).filter((p) => p > 0);
  const hhi = shares.reduce((s, p) => s + p * p, 0);
  const entropy = -shares.reduce((s, p) => s + p * Math.log(p), 0);
  return { hhi, entropy, effectiveStrikes: Math.exp(entropy) };
}

export interface VannaCenter {
  callCenter: number | null;
  putCenter: number | null;
  grossCenter: number | null;
  netSignedCenter: number | null;
  reachabilityWeightedCenter: number | null;
}

function weightedCenter(rows: { strike: number; weight: number }[]): number | null {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return null;
  return rows.reduce((s, r) => s + r.strike * r.weight, 0) / total;
}

function computeVannaCenter(callPutLadder: { strike: number; callVex: number; putVex: number }[], spot: number, atmIv: number, hoursAhead: number): VannaCenter {
  const callCenter = weightedCenter(callPutLadder.map((r) => ({ strike: r.strike, weight: Math.abs(r.callVex) })));
  const putCenter = weightedCenter(callPutLadder.map((r) => ({ strike: r.strike, weight: Math.abs(r.putVex) })));
  const grossCenter = weightedCenter(callPutLadder.map((r) => ({ strike: r.strike, weight: Math.abs(r.callVex) + Math.abs(r.putVex) })));
  const netSignedCenter = weightedCenter(callPutLadder.map((r) => ({ strike: r.strike, weight: Math.abs(r.callVex + r.putVex) })));
  const reachabilityWeightedCenter = weightedCenter(
    callPutLadder.map((r) => {
      const touch = touchProbability(r.strike, spot, atmIv, hoursAhead);
      return { strike: r.strike, weight: (Math.abs(r.callVex) + Math.abs(r.putVex)) * Math.max(0.02, touch) };
    })
  );
  return { callCenter, putCenter, grossCenter, netSignedCenter, reachabilityWeightedCenter };
}

export interface AsymmetryStats {
  aboveAbs: number;
  belowAbs: number;
  asymmetry: number;
}

function computeAsymmetry(perStrike: { strike: number; vex: number }[], spot: number): AsymmetryStats {
  const above = perStrike.filter((r) => r.strike > spot).reduce((s, r) => s + Math.abs(r.vex), 0);
  const below = perStrike.filter((r) => r.strike < spot).reduce((s, r) => s + Math.abs(r.vex), 0);
  return { aboveAbs: above, belowAbs: below, asymmetry: (above - below) / (above + below + 1e-9) };
}

export interface ZeroDteVannaControl {
  zeroDteGrossRaw: number;
  totalGrossRaw: number;
  controlPct: number;
}

export interface ForwardVannaClockPoint {
  label: string;
  minutesAhead: number;
  netVex: number;
  grossVex: number;
  flip: number | null;
  hedgeChangeAt1pt: number;
}

function computeForwardVannaClock(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number): ForwardVannaClockPoint[] {
  const points = [
    { label: "Now", minutesAhead: 0 },
    { label: "+15m", minutesAhead: 15 },
    { label: "+30m", minutesAhead: 30 },
    { label: "+60m", minutesAhead: 60 },
    { label: "Close", minutesAhead: totalMinutesToExpiry },
  ].filter((p) => p.minutesAhead <= totalMinutesToExpiry);

  return points.map((p) => {
    const tMid = Math.max(1e-8, T - p.minutesAhead / 60 / 24 / 365);
    const ladder = vexLadderAt(chain, spot, tMid, r, q, 1, 1);
    const netVex = ladderSum(ladder);
    const grossVex = ladder.reduce((s, row) => s + Math.abs(row.vex), 0);
    const crossings = zeroCrossings(ladder.map((row) => ({ strike: row.strike, gex: row.vex })), spot);
    const h0 = hedgeAt(chain, spot, tMid, r, q, 0, 1, 1);
    const h1 = hedgeAt(chain, spot, tMid, r, q, 0.01, 1, 1);
    return { label: p.label, minutesAhead: p.minutesAhead, netVex, grossVex, flip: crossings.length ? crossings[0] : null, hedgeChangeAt1pt: h1 - h0 };
  });
}

// ---------------------------------------------------------------------------
// Hero statement
// ---------------------------------------------------------------------------

function buildHeroStatement(symbol: string, phase: VannaPhaseClassification, ivShockScenarios: IvShockScenario[], flipBand: VannaFlipBand, oiFreshness: OiFreshnessRisk): string {
  const parts: string[] = [];
  parts.push(`${symbol}'s vanna book is in a ${phase.label.toLowerCase()} state.`);

  const upShock = ivShockScenarios.find((s) => s.shockPoints === 1);
  const downShock = ivShockScenarios.find((s) => s.shockPoints === -1);
  if (upShock) parts.push(`If implied volatility rises 1 point, estimated dealer hedge flow is ${Math.round(upShock.hedgeChangeSharesFull).toLocaleString()} shares.`);
  if (downShock) parts.push(`If implied volatility falls 1 point, estimated dealer hedge flow is ${Math.round(downShock.hedgeChangeSharesFull).toLocaleString()} shares.`);
  parts.push("These are conditional on the stated IV move - vanna alone does not predict which way volatility goes.");

  if (flipBand.center !== null) parts.push(`The vanna flip is estimated near ${flipBand.center.toFixed(1)}.`);
  if (oiFreshness.level === "high") parts.push("High 0DTE volume reduces vanna-exposure confidence.");

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Diagnostics + assembly
// ---------------------------------------------------------------------------

export interface VannaEngineDiagnostics {
  pricingModel: string;
  surfaceModel: string;
  contractsIncluded: number;
  invalidContracts: number;
  dealerSignConvention: string;
  oiFreshnessLabel: OiFreshnessRisk["level"];
  crossProductWarning: string;
  vannaSurfaceDataNote: string;
  signConventionWarning: string;
  lastCalculatedAt: number;
}

export interface VannaEngineResult {
  heroStatement: string;
  consensus: VannaConsensus;
  phase: VannaPhaseClassification;
  ivShockScenarios: IvShockScenario[];
  spotVolInteraction: SpotVolInteraction;
  hedgeField: { grid: HedgeFieldPoint[]; spotValues: number[]; ivShockValues: number[] };
  flipBand: VannaFlipBand;
  compressionPivot: number | null;
  expansionPivot: number | null;
  shelves: VannaShelf[];
  volatilityGate: VolatilityGate;
  vacuum: VannaVacuum;
  confluence: VannaConfluence;
  surfaceShapeRisk: SurfaceShapeRisk;
  linearizationRisk: LinearizationRisk;
  vannaHalfLifeMinutes: number | null;
  dealerSignUncertainty: DealerSignUncertainty;
  oiFreshness: OiFreshnessRisk;
  balanceSheet: VannaBalanceSheet;
  heatmap: VannaHeatmap | null;
  concentration: ConcentrationStats;
  center: VannaCenter;
  asymmetry: AsymmetryStats;
  zeroDteControl: ZeroDteVannaControl | null;
  forwardClock: ForwardVannaClockPoint[];
  diagnostics: VannaEngineDiagnostics;
}

export function computeVannaEngine(params: {
  symbol: string;
  chain: ChainStrikeInput[];
  perStrike: StrikeRow0DTE[];
  spot: number;
  r: number;
  q: number;
  dteHours: number;
  atmIv: number;
  forward: number;
  sviParams: SviParams;
  vannaSurfacePoints: VannaSurfacePoint[];
  recentVolume5m: number | null;
  recentVolume15m: number | null;
  flowImbalance: number | null;
  netGexSign: number;
  validContracts: number;
  invalidContracts: number;
}): VannaEngineResult {
  const {
    symbol,
    chain,
    perStrike,
    spot,
    r,
    q,
    dteHours,
    atmIv,
    forward,
    sviParams,
    vannaSurfacePoints,
    recentVolume5m,
    recentVolume15m,
    flowImbalance,
    netGexSign,
    validContracts,
    invalidContracts,
  } = params;

  const T = Math.max(dteHours, 0.05) / 24 / 365;
  const totalMinutesToExpiry = Math.max(dteHours * 60, 3);

  const consensus = computeVannaConsensus(chain, spot, T, r, q, sviParams, forward, flowImbalance, netGexSign);

  const callPutLadder: { strike: number; callVex: number; putVex: number }[] = (() => {
    const byStrike = new Map<number, { callVex: number; putVex: number }>();
    for (const row of chain) {
      if (row.oi <= 0 || row.iv <= 0) continue;
      const vanna = bsVannaAt(spot, row.strike, T, row.iv, r, q, row.side === "call");
      const shares = vanna * row.oi * MULTIPLIER;
      const entry = byStrike.get(row.strike) ?? { callVex: 0, putVex: 0 };
      if (row.side === "call") entry.callVex += shares;
      else entry.putVex += shares;
      byStrike.set(row.strike, entry);
    }
    return [...byStrike.entries()].map(([strike, v]) => ({ strike, ...v })).sort((a, b) => a.strike - b.strike);
  })();

  const callVex = callPutLadder.reduce((s, r2) => s + r2.callVex, 0);
  const putVex = callPutLadder.reduce((s, r2) => s + r2.putVex, 0);
  const netVex = callVex + putVex;
  const grossVex = callPutLadder.reduce((s, r2) => s + Math.abs(r2.callVex) + Math.abs(r2.putVex), 0);

  const ivShockScenarios = computeIvShockScenarios(chain, spot, T, r, q, netVex, recentVolume15m);
  const compressionShock = ivShockScenarios.find((s) => s.shockPoints === -1);
  const expansionShock = ivShockScenarios.find((s) => s.shockPoints === 1);

  const phase = classifyVannaPhase(netVex, grossVex, compressionShock?.hedgeChangeSharesFull ?? 0, expansionShock?.hedgeChangeSharesFull ?? 0, consensus.signAgreementPct);

  const spotVolInteraction = computeSpotVolInteraction(chain, spot, T, r, q);

  const priceRangePct = 0.05;
  const priceGrid: number[] = [];
  for (let i = 0; i <= 24; i++) priceGrid.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / 24));

  const hedgeField = computeHedgeField(chain, spot, T, r, q, priceRangePct, 20);
  const flipBand = computeVannaFlipBand(chain, spot, T, r, q, sviParams, forward, flowImbalance, netGexSign);
  const compressionPivot = findPivot(chain, spot, T, r, q, -0.01, priceGrid);
  const expansionPivot = findPivot(chain, spot, T, r, q, 0.01, priceGrid);

  const vexPerStrike = perStrike.map((row) => {
    const match = callPutLadder.find((c) => c.strike === row.strike);
    return { strike: row.strike, vex: match ? match.callVex + match.putVex : 0 };
  });
  const shelves = computeVannaShelves(vexPerStrike);
  const volatilityGate = computeVolatilityGate(chain, spot, T, r, q, priceGrid, recentVolume5m);
  const vacuum = computeVannaVacuum(vexPerStrike, spot);

  // Cross-expiry: /vanna_surface raw points (no OI) aggregated by dte, gross/net of raw vanna values.
  const surfaceByDte = new Map<number, { net: number; gross: number }>();
  for (const p of vannaSurfacePoints) {
    const entry = surfaceByDte.get(p.dte) ?? { net: 0, gross: 0 };
    entry.net += p.vanna;
    entry.gross += Math.abs(p.vanna);
    surfaceByDte.set(p.dte, entry);
  }
  const zeroDteRawVanna = surfaceByDte.get(0)?.net ?? Math.sign(netVex);
  const confluence = computeVannaConfluence(zeroDteRawVanna, surfaceByDte);

  const surfaceShapeRisk = computeSurfaceShapeRisk(chain, spot, T, r, q, forward);
  const linearizationRisk = computeLinearizationRisk(ivShockScenarios);
  const vannaHalfLifeMinutes = findVannaHalfLife(chain, spot, T, r, q, totalMinutesToExpiry);
  const dealerSignUncertainty = computeDealerSignUncertainty(consensus.dealerSignScenarios);

  const zeroDteOi = perStrike.reduce((s, row) => s + row.callOi + row.putOi, 0);
  const zeroDteVolume = recentVolume5m ?? 0; // proxy: same-session activity, symmetric with other engines' freshness checks
  const oiFreshness = computeOiFreshness(zeroDteVolume, zeroDteOi);

  const balanceSheet: VannaBalanceSheet = { callVex, putVex, netVex, grossVex, cancellationRatio: 1 - Math.abs(netVex) / (grossVex + 1e-9) };

  const heatmap = parseVannaHeatmap(vannaSurfacePoints);
  const concentration = computeConcentration(vexPerStrike);
  const center = computeVannaCenter(callPutLadder, spot, atmIv, dteHours);
  const asymmetry = computeAsymmetry(vexPerStrike, spot);

  const totalGrossRaw = [...surfaceByDte.values()].reduce((s, v) => s + v.gross, 0);
  const zeroDteGrossRaw = surfaceByDte.get(0)?.gross ?? 0;
  const zeroDteControl: ZeroDteVannaControl | null = totalGrossRaw > 0 ? { zeroDteGrossRaw, totalGrossRaw, controlPct: (zeroDteGrossRaw / totalGrossRaw) * 100 } : null;

  const forwardClock = computeForwardVannaClock(chain, spot, T, r, q, totalMinutesToExpiry);

  const heroStatement = buildHeroStatement(symbol, phase, ivShockScenarios, flipBand, oiFreshness);

  const diagnostics: VannaEngineDiagnostics = {
    pricingModel: "Black-Scholes bump-and-reprice vanna (d(delta)/d(vol)) on SVI-smoothed 0DTE smile; headline hedge-flow numbers use full delta repricing at the shocked vol, not linear vanna scaling",
    surfaceModel: "Single-slice raw SVI, sticky-moneyness for surface-consistent/scenario views",
    contractsIncluded: validContracts,
    invalidContracts,
    dealerSignConvention: "6 scenarios modeled (see Vanna Regime tab) - conventional customer-long/dealer-short is not asserted as known fact",
    oiFreshnessLabel: oiFreshness.level,
    crossProductWarning: "Product-local exposure only (this symbol's own listed options) - cross-product offsets in futures, index options, ETF baskets, or other expirations are unobserved.",
    vannaSurfaceDataNote: "Cross-expiry confluence, the strike x expiry heatmap, and 0DTE vanna control use the source's own /vanna_surface points, which carry no open-interest field - these are raw-Greek-magnitude proxies, not OI-weighted share/dollar exposure.",
    signConventionWarning: "Vanna sign depends on moneyness, not option side - do not assume calls are positive vanna or puts are negative.",
    lastCalculatedAt: Date.now(),
  };

  return {
    heroStatement,
    consensus,
    phase,
    ivShockScenarios,
    spotVolInteraction,
    hedgeField,
    flipBand,
    compressionPivot,
    expansionPivot,
    shelves,
    volatilityGate,
    vacuum,
    confluence,
    surfaceShapeRisk,
    linearizationRisk,
    vannaHalfLifeMinutes,
    dealerSignUncertainty,
    oiFreshness,
    balanceSheet,
    heatmap,
    concentration,
    center,
    asymmetry,
    zeroDteControl,
    forwardClock,
    diagnostics,
  };
}
