/**
 * Delta Decision Engine - the DEX page's primary content.
 *
 * Different central question from the GEX page: GEX asks how hedge
 * sensitivity changes as price moves; this asks what underlying-equivalent
 * hedge inventory is implied by the option book RIGHT NOW, and how that
 * inventory would rotate under defined price/time scenarios. Same
 * architecture as gammaEngine.ts (consensus -> typed levels -> risks ->
 * structure), same "current snapshot + scenario repricing, never history"
 * constraint, same stated-simplification posture - see that module's
 * docstring for the shared caveats (no discrete-dividend CRR, single-slice
 * SVI not full arbitrage-free SSVI, dealer sign fundamentally unobservable
 * from a public chain).
 *
 * DEX is inventory, not flow: current DEX estimates a hedge inventory that
 * may already exist, be partially hedged, or be offset in another
 * instrument or product (see cross-product netting risk below) - nothing
 * here claims dealers must still execute this exact trade.
 */

import { bsDelta } from "@/lib/blackScholes";
import { sviImpliedVol, type SviParams } from "@/lib/svi";
import type { ChainStrikeInput, CrossExpiryRow, StrikeRow0DTE } from "@/lib/gex";
import { quantile, touchProbability, zeroCrossings } from "@/lib/gexAnalytics";

const MULTIPLIER = 100;

// ---------------------------------------------------------------------------
// Delta primitives
// ---------------------------------------------------------------------------

// Closed-form delta from the shared pricer - NOT bump-and-reprice. A fixed
// 0.5%-of-spot central-difference bump is wider than the entire 0->1 delta
// ramp late in a 0DTE session (transition width ~ S*sigma*sqrt(T)), which
// smears every near-the-money strike's delta and puts phantom delta on
// strikes a bump-width OTM - the exact failure mode blackScholes.ts's own
// docstring documents and fixed for gamma.
function bsDeltaAt(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean): number {
  return bsDelta({ spot, strike, T, vol, r, q, isCall });
}

type DexLadder = { strike: number; dex: number }[];

/** Static (frozen-IV) DEX ladder in shares, dealer-sign-weighted. Puts already carry their own negative delta - no sign flip needed the way GEX needs one, only a participation/weight multiplier per side (the "q_i" dealer-position-sign scenarios). */
function dexLadderAt(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, callWeight: number, putWeight: number): DexLadder {
  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const delta = bsDeltaAt(spot, row.strike, T, row.iv, r, q, row.side === "call");
    const shares = delta * row.oi * MULTIPLIER;
    const weighted = row.side === "call" ? shares * callWeight : shares * putWeight;
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + weighted);
  }
  return [...byStrike.entries()].map(([strike, dex]) => ({ strike, dex })).sort((a, b) => a.strike - b.strike);
}

/** Surface-consistent (sticky-moneyness) DEX ladder - each strike's IV recomputed from the fitted smile at its moneyness relative to the hypothetical price, instead of frozen at today's quote. More appropriate for scenario/forward charts. */
function surfaceDexLadderAt(
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
): DexLadder {
  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const vol = sviImpliedVol(sviParams, row.strike * (actualSpot / evalPrice), forward, T);
    const delta = bsDeltaAt(evalPrice, row.strike, T, vol, r, q, row.side === "call");
    const shares = delta * row.oi * MULTIPLIER;
    const weighted = row.side === "call" ? shares * callWeight : shares * putWeight;
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + weighted);
  }
  return [...byStrike.entries()].map(([strike, dex]) => ({ strike, dex })).sort((a, b) => a.strike - b.strike);
}

function ladderSum(ladder: DexLadder): number {
  return ladder.reduce((s, r) => s + r.dex, 0);
}

function netDexAt(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): number {
  return ladderSum(dexLadderAt(chain, spot, T, r, q, 1, 1));
}

// ---------------------------------------------------------------------------
// Dealer-sign scenarios (mirrors gammaEngine.ts's 6-scenario framework)
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
    { name: "gex_constrained", label: "Constrained by full-book GEX sign", callWeight: 1 + gexBias, putWeight: 1 - gexBias },
  ];
}

// ---------------------------------------------------------------------------
// Delta Consensus (static + surface models x 6 dealer-sign scenarios)
// ---------------------------------------------------------------------------

export interface ModelDexResult {
  name: string;
  label: string;
  netDex: number;
}

export interface DealerSignDexResult {
  name: string;
  label: string;
  netDex: number;
}

export interface DeltaConsensus {
  models: ModelDexResult[];
  dealerSignScenarios: DealerSignDexResult[];
  consensusDex: number;
  dispersion: number;
  signAgreementPct: number;
}

