/**
 * Gamma Decision Engine - the GEX page's primary content.
 *
 * Structural idea: consensus gamma regime -> typed actionable levels ->
 * failure/cascade risks -> cross-expiry structural map. Everything here is
 * still built from exactly one thing: the current 0DTE chain snapshot
 * (+ the next-dominant expiry's aggregate figures from /option-matrix) and
 * scenario repricing at hypothetical (price, time, vol, dealer-sign,
 * smile-response) combinations. Nothing here is a time series of past
 * snapshots.
 *
 * Stated simplifications, not hidden ones (full academic rigor on every one
 * of these would each be its own research project):
 *  - CRR-with-discrete-dividends is not implemented: this app has no
 *    dividend-calendar data source, so the continuous dividend yield
 *    already used throughout the rest of the app stands in here too.
 *  - The IV smile fit is single-slice raw SVI (svi.ts), not a fully
 *    arbitrage-constrained SSVI surface - it already prevents the worst
 *    per-contract noise, but calendar/butterfly arbitrage-freeness isn't
 *    formally enforced by construction, only checked indirectly via the
 *    CRR engine's separate arbitrage-controlled-smile page option.
 *  - "Sticky-delta" is approximated as a 50/50 blend of sticky-strike
 *    (frozen IV) and sticky-moneyness IV, not the rigorous delta-matched
 *    definition (which needs an implicit strike-solve per option per
 *    scenario) - a commonly cited practitioner rule of thumb, not the
 *    textbook definition.
 *  - "Tail-aware" gamma uses the Corrado-Su (1996) skewness/kurtosis-
 *    adjusted option pricing formula, fed by this app's own SVI-implied
 *    skew/kurtosis (Breeden-Litzenberger on the fitted smile) - a
 *    real, published, closed-form technique, but not a reproduction of
 *    the specific short-time-expansion 0DTE model in the Bandi-Fusari-
 *    Renò research this was inspired by.
 *  - Dealer-position sign is fundamentally unobservable from a public
 *    chain (OI shows contract count, not who's long/short which side).
 *    Every "consensus"/"uncertainty" figure here quantifies sensitivity
 *    to that unknown, not knowledge of the true dealer book.
 */

import { bsPrice, dollarGex, GAMMA_MIN_T_YEARS } from "@/lib/blackScholes";
import { sviImpliedVol, type SviParams } from "@/lib/svi";
import type { ChainStrikeInput, CrossExpiryRow, StrikeRow0DTE } from "@/lib/gex";
import { bsGammaAt, gexLadderAt, netGexAt, normCdf, quantile, zeroCrossings } from "@/lib/gexAnalytics";

// ---------------------------------------------------------------------------
// Tail-aware (Corrado-Su) pricer
// ---------------------------------------------------------------------------

function normPdf(z: number): number {
  return 0.3989422804014327 * Math.exp(-0.5 * z * z);
}

/** Corrado & Su (1996) skewness/kurtosis-adjusted Black-Scholes call, extended to a continuous dividend yield via the forward price. */
function csCallPrice(spot: number, strike: number, T: number, vol: number, r: number, q: number, skew: number, kurtExcess: number): number {
  const bsCall = bsPrice({ spot, strike, T, vol, r, q, isCall: true });
  if (T <= 0 || vol <= 0) return bsCall;

  const sqrtT = Math.sqrt(T);
  const F = spot * Math.exp(-q * T); // forward-discounted spot, used in place of raw S in the correction terms
  const d = (Math.log(spot / strike) + (r - q + (vol * vol) / 2) * T) / (vol * sqrtT);

  const Q3 = (1 / 6) * F * vol * sqrtT * ((2 * vol * sqrtT - d) * normPdf(d) + vol * vol * T * normCdf(d));
  const Q4 =
    (1 / 24) * F * vol * sqrtT * ((d * d - 1 - 3 * vol * sqrtT * (d - vol * sqrtT)) * normPdf(d) + Math.pow(vol, 3) * Math.pow(T, 1.5) * normCdf(d));

  return bsCall + skew * Q3 + kurtExcess * Q4;
}

function csPrice(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean, skew: number, kurtExcess: number): number {
  if (T <= 0 || vol <= 0) return isCall ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  const call = csCallPrice(spot, strike, T, vol, r, q, skew, kurtExcess);
  if (isCall) return Math.max(0, call);
  // put-call parity
  return Math.max(0, call - spot * Math.exp(-q * T) + strike * Math.exp(-r * T));
}

function csGammaAt(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean, skew: number, kurtExcess: number): number {
  if (T <= 0 || vol <= 0) return 0;
  // Same minimum-T floor bsGamma applies: the other three consensus models
  // all reach bsGamma's floored T, so an unfloored tail-aware gamma would
  // collapse into the near-Dirac ATM spike late in a 0DTE session and the
  // displayed "model dispersion" would be measuring the T treatment, not
  // tail risk.
  const Tg = Math.max(T, GAMMA_MIN_T_YEARS);
  const h = spot * 0.005;
  const v0 = csPrice(spot, strike, Tg, vol, r, q, isCall, skew, kurtExcess);
  const up = csPrice(spot + h, strike, Tg, vol, r, q, isCall, skew, kurtExcess);
  const down = csPrice(spot - h, strike, Tg, vol, r, q, isCall, skew, kurtExcess);
  return (up - 2 * v0 + down) / (h * h);
}

// ---------------------------------------------------------------------------
// The four gamma models, each returning a per-strike ladder under a given
// dealer-sign weighting - built once per (model, sign) combination.
// ---------------------------------------------------------------------------

type Ladder = { strike: number; gex: number }[];

function staticLadder(chain: ChainStrikeInput[], evalPrice: number, T: number, r: number, q: number, callWeight: number, putWeight: number): Ladder {
  return gexLadderAt(chain, evalPrice, T, r, q, { callWeight, putWeight });
}

