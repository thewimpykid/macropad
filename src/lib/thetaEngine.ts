/**
 * Theta Decision Engine - the Theta page's primary content.
 *
 * Different central question again: not hedge sensitivity (GEX) or hedge
 * inventory (DEX), but where option premium is disappearing, how fast, and
 * how much movement is required to overcome it. Theta does NOT directly
 * force dealers to buy or sell the underlying - a high-theta strike is not
 * automatically support, resistance, or a reversal level. Same
 * architecture and "current snapshot + scenario repricing, never history"
 * constraint as gammaEngine.ts/deltaEngine.ts - see those modules'
 * docstrings for the shared caveats.
 *
 * Two separate views kept apart throughout, never conflated:
 *  - Long-holder decay burden: Theta_i * OI_i * 100, natural sign, no
 *    dealer-position assumption - what option HOLDERS collectively lose.
 *  - Estimated dealer carry: the same figure under an assumed dealer
 *    short-side convention (6 scenarios) - what dealers are estimated to
 *    collect (or lose) from time passage. OI reveals contract count, not
 *    who's long or short, so this remains an estimate under stated
 *    assumptions, never presented as observed dealer P&L.
 *
 * Finite-horizon burn (5/15/30/60 min, not "per day") is computed as an
 * actual reprice difference at two points in time (V(tau) - V(tau-h)),
 * not linear extrapolation of the analytic per-day theta - theta is
 * nonlinear near expiration, and 0DTE horizons are short enough that the
 * linear approximation would be wrong exactly when it matters most.
 */

import { bsGreeks, bsPrice, dollarTheta } from "@/lib/blackScholes";
import type { ChainStrikeInput, CrossExpiryRow, StrikeRow0DTE } from "@/lib/gex";

const MULTIPLIER = 100;

// ---------------------------------------------------------------------------
// Extrinsic value + finite-horizon burn primitives
// ---------------------------------------------------------------------------

function intrinsicValue(spot: number, strike: number, isCall: boolean): number {
  return isCall ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

/** Total extrinsic (time) value across the active chain at a hypothetical (spot, T) - the denominator for burn fraction and the target for half-life search. */
function extrinsicValueAt(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): number {
  let total = 0;
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const price = bsPrice({ spot, strike: row.strike, T, vol: row.iv, r, q, isCall: row.side === "call" });
    const extrinsic = Math.max(0, price - intrinsicValue(spot, row.strike, row.side === "call"));
    total += extrinsic * row.oi * MULTIPLIER;
  }
  return total;
}

/** Burn over a forward window [hStart, hEnd] (years) - the aggregate extrinsic value that disappears between two future points, holding spot/IV fixed. Positive = value lost. */
function burnOverWindow(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, hStartYears: number, hEndYears: number): number {
  const tAtStart = Math.max(1e-8, T - hStartYears);
  const tAtEnd = Math.max(1e-8, T - hEndYears);
  return extrinsicValueAt(chain, spot, tAtStart, r, q) - extrinsicValueAt(chain, spot, tAtEnd, r, q);
}

function grossBurn(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, hYears: number): number {
  return burnOverWindow(chain, spot, T, r, q, 0, Math.min(hYears, T));
}

// ---------------------------------------------------------------------------
// Long-holder vs. estimated dealer carry
// ---------------------------------------------------------------------------

interface DealerSignDef {
  name: string;
  label: string;
  callWeight: number;
  putWeight: number;
}

function dealerSignScenarios(flowImbalance: number | null): DealerSignDef[] {
  const imb = Number.isFinite(flowImbalance) ? Math.max(-1, Math.min(1, flowImbalance as number)) : 0;
  return [
    { name: "conventional", label: "Conventional customer-long/dealer-short", callWeight: 1, putWeight: 1 },
    { name: "reduced", label: "Reduced dealer participation", callWeight: 0.5, putWeight: 0.5 },
    { name: "call_heavy", label: "Call-heavy dealer exposure", callWeight: 1.5, putWeight: 0.5 },
    { name: "put_heavy", label: "Put-heavy dealer exposure", callWeight: 0.5, putWeight: 1.5 },
    { name: "flow_constrained", label: "Constrained by dealer-flow imbalance", callWeight: 1 + imb * 0.5, putWeight: 1 - imb * 0.5 },
    { name: "reinforcing", label: "Reinforcing (dealers long both sides)", callWeight: -1, putWeight: -1 },
  ];
}

/** Long-holder decay burden ladder: natural theta sign, no dealer-position weighting at all - Theta_i * OI_i * 100, both sides summed as-is. */
function longHolderLadder(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): { strike: number; tex: number }[] {
  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const g = bsGreeks({ spot, strike: row.strike, T, vol: row.iv, r, q, isCall: row.side === "call" });
    const contribution = dollarTheta(g.theta, row.oi);
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + contribution);
  }
  return [...byStrike.entries()].map(([strike, tex]) => ({ strike, tex })).sort((a, b) => a.strike - b.strike);
}

/** Estimated dealer carry ladder: -Theta_i * OI_i * 100 * side-weight - positive means dealers are estimated to collect from time decay (the "sellers of options collect theta" convention) under the given dealer-sign scenario. */
function dealerCarryLadder(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, callWeight: number, putWeight: number): { strike: number; carry: number }[] {
  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const g = bsGreeks({ spot, strike: row.strike, T, vol: row.iv, r, q, isCall: row.side === "call" });
    const weight = row.side === "call" ? callWeight : putWeight;
    const contribution = -dollarTheta(g.theta, row.oi) * weight;
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + contribution);
  }
  return [...byStrike.entries()].map(([strike, carry]) => ({ strike, carry })).sort((a, b) => a.strike - b.strike);
}

function ladderSum<T extends { [k: string]: number }>(ladder: T[], key: keyof T): number {
  return ladder.reduce((s, r) => s + (r[key] as number), 0);
}

// ---------------------------------------------------------------------------
// Pillar 1: Theta regime
// ---------------------------------------------------------------------------

export type ThetaPhase = "slow_carry" | "steady_burn" | "accelerating_burn" | "decay_trap" | "motion_dominant" | "fragile_carry";

const PHASE_INFO: Record<ThetaPhase, { label: string; interpretation: string }> = {
  slow_carry: { label: "Slow carry", interpretation: "Little remaining premium disappears over the next 30 minutes." },
  steady_burn: { label: "Steady burn", interpretation: "Decay is material but relatively distributed." },
  accelerating_burn: { label: "Accelerating burn", interpretation: "The next 30 minutes lose much more premium than the previous equivalent interval." },
  decay_trap: { label: "Decay trap", interpretation: "Spot is inside a region where meaningful movement is required merely to offset time decay." },
  motion_dominant: { label: "Motion-dominant", interpretation: "The current implied movement scale exceeds the theta escape requirement." },
  fragile_carry: { label: "Fragile carry", interpretation: "Theta income is high, but a modest underlying move can overwhelm it." },
};