function computeDeltaConsensus(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  sviParams: SviParams,
  forward: number,
  flowImbalance: number | null,
  netGexSign: number
): DeltaConsensus {
  const signs = dealerSignScenarios(flowImbalance, netGexSign);

  const all: number[] = [];
  for (const s of signs) {
    all.push(ladderSum(dexLadderAt(chain, spot, T, r, q, s.callWeight, s.putWeight)));
    all.push(ladderSum(surfaceDexLadderAt(chain, spot, spot, T, r, q, sviParams, forward, s.callWeight, s.putWeight)));
  }

  const models: ModelDexResult[] = [
    { name: "static", label: "Static delta (frozen IV)", netDex: ladderSum(dexLadderAt(chain, spot, T, r, q, 1, 1)) },
    { name: "surface", label: "Surface-consistent (sticky-moneyness)", netDex: ladderSum(surfaceDexLadderAt(chain, spot, spot, T, r, q, sviParams, forward, 1, 1)) },
  ];

  const dealerSignResults: DealerSignDexResult[] = signs.map((s) => ({
    name: s.name,
    label: s.label,
    netDex: ladderSum(dexLadderAt(chain, spot, T, r, q, s.callWeight, s.putWeight)),
  }));

  const sorted = [...all].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const consensusDex = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const dispersion = quantile(all, 0.75) - quantile(all, 0.25);

  const positiveCount = dealerSignResults.filter((d) => d.netDex > 0).length;
  const negativeCount = dealerSignResults.filter((d) => d.netDex < 0).length;
  const signAgreementPct = (Math.max(positiveCount, negativeCount) / dealerSignResults.length) * 100;

  return { models, dealerSignScenarios: dealerSignResults, consensusDex, dispersion, signAgreementPct };
}

// ---------------------------------------------------------------------------
// Pillar 1: Delta Inventory phase
// ---------------------------------------------------------------------------

export type DeltaPhase = "hedge_long" | "hedge_short" | "balanced" | "fragile_neutral" | "crowded_hedge_long" | "crowded_hedge_short";

const PHASE_INFO: Record<DeltaPhase, { label: string; interpretation: string }> = {
  hedge_long: { label: "Hedge-long inventory", interpretation: "Estimated option delta requires dealers to hold long underlying hedges." },
  hedge_short: { label: "Hedge-short inventory", interpretation: "Estimated option delta requires dealers to hold short underlying hedges." },
  balanced: { label: "Balanced inventory", interpretation: "Net DEX is small and gross DEX is also modest." },
  fragile_neutral: { label: "Fragile neutral", interpretation: "Net DEX is small, but large opposing call and put DEX cancel." },
  crowded_hedge_long: { label: "Crowded hedge-long", interpretation: "Estimated long hedge inventory is large relative to liquidity." },
  crowded_hedge_short: { label: "Crowded hedge-short", interpretation: "Estimated short hedge inventory is large relative to liquidity." },
};

export interface PhaseClassification {
  phase: DeltaPhase;
  label: string;
  interpretation: string;
  deltaBalanceRatio: number;
  cancellationRatio: number;
  hedgeInventoryBurden30m: number | null;
  signAgreementPct: number;
}

function classifyPhase(netDex: number, grossDex: number, hib30m: number | null, signAgreementPct: number): PhaseClassification {
  const deltaBalanceRatio = netDex / (grossDex + 1e-9);
  const cancellationRatio = 1 - Math.abs(netDex) / (grossDex + 1e-9);
  const crowded = hib30m !== null && hib30m > 0.3;
  const balanced = Math.abs(deltaBalanceRatio) < 0.15 && grossDex < 3_000_000;

  let phase: DeltaPhase;
  if (balanced) phase = "balanced";
  else if (cancellationRatio > 0.75 && Math.abs(deltaBalanceRatio) < 0.25) phase = "fragile_neutral";
  else if (netDex > 0) phase = crowded ? "crowded_hedge_long" : "hedge_long";
  else phase = crowded ? "crowded_hedge_short" : "hedge_short";

  const info = PHASE_INFO[phase];
  return { phase, label: info.label, interpretation: info.interpretation, deltaBalanceRatio, cancellationRatio, hedgeInventoryBurden30m: hib30m, signAgreementPct };
}

// ---------------------------------------------------------------------------
// Pillar 2: Key levels - Inventory Pivot, Delta Shelf, Rehedge Trigger
// ---------------------------------------------------------------------------

export interface DeltaNeutralBand {
  center: number | null;
  low: number | null;
  high: number | null;
  signAgreementPct: number;
}

function computeDeltaNeutralBand(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, flowImbalance: number | null, netGexSign: number): DeltaNeutralBand {
  const signs = dealerSignScenarios(flowImbalance, netGexSign);
  const flips: number[] = [];
  const signsAtSpot: number[] = [];

  for (const s of signs) {
    const ladder = dexLadderAt(chain, spot, T, r, q, s.callWeight, s.putWeight);
    const crossings = zeroCrossings(
      ladder.map((row) => ({ strike: row.strike, gex: row.dex })),
      spot
    );
    if (crossings.length) flips.push(crossings[0]);
    const nearest = [...ladder].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (nearest) signsAtSpot.push(Math.sign(nearest.dex));
  }

  const positiveCount = signsAtSpot.filter((s) => s > 0).length;
  const negativeCount = signsAtSpot.filter((s) => s < 0).length;
  const signAgreementPct = signsAtSpot.length ? (Math.max(positiveCount, negativeCount) / signsAtSpot.length) * 100 : 0;

  return {
    center: flips.length ? flips[0] : null,
    low: flips.length ? Math.min(...flips) : null,
    high: flips.length ? Math.max(...flips) : null,
    signAgreementPct,
  };
}