/** Sticky-moneyness: each strike's IV recomputed from the fitted smile at ITS moneyness relative to evalPrice, instead of frozen at today's quote. */
function smileAwareLadder(
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
): Ladder {
  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const vol = sviImpliedVol(sviParams, row.strike * (actualSpot / evalPrice), forward, T);
    const gamma = bsGammaAt(evalPrice, row.strike, T, vol, r, q, row.side === "call");
    const dollar = dollarGex(gamma, row.oi, evalPrice);
    const signed = row.side === "call" ? dollar * callWeight : -dollar * putWeight;
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + signed);
  }
  return [...byStrike.entries()].map(([strike, gex]) => ({ strike, gex })).sort((a, b) => a.strike - b.strike);
}

/** Sticky-delta, approximated as a 50/50 blend of frozen (sticky-strike) and sticky-moneyness IV - see module docstring. */
function stickyDeltaLadder(
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
): Ladder {
  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const stickyMoneyVol = sviImpliedVol(sviParams, row.strike * (actualSpot / evalPrice), forward, T);
    const vol = (row.iv + stickyMoneyVol) / 2;
    const gamma = bsGammaAt(evalPrice, row.strike, T, vol, r, q, row.side === "call");
    const dollar = dollarGex(gamma, row.oi, evalPrice);
    const signed = row.side === "call" ? dollar * callWeight : -dollar * putWeight;
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + signed);
  }
  return [...byStrike.entries()].map(([strike, gex]) => ({ strike, gex })).sort((a, b) => a.strike - b.strike);
}

/** Tail-aware: Corrado-Su gamma using this app's own SVI-implied skew/kurtosis, frozen IV per contract otherwise. */
function tailAwareLadder(
  chain: ChainStrikeInput[],
  evalPrice: number,
  T: number,
  r: number,
  q: number,
  skew: number,
  kurtExcess: number,
  callWeight: number,
  putWeight: number
): Ladder {
  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const gamma = csGammaAt(evalPrice, row.strike, T, row.iv, r, q, row.side === "call", skew, kurtExcess);
    const dollar = dollarGex(gamma, row.oi, evalPrice);
    const signed = row.side === "call" ? dollar * callWeight : -dollar * putWeight;
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + signed);
  }
  return [...byStrike.entries()].map(([strike, gex]) => ({ strike, gex })).sort((a, b) => a.strike - b.strike);
}

function ladderSum(ladder: Ladder): number {
  return ladder.reduce((s, r) => s + r.gex, 0);
}

// ---------------------------------------------------------------------------
// Dealer-sign scenarios
// ---------------------------------------------------------------------------

interface DealerSignDef {
  name: string;
  label: string;
  callWeight: number;
  putWeight: number;
}

function dealerSignScenarios(flowImbalance: number | null): DealerSignDef[] {
  // flowImbalance (from /dealer_anomalies, already fetched elsewhere in this
  // app) biases scenario 6 instead of an additional /dealer_delta fetch -
  // stated substitution, not a hidden one; see module docstring. The
  // upstream field is typed as numeric but has been observed returning a
  // categorical string ("BALANCED") instead - guarded here rather than
  // trusted, since Math.min/max propagate NaN silently otherwise.
  const imb = Number.isFinite(flowImbalance) ? Math.max(-1, Math.min(1, flowImbalance as number)) : 0;
  return [
    { name: "conventional", label: "Conventional (call+/put-)", callWeight: 1, putWeight: 1 },
    { name: "short_all", label: "Dealers short all customer options", callWeight: -1, putWeight: 1 },
    { name: "reduced", label: "Reduced dealer participation", callWeight: 0.5, putWeight: 0.5 },
    { name: "call_heavy_short", label: "Call-heavy dealer-short positioning", callWeight: -1.5, putWeight: 0.5 },
    { name: "put_heavy_short", label: "Put-heavy dealer-short positioning", callWeight: 0.5, putWeight: 1.5 },
    { name: "flow_constrained", label: "Constrained by dealer-flow imbalance", callWeight: 1 + imb * 0.5, putWeight: 1 - imb * 0.5 },
  ];
}

// ---------------------------------------------------------------------------
// Gamma Consensus
// ---------------------------------------------------------------------------

export interface ModelGexResult {
  name: string;
  label: string;
  netGex: number;
}

export interface DealerSignResult {
  name: string;
  label: string;
  netGex: number;
}

export interface GammaConsensus {
  models: ModelGexResult[];
  dealerSignScenarios: DealerSignResult[];
  consensusGex: number;
  dispersion: number;
  signAgreementPct: number;
}

function computeGammaConsensus(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  sviParams: SviParams,
  forward: number,
  skew: number,
  kurtExcess: number,
  flowImbalance: number | null
): GammaConsensus {
  const signs = dealerSignScenarios(flowImbalance);

  const all: number[] = [];
  for (const s of signs) {
    all.push(ladderSum(staticLadder(chain, spot, T, r, q, s.callWeight, s.putWeight)));
    all.push(ladderSum(smileAwareLadder(chain, spot, spot, T, r, q, sviParams, forward, s.callWeight, s.putWeight)));
    all.push(ladderSum(stickyDeltaLadder(chain, spot, spot, T, r, q, sviParams, forward, s.callWeight, s.putWeight)));
    all.push(ladderSum(tailAwareLadder(chain, spot, T, r, q, skew, kurtExcess, s.callWeight, s.putWeight)));
  }

  const models: ModelGexResult[] = [
    { name: "static", label: "Static IV (frozen per contract)", netGex: ladderSum(staticLadder(chain, spot, T, r, q, 1, 1)) },
    { name: "smile_aware", label: "Smile-aware (sticky-moneyness)", netGex: ladderSum(smileAwareLadder(chain, spot, spot, T, r, q, sviParams, forward, 1, 1)) },
    { name: "sticky_delta", label: "Sticky-delta (approximated)", netGex: ladderSum(stickyDeltaLadder(chain, spot, spot, T, r, q, sviParams, forward, 1, 1)) },
    { name: "tail_aware", label: "Tail-aware (Corrado-Su)", netGex: ladderSum(tailAwareLadder(chain, spot, T, r, q, skew, kurtExcess, 1, 1)) },
  ];

  const dealerSignResults: DealerSignResult[] = signs.map((s) => ({
    name: s.name,
    label: s.label,
    netGex: ladderSum(staticLadder(chain, spot, T, r, q, s.callWeight, s.putWeight)),
  }));

  const sorted = [...all].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const consensusGex = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const dispersion = quantile(all, 0.75) - quantile(all, 0.25);

  const positiveCount = dealerSignResults.filter((d) => d.netGex > 0).length;
  const negativeCount = dealerSignResults.filter((d) => d.netGex < 0).length;
  const signAgreementPct = (Math.max(positiveCount, negativeCount) / dealerSignResults.length) * 100;

  return { models, dealerSignScenarios: dealerSignResults, consensusGex, dispersion, signAgreementPct };
}