export interface ThetaConsensusScenario {
  name: string;
  label: string;
  carryNow: number;
}

export interface ThetaRegime {
  burn5m: number;
  burn15m: number;
  burn30m: number;
  burn60m: number;
  burnUntilExpiry: number;
  grossExtrinsicValue: number;
  burnFraction30m: number;
  burnRateNow: number;
  burnRateAt30m: number;
  burnAcceleration: number;
  maxAccelerationMinutes: number | null;
  halfLifeAll: number | null;
  halfLifeAtm: number | null;
  halfLifeCalls: number | null;
  halfLifePuts: number | null;
  decayDominanceRatio30m: number | null;
}

function computeBurnRateSeries(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number): { minutesAhead: number; ratePerMin: number }[] {
  const points = [0, 10, 20, 30, 45, 60, 90].filter((m) => m < totalMinutesToExpiry);
  const window = 5 / 60 / 24 / 365;
  return points.map((m) => {
    const hStart = (m / 60 / 24 / 365);
    const hEnd = hStart + window;
    const burn = burnOverWindow(chain, spot, T, r, q, hStart, Math.min(hEnd, T));
    return { minutesAhead: m, ratePerMin: burn / 5 };
  });
}

/** Binary search for the horizon (minutes) at which extrinsic value first reaches half its current value, null if it never does within the session. */
function findHalfLife(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number): number | null {
  const v0 = extrinsicValueAt(chain, spot, T, r, q);
  if (v0 <= 0) return null;
  const target = v0 * 0.5;
  const vEnd = extrinsicValueAt(chain, spot, Math.max(1e-8, T - totalMinutesToExpiry / 60 / 24 / 365), r, q);
  if (vEnd > target) return null; // never reaches half-life within the session

  let lo = 0,
    hi = totalMinutesToExpiry;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const v = extrinsicValueAt(chain, spot, Math.max(1e-8, T - mid / 60 / 24 / 365), r, q);
    if (v > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function computeThetaRegimeMetrics(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  totalMinutesToExpiry: number,
  impliedMove30m: number | null,
  escapeMove30m: number | null
): ThetaRegime {
  const toYears = (m: number) => Math.min(m, totalMinutesToExpiry) / 60 / 24 / 365;
  const burn5m = grossBurn(chain, spot, T, r, q, toYears(5));
  const burn15m = grossBurn(chain, spot, T, r, q, toYears(15));
  const burn30m = grossBurn(chain, spot, T, r, q, toYears(30));
  const burn60m = grossBurn(chain, spot, T, r, q, toYears(60));
  const burnUntilExpiry = grossBurn(chain, spot, T, r, q, T);

  const grossExtrinsicValue = extrinsicValueAt(chain, spot, T, r, q);
  const burnFraction30m = grossExtrinsicValue > 0 ? burn30m / grossExtrinsicValue : 0;

  const rateSeries = computeBurnRateSeries(chain, spot, T, r, q, totalMinutesToExpiry);
  const burnRateNow = rateSeries[0]?.ratePerMin ?? 0;
  const burnRateAt30m = rateSeries.find((p) => p.minutesAhead === 30)?.ratePerMin ?? rateSeries[rateSeries.length - 1]?.ratePerMin ?? burnRateNow;
  const burnAcceleration = burnRateAt30m - burnRateNow;

  let maxAccelerationMinutes: number | null = null;
  let maxAccel = -Infinity;
  for (let i = 1; i < rateSeries.length; i++) {
    const accel = rateSeries[i].ratePerMin - rateSeries[i - 1].ratePerMin;
    if (accel > maxAccel) {
      maxAccel = accel;
      maxAccelerationMinutes = rateSeries[i].minutesAhead;
    }
  }

  const atmChain = chain.filter((row) => Math.abs(row.strike - spot) <= spot * 0.01);
  const halfLifeAll = findHalfLife(chain, spot, T, r, q, totalMinutesToExpiry);
  const halfLifeAtm = atmChain.length ? findHalfLife(atmChain, spot, T, r, q, totalMinutesToExpiry) : null;
  const halfLifeCalls = findHalfLife(chain.filter((row) => row.side === "call"), spot, T, r, q, totalMinutesToExpiry);
  const halfLifePuts = findHalfLife(chain.filter((row) => row.side === "put"), spot, T, r, q, totalMinutesToExpiry);

  const decayDominanceRatio30m = impliedMove30m !== null && escapeMove30m !== null && escapeMove30m > 0 ? impliedMove30m / escapeMove30m : null;

  return {
    burn5m,
    burn15m,
    burn30m,
    burn60m,
    burnUntilExpiry,
    grossExtrinsicValue,
    burnFraction30m,
    burnRateNow,
    burnRateAt30m,
    burnAcceleration,
    maxAccelerationMinutes,
    halfLifeAll,
    halfLifeAtm,
    halfLifeCalls,
    halfLifePuts,
    decayDominanceRatio30m,
  };
}

export interface PhaseClassification {
  phase: ThetaPhase;
  label: string;
  interpretation: string;
}

function classifyPhase(regime: ThetaRegime, spotInsideCompressionZone: boolean): PhaseClassification {
  let phase: ThetaPhase;
  if (regime.decayDominanceRatio30m !== null && regime.decayDominanceRatio30m > 1.3) phase = "motion_dominant";
  else if (regime.burnAcceleration > regime.burnRateNow * 0.5 && regime.burnRateNow > 0) phase = "accelerating_burn";
  else if (spotInsideCompressionZone && regime.burnFraction30m > 0.2) phase = "decay_trap";
  else if (regime.decayDominanceRatio30m !== null && regime.decayDominanceRatio30m < 0.6) phase = "fragile_carry";
  else if (regime.burnFraction30m < 0.08) phase = "slow_carry";
  else phase = "steady_burn";

  const info = PHASE_INFO[phase];
  return { phase, label: info.label, interpretation: info.interpretation };
}

// ---------------------------------------------------------------------------
// Pillar 2: Key levels
// ---------------------------------------------------------------------------

export interface DecayCenters {
  callCenter: number | null;
  putCenter: number | null;
  grossCenter: number | null;
}

function weightedCenter(rows: { strike: number; weight: number }[]): number | null {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return null;
  return rows.reduce((s, r) => s + r.strike * r.weight, 0) / total;
}

function computeDecayCenters(perStrike: { strike: number; tex: number; callTex: number; putTex: number }[]): DecayCenters {
  return {
    callCenter: weightedCenter(perStrike.map((r) => ({ strike: r.strike, weight: Math.abs(r.callTex) }))),
    putCenter: weightedCenter(perStrike.map((r) => ({ strike: r.strike, weight: Math.abs(r.putTex) }))),
    grossCenter: weightedCenter(perStrike.map((r) => ({ strike: r.strike, weight: Math.abs(r.tex) }))),
  };
}

export interface BurnBasin {
  low: number;
  high: number;
  center: number;
  sharePct: number;
}

function computeBurnBasin(perStrike: { strike: number; tex: number }[], priceValues: number[], bandwidth: number): { density: { price: number; density: number }[]; basin: BurnBasin | null } {
  const h = Math.max(1e-6, bandwidth);
  const density = priceValues.map((price) => ({
    price,
    density: perStrike.reduce((sum, r) => sum + Math.abs(r.tex) * Math.exp(-((r.strike - price) ** 2) / (2 * h * h)), 0),
  }));
  const maxDensity = Math.max(0, ...density.map((p) => p.density));
  if (maxDensity <= 0) return { density, basin: null };

  const threshold = maxDensity * 0.6;
  const aboveThreshold = density.filter((p) => p.density >= threshold);
  if (!aboveThreshold.length) return { density, basin: null };

  const low = aboveThreshold[0].price;
  const high = aboveThreshold[aboveThreshold.length - 1].price;
  const totalAbs = perStrike.reduce((s, r) => s + Math.abs(r.tex), 0) || 1;
  const inBasin = perStrike.filter((r) => r.strike >= low && r.strike <= high).reduce((s, r) => s + Math.abs(r.tex), 0);
  const center = weightedCenter(aboveThreshold.map((p) => ({ strike: p.price, weight: p.density }))) ?? (low + high) / 2;

  return { density, basin: { low, high, center, sharePct: (inBasin / totalAbs) * 100 } };
}

export interface EscapeBand {
  horizonMinutes: number;
  down: number | null;
  up: number | null;
}

/** Bisection root-find for the price where a basket's future value (at tau-h) recovers today's value - expands the search range outward until bracketed or gives up at maxRangePct. */
function findEscapePrice(basketValueAt: (S: number) => number, target: number, spot: number, direction: "up" | "down", maxRangePct = 0.05): number | null {
  let lo = spot;
  let hi = direction === "up" ? spot * (1 + maxRangePct) : spot * (1 - maxRangePct);
  const valLo = basketValueAt(lo);
  const valHi = basketValueAt(hi);
  if (!(valLo < target && valHi >= target)) return null; // not bracketed within range - decay isn't recoverable that close

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const val = basketValueAt(mid);
    if (val < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function computeEscapeBand(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  horizonMinutes: number,
  totalMinutesToExpiry: number,
  basket: "atm_straddle" | "oi_weighted"
): EscapeBand {
  const hYears = Math.min(horizonMinutes, totalMinutesToExpiry) / 60 / 24 / 365;
  const Tfuture = Math.max(1e-8, T - hYears);

  let basketValueAt: (S: number) => number;

  if (basket === "atm_straddle") {
    const nearest = [...new Set(chain.map((row) => row.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))[0];
    const call = chain.find((row) => row.strike === nearest && row.side === "call");
    const put = chain.find((row) => row.strike === nearest && row.side === "put");
    const callIv = call?.iv || put?.iv || 0.2;
    const putIv = put?.iv || call?.iv || 0.2;
    basketValueAt = (S: number) =>
      bsPrice({ spot: S, strike: nearest, T: Tfuture, vol: callIv, r, q, isCall: true }) + bsPrice({ spot: S, strike: nearest, T: Tfuture, vol: putIv, r, q, isCall: false });
  } else {
    const active = chain.filter((row) => row.oi > 0 && row.iv > 0);
    basketValueAt = (S: number) => active.reduce((sum, row) => sum + row.oi * bsPrice({ spot: S, strike: row.strike, T: Tfuture, vol: row.iv, r, q, isCall: row.side === "call" }), 0);
  }

  const targetNow = basket === "atm_straddle" ? straddleValueNow(chain, spot, T, r, q) : oiWeightedValueNow(chain, spot, T, r, q);

  const down = findEscapePrice(basketValueAt, targetNow, spot, "down");
  const up = findEscapePrice(basketValueAt, targetNow, spot, "up");
  return { horizonMinutes, down, up };
}

function straddleValueNow(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): number {
  const nearest = [...new Set(chain.map((row) => row.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))[0];
  const call = chain.find((row) => row.strike === nearest && row.side === "call");
  const put = chain.find((row) => row.strike === nearest && row.side === "put");
  const callIv = call?.iv || put?.iv || 0.2;
  const putIv = put?.iv || call?.iv || 0.2;
  return bsPrice({ spot, strike: nearest, T, vol: callIv, r, q, isCall: true }) + bsPrice({ spot, strike: nearest, T, vol: putIv, r, q, isCall: false });
}

function oiWeightedValueNow(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): number {
  const active = chain.filter((row) => row.oi > 0 && row.iv > 0);
  return active.reduce((sum, row) => sum + row.oi * bsPrice({ spot, strike: row.strike, T, vol: row.iv, r, q, isCall: row.side === "call" }), 0);
}

export interface EscapeAsymmetry {
  horizonMinutes: number;
  upDistance: number | null;
  downDistance: number | null;
  asymmetry: number | null;
}

function computeEscapeAsymmetry(band: EscapeBand, spot: number): EscapeAsymmetry {
  const upDistance = band.up !== null ? band.up - spot : null;
  const downDistance = band.down !== null ? spot - band.down : null;
  const asymmetry = upDistance !== null && downDistance !== null && upDistance + downDistance > 0 ? (upDistance - downDistance) / (upDistance + downDistance) : null;
  return { horizonMinutes: band.horizonMinutes, upDistance, downDistance, asymmetry };
}

export interface ThetaShelf {
  low: number;
  high: number;
  center: number;
  sharePct: number;
  mix: "call_heavy" | "put_heavy" | "balanced";
  burn30m: number;
}

function computeThetaShelves(perStrike: { strike: number; tex: number; callTex: number; putTex: number }[], burnByStrike30m: Map<number, number>): ThetaShelf[] {
  const sorted = [...perStrike].sort((a, b) => a.strike - b.strike);
  const totalAbs = sorted.reduce((s, r) => s + Math.abs(r.tex), 0) || 1;
  const window = 3;

  const shelves: ThetaShelf[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const strikeShare = Math.abs(sorted[i].tex) / totalAbs;
    if (strikeShare < 0.03) continue;
    const windowRows = sorted.slice(Math.max(0, i - window), Math.min(sorted.length, i + window + 1));
    const sharePct = (windowRows.reduce((s, r) => s + Math.abs(r.tex), 0) / totalAbs) * 100;
    const callShare = windowRows.reduce((s, r) => s + Math.abs(r.callTex), 0);
    const putShare = windowRows.reduce((s, r) => s + Math.abs(r.putTex), 0);
    const mix: ThetaShelf["mix"] = callShare > putShare * 1.5 ? "call_heavy" : putShare > callShare * 1.5 ? "put_heavy" : "balanced";
    const burn30m = windowRows.reduce((s, r) => s + (burnByStrike30m.get(r.strike) ?? 0), 0);
    shelves.push({ low: windowRows[0].strike, high: windowRows[windowRows.length - 1].strike, center: sorted[i].strike, sharePct, mix, burn30m });
  }

  const sortedByShare = shelves.sort((a, b) => b.sharePct - a.sharePct);
  const kept: ThetaShelf[] = [];
  for (const shelf of sortedByShare) {
    if (kept.some((k) => Math.abs(k.center - shelf.center) < shelf.high - shelf.low)) continue;
    kept.push(shelf);
  }
  return kept.slice(0, 6);
}

export interface ThetaConfluence {
  nextExpiry: { expiration: string } | null;
  classification: "reinforcing" | "zero_dte_only" | "weekly_only" | "mixed_call_put";
  alignmentPct: number;
}

/** Real cross-expiry overlap, using OUR OWN 0DTE per-strike theta against the source's /theta grid column for whichever other expiry currently carries the most gross theta (the only available cross-expiry theta source - we don't have a full chain to reprice other expiries ourselves). */
function computeThetaConfluence(perStrike: { strike: number; tex: number }[], heatmap: ThetaHeatmap | null): ThetaConfluence {
  if (!heatmap || heatmap.expirations.length < 2) return { nextExpiry: null, classification: "zero_dte_only", alignmentPct: 0 };

  const zeroDteExp = heatmap.expirations[0];
  const otherExps = heatmap.expirations.slice(1);
  const grossByExp = new Map<string, number>();
  for (const cell of heatmap.cells) {
    if (cell.expiration === zeroDteExp) continue;
    grossByExp.set(cell.expiration, (grossByExp.get(cell.expiration) ?? 0) + Math.abs(cell.netTheta));
  }
  const nextExpiry = otherExps.sort((a, b) => (grossByExp.get(b) ?? 0) - (grossByExp.get(a) ?? 0))[0];
  if (!nextExpiry) return { nextExpiry: null, classification: "zero_dte_only", alignmentPct: 0 };

  const totalOwn = perStrike.reduce((s, r) => s + Math.abs(r.tex), 0) || 1;
  const nextCells = heatmap.cells.filter((c) => c.expiration === nextExpiry);
  const totalNext = nextCells.reduce((s, c) => s + Math.abs(c.netTheta), 0) || 1;

  let overlap = 0;
  for (const row of perStrike) {
    const p0 = Math.abs(row.tex) / totalOwn;
    const cell = nextCells.find((c) => c.strike === row.strike);
    const pT = cell ? Math.abs(cell.netTheta) / totalNext : 0;
    overlap += Math.sqrt(p0 * pT);
  }
  const alignmentPct = Math.min(100, overlap * 100);

  const zeroDteGross = perStrike.reduce((s, r) => s + Math.abs(r.tex), 0);
  const nextGross = totalNext;
  let classification: ThetaConfluence["classification"];
  if (alignmentPct > 35) classification = "reinforcing";
  else if (zeroDteGross > nextGross * 3) classification = "zero_dte_only";
  else if (nextGross > zeroDteGross * 3) classification = "weekly_only";
  else classification = "mixed_call_put";

  return { nextExpiry: { expiration: nextExpiry }, classification, alignmentPct };
}

// ---------------------------------------------------------------------------
// Pillar 3: Key risks
// ---------------------------------------------------------------------------

export interface CarryWipeoutScenario {
  label: string;
  price: number;
  positionPnl: number;
  carryRiskRatio: number | null;
  riskLevel: "low" | "moderate" | "high" | "extreme";
}

function classifyCarryRisk(ratio: number | null): CarryWipeoutScenario["riskLevel"] {
  if (ratio === null) return "low";
  if (ratio > 3) return "extreme";
  if (ratio > 1.5) return "high";
  if (ratio > 0.75) return "moderate";
  return "low";
}

function computeCarryWipeoutScenarios(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, thetaCarry30m: number, emLow: number, emHigh: number, horizonMinutes = 30): CarryWipeoutScenario[] {
  const hYears = horizonMinutes / 60 / 24 / 365;
  const Tfuture = Math.max(1e-8, T - hYears);
  const active = chain.filter((row) => row.oi > 0 && row.iv > 0);

  const bookValueAt = (S: number, Tx: number) => active.reduce((sum, row) => sum + row.oi * bsPrice({ spot: S, strike: row.strike, T: Tx, vol: row.iv, r, q, isCall: row.side === "call" }), 0);
  const valueNow = bookValueAt(spot, T);

  const scenarios: { label: string; price: number }[] = [
    { label: "+0.10%", price: spot * 1.001 },
    { label: "-0.10%", price: spot * 0.999 },
    { label: "+0.25%", price: spot * 1.0025 },
    { label: "-0.25%", price: spot * 0.9975 },
    { label: "+0.50%", price: spot * 1.005 },
    { label: "-0.50%", price: spot * 0.995 },
    { label: "EM upper bound", price: emHigh },
    { label: "EM lower bound", price: emLow },
  ];

  return scenarios.map((s) => {
    const valueAt = bookValueAt(s.price, Tfuture);
    const positionPnl = valueAt - valueNow;
    const carryRiskRatio = thetaCarry30m > 0 ? Math.abs(Math.min(0, positionPnl)) / thetaCarry30m : null;
    return { label: s.label, price: s.price, positionPnl, carryRiskRatio, riskLevel: classifyCarryRisk(carryRiskRatio) };
  });
}

// ---------------------------------------------------------------------------
// Convexity Deficit: the move needed for gamma P&L to offset theta -
// (1/2)*Gamma*(dS)^2 ~= |Theta|*dt, so dS_escape ~= sqrt(2*|Theta|*dt/Gamma).
// Uses the actual 30-minute reprice burn (already computed elsewhere, not
// an annualized theta) paired with the book's current aggregate dollar
// gamma - the stated approximation the spec calls out (full repricing, the
// escape bands above, is the production-grade version of the same idea).
// ---------------------------------------------------------------------------

export interface ConvexityDeficit {
  thetaCarry30m: number;
  moveRequiredPoints: number | null;
  moveRequiredPct: number | null;
}

function computeConvexityDeficit(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, burn30mDollar: number): ConvexityDeficit {
  let gammaDollarPerPt2 = 0;
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const g = bsGreeks({ spot, strike: row.strike, T, vol: row.iv, r, q, isCall: row.side === "call" });
    gammaDollarPerPt2 += g.gamma * row.oi * MULTIPLIER;
  }
  if (gammaDollarPerPt2 <= 0) return { thetaCarry30m: burn30mDollar, moveRequiredPoints: null, moveRequiredPct: null };
  const moveRequiredPoints = Math.sqrt((2 * Math.abs(burn30mDollar)) / gammaDollarPerPt2);
  return { thetaCarry30m: burn30mDollar, moveRequiredPoints, moveRequiredPct: (moveRequiredPoints / spot) * 100 };
}

// ---------------------------------------------------------------------------
// Theta Decision Ladder: horizon -> compression zone -> premium burned ->
// movement required, one table instead of reading the escape bands and
// burn fraction separately.
// ---------------------------------------------------------------------------

export interface ThetaDecisionLadderRow {
  horizonMinutes: number;
  compressionLow: number | null;
  compressionHigh: number | null;
  burnFractionPct: number;
  movementRequiredPct: number | null;
}

function computeThetaDecisionLadder(escapeBands: EscapeBand[], regime: ThetaRegime, spot: number): ThetaDecisionLadderRow[] {
  const burnByHorizon: Record<number, number> = { 15: regime.burn15m, 30: regime.burn30m, 60: regime.burn60m };
  return escapeBands.map((b) => {
    const burn = burnByHorizon[b.horizonMinutes] ?? 0;
    const burnFractionPct = regime.grossExtrinsicValue > 0 ? (burn / regime.grossExtrinsicValue) * 100 : 0;
    const avgDistance = b.down !== null && b.up !== null ? ((spot - b.down) + (b.up - spot)) / 2 : null;
    return {
      horizonMinutes: b.horizonMinutes,
      compressionLow: b.down,
      compressionHigh: b.up,
      burnFractionPct,
      movementRequiredPct: avgDistance !== null ? (avgDistance / spot) * 100 : null,
    };
  });
}

export interface IvStabilityResult {
  ivShiftPoints: number;
  decayStillDominant: boolean;
  burn30m: number;
}

function computeIvStability(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, decayDominanceBase: boolean): { scenarios: IvStabilityResult[]; robustnessPct: number } {
  const shifts = [-0.02, -0.01, 0, 0.01, 0.02];
  const scenarios = shifts.map((ivShift) => {
    const shiftedChain = chain.map((row) => ({ ...row, iv: Math.max(1e-4, row.iv + ivShift) }));
    const burn30m = grossBurn(shiftedChain, spot, T, r, q, Math.min(30 / 60 / 24 / 365, T));
    const extrinsic = extrinsicValueAt(shiftedChain, spot, T, r, q);
    // Same 0.15 dominance threshold as the baseline flag (regime.burnFraction30m > 0.15) -
    // a mismatched threshold made even the zero-shift scenario "disagree" with the baseline
    // whenever the true burn fraction sat between the two, reading as 0% robustness.
    const decayStillDominant = extrinsic > 0 ? burn30m / extrinsic > 0.15 === decayDominanceBase : decayDominanceBase;
    return { ivShiftPoints: ivShift * 100, decayStillDominant, burn30m };
  });
  const robustnessPct = (scenarios.filter((s) => s.decayStillDominant).length / scenarios.length) * 100;
  return { scenarios, robustnessPct };
}

export interface ThetaMirageRisk {
  gross: number;
  net: number;
  cancellationPct: number;
}

function computeThetaMirage(carryLadder: { carry: number }[]): ThetaMirageRisk {
  const gross = carryLadder.reduce((s, r) => s + Math.abs(r.carry), 0);
  const net = carryLadder.reduce((s, r) => s + r.carry, 0);
  return { gross, net, cancellationPct: gross > 0 ? (1 - Math.abs(net) / gross) * 100 : 0 };
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

export interface ThetaBalanceSheet {
  callTex: number;
  putTex: number;
  grossTex: number;
  netTex: number;
  burn15m: number;
  burn30m: number;
  burn60m: number;
  burnUntilExpiry: number;
  dealerCarryNow: number;
  longHolderBurdenNow: number;
}

export interface ConcentrationStats {
  hhi: number;
  entropy: number;
  effectiveStrikes: number;
}

function computeConcentration(perStrike: { strike: number; tex: number }[]): ConcentrationStats {
  const totalAbs = perStrike.reduce((s, r) => s + Math.abs(r.tex), 0) || 1;
  const shares = perStrike.map((r) => Math.abs(r.tex) / totalAbs).filter((p) => p > 0);
  const hhi = shares.reduce((s, p) => s + p * p, 0);
  const entropy = -shares.reduce((s, p) => s + p * Math.log(p), 0);
  return { hhi, entropy, effectiveStrikes: Math.exp(entropy) };
}

export type MoneynessBucket = "deep_itm" | "itm" | "near_atm" | "otm" | "deep_otm";
export interface MoneynessRow {
  bucket: MoneynessBucket;
  label: string;
  burn30m: number;
}
const BUCKET_LABEL: Record<MoneynessBucket, string> = { deep_itm: "Deep ITM", itm: "ITM", near_atm: "Near ATM", otm: "OTM", deep_otm: "Deep OTM" };

function bucketOf(absDelta: number): MoneynessBucket {
  if (absDelta > 0.85) return "deep_itm";
  if (absDelta > 0.6) return "itm";
  if (absDelta > 0.4) return "near_atm";
  if (absDelta > 0.15) return "otm";
  return "deep_otm";
}

function computeMoneynessStructure(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): MoneynessRow[] {
  const totals = new Map<MoneynessBucket, number>();
  const hYears = Math.min(30, T * 60 * 24 * 365) / 60 / 24 / 365;
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const g = bsGreeks({ spot, strike: row.strike, T, vol: row.iv, r, q, isCall: row.side === "call" });
    const burn = burnOverWindow([row], spot, T, r, q, 0, hYears);
    const bucket = bucketOf(Math.abs(g.delta));
    totals.set(bucket, (totals.get(bucket) ?? 0) + burn);
  }
  const order: MoneynessBucket[] = ["deep_itm", "itm", "near_atm", "otm", "deep_otm"];
  return order.map((bucket) => ({ bucket, label: BUCKET_LABEL[bucket], burn30m: totals.get(bucket) ?? 0 }));
}

export interface ForwardClockSnapshot {
  label: string;
  minutesAhead: number;
  burnRatePerMin: number;
  burnCenter: number | null;
  concentrationEffectiveStrikes: number;
  zeroDteSharePct: number | null;
}

function computeForwardClock(chain: ChainStrikeInput[], spot: number, r: number, q: number, totalMinutesToExpiry: number): ForwardClockSnapshot[] {
  const rawTargets = [
    { label: "Now", minutesAhead: 0 },
    { label: "+15 min", minutesAhead: 15 },
    { label: "+30 min", minutesAhead: 30 },
    { label: "+60 min", minutesAhead: 60 },
    { label: "60 min before close", minutesAhead: Math.max(0, totalMinutesToExpiry - 60) },
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
    const ladder = longHolderLadder(chain, spot, T, r, q);
    const window5 = 5 / 60 / 24 / 365;
    const rate = burnOverWindow(chain, spot, T, r, q, 0, Math.min(window5, T)) / 5;
    const center = weightedCenter(ladder.map((row) => ({ strike: row.strike, weight: Math.abs(row.tex) })));
    const totalAbs = ladder.reduce((s, row) => s + Math.abs(row.tex), 0) || 1;
    const shares = ladder.map((row) => Math.abs(row.tex) / totalAbs).filter((p) => p > 0);
    const entropy = -shares.reduce((s, p) => s + p * Math.log(p), 0);
    return { label: t.label, minutesAhead: t.minutesAhead, burnRatePerMin: rate, burnCenter: center, concentrationEffectiveStrikes: Math.exp(entropy), zeroDteSharePct: null };
  });
}

// ---------------------------------------------------------------------------
// Strike x expiry theta heatmap (from the source's own /theta grid - see docstring)
// ---------------------------------------------------------------------------

export interface ThetaHeatmapCell {
  strike: number;
  expiration: string;
  callTheta: number;
  putTheta: number;
  netTheta: number;
}

export interface ThetaHeatmap {
  expirations: string[];
  /** DTE per expiration column (aligned to `expirations`), null where the source omitted it - the topo tenor bucketing needs real DTEs, not labels. */
  expiryDtes: (number | null)[];
  cells: ThetaHeatmapCell[];
  totalTex: number;
  callTex: number;
  putTex: number;
}

export interface ExpiryThetaStackRow {
  expiration: string;
  grossBurn: number;
  sharePct: number;
}

export interface ExpiryThetaStack {
  rows: ExpiryThetaStackRow[];
  /** 0DTE Control_Theta = |TEX_0DTE| / sum_T |TEX_T| - gross share of the source's own per-expiry theta grid. Not the same as "0DTE burn control" (share of next-hour decay specifically), which isn't calculable without a full chain to reprice every other expiry ourselves - stated omission, not a hidden one. */
  zeroDteControlPct: number;
}

/** Real 0DTE theta control, using the source's own /theta grid across every expiry it returns (the only place cross-expiry theta totals exist - we only reprice the 0DTE chain ourselves). */
function computeExpiryThetaStack(heatmap: ThetaHeatmap | null): ExpiryThetaStack | null {
  if (!heatmap || !heatmap.expirations.length) return null;
  const grossByExp = new Map<string, number>();
  for (const cell of heatmap.cells) {
    grossByExp.set(cell.expiration, (grossByExp.get(cell.expiration) ?? 0) + Math.abs(cell.netTheta));
  }
  const total = [...grossByExp.values()].reduce((s, v) => s + v, 0) || 1;
  const rows: ExpiryThetaStackRow[] = heatmap.expirations.map((exp) => {
    const grossBurn = grossByExp.get(exp) ?? 0;
    return { expiration: exp, grossBurn, sharePct: (grossBurn / total) * 100 };
  });
  return { rows, zeroDteControlPct: rows[0]?.sharePct ?? 0 };
}

// ---------------------------------------------------------------------------
// Signature visualizations
// ---------------------------------------------------------------------------

export interface BurnSurfacePoint {
  price: number;
  minutesAhead: number;
  grossBurn: number;
}

function computeBurnSurface(chain: ChainStrikeInput[], spot: number, r: number, q: number, T: number, totalMinutesToExpiry: number, priceRangePct: number, priceSteps: number, timeSteps: number): { grid: BurnSurfacePoint[]; priceValues: number[]; minutesValues: number[] } {
  const priceValues: number[] = [];
  for (let i = 0; i <= priceSteps; i++) priceValues.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / priceSteps));

  const minutesValues: number[] = [];
  for (let i = 1; i <= timeSteps; i++) minutesValues.push((totalMinutesToExpiry * i) / timeSteps);

  const grid: BurnSurfacePoint[] = [];
  for (const minutesAhead of minutesValues) {
    const hYears = Math.min(minutesAhead, totalMinutesToExpiry) / 60 / 24 / 365;
    for (const price of priceValues) {
      grid.push({ price, minutesAhead, grossBurn: burnOverWindow(chain, price, T, r, q, 0, Math.min(hYears, T)) });
    }
  }
  return { grid, priceValues, minutesValues };
}

export interface SurvivalPoint {
  price: number;
  minutesAhead: number;
  pnl: number;
}

function computeSurvivalMap(chain: ChainStrikeInput[], spot: number, r: number, q: number, T: number, totalMinutesToExpiry: number, priceRangePct: number, priceSteps: number, timeSteps: number): { grid: SurvivalPoint[]; priceValues: number[]; minutesValues: number[] } {
  const active = chain.filter((row) => row.oi > 0 && row.iv > 0);
  const bookValueAt = (S: number, Tx: number) => active.reduce((sum, row) => sum + row.oi * bsPrice({ spot: S, strike: row.strike, T: Tx, vol: row.iv, r, q, isCall: row.side === "call" }), 0);
  const valueNow = bookValueAt(spot, T);

  const priceValues: number[] = [];
  for (let i = 0; i <= priceSteps; i++) priceValues.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / priceSteps));

  const minutesValues: number[] = [];
  for (let i = 1; i <= timeSteps; i++) minutesValues.push((totalMinutesToExpiry * i) / timeSteps);

  const grid: SurvivalPoint[] = [];
  for (const minutesAhead of minutesValues) {
    const hYears = Math.min(minutesAhead, totalMinutesToExpiry) / 60 / 24 / 365;
    const Tfuture = Math.max(1e-8, T - hYears);
    for (const price of priceValues) {
      grid.push({ price, minutesAhead, pnl: bookValueAt(price, Tfuture) - valueNow });
    }
  }
  return { grid, priceValues, minutesValues };
}