/** Inventory Pivot: distance-weighted local DEX zero-crossing - the delta-neutral price can be distorted by distant deep-ITM contracts; this discounts them so it's more relevant to today's actual session. */
function computeInventoryPivot(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, lambda: number): number | null {
  const ladder = dexLadderAt(chain, spot, T, r, q, 1, 1);
  const weighted = ladder.map((row) => ({ strike: row.strike, gex: row.dex * Math.exp(-Math.abs(row.strike - spot) / lambda) }));
  const crossings = zeroCrossings(weighted, spot);
  return crossings.length ? crossings[0] : null;
}

export interface DeltaShelf {
  low: number;
  high: number;
  center: number;
  side: "positive" | "negative";
  sharePct: number;
  widthPoints: number;
}

function computeDeltaShelves(perStrike: { strike: number; dex: number }[]): DeltaShelf[] {
  const sorted = [...perStrike].sort((a, b) => a.strike - b.strike);
  const totalAbs = sorted.reduce((s, r) => s + Math.abs(r.dex), 0) || 1;
  const window = 3;

  const shelves: DeltaShelf[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const windowRows = sorted.slice(Math.max(0, i - window), Math.min(sorted.length, i + window + 1));
    const shelfShare = windowRows.reduce((s, r) => s + Math.abs(r.dex), 0) / totalAbs;
    const strikeShare = Math.abs(sorted[i].dex) / totalAbs;
    if (strikeShare < 0.03) continue; // not meaningful enough to anchor a shelf
    shelves.push({
      low: windowRows[0].strike,
      high: windowRows[windowRows.length - 1].strike,
      center: sorted[i].strike,
      side: sorted[i].dex >= 0 ? "positive" : "negative",
      sharePct: shelfShare * 100,
      widthPoints: windowRows[windowRows.length - 1].strike - windowRows[0].strike,
    });
  }

  // Keep the highest-share shelf per local neighborhood (avoid 5 overlapping entries around one real shelf)
  const sortedByShare = shelves.sort((a, b) => b.sharePct - a.sharePct);
  const kept: DeltaShelf[] = [];
  for (const shelf of sortedByShare) {
    if (kept.some((k) => Math.abs(k.center - shelf.center) < shelf.widthPoints)) continue;
    kept.push(shelf);
  }

  return kept.slice(0, 6);
}

export interface RehedgeTrigger {
  price: number;
  direction: "upside" | "downside";
  hedgeChangeShares: number;
  impactRatio: number | null;
}

function computeRehedgeTriggers(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  dex0: number,
  priceGrid: number[],
  recentVolume5m: number | null,
  thresholdPct = 0.25
): RehedgeTrigger[] {
  const triggers: RehedgeTrigger[] = [];
  const up = priceGrid.filter((p) => p > spot).sort((a, b) => a - b);
  const down = priceGrid.filter((p) => p < spot).sort((a, b) => b - a);

  function scan(prices: number[], direction: "upside" | "downside") {
    for (const price of prices) {
      const dexAt = netDexAt(chain, price, T, r, q);
      const hedgeChange = dexAt - dex0;
      const impactRatio = recentVolume5m && recentVolume5m > 0 ? Math.abs(hedgeChange) / recentVolume5m : null;
      if (impactRatio !== null && impactRatio > thresholdPct) {
        triggers.push({ price, direction, hedgeChangeShares: hedgeChange, impactRatio });
        return;
      }
    }
  }

  scan(up, "upside");
  scan(down, "downside");
  return triggers;
}

export interface HedgeRotationZone {
  low: number | null;
  high: number | null;
  belowPosture: "hedge-long" | "hedge-short";
  abovePosture: "hedge-long" | "hedge-short";
}

function computeHedgeRotationZone(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, priceGrid: number[], grossDex: number): HedgeRotationZone {
  const a = grossDex * 0.03; // stated small-band threshold: 3% of gross DEX
  // Dealer hedge tracks the customer book's delta directly (+netDex) under
  // the engine's customer-long/dealer-short convention - the same sign
  // classifyPhase uses, so the rotation-zone postures can never contradict
  // the phase banner (they did when this negated).
  const points = priceGrid
    .map((price) => ({ price, hedge: netDexAt(chain, price, T, r, q) }))
    .sort((x, y) => x.price - y.price);
  const inZone = points.filter((p) => Math.abs(p.hedge) <= a);
  if (!inZone.length) return { low: null, high: null, belowPosture: "hedge-short", abovePosture: "hedge-long" };

  const low = inZone[0].price;
  const high = inZone[inZone.length - 1].price;
  const belowPoint = points.find((p) => p.price < low);
  const abovePoint = [...points].reverse().find((p) => p.price > high);
  return {
    low,
    high,
    belowPosture: (belowPoint?.hedge ?? 0) >= 0 ? "hedge-long" : "hedge-short",
    abovePosture: (abovePoint?.hedge ?? 0) >= 0 ? "hedge-long" : "hedge-short",
  };
}