// ---------------------------------------------------------------------------
// Pillar 1: Gamma Phase classification
// ---------------------------------------------------------------------------

export type GammaPhase = "pinned" | "damped" | "fragile_balance" | "transition" | "reflexive" | "open_field";

const PHASE_INFO: Record<GammaPhase, { label: string; interpretation: string; implication: string }> = {
  pinned: {
    label: "Pinned",
    interpretation: "Positive, concentrated gamma near spot.",
    implication: "Mean reversion and strike attraction are structurally supported.",
  },
  damped: {
    label: "Damped",
    interpretation: "Positive but broadly distributed gamma.",
    implication: "Movement may be restrained, but no precise pin dominates.",
  },
  fragile_balance: {
    label: "Fragile balance",
    interpretation: "Low net gamma but high gross gamma - large opposing exposures are cancelling.",
    implication: "Small changes can flip the regime.",
  },
  transition: {
    label: "Transition",
    interpretation: "Spot is close to a steep gamma flip.",
    implication: "Avoid assuming either trend or mean reversion until price resolves the transition.",
  },
  reflexive: {
    label: "Reflexive",
    interpretation: "Negative gamma with meaningful hedge impact.",
    implication: "Moves may receive procyclical hedge reinforcement.",
  },
  open_field: {
    label: "Open field",
    interpretation: "Low gross gamma and low hedge impact.",
    implication: "Options positioning provides little expected friction.",
  },
};

export interface PhaseClassification {
  phase: GammaPhase;
  label: string;
  interpretation: string;
  tradingImplication: string;
  netGammaRatio: number;
  cancellationRatio: number;
  impactRatio: number | null;
  flipProximity: number | null;
  regimeAgreementPct: number;
}

function classifyPhase(
  netGex: number,
  grossGex: number,
  impactRatio: number | null,
  flipProximity: number | null,
  concentrationEffectiveStrikes: number,
  totalCandidateStrikes: number,
  regimeAgreementPct: number
): PhaseClassification {
  const netGammaRatio = netGex / (grossGex + 1e-9);
  const cancellationRatio = 1 - Math.abs(netGex) / (grossGex + 1e-9);

  const nearFlip = flipProximity !== null && flipProximity < 0.35;
  const concentrated = concentrationEffectiveStrikes < Math.max(3, totalCandidateStrikes * 0.15);
  const highImpact = impactRatio !== null && impactRatio > 0.15;
  const lowGross = grossGex < 1e6; // effectively no meaningful gamma book

  let phase: GammaPhase;
  if (lowGross && !highImpact) {
    phase = "open_field";
  } else if (nearFlip) {
    phase = "transition";
  } else if (netGex < 0) {
    phase = "reflexive";
  } else if (cancellationRatio > 0.7) {
    phase = "fragile_balance";
  } else if (concentrated) {
    phase = "pinned";
  } else {
    phase = "damped";
  }

  const info = PHASE_INFO[phase];
  return {
    phase,
    label: info.label,
    interpretation: info.interpretation,
    tradingImplication: info.implication,
    netGammaRatio,
    cancellationRatio,
    impactRatio,
    flipProximity,
    regimeAgreementPct,
  };
}

// ---------------------------------------------------------------------------
// Pillar 2: Gamma density + typed levels
// ---------------------------------------------------------------------------

export interface GammaDensityPoint {
  price: number;
  density: number;
}

function computeGammaDensity(perStrike: StrikeRow0DTE[], priceValues: number[], bandwidth: number): GammaDensityPoint[] {
  const h = Math.max(1e-6, bandwidth);
  return priceValues.map((price) => ({
    price,
    density: perStrike.reduce((sum, r) => sum + r.gex * Math.exp(-((r.strike - price) ** 2) / (2 * h * h)), 0),
  }));
}

export type LevelType = "pin_basin" | "friction_wall" | "launch_edge" | "vacuum_gate";

export interface TypedLevel {
  type: LevelType;
  label: string;
  low: number;
  high: number;
  center: number;
  score: number;
  ifHeld: string;
  ifCrossed: string;
}

function localSymmetryAt(density: GammaDensityPoint[], centerIdx: number, window: number): number {
  const below = density.slice(Math.max(0, centerIdx - window), centerIdx).reduce((s, p) => s + Math.abs(p.density), 0);
  const above = density.slice(centerIdx + 1, Math.min(density.length, centerIdx + window + 1)).reduce((s, p) => s + Math.abs(p.density), 0);
  return Math.min(below, above) / (Math.max(below, above) + 1e-9);
}