// ---------------------------------------------------------------------------
// Hero statement
// ---------------------------------------------------------------------------

function buildHeroStatement(symbol: string, phase: PhaseClassification, regime: ThetaRegime, band30m: EscapeBand, carryWipeout: CarryWipeoutScenario[]): string {
  const parts: string[] = [];
  parts.push(`${symbol} is in ${phase.phase === "accelerating_burn" ? "an accelerating" : phase.phase === "decay_trap" ? "a" : "a"} ${phase.label.toLowerCase()} regime.`);
  parts.push(`Approximately ${(regime.burnFraction30m * 100).toFixed(0)}% of remaining 0DTE extrinsic premium is projected to disappear over the next 30 minutes if spot and IV remain unchanged.`);

  if (band30m.down !== null && band30m.up !== null) {
    parts.push(`The 30-minute decay compression zone is ${band30m.down.toFixed(1)}–${band30m.up.toFixed(1)}. Movement below or above that range is required for the current basket to overcome decay.`);
  }

  const worstScenario = [...carryWipeout].sort((a, b) => (b.carryRiskRatio ?? 0) - (a.carryRiskRatio ?? 0))[0];
  if (worstScenario && worstScenario.carryRiskRatio !== null && worstScenario.carryRiskRatio > 1) {
    parts.push(`Carry risk becomes asymmetric near ${worstScenario.price.toFixed(1)}.`);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Diagnostics + assembly
// ---------------------------------------------------------------------------

export interface ThetaEngineDiagnostics {
  pricingModel: string;
  exactExpirationLabel: string;
  thetaUnit: string;
  staticIvAssumption: string;
  ivScenarioRangePoints: number;
  validContracts: number;
  dealerSignAssumption: string;
  oiFreshnessLabel: OiFreshnessRisk["level"];
  assignmentSettlementNote: string;
  lastCalculatedAt: number;
}

export interface ThetaEngineResult {
  heroStatement: string;
  phase: PhaseClassification;
  regime: ThetaRegime;
  consensusScenarios: ThetaConsensusScenario[];
  thetaHeatmap: ThetaHeatmap | null;
  burnSurface: { grid: BurnSurfacePoint[]; priceValues: number[]; minutesValues: number[] };
  survivalMap: { grid: SurvivalPoint[]; priceValues: number[]; minutesValues: number[] };
  decayCenters: DecayCenters;
  burnBasin: { density: { price: number; density: number }[]; basin: BurnBasin | null };
  escapeBands: EscapeBand[];
  escapeAsymmetry30m: EscapeAsymmetry;
  decisionLadder: ThetaDecisionLadderRow[];
  thetaShelves: ThetaShelf[];
  confluence: ThetaConfluence;
  carryWipeoutScenarios: CarryWipeoutScenario[];
  convexityDeficit: ConvexityDeficit;
  ivStability: { scenarios: IvStabilityResult[]; robustnessPct: number };
  thetaMirage: ThetaMirageRisk;
  oiFreshness: OiFreshnessRisk;
  balanceSheet: ThetaBalanceSheet;
  concentration: ConcentrationStats;
  expiryStack: ExpiryThetaStack | null;
  zeroDteControlPct: number | null;
  moneyness: MoneynessRow[];
  forwardClock: ForwardClockSnapshot[];
  diagnostics: ThetaEngineDiagnostics;
}

export function computeThetaEngine(params: {
  symbol: string;
  chain: ChainStrikeInput[];
  perStrike: StrikeRow0DTE[];
  spot: number;
  r: number;
  q: number;
  dteHours: number;
  expectedMove1s: number | null;
  crossExpiry: CrossExpiryRow[];
  thetaHeatmap: ThetaHeatmap | null;
  flowImbalance: number | null;
  validContracts: number;
}): ThetaEngineResult {
  const { symbol, chain, perStrike, spot, r, q, dteHours, expectedMove1s, crossExpiry, thetaHeatmap, flowImbalance, validContracts } = params;

  const T = Math.max(dteHours, 0.05) / 24 / 365;
  const totalMinutesToExpiry = Math.max(dteHours * 60, 3);
  const lambda = expectedMove1s && expectedMove1s > 0 ? expectedMove1s : spot * 0.01;
  const emLow = spot - lambda;
  const emHigh = spot + lambda;

  const band30mForDominance = computeEscapeBand(chain, spot, T, r, q, 30, totalMinutesToExpiry, "atm_straddle");
  const escapeMove30m = band30mForDominance.up !== null ? band30mForDominance.up - spot : null;
  const impliedMove30m = lambda * Math.sqrt(Math.min(30, totalMinutesToExpiry) / totalMinutesToExpiry);

  const regime = computeThetaRegimeMetrics(chain, spot, T, r, q, totalMinutesToExpiry, impliedMove30m, escapeMove30m);

  const escapeBands = [15, 30, 60].filter((m) => m <= totalMinutesToExpiry || m === 15).map((m) => computeEscapeBand(chain, spot, T, r, q, m, totalMinutesToExpiry, "atm_straddle"));
  const band30m = escapeBands.find((b) => b.horizonMinutes === 30) ?? band30mForDominance;
  const escapeAsymmetry30m = computeEscapeAsymmetry(band30m, spot);
  const spotInsideCompressionZone = band30m.down !== null && band30m.up !== null && spot > band30m.down && spot < band30m.up;

  const phase = classifyPhase(regime, spotInsideCompressionZone);

  const callPutLadder = (() => {
    const byStrike = new Map<number, { callTex: number; putTex: number }>();
    for (const row of chain) {
      if (row.oi <= 0 || row.iv <= 0) continue;
      const g = bsGreeks({ spot, strike: row.strike, T, vol: row.iv, r, q, isCall: row.side === "call" });
      const contribution = dollarTheta(g.theta, row.oi);
      const entry = byStrike.get(row.strike) ?? { callTex: 0, putTex: 0 };
      if (row.side === "call") entry.callTex += contribution;
      else entry.putTex += contribution;
      byStrike.set(row.strike, entry);
    }
    return [...byStrike.entries()].map(([strike, v]) => ({ strike, tex: v.callTex + v.putTex, ...v })).sort((a, b) => a.strike - b.strike);
  })();

  const decayCenters = computeDecayCenters(callPutLadder);

  const priceRangePct = 0.04;
  const priceValues: number[] = [];
  for (let i = 0; i <= 60; i++) priceValues.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / 60));
  const bandwidth = Math.max(lambda * 0.4, spot * 0.0025);
  const burnBasin = computeBurnBasin(callPutLadder, priceValues, bandwidth);

  const burnByStrike30m = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const burn = burnOverWindow([row], spot, T, r, q, 0, Math.min(30 / 60 / 24 / 365, T));
    burnByStrike30m.set(row.strike, (burnByStrike30m.get(row.strike) ?? 0) + burn);
  }
  const thetaShelves = computeThetaShelves(callPutLadder, burnByStrike30m);

  const confluence = computeThetaConfluence(callPutLadder, thetaHeatmap);

  const signs = dealerSignScenarios(flowImbalance);
  const consensusScenarios: ThetaConsensusScenario[] = signs.map((s) => ({
    name: s.name,
    label: s.label,
    carryNow: ladderSum(dealerCarryLadder(chain, spot, T, r, q, s.callWeight, s.putWeight), "carry"),
  }));

  const dealerCarryConventional = dealerCarryLadder(chain, spot, T, r, q, 1, 1);
  const dealerCarryNow = ladderSum(dealerCarryConventional, "carry");
  const longHolderBurdenNow = ladderSum(longHolderLadder(chain, spot, T, r, q), "tex");

  // The wipeout ratio's P&L leg is a 30-MINUTE reprice, so its carry
  // denominator must be the 30-minute burn, not the per-calendar-day carry -
  // dividing a 30-min P&L by a full day's carry understated the ratio ~48x
  // and left classifyCarryRisk's thresholds effectively unreachable.
  const thetaCarry30m = regime.burn30m;
  const carryWipeoutScenarios = computeCarryWipeoutScenarios(chain, spot, T, r, q, Math.abs(thetaCarry30m) || 1, emLow, emHigh);

  const ivStability = computeIvStability(chain, spot, T, r, q, regime.burnFraction30m > 0.15);
  const thetaMirage = computeThetaMirage(dealerCarryConventional);

  const zeroDteRow = crossExpiry.find((row) => row.dte === 0);
  const zeroDteVolume = zeroDteRow?.totalVol ?? 0;
  const zeroDteOi = perStrike.reduce((s, row) => s + row.callOi + row.putOi, 0);
  const oiFreshness = computeOiFreshness(zeroDteVolume, zeroDteOi);

  const callTex = callPutLadder.reduce((s, r2) => s + r2.callTex, 0);
  const putTex = callPutLadder.reduce((s, r2) => s + r2.putTex, 0);
  const netTex = callTex + putTex;
  const grossTex = callPutLadder.reduce((s, r2) => s + Math.abs(r2.callTex) + Math.abs(r2.putTex), 0);

  const balanceSheet: ThetaBalanceSheet = {
    callTex,
    putTex,
    grossTex,
    netTex,
    burn15m: regime.burn15m,
    burn30m: regime.burn30m,
    burn60m: regime.burn60m,
    burnUntilExpiry: regime.burnUntilExpiry,
    dealerCarryNow,
    longHolderBurdenNow,
  };

  const concentration = computeConcentration(callPutLadder);
  const moneyness = computeMoneynessStructure(chain, spot, T, r, q);
  const forwardClock = computeForwardClock(chain, spot, r, q, totalMinutesToExpiry);

  const expiryStack = computeExpiryThetaStack(thetaHeatmap);
  const zeroDteControlPct = expiryStack?.zeroDteControlPct ?? null;
  const decisionLadder = computeThetaDecisionLadder(escapeBands, regime, spot);
  const convexityDeficit = computeConvexityDeficit(chain, spot, T, r, q, regime.burn30m);

  const burnSurface = computeBurnSurface(chain, spot, r, q, T, totalMinutesToExpiry, priceRangePct, 20, 6);
  const survivalMap = computeSurvivalMap(chain, spot, r, q, T, totalMinutesToExpiry, priceRangePct, 20, 6);

  const heroStatement = buildHeroStatement(symbol, phase, regime, band30m, carryWipeoutScenarios);

  const diagnostics: ThetaEngineDiagnostics = {
    pricingModel: "Black-Scholes finite-horizon reprice (V(tau) - V(tau-h)) on SVI-smoothed 0DTE smile, not linear per-day theta extrapolation",
    exactExpirationLabel: `${dteHours.toFixed(3)} hours (${totalMinutesToExpiry.toFixed(0)} minutes) remaining`,
    thetaUnit: "Dollar burn per stated horizon (5/15/30/60 min or until expiry) - not annualized or generic per-day",
    staticIvAssumption: "Spot and IV held fixed for burn/escape-band calcs; IV Stability risk (Key Risks tab) tests ±1/±2 vol-point sensitivity",
    ivScenarioRangePoints: 2,
    validContracts,
    dealerSignAssumption: "6 scenarios modeled (see Theta Regime tab) - conventional customer-long/dealer-short is not asserted as known fact",
    oiFreshnessLabel: oiFreshness.level,
    assignmentSettlementNote: "SPY/QQQ options are American-style and physically settled - deep-ITM positions near expiration carry assignment/share-delivery consequences not modeled here.",
    lastCalculatedAt: Date.now(),
  };

  return {
    heroStatement,
    phase,
    regime,
    consensusScenarios,
    thetaHeatmap,
    burnSurface,
    survivalMap,
    decayCenters,
    burnBasin,
    escapeBands,
    escapeAsymmetry30m,
    decisionLadder,
    thetaShelves,
    confluence,
    carryWipeoutScenarios,
    convexityDeficit,
    ivStability,
    thetaMirage,
    oiFreshness,
    balanceSheet,
    concentration,
    expiryStack,
    zeroDteControlPct,
    moneyness,
    forwardClock,
    diagnostics,
  };
}

/** Parses the source's own /theta grid response into a simple heatmap structure - used only for the strike x expiry structural chart, since this app has no per-strike chain for other expiries to build its own numbers from. */
export function parseThetaHeatmap(raw: {
  total_tex?: number;
  call_tex?: number;
  put_tex?: number;
  expiries?: { label: string; dte?: number }[];
  rows?: { strike: number; call_cells: number[]; put_cells: number[] }[];
}): ThetaHeatmap | null {
  if (!raw.expiries?.length || !raw.rows?.length) return null;
  const expirations = raw.expiries.map((e) => e.label);
  const expiryDtes = raw.expiries.map((e) => (typeof e.dte === "number" ? e.dte : null));
  const cells: ThetaHeatmapCell[] = [];
  for (const row of raw.rows) {
    expirations.forEach((exp, i) => {
      const callTheta = row.call_cells?.[i] ?? 0;
      const putTheta = row.put_cells?.[i] ?? 0;
      cells.push({ strike: row.strike, expiration: exp, callTheta, putTheta, netTheta: callTheta + putTheta });
    });
  }
  return { expirations, expiryDtes, cells, totalTex: raw.total_tex ?? 0, callTex: raw.call_tex ?? 0, putTex: raw.put_tex ?? 0 };
}