export interface DeltaConfluence {
  nextExpiry: { expiration: string; dte: number; totalVol: number; totalOi: number } | null;
  classification: "reinforcing" | "cancelling" | "zero_dte_only" | "next_expiry_only" | "unavailable";
  alignmentPct: number;
}

function computeDeltaConfluence(netDex: number, crossExpiry: CrossExpiryRow[]): DeltaConfluence {
  const candidates = crossExpiry.filter((row) => row.dte > 0);
  if (!candidates.length) return { nextExpiry: null, classification: "unavailable", alignmentPct: 0 };

  const nextExpiry = [...candidates].sort((a, b) => Math.abs(b.netDex) - Math.abs(a.netDex))[0];
  const zeroDteRow = crossExpiry.find((row) => row.dte === 0);
  const totalGross = crossExpiry.reduce((s, row) => s + Math.abs(row.netDex), 0) || 1;
  const p0 = zeroDteRow ? Math.abs(zeroDteRow.netDex) / totalGross : 0;
  const pT = Math.abs(nextExpiry.netDex) / totalGross;
  const agree = Math.sign(netDex || 1) === Math.sign(nextExpiry.netDex || 1) ? 1 : -1;
  const alignmentPct = Math.sqrt(Math.max(0, p0 * pT)) * agree * 100;

  let classification: DeltaConfluence["classification"];
  if (Math.abs(alignmentPct) < 15) classification = p0 > pT ? "zero_dte_only" : "next_expiry_only";
  else classification = alignmentPct > 0 ? "reinforcing" : "cancelling";

  return { nextExpiry: { expiration: nextExpiry.expiration, dte: nextExpiry.dte, totalVol: nextExpiry.totalVol, totalOi: nextExpiry.totalOi }, classification, alignmentPct };
}

// ---------------------------------------------------------------------------
// Pillar 3: Key risks
// ---------------------------------------------------------------------------

export interface UnwindScenario {
  label: string;
  price: number;
  hedgeChangeShares: number;
  impactRatio: number | null;
  riskLevel: "low" | "moderate" | "high" | "extreme";
}

function classifyImpact(ratio: number | null): UnwindScenario["riskLevel"] {
  if (ratio === null) return "low";
  if (ratio > 0.6) return "extreme";
  if (ratio > 0.3) return "high";
  if (ratio > 0.1) return "moderate";
  return "low";
}

function computeUnwindScenarios(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  dex0: number,
  nearestShelf: number | null,
  inventoryPivot: number | null,
  emLow: number,
  emHigh: number,
  recentVolume15m: number | null
): UnwindScenario[] {
  const scenarios: { label: string; price: number }[] = [
    { label: "+0.10%", price: spot * 1.001 },
    { label: "-0.10%", price: spot * 0.999 },
    { label: "+0.25%", price: spot * 1.0025 },
    { label: "-0.25%", price: spot * 0.9975 },
    { label: "+0.50%", price: spot * 1.005 },
    { label: "-0.50%", price: spot * 0.995 },
    ...(nearestShelf !== null ? [{ label: "To nearest shelf", price: nearestShelf }] : []),
    ...(inventoryPivot !== null ? [{ label: "To inventory pivot", price: inventoryPivot }] : []),
    { label: "To EM upper bound", price: emHigh },
    { label: "To EM lower bound", price: emLow },
  ];

  return scenarios.map((s) => {
    const dexAt = netDexAt(chain, s.price, T, r, q);
    const hedgeChangeShares = dexAt - dex0;
    const impactRatio = recentVolume15m && recentVolume15m > 0 ? Math.abs(hedgeChangeShares) / recentVolume15m : null;
    return { label: s.label, price: s.price, hedgeChangeShares, impactRatio, riskLevel: classifyImpact(impactRatio) };
  });
}

export interface GapRiskRow {
  gapPct: number;
  direction: "upside" | "downside";
  hedgeChangeShares: number;
  impactRatio: number | null;
}

function computeGapRisk(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, dex0: number, emSigma1: number, recentVolume5m: number | null): GapRiskRow[] {
  const gaps = [0.0025, 0.005, 0.01];
  const rows: GapRiskRow[] = [];
  for (const gapPct of gaps) {
    for (const direction of ["upside", "downside"] as const) {
      const price = direction === "upside" ? spot * (1 + gapPct) : spot * (1 - gapPct);
      const dexAt = netDexAt(chain, price, T, r, q);
      const hedgeChangeShares = dexAt - dex0;
      const impactRatio = recentVolume5m && recentVolume5m > 0 ? Math.abs(hedgeChangeShares) / recentVolume5m : null;
      rows.push({ gapPct: gapPct * 100, direction, hedgeChangeShares, impactRatio });
    }
  }
  const emPrice = { upside: spot + emSigma1, downside: spot - emSigma1 };
  for (const direction of ["upside", "downside"] as const) {
    const dexAt = netDexAt(chain, emPrice[direction], T, r, q);
    const hedgeChangeShares = dexAt - dex0;
    const impactRatio = recentVolume5m && recentVolume5m > 0 ? Math.abs(hedgeChangeShares) / recentVolume5m : null;
    rows.push({ gapPct: (emSigma1 / spot) * 100, direction, hedgeChangeShares, impactRatio });
  }
  return rows;
}