function findTypedLevels(density: GammaDensityPoint[], spot: number, maxAbs: number): TypedLevel[] {
  const levels: TypedLevel[] = [];
  const n = density.length;
  const step = n > 1 ? density[1].price - density[0].price : 1;
  const window = Math.max(2, Math.round(density.length * 0.06));

  // Local maxima/minima
  for (let i = 2; i < n - 2; i++) {
    const cur = density[i].density;
    const isPeak = cur > density[i - 1].density && cur > density[i + 1].density;
    const isTrough = cur < density[i - 1].density && cur < density[i + 1].density;

    if (isPeak && cur > 0) {
      // width at half-max
      let lo = i,
        hi = i;
      while (lo > 0 && density[lo].density > cur / 2) lo--;
      while (hi < n - 1 && density[hi].density > cur / 2) hi++;
      const widthPct = ((density[hi].price - density[lo].price) / spot) * 100;
      const symmetry = localSymmetryAt(density, i, window);
      const score = Math.min(100, (cur / (maxAbs + 1e-9)) * 100);

      if (widthPct < 1.2 && symmetry > 0.45) {
        levels.push({
          type: "pin_basin",
          label: "Pin basin",
          low: density[lo].price,
          high: density[hi].price,
          center: density[i].price,
          score,
          ifHeld: "Mean-reversion pressure toward this range",
          ifCrossed: "Transition toward the next ridge",
        });
      } else if (score > 40) {
        levels.push({
          type: "friction_wall",
          label: "Friction wall",
          low: density[lo].price,
          high: density[hi].price,
          center: density[i].price,
          score,
          ifHeld: "Modeled countercyclical hedge response",
          ifCrossed: "Reduced structural resistance beyond this point",
        });
      }
    }

    if (isTrough) {
      const score = 100 - Math.min(100, (Math.abs(cur) / (maxAbs + 1e-9)) * 100);
      if (score > 55) {
        levels.push({
          type: "vacuum_gate",
          label: "Vacuum gate",
          low: density[Math.max(0, i - 1)].price,
          high: density[Math.min(n - 1, i + 1)].price,
          center: density[i].price,
          score,
          ifHeld: "Little modeled gamma friction in this corridor",
          ifCrossed: "Enters the low-density corridor toward the next ridge",
        });
      }
    }
  }

  // Zero-crossings -> launch edges, kept if the slope there is steep
  const asLadder = density.map((p) => ({ strike: p.price, gex: p.density }));
  for (const crossing of zeroCrossings(asLadder, spot).slice(0, 4)) {
    const idx = density.reduce((best, p, i) => (Math.abs(p.price - crossing) < Math.abs(density[best].price - crossing) ? i : best), 0);
    const lo = Math.max(0, idx - 1);
    const hi = Math.min(n - 1, idx + 1);
    const slope = Math.abs((density[hi].density - density[lo].density) / ((hi - lo) * step || 1));
    const score = Math.min(100, (slope / (maxAbs / (spot * 0.01) + 1e-9)) * 100);
    levels.push({
      type: "launch_edge",
      label: "Launch edge",
      low: crossing - step,
      high: crossing + step,
      center: crossing,
      score,
      ifHeld: "Regime on the current side of this edge persists",
      ifCrossed: "Crosses from stabilizing into amplifying gamma (or vice versa)",
    });
  }

  return levels.sort((a, b) => b.score - a.score).slice(0, 12);
}

// ---------------------------------------------------------------------------
// Cross-expiry gamma confluence (typed)
// ---------------------------------------------------------------------------

export interface ConfluenceResult {
  nextExpiry: { expiration: string; dte: number; totalVol: number; totalOi: number } | null;
  classification: "reinforcing" | "opposing" | "zero_dte_only" | "weekly_only" | "unavailable";
  callConfluence: number;
  putConfluence: number;
}

function computeConfluence(perStrike: StrikeRow0DTE[], crossExpiry: CrossExpiryRow[], callWall: number, putWall: number): ConfluenceResult {
  const candidates = crossExpiry.filter((r) => r.dte > 0);
  if (!candidates.length) return { nextExpiry: null, classification: "unavailable", callConfluence: 0, putConfluence: 0 };

  // T* = next expiry with the greatest gross gamma proxy available from
  // option-matrix (it only exposes net GEX per expiry, not split call/put
  // gross - |netGex| is the best available proxy for "gross gamma" here).
  const nextExpiry = [...candidates].sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex))[0];

  const totalAbs0dte = perStrike.reduce((s, r) => s + Math.abs(r.gex), 0) || 1;
  const p0Call = Math.abs(perStrike.find((r) => r.strike === callWall)?.gex ?? 0) / totalAbs0dte;
  const p0Put = Math.abs(perStrike.find((r) => r.strike === putWall)?.gex ?? 0) / totalAbs0dte;

  // Without the next expiry's own per-strike breakdown (option-matrix only
  // gives call_resistance/put_support, one strike per side), pT is
  // approximated as 1 if that expiry's own resistance/support sits at the
  // same wall, scaled down otherwise - a coarser proxy than a true
  // per-strike overlap, stated plainly.
  const pTCall = nextExpiry.callResistance === callWall ? 1 : nextExpiry.callResistance !== null ? 0.3 : 0;
  const pTPut = nextExpiry.putSupport === putWall ? 1 : nextExpiry.putSupport !== null ? 0.3 : 0;

  const signAgreeCall = nextExpiry.netGex >= 0 ? 1 : 0.4;
  const signAgreePut = nextExpiry.netGex < 0 ? 1 : 0.4;

  const callConfluence = Math.sqrt(p0Call * pTCall) * signAgreeCall * 100;
  const putConfluence = Math.sqrt(p0Put * pTPut) * signAgreePut * 100;

  let classification: ConfluenceResult["classification"];
  const maxConfluence = Math.max(callConfluence, putConfluence);
  if (maxConfluence > 40 && Math.sign(nextExpiry.netGex || 1) === Math.sign(perStrike.reduce((s, r) => s + r.gex, 0) || 1)) classification = "reinforcing";
  else if (maxConfluence > 40) classification = "opposing";
  else if (Math.abs(nextExpiry.netGex) < 1e6) classification = "zero_dte_only";
  else classification = "weekly_only";

  return { nextExpiry: { expiration: nextExpiry.expiration, dte: nextExpiry.dte, totalVol: nextExpiry.totalVol, totalOi: nextExpiry.totalOi }, classification, callConfluence, putConfluence };
}

// ---------------------------------------------------------------------------
// Pillar 3: Key risks
// ---------------------------------------------------------------------------

export interface GammaCliffRisk {
  price: number | null;
  distancePct: number | null;
  regimeChangeLow: number | null;
  regimeChangeHigh: number | null;
}

function computeCliffRisk(density: GammaDensityPoint[], spot: number): GammaCliffRisk {
  if (density.length < 3) return { price: null, distancePct: null, regimeChangeLow: null, regimeChangeHigh: null };
  const step = density[1].price - density[0].price || 1;
  let best = { idx: -1, slope: 0 };
  for (let i = 1; i < density.length - 1; i++) {
    const slope = Math.abs((density[i + 1].density - density[i - 1].density) / (2 * step));
    if (slope > best.slope) best = { idx: i, slope };
  }
  if (best.idx < 0) return { price: null, distancePct: null, regimeChangeLow: null, regimeChangeHigh: null };
  const price = density[best.idx].price;
  return {
    price,
    distancePct: (Math.abs(price - spot) / spot) * 100,
    regimeChangeLow: density[Math.max(0, best.idx - 3)].density,
    regimeChangeHigh: density[Math.min(density.length - 1, best.idx + 3)].density,
  };
}

export interface CascadeRisk {
  direction: "upside" | "downside";
  triggerLow: number | null;
  triggerHigh: number | null;
  nextRidge: number | null;
  cascadeImpactRatio: number | null;
  riskLevel: "low" | "moderate" | "high" | "extreme";
}

function cascadeHedgeShares(chain: ChainStrikeInput[], fromPrice: number, toPrice: number, T: number, r: number, q: number, steps = 8): number {
  let shares = 0;
  const stepSize = (toPrice - fromPrice) / steps;
  for (let i = 0; i < steps; i++) {
    const mid = fromPrice + stepSize * (i + 0.5);
    const gexDollar = netGexAt(chain, mid, T, r, q);
    shares += -((gexDollar * 100) / (mid * mid)) * stepSize;
  }
  return shares;
}

function classifyCascadeRisk(impactRatio: number | null): CascadeRisk["riskLevel"] {
  if (impactRatio === null) return "low";
  if (impactRatio > 0.6) return "extreme";
  if (impactRatio > 0.3) return "high";
  if (impactRatio > 0.1) return "moderate";
  return "low";
}

function computeCascadeRisks(
  chain: ChainStrikeInput[],
  typedLevels: TypedLevel[],
  spot: number,
  T: number,
  r: number,
  q: number,
  recentVolume5m: number | null
): CascadeRisk[] {
  const launchEdges = typedLevels.filter((l) => l.type === "launch_edge");
  const ridges = typedLevels.filter((l) => l.type === "pin_basin" || l.type === "friction_wall");

  const downEdge = launchEdges.filter((l) => l.center < spot).sort((a, b) => b.center - a.center)[0] ?? null;
  const upEdge = launchEdges.filter((l) => l.center > spot).sort((a, b) => a.center - b.center)[0] ?? null;

  const results: CascadeRisk[] = [];

  if (downEdge) {
    const nextRidge = ridges.filter((r2) => r2.center < downEdge.center).sort((a, b) => b.center - a.center)[0]?.center ?? downEdge.low - (spot - downEdge.center);
    const shares = cascadeHedgeShares(chain, spot, nextRidge, T, r, q);
    const impactRatio = recentVolume5m && recentVolume5m > 0 ? Math.abs(shares) / recentVolume5m : null;
    results.push({ direction: "downside", triggerLow: downEdge.low, triggerHigh: downEdge.high, nextRidge, cascadeImpactRatio: impactRatio, riskLevel: classifyCascadeRisk(impactRatio) });
  }

  if (upEdge) {
    const nextRidge = ridges.filter((r2) => r2.center > upEdge.center).sort((a, b) => a.center - b.center)[0]?.center ?? upEdge.high + (upEdge.center - spot);
    const shares = cascadeHedgeShares(chain, spot, nextRidge, T, r, q);
    const impactRatio = recentVolume5m && recentVolume5m > 0 ? Math.abs(shares) / recentVolume5m : null;
    results.push({ direction: "upside", triggerLow: upEdge.low, triggerHigh: upEdge.high, nextRidge, cascadeImpactRatio: impactRatio, riskLevel: classifyCascadeRisk(impactRatio) });
  }

  return results;
}

export interface OiFreshness {
  refreshRatio: number;
  level: "low" | "moderate" | "high";
}

function computeOiFreshness(zeroDteVolume: number, zeroDteOi: number): OiFreshness {
  const refreshRatio = zeroDteVolume / (zeroDteOi + 1e-9);
  const level: OiFreshness["level"] = refreshRatio < 0.5 ? "low" : refreshRatio < 1.5 ? "moderate" : "high";
  return { refreshRatio, level };
}

export interface DealerInventoryUncertainty {
  uncertainty: number;
  positiveScenarios: number;
  negativeScenarios: number;
  totalScenarios: number;
}

function computeInventoryUncertainty(dealerSignResults: DealerSignResult[]): DealerInventoryUncertainty {
  const positiveScenarios = dealerSignResults.filter((d) => d.netGex > 0).length;
  const negativeScenarios = dealerSignResults.filter((d) => d.netGex < 0).length;
  const total = dealerSignResults.length;
  return { uncertainty: 1 - Math.abs(positiveScenarios - negativeScenarios) / total, positiveScenarios, negativeScenarios, totalScenarios: total };
}

export interface SurfaceModelRisk {
  evalPrice: number;
  models: ModelGexResult[];
  dispersionLabel: "low" | "moderate" | "high" | "extreme";
}

function computeSurfaceModelRisk(
  chain: ChainStrikeInput[],
  spot: number,
  evalPrice: number,
  T: number,
  r: number,
  q: number,
  sviParams: SviParams,
  forward: number,
  skew: number,
  kurtExcess: number
): SurfaceModelRisk {
  const models: ModelGexResult[] = [
    { name: "static", label: "Static GEX", netGex: ladderSum(staticLadder(chain, evalPrice, T, r, q, 1, 1)) },
    { name: "smile_aware", label: "Smile-aware GEX", netGex: ladderSum(smileAwareLadder(chain, evalPrice, spot, T, r, q, sviParams, forward, 1, 1)) },
    { name: "sticky_delta", label: "Sticky-delta GEX", netGex: ladderSum(stickyDeltaLadder(chain, evalPrice, spot, T, r, q, sviParams, forward, 1, 1)) },
    { name: "tail_aware", label: "Tail-aware GEX", netGex: ladderSum(tailAwareLadder(chain, evalPrice, T, r, q, skew, kurtExcess, 1, 1)) },
  ];
  const values = models.map((m) => m.netGex);
  const spread = Math.max(...values) - Math.min(...values);
  const scale = Math.max(...values.map(Math.abs), 1);
  const relSpread = spread / scale;
  const dispersionLabel: SurfaceModelRisk["dispersionLabel"] = relSpread > 1.5 ? "extreme" : relSpread > 0.75 ? "high" : relSpread > 0.25 ? "moderate" : "low";
  return { evalPrice, models, dispersionLabel };
}