export interface HedgeCrowdingRisk {
  score: number;
  label: "low" | "moderate" | "high" | "extreme";
}

function computeHedgeCrowding(dbr: number, concentrationEffectiveStrikes: number, totalStrikes: number, confluenceAlignmentPct: number, hib5m: number | null): HedgeCrowdingRisk {
  const concentration = 1 - Math.min(1, concentrationEffectiveStrikes / Math.max(3, totalStrikes * 0.3));
  const crossExpiryAlignment = Math.max(0, confluenceAlignmentPct) / 100;
  const liquidityBurden = Math.min(1, hib5m ?? 0);
  const score = Math.abs(dbr) * concentration * crossExpiryAlignment * liquidityBurden * 100;
  const label: HedgeCrowdingRisk["label"] = score > 40 ? "extreme" : score > 20 ? "high" : score > 8 ? "moderate" : "low";
  return { score, label };
}

export interface OiFreshnessRisk {
  refreshRatio: number;
  level: "low" | "moderate" | "high";
}

function computeOiFreshness(zeroDteVolume: number, zeroDteOi: number): OiFreshnessRisk {
  const refreshRatio = zeroDteVolume / (zeroDteOi + 1e-9);
  return { refreshRatio, level: refreshRatio < 0.5 ? "low" : refreshRatio < 1.5 ? "moderate" : "high" };
}

export interface DealerInventoryUncertainty {
  uncertainty: number;
  positiveScenarios: number;
  negativeScenarios: number;
  totalScenarios: number;
}

function computeInventoryUncertainty(dealerSignResults: DealerSignDexResult[]): DealerInventoryUncertainty {
  const positiveScenarios = dealerSignResults.filter((d) => d.netDex > 0).length;
  const negativeScenarios = dealerSignResults.filter((d) => d.netDex < 0).length;
  const total = dealerSignResults.length;
  return { uncertainty: 1 - Math.abs(positiveScenarios - negativeScenarios) / total, positiveScenarios, negativeScenarios, totalScenarios: total };
}

// ---------------------------------------------------------------------------
// Pillar 4: Key structure
// ---------------------------------------------------------------------------

export interface DeltaBalanceSheet {
  callDex: number;
  putDex: number;
  netDex: number;
  grossDex: number;
  theoreticalHedge: number;
  cancellationRatio: number;
}

export interface CumulativeDexPoint {
  strike: number;
  cumulativeCall: number;
  cumulativePut: number;
  cumulativeNet: number;
}

function computeCumulativeLadder(callPutLadder: { strike: number; callDex: number; putDex: number }[]): CumulativeDexPoint[] {
  const sorted = [...callPutLadder].sort((a, b) => a.strike - b.strike);
  let cCall = 0,
    cPut = 0;
  return sorted.map((row) => {
    cCall += row.callDex;
    cPut += row.putDex;
    return { strike: row.strike, cumulativeCall: cCall, cumulativePut: cPut, cumulativeNet: cCall + cPut };
  });
}

export interface RehedgeSurfacePoint {
  price: number;
  minutesToExpiry: number;
  hedgeChangeShares: number;
}

function computeRehedgeSurface(
  chain: ChainStrikeInput[],
  spot: number,
  r: number,
  q: number,
  totalMinutesToExpiry: number,
  dex0: number,
  priceRangePct: number,
  priceSteps: number,
  timeSteps: number
): { grid: RehedgeSurfacePoint[]; priceValues: number[]; minutesValues: number[] } {
  const priceValues: number[] = [];
  for (let i = 0; i <= priceSteps; i++) priceValues.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / priceSteps));

  const minutesValues: number[] = [];
  const floorMinutes = Math.min(3, totalMinutesToExpiry);
  for (let i = 0; i <= timeSteps; i++) minutesValues.push(totalMinutesToExpiry - ((totalMinutesToExpiry - floorMinutes) * i) / timeSteps);

  const grid: RehedgeSurfacePoint[] = [];
  for (const minutesToExpiry of minutesValues) {
    const T = Math.max(floorMinutes, minutesToExpiry) / 60 / 24 / 365;
    for (const price of priceValues) {
      const dexAt = netDexAt(chain, price, T, r, q);
      grid.push({ price, minutesToExpiry, hedgeChangeShares: dexAt - dex0 });
    }
  }
  return { grid, priceValues, minutesValues };
}

export interface ExpiryDexStackRow {
  expiration: string;
  dte: number;
  grossDex: number;
  sharePctNet: number;
  sharePctGross: number;
}

export interface ExpiryDexStack {
  rows: ExpiryDexStackRow[];
  zeroDteControlNetPct: number;
  zeroDteControlGrossPct: number;
}