export interface PinFailureRisk {
  center: number;
  fragility: number;
}

function computePinFailureRisks(
  chain: ChainStrikeInput[],
  pinBasins: TypedLevel[],
  spot: number,
  T: number,
  r: number,
  q: number,
  totalMinutesToExpiry: number
): PinFailureRisk[] {
  if (!pinBasins.length) return [];

  const priceScenarios = [-0.005, -0.0025, -0.001, 0, 0.001, 0.0025, 0.005].map((pct) => spot * (1 + pct));
  const timeScenarios = [0, 15, 30, 60].filter((m) => m < totalMinutesToExpiry).map((m) => Math.max(1e-6, (totalMinutesToExpiry - m) / 60 / 24 / 365));
  const ivScenarios = [-0.02, -0.01, 0, 0.01, 0.02];

  return pinBasins.slice(0, 3).map((basin) => {
    let failCount = 0;
    let total = 0;
    for (const price of priceScenarios) {
      for (const Tsc of timeScenarios.length ? timeScenarios : [T]) {
        for (const ivShift of ivScenarios) {
          total++;
          const ladder = gexLadderAt(chain, price, Tsc, r, q, { ivShift });
          const nearRow = ladder.reduce((best, row) => (Math.abs(row.strike - basin.center) < Math.abs(best.strike - basin.center) ? row : best), ladder[0]);
          if (!nearRow || nearRow.gex <= 0) failCount++;
        }
      }
    }
    return { center: basin.center, fragility: total ? failCount / total : 1 };
  });
}

// ---------------------------------------------------------------------------
// Pillar 4: Key structure
// ---------------------------------------------------------------------------

export interface StructureBalanceSheet {
  grossPositive: number;
  grossNegative: number;
  gammaGross: number;
  gammaNet: number;
  cancellationRatio: number;
}

function computeBalanceSheet(perStrike: StrikeRow0DTE[]): StructureBalanceSheet {
  const grossPositive = perStrike.reduce((s, r) => s + Math.max(r.gex, 0), 0);
  const grossNegative = perStrike.reduce((s, r) => s + Math.min(r.gex, 0), 0);
  const gammaGross = grossPositive + Math.abs(grossNegative);
  const gammaNet = grossPositive + grossNegative;
  return { grossPositive, grossNegative, gammaGross, gammaNet, cancellationRatio: 1 - Math.abs(gammaNet) / (gammaGross + 1e-9) };
}

export interface CenterOfGravity {
  strike: number;
  distanceFromSpot: number;
  distanceInEmUnits: number | null;
  side: "above" | "below" | "at";
}

function computeCenterOfGravity(perStrike: StrikeRow0DTE[], spot: number, expectedMove1s: number | null): CenterOfGravity {
  const totalAbs = perStrike.reduce((s, r) => s + Math.abs(r.gex), 0) || 1;
  const strike = perStrike.reduce((s, r) => s + r.strike * Math.abs(r.gex), 0) / totalAbs;
  const distanceFromSpot = strike - spot;
  return {
    strike,
    distanceFromSpot,
    distanceInEmUnits: expectedMove1s && expectedMove1s > 0 ? distanceFromSpot / expectedMove1s : null,
    side: Math.abs(distanceFromSpot) < 1e-6 ? "at" : distanceFromSpot > 0 ? "above" : "below",
  };
}

// ---------------------------------------------------------------------------
// Forward Gamma Clock
// ---------------------------------------------------------------------------

export interface ForwardClockSnapshot {
  label: string;
  minutesAhead: number;
  gammaFlip: number | null;
  pinBasinCenter: number | null;
  nearestCliff: number | null;
  effectiveStrikes: number;
}

function effectiveStrikesOf(ladder: Ladder): number {
  const totalAbs = ladder.reduce((s, r) => s + Math.abs(r.gex), 0) || 1;
  const shares = ladder.map((r) => Math.abs(r.gex) / totalAbs).filter((p) => p > 0);
  const entropy = -shares.reduce((s, p) => s + p * Math.log(p), 0);
  return Math.exp(entropy);
}