function computeExpiryDexStack(crossExpiry: CrossExpiryRow[]): ExpiryDexStack {
  const totalGross = crossExpiry.reduce((s, row) => s + Math.abs(row.netDex), 0) || 1;
  const rows = crossExpiry.map((row) => ({
    expiration: row.expiration,
    dte: row.dte,
    grossDex: Math.abs(row.netDex),
    // Signed share against the GROSS total: the signed net sum can sit near
    // zero when call- and put-dominated expiries cancel, which blew this up
    // to +-10^4% and arbitrary signs. Gross keeps it bounded in [-100, 100].
    sharePctNet: (row.netDex / totalGross) * 100,
    sharePctGross: (Math.abs(row.netDex) / totalGross) * 100,
  }));
  const zeroDteRow = rows.find((r) => r.dte === 0);
  return {
    rows,
    zeroDteControlNetPct: zeroDteRow ? Math.abs(zeroDteRow.sharePctNet) : 0,
    zeroDteControlGrossPct: zeroDteRow ? zeroDteRow.sharePctGross : 0,
  };
}

export interface ConcentrationStats {
  hhi: number;
  entropy: number;
  effectiveStrikes: number;
}

function computeConcentration(perStrike: { strike: number; dex: number }[]): ConcentrationStats {
  const totalAbs = perStrike.reduce((s, r) => s + Math.abs(r.dex), 0) || 1;
  const shares = perStrike.map((r) => Math.abs(r.dex) / totalAbs).filter((p) => p > 0);
  const hhi = shares.reduce((s, p) => s + p * p, 0);
  const entropy = -shares.reduce((s, p) => s + p * Math.log(p), 0);
  return { hhi, entropy, effectiveStrikes: Math.exp(entropy) };
}

export interface CenterOfInventory {
  callCenter: number | null;
  putCenter: number | null;
  grossCenter: number | null;
  reachabilityWeightedCenter: number | null;
}

function weightedCenter(rows: { strike: number; weight: number }[]): number | null {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return null;
  return rows.reduce((s, r) => s + r.strike * r.weight, 0) / total;
}

function computeCenterOfInventory(
  callPutLadder: { strike: number; callDex: number; putDex: number }[],
  spot: number,
  atmIv: number,
  hoursAhead: number
): CenterOfInventory {
  const callCenter = weightedCenter(callPutLadder.map((r) => ({ strike: r.strike, weight: Math.abs(r.callDex) })));
  const putCenter = weightedCenter(callPutLadder.map((r) => ({ strike: r.strike, weight: Math.abs(r.putDex) })));
  const grossCenter = weightedCenter(callPutLadder.map((r) => ({ strike: r.strike, weight: Math.abs(r.callDex) + Math.abs(r.putDex) })));

  const reachabilityWeightedCenter = weightedCenter(
    callPutLadder.map((r) => {
      const touch = touchProbability(r.strike, spot, atmIv, hoursAhead);
      return { strike: r.strike, weight: (Math.abs(r.callDex) + Math.abs(r.putDex)) * Math.max(0.02, touch) };
    })
  );

  return { callCenter, putCenter, grossCenter, reachabilityWeightedCenter };
}

export interface AsymmetryStats {
  aboveAbs: number;
  belowAbs: number;
  asymmetry: number;
}

function computeAsymmetry(perStrike: { strike: number; dex: number }[], spot: number): AsymmetryStats {
  const above = perStrike.filter((r) => r.strike > spot).reduce((s, r) => s + Math.abs(r.dex), 0);
  const below = perStrike.filter((r) => r.strike < spot).reduce((s, r) => s + Math.abs(r.dex), 0);
  return { aboveAbs: above, belowAbs: below, asymmetry: (above - below) / (above + below + 1e-9) };
}

export type MoneynessBucket = "deep_itm" | "itm" | "near_atm" | "otm" | "deep_otm";

export interface MoneynessRow {
  bucket: MoneynessBucket;
  label: string;
  dex: number;
}

function bucketOf(absDelta: number): MoneynessBucket {
  if (absDelta > 0.85) return "deep_itm";
  if (absDelta > 0.6) return "itm";
  if (absDelta > 0.4) return "near_atm";
  if (absDelta > 0.15) return "otm";
  return "deep_otm";
}

const BUCKET_LABEL: Record<MoneynessBucket, string> = {
  deep_itm: "Deep ITM",
  itm: "ITM",
  near_atm: "Near ATM",
  otm: "OTM",
  deep_otm: "Deep OTM",
};

function computeMoneynessStructure(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): MoneynessRow[] {
  const totals = new Map<MoneynessBucket, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const delta = bsDeltaAt(spot, row.strike, T, row.iv, r, q, row.side === "call");
    const shares = delta * row.oi * MULTIPLIER;
    const bucket = bucketOf(Math.abs(delta));
    totals.set(bucket, (totals.get(bucket) ?? 0) + shares);
  }
  const order: MoneynessBucket[] = ["deep_itm", "itm", "near_atm", "otm", "deep_otm"];
  return order.map((bucket) => ({ bucket, label: BUCKET_LABEL[bucket], dex: totals.get(bucket) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Hero statement
// ---------------------------------------------------------------------------

function buildHeroStatement(
  symbol: string,
  phase: PhaseClassification,
  netDex: number,
  inventoryPivot: number | null,
  rehedgeTriggers: RehedgeTrigger[],
  confluence: DeltaConfluence,
  oiFreshness: OiFreshnessRisk
): string {
  const parts: string[] = [];
  parts.push(`${symbol} has a ${phase.label.toLowerCase()} inventory posture.`);
  parts.push(`The customer option book carries an estimated ${netDex >= 0 ? "+" : ""}${(netDex / 1_000_000).toFixed(1)} million shares of delta, implying a theoretical ${netDex >= 0 ? "+" : ""}${(netDex / 1_000_000).toFixed(1)} million-share dealer hedge.`);

  if (inventoryPivot !== null) parts.push(`The primary inventory pivot is ${inventoryPivot.toFixed(1)}.`);

  const upTrigger = rehedgeTriggers.find((t) => t.direction === "upside");
  if (upTrigger) {
    parts.push(`A move above ${upTrigger.price.toFixed(1)} creates an estimated ${Math.round(Math.abs(upTrigger.hedgeChangeShares)).toLocaleString()}-share hedge rotation.`);
  }

  if (confluence.nextExpiry) {
    parts.push(`Cross-expiry alignment is ${Math.abs(confluence.alignmentPct) > 40 ? "strong" : Math.abs(confluence.alignmentPct) > 15 ? "moderate" : "weak"}.`);
  }

  if (oiFreshness.level === "high") parts.push("High 0DTE volume reduces inventory confidence.");

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Diagnostics + assembly
// ---------------------------------------------------------------------------

export interface DeltaEngineDiagnostics {
  pricingModel: string;
  surfaceModel: string;
  contractsIncluded: number;
  invalidContracts: number;
  dealerSignConvention: string;
  oiFreshnessLabel: OiFreshnessRisk["level"];
  crossProductWarning: string;
  lastCalculatedAt: number;
}

export interface DeltaEngineResult {
  heroStatement: string;
  consensus: DeltaConsensus;
  phase: PhaseClassification;
  rehedgeSurface: { grid: RehedgeSurfacePoint[]; priceValues: number[]; minutesValues: number[] };
  deltaNeutralBand: DeltaNeutralBand;
  inventoryPivot: number | null;
  deltaShelves: DeltaShelf[];
  rehedgeTriggers: RehedgeTrigger[];
  hedgeRotationZone: HedgeRotationZone;
  confluence: DeltaConfluence;
  unwindScenarios: UnwindScenario[];
  gapRisk: GapRiskRow[];
  hedgeCrowding: HedgeCrowdingRisk;
  oiFreshness: OiFreshnessRisk;
  inventoryUncertainty: DealerInventoryUncertainty;
  balanceSheet: DeltaBalanceSheet;
  cumulativeLadder: CumulativeDexPoint[];
  expiryStack: ExpiryDexStack;
  concentration: ConcentrationStats;
  centerOfInventory: CenterOfInventory;
  asymmetry: AsymmetryStats;
  moneyness: MoneynessRow[];
  diagnostics: DeltaEngineDiagnostics;
}

export function computeDeltaEngine(params: {
  symbol: string;
  chain: ChainStrikeInput[];
  perStrike: StrikeRow0DTE[];
  spot: number;
  r: number;
  q: number;
  dteHours: number;
  atmIv: number;
  expectedMove1s: number | null;
  crossExpiry: CrossExpiryRow[];
  recentVolume5m: number | null;
  recentVolume15m: number | null;
  recentVolume30m: number | null;
  sviParams: SviParams;
  forward: number;
  flowImbalance: number | null;
  netGexSign: number;
  validContracts: number;
  invalidContracts: number;
}): DeltaEngineResult {
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
    crossExpiry,
    recentVolume5m,
    recentVolume15m,
    recentVolume30m,
    sviParams,
    forward,
    flowImbalance,
    netGexSign,
    validContracts,
    invalidContracts,
  } = params;

  const T = Math.max(dteHours, 0.05) / 24 / 365;
  const totalMinutesToExpiry = Math.max(dteHours * 60, 3);
  const lambda = expectedMove1s && expectedMove1s > 0 ? expectedMove1s : spot * 0.01;
  const emLow = spot - lambda;
  const emHigh = spot + lambda;

  const consensus = computeDeltaConsensus(chain, spot, T, r, q, sviParams, forward, flowImbalance, netGexSign);

  // Real call/put split, computed once here (not derivable losslessly from perStrike.dex alone).
  const callPutLadder: { strike: number; callDex: number; putDex: number }[] = (() => {
    const byStrike = new Map<number, { callDex: number; putDex: number }>();
    for (const row of chain) {
      if (row.oi <= 0 || row.iv <= 0) continue;
      const delta = bsDeltaAt(spot, row.strike, T, row.iv, r, q, row.side === "call");
      const shares = delta * row.oi * MULTIPLIER;
      const entry = byStrike.get(row.strike) ?? { callDex: 0, putDex: 0 };
      if (row.side === "call") entry.callDex += shares;
      else entry.putDex += shares;
      byStrike.set(row.strike, entry);
    }
    return [...byStrike.entries()].map(([strike, v]) => ({ strike, ...v })).sort((a, b) => a.strike - b.strike);
  })();

  const callDex = callPutLadder.reduce((s, r2) => s + r2.callDex, 0);
  const putDex = callPutLadder.reduce((s, r2) => s + r2.putDex, 0);
  const netDex = callDex + putDex;
  const grossDex = callPutLadder.reduce((s, r2) => s + Math.abs(r2.callDex) + Math.abs(r2.putDex), 0);

  const hib5m = recentVolume5m && recentVolume5m > 0 ? Math.abs(-netDex) / recentVolume5m : null;
  const hib30m = recentVolume30m && recentVolume30m > 0 ? Math.abs(-netDex) / recentVolume30m : null;

  const phase = classifyPhase(netDex, grossDex, hib30m, consensus.signAgreementPct);

  const deltaNeutralBand = computeDeltaNeutralBand(chain, spot, T, r, q, flowImbalance, netGexSign);
  const inventoryPivot = computeInventoryPivot(chain, spot, T, r, q, lambda);

  const dexPerStrike = perStrike.map((r2) => ({ strike: r2.strike, dex: r2.dex }));
  const deltaShelves = computeDeltaShelves(dexPerStrike);

  const priceRangePct = 0.05;
  const priceGrid: number[] = [];
  for (let i = 0; i <= 24; i++) priceGrid.push(spot * (1 - priceRangePct + (2 * priceRangePct * i) / 24));

  const rehedgeTriggers = computeRehedgeTriggers(chain, spot, T, r, q, netDex, priceGrid, recentVolume5m);
  const hedgeRotationZone = computeHedgeRotationZone(chain, spot, T, r, q, priceGrid, grossDex);
  const confluence = computeDeltaConfluence(netDex, crossExpiry);

  const nearestShelf = deltaShelves.length ? [...deltaShelves].sort((a, b) => Math.abs(a.center - spot) - Math.abs(b.center - spot))[0].center : null;
  const unwindScenarios = computeUnwindScenarios(chain, spot, T, r, q, netDex, nearestShelf, inventoryPivot, emLow, emHigh, recentVolume15m);
  const gapRisk = computeGapRisk(chain, spot, T, r, q, netDex, lambda, recentVolume5m);

  const concentration = computeConcentration(dexPerStrike);
  const hedgeCrowding = computeHedgeCrowding(phase.deltaBalanceRatio, concentration.effectiveStrikes, dexPerStrike.length, confluence.alignmentPct, hib5m);

  const zeroDteRow = crossExpiry.find((row) => row.dte === 0);
  const zeroDteVolume = zeroDteRow?.totalVol ?? 0;
  const zeroDteOi = perStrike.reduce((s, r2) => s + r2.callOi + r2.putOi, 0);
  const oiFreshness = computeOiFreshness(zeroDteVolume, zeroDteOi);

  const inventoryUncertainty = computeInventoryUncertainty(consensus.dealerSignScenarios);

  // theoreticalHedge = +netDex: dealers short the customer book hold its delta as the hedge - same sign classifyPhase reports (hedge_long when netDex > 0).
  const balanceSheet: DeltaBalanceSheet = { callDex, putDex, netDex, grossDex, theoreticalHedge: netDex, cancellationRatio: 1 - Math.abs(netDex) / (grossDex + 1e-9) };
  const cumulativeLadder = computeCumulativeLadder(callPutLadder);

  const rehedgeSurface = computeRehedgeSurface(chain, spot, r, q, totalMinutesToExpiry, netDex, priceRangePct, 20, 6);
  const expiryStack = computeExpiryDexStack(crossExpiry);
  const centerOfInventory = computeCenterOfInventory(callPutLadder, spot, atmIv, dteHours);
  const asymmetry = computeAsymmetry(dexPerStrike, spot);
  const moneyness = computeMoneynessStructure(chain, spot, T, r, q);

  const heroStatement = buildHeroStatement(symbol, phase, netDex, inventoryPivot, rehedgeTriggers, confluence, oiFreshness);

  const diagnostics: DeltaEngineDiagnostics = {
    pricingModel: "Closed-form Black-Scholes delta on SVI-smoothed 0DTE smile (American/CRR trees available via the page's engine toggle for the static table)",
    surfaceModel: "Single-slice raw SVI, sticky-moneyness for surface-consistent/scenario views",
    contractsIncluded: validContracts,
    invalidContracts,
    dealerSignConvention: "6 scenarios modeled (see Delta Regime tab) - conventional customer-long/dealer-short is not asserted as known fact",
    oiFreshnessLabel: oiFreshness.level,
    crossProductWarning: "Product-local exposure only (this symbol's own listed options) - cross-product offsets in futures, index options, ETF baskets, or other expirations are unobserved.",
    lastCalculatedAt: Date.now(),
  };

  return {
    heroStatement,
    consensus,
    phase,
    rehedgeSurface,
    deltaNeutralBand,
    inventoryPivot,
    deltaShelves,
    rehedgeTriggers,
    hedgeRotationZone,
    confluence,
    unwindScenarios,
    gapRisk,
    hedgeCrowding,
    oiFreshness,
    inventoryUncertainty,
    balanceSheet,
    cumulativeLadder,
    expiryStack,
    concentration,
    centerOfInventory,
    asymmetry,
    moneyness,
    diagnostics,
  };
}