function computeForwardClock(chain: ChainStrikeInput[], spot: number, r: number, q: number, totalMinutesToExpiry: number): ForwardClockSnapshot[] {
  const rawTargets = [
    { label: "Now", minutesAhead: 0 },
    { label: "+30 min", minutesAhead: 30 },
    { label: "+60 min", minutesAhead: 60 },
    { label: "+90 min", minutesAhead: 90 },
    { label: "30 min before close", minutesAhead: Math.max(0, totalMinutesToExpiry - 30) },
    { label: "10 min before close", minutesAhead: Math.max(0, totalMinutesToExpiry - 10) },
  ].filter((t) => t.minutesAhead < totalMinutesToExpiry);

  const seen = new Set<number>();
  const targets = rawTargets.filter((t) => {
    const key = Math.round(t.minutesAhead);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return targets.map((t) => {
    const T = Math.max(1e-6, (totalMinutesToExpiry - t.minutesAhead) / 60 / 24 / 365);
    const ladder = staticLadder(chain, spot, T, r, q, 1, 1);
    const flip = zeroCrossings(ladder, spot)[0] ?? null;
    const topPositive = [...ladder].filter((row) => row.gex > 0).sort((a, b) => b.gex - a.gex)[0]?.strike ?? null;

    let cliffPrice: number | null = null;
    if (ladder.length > 2) {
      let best = { idx: -1, slope: 0 };
      for (let i = 1; i < ladder.length - 1; i++) {
        const slope = Math.abs((ladder[i + 1].gex - ladder[i - 1].gex) / ((ladder[i + 1].strike - ladder[i - 1].strike) || 1));
        if (slope > best.slope) best = { idx: i, slope };
      }
      cliffPrice = best.idx >= 0 ? ladder[best.idx].strike : null;
    }

    return {
      label: t.label,
      minutesAhead: t.minutesAhead,
      gammaFlip: flip,
      pinBasinCenter: topPositive,
      nearestCliff: cliffPrice,
      effectiveStrikes: effectiveStrikesOf(ladder),
    };
  });
}

// ---------------------------------------------------------------------------
// Gamma Phase Map - the flagship visualization: price x time-to-expiry,
// colored by consensus-direction net GEX, opacity by a cheap 2-scenario
// agreement check (conventional vs. dealers-short-all) rather than the
// full 24-combination consensus at every grid cell, which would be far
// too slow for a live endpoint at this grid resolution.
// ---------------------------------------------------------------------------

export interface PhaseMapPoint {
  price: number;
  minutesToExpiry: number;
  netGex: number;
  agreementPct: number;
}

export interface PhaseMap {
  grid: PhaseMapPoint[];
  priceValues: number[];
  minutesValues: number[];
}

function computePhaseMap(
  chain: ChainStrikeInput[],
  spot: number,
  r: number,
  q: number,
  totalMinutesToExpiry: number,
  priceRangePct: number,
  priceSteps: number,
  timeSteps: number
): PhaseMap {
  const priceValues: number[] = [];
  for (let i = 0; i <= priceSteps; i++) priceValues.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / priceSteps));

  const minutesValues: number[] = [];
  const floorMinutes = Math.min(3, totalMinutesToExpiry);
  for (let i = 0; i <= timeSteps; i++) minutesValues.push(totalMinutesToExpiry - ((totalMinutesToExpiry - floorMinutes) * i) / timeSteps);

  const grid: PhaseMapPoint[] = [];
  for (const minutesToExpiry of minutesValues) {
    const T = Math.max(floorMinutes, minutesToExpiry) / 60 / 24 / 365;
    for (const price of priceValues) {
      const conventional = netGexAt(chain, price, T, r, q);
      const shortAll = ladderSum(gexLadderAt(chain, price, T, r, q, { callWeight: -1, putWeight: 1 }));
      const agreementPct = Math.sign(conventional) === Math.sign(shortAll) ? 90 : 45;
      grid.push({ price, minutesToExpiry, netGex: conventional, agreementPct });
    }
  }
  return { grid, priceValues, minutesValues };
}

// ---------------------------------------------------------------------------
// Hero statement
// ---------------------------------------------------------------------------

function buildHeroStatement(
  symbol: string,
  phase: PhaseClassification,
  typedLevels: TypedLevel[],
  cascadeRisks: CascadeRisk[],
  confluence: ConfluenceResult,
  oiFreshness: OiFreshness
): string {
  const primaryPin = typedLevels.find((l) => l.type === "pin_basin");
  const downCascade = cascadeRisks.find((c) => c.direction === "downside");

  const parts: string[] = [];
  // Skip the "fragile " prefix when the phase label already says fragile ("fragile balance" would read "fragile fragile balance").
  parts.push(`${symbol} is in ${phase.cancellationRatio > 0.6 && phase.phase !== "pinned" && phase.phase !== "fragile_balance" ? "fragile " : ""}${phase.label.toLowerCase()} gamma.`);

  if (primaryPin) {
    parts.push(`The primary pin basin is ${primaryPin.low.toFixed(1)}–${primaryPin.high.toFixed(1)}.`);
  }

  if (downCascade && downCascade.triggerLow !== null) {
    const nextRidgeText = downCascade.nextRidge !== null ? ` toward ${downCascade.nextRidge.toFixed(1)}` : "";
    parts.push(`Acceptance below the ${downCascade.triggerLow.toFixed(1)} launch edge enters a negative-gamma corridor${nextRidgeText}.`);
  }

  if (confluence.nextExpiry) {
    const pct = Math.max(confluence.callConfluence, confluence.putConfluence);
    parts.push(`0DTE ${confluence.classification === "reinforcing" ? "reinforces" : confluence.classification === "opposing" ? "opposes" : "stands alone against"} the next dominant expiry (${pct.toFixed(0)}% confluence).`);
  }

  if (oiFreshness.level === "high") {
    parts.push("Elevated intraday turnover reduces inventory confidence.");
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Diagnostics + assembly
// ---------------------------------------------------------------------------

export interface EngineDiagnostics {
  pricingEngine: string;
  ivSurfaceFitError: number;
  validContracts: number;
  dealerSignAssumption: string;
  modelDispersionLabel: SurfaceModelRisk["dispersionLabel"];
  oiFreshnessLabel: OiFreshness["level"];
  lastCalculatedAt: number;
}

export interface GammaEngineResult {
  heroStatement: string;
  consensus: GammaConsensus;
  phase: PhaseClassification;
  phaseMap: PhaseMap;
  density: GammaDensityPoint[];
  typedLevels: TypedLevel[];
  confluence: ConfluenceResult;
  cliffRisk: GammaCliffRisk;
  cascadeRisks: CascadeRisk[];
  oiFreshness: OiFreshness;
  inventoryUncertainty: DealerInventoryUncertainty;
  surfaceModelRisk: SurfaceModelRisk;
  pinFailureRisks: PinFailureRisk[];
  balanceSheet: StructureBalanceSheet;
  centerOfGravity: CenterOfGravity;
  zeroDteControlPct: number | null;
  forwardClock: ForwardClockSnapshot[];
  diagnostics: EngineDiagnostics;
}

export function computeGammaEngine(params: {
  symbol: string;
  chain: ChainStrikeInput[];
  perStrike: StrikeRow0DTE[];
  spot: number;
  r: number;
  q: number;
  dteHours: number;
  atmIv: number;
  expectedMove1s: number | null;
  callWall: number;
  putWall: number;
  totalGex0dte: number;
  crossExpiry: CrossExpiryRow[];
  recentVolume5m: number | null;
  sviParams: SviParams;
  forward: number;
  skew: number;
  kurtExcess: number;
  flowImbalance: number | null;
  validContracts: number;
  ivSurfaceFitError: number;
  pricerEngineLabel: string;
}): GammaEngineResult {
  const {
    symbol,
    chain,
    perStrike,
    spot,
    r,
    q,
    dteHours,
    atmIv,
    expectedMove1s,
    callWall,
    putWall,
    totalGex0dte,
    crossExpiry,
    recentVolume5m,
    sviParams,
    forward,
    skew,
    kurtExcess,
    flowImbalance,
    validContracts,
    ivSurfaceFitError,
    pricerEngineLabel,
  } = params;

  const T = Math.max(dteHours, 0.05) / 24 / 365;
  const totalMinutesToExpiry = Math.max(dteHours * 60, 3);
  const lambda = expectedMove1s && expectedMove1s > 0 ? expectedMove1s : spot * 0.01;

  const consensus = computeGammaConsensus(chain, spot, T, r, q, sviParams, forward, skew, kurtExcess, flowImbalance);

  const grossGex = perStrike.reduce((s, row) => s + Math.abs(row.gex), 0);
  const impactRatio = recentVolume5m && recentVolume5m > 0 ? Math.abs((totalGex0dte * 100 * 0.0025) / spot) / recentVolume5m : null;
  const flipCrossing = zeroCrossings(perStrike.map((r2) => ({ strike: r2.strike, gex: r2.gex })), spot)[0] ?? null;
  const flipProximity = flipCrossing !== null ? Math.abs(spot - flipCrossing) / lambda : null;

  const totalAbsForConcentration = perStrike.reduce((s, row) => s + Math.abs(row.gex), 0) || 1;
  const shares = perStrike.map((row) => Math.abs(row.gex) / totalAbsForConcentration).filter((p) => p > 0);
  const entropy = -shares.reduce((s, p) => s + p * Math.log(p), 0);
  const effectiveStrikes = Math.exp(entropy);

  const phase = classifyPhase(totalGex0dte, grossGex, impactRatio, flipProximity, effectiveStrikes, perStrike.length, consensus.signAgreementPct);
  const phaseMap = computePhaseMap(chain, spot, r, q, totalMinutesToExpiry, 0.05, 20, 6);

  const priceRangePct = 0.06;
  const priceValues: number[] = [];
  for (let i = 0; i <= 80; i++) priceValues.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / 80));
  const bandwidth = Math.max(lambda * 0.4, spot * 0.0025);
  const density = computeGammaDensity(perStrike, priceValues, bandwidth);
  const maxAbsDensity = Math.max(1e-6, ...density.map((p) => Math.abs(p.density)));

  const typedLevels = findTypedLevels(density, spot, maxAbsDensity);
  const confluence = computeConfluence(perStrike, crossExpiry, callWall, putWall);
  const cliffRisk = computeCliffRisk(density, spot);
  const cascadeRisks = computeCascadeRisks(chain, typedLevels, spot, T, r, q, recentVolume5m);

  const zeroDteRow = crossExpiry.find((row) => row.dte === 0);
  const zeroDteVolume = zeroDteRow?.totalVol ?? 0;
  const zeroDteOi = perStrike.reduce((s, row) => s + row.callOi + row.putOi, 0);
  const oiFreshness = computeOiFreshness(zeroDteVolume, zeroDteOi);

  const inventoryUncertainty = computeInventoryUncertainty(consensus.dealerSignScenarios);

  const evalPrice = spot + lambda;
  const surfaceModelRisk = computeSurfaceModelRisk(chain, spot, evalPrice, T, r, q, sviParams, forward, skew, kurtExcess);

  const pinBasins = typedLevels.filter((l) => l.type === "pin_basin");
  const pinFailureRisks = computePinFailureRisks(chain, pinBasins, spot, T, r, q, totalMinutesToExpiry);

  const balanceSheet = computeBalanceSheet(perStrike);
  const centerOfGravity = computeCenterOfGravity(perStrike, spot, expectedMove1s);

  const totalAbsAllExpiries = crossExpiry.reduce((s, row) => s + Math.abs(row.netGex), 0);
  const zeroDteControlPct = totalAbsAllExpiries > 0 && zeroDteRow ? (Math.abs(zeroDteRow.netGex) / totalAbsAllExpiries) * 100 : null;

  const forwardClock = computeForwardClock(chain, spot, r, q, totalMinutesToExpiry);

  const heroStatement = buildHeroStatement(symbol, phase, typedLevels, cascadeRisks, confluence, oiFreshness);

  const diagnostics: EngineDiagnostics = {
    pricingEngine: pricerEngineLabel,
    ivSurfaceFitError,
    validContracts,
    dealerSignAssumption: "6 scenarios modeled (see Gamma Regime tab) - conventional call+/put- is not asserted as known fact",
    modelDispersionLabel: surfaceModelRisk.dispersionLabel,
    oiFreshnessLabel: oiFreshness.level,
    lastCalculatedAt: Date.now(),
  };

  return {
    heroStatement,
    consensus,
    phase,
    phaseMap,
    density,
    typedLevels,
    confluence,
    cliffRisk,
    cascadeRisks,
    oiFreshness,
    inventoryUncertainty,
    surfaceModelRisk,
    pinFailureRisks,
    balanceSheet,
    centerOfGravity,
    zeroDteControlPct,
    forwardClock,
    diagnostics,
  };
}

/** ATM-IV-vs-fitted-SVI residual, RMS across all live-quoted strikes - a crude "IV surface fit error" for the diagnostic strip. */
export function computeIvSurfaceFitError(chain: ChainStrikeInput[], sviParams: SviParams, forward: number, T: number): number {
  const withIv = chain.filter((row) => row.iv > 0);
  if (!withIv.length) return 0;
  const sq = withIv.reduce((s, row) => {
    const fitted = sviImpliedVol(sviParams, row.strike, forward, T);
    return s + (row.iv - fitted) ** 2;
  }, 0);
  return Math.sqrt(sq / withIv.length);
}
