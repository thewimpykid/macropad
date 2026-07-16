/**
 * GEX-page-only deep analytics: gamma concentration, gamma-regime transitions,
 * gamma-driven hedge sensitivity. Nothing here touches vanna/charm/theta/
 * generic dealer delta - that's the other 4 pages' job.
 *
 * No historical chain database exists in this app, so every metric here is
 * built from exactly one thing: the current chain snapshot (strike/side/OI/
 * IV) + current spot/time + scenario repricing (hypothetical spot and/or
 * hypothetical time-to-expiry, frozen-IV). Nothing here is a time series of
 * past snapshots - "scenario" always means "reprice the SAME book at a
 * different (spot, time)," not "look at what happened before."
 *
 * Pricer choice for the repricing-heavy parts (scenario surface, feedback
 * curve, transition/cliff, gamma-flip-band scenarios, wall-quality scenario
 * stability): always closed-form Black-Scholes, regardless of which engine
 * the page's own toggle has selected for the static per-strike table. A
 * scenario grid needs thousands of re-prices; Black-Scholes is a few dozen
 * flops per re-price, the American/CRR trees are ~30x that per re-price
 * (each is itself an O(steps) backward induction). Stated simplification,
 * not a hidden one - the static GEX-by-strike numbers elsewhere on the page
 * still respect the engine toggle.
 */

import { bsGamma, bsPrice, dollarGex } from "@/lib/blackScholes";
import { topStrikesByMagnitude, type ChainStrikeInput, type CrossExpiryRow, type StrikeRow0DTE } from "@/lib/gex";
import { sviImpliedVol, type SviParams } from "@/lib/svi";

// ---------------------------------------------------------------------------
// Shared repricing primitives
// ---------------------------------------------------------------------------

export function bsGammaAt(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean): number {
  return bsGamma({ spot, strike, T, vol, r, q, isCall });
}

/** d(Gamma)/dS via the standard 5-point third-derivative finite-difference stencil. */
function bsSpeedAt(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean): number {
  if (T <= 0 || vol <= 0) return 0;
  const h = spot * 0.005;
  const up2 = bsPrice({ spot: spot + 2 * h, strike, T, vol, r, q, isCall });
  const up1 = bsPrice({ spot: spot + h, strike, T, vol, r, q, isCall });
  const down1 = bsPrice({ spot: spot - h, strike, T, vol, r, q, isCall });
  const down2 = bsPrice({ spot: spot - 2 * h, strike, T, vol, r, q, isCall });
  return (up2 - 2 * up1 + 2 * down1 - down2) / (2 * h * h * h);
}

/** d(Gamma)/dT ("color"), per calendar day - bump-and-reprice gamma at a slightly later point (smaller T), matching the sign convention of this app's existing charm/theta (decay is negative of d/dT). */
function bsColorAt(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean): number {
  if (T <= 0 || vol <= 0) return 0;
  const hT = Math.min(T * 0.1, 1 / 365);
  const gammaNow = bsGammaAt(spot, strike, T, vol, r, q, isCall);
  const gammaSoon = bsGammaAt(spot, strike, Math.max(1e-8, T - hT), vol, r, q, isCall);
  return ((gammaSoon - gammaNow) / hT) * (1 / 365);
}

/** d(Gamma)/d(vol) ("zomma"), per 1 vol point (0.01) - matches this app's existing vega/vanna per-vol-point convention. */
function bsZommaAt(spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean): number {
  if (T <= 0 || vol <= 0) return 0;
  const hVol = 0.01;
  const gammaUp = bsGammaAt(spot, strike, T, vol + hVol, r, q, isCall);
  const gammaDown = bsGammaAt(spot, strike, T, Math.max(1e-4, vol - hVol), r, q, isCall);
  return (gammaUp - gammaDown) / 2;
}

/** Dollar-scaled the same way as dollarGex (gamma*OI*mult*S^2*0.01) - stated convention, not an industry-standard "dollar speed/color/zomma" the way GEX/DEX/vega are; extends the same Greek*OI*S^n*scale pattern one derivative further. */
function dollarGammaFamily(value: number, oi: number, spot: number, multiplier = 100): number {
  return value * oi * multiplier * spot * spot * 0.01;
}

/** Per-strike dealer-signed dollar GEX at a hypothetical (spot, T) - the one repricing primitive every scenario feature below is built from. */
export function gexLadderAt(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  opts?: { callWeight?: number; putWeight?: number; ivShift?: number }
): { strike: number; gex: number }[] {
  const callWeight = opts?.callWeight ?? 1;
  const putWeight = opts?.putWeight ?? 1;
  const ivShift = opts?.ivShift ?? 0;

  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const vol = Math.max(1e-4, row.iv + ivShift);
    const gamma = bsGammaAt(spot, row.strike, T, vol, r, q, row.side === "call");
    const dollar = dollarGex(gamma, row.oi, spot);
    const signed = row.side === "call" ? dollar * callWeight : -dollar * putWeight;
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + signed);
  }
  return [...byStrike.entries()]
    .map(([strike, gex]) => ({ strike, gex }))
    .sort((a, b) => a.strike - b.strike);
}

export function netGexAt(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): number {
  return gexLadderAt(chain, spot, T, r, q).reduce((s, row) => s + row.gex, 0);
}

/** Zero-crossings of a strike-sorted {strike,gex} ladder, nearest to spot first. */
export function zeroCrossings(rows: { strike: number; gex: number }[], spot: number): number[] {
  const sorted = [...rows].sort((a, b) => a.strike - b.strike);
  const crossings: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if ((a.gex < 0 && b.gex > 0) || (a.gex > 0 && b.gex < 0)) {
      const t = a.gex / (a.gex - b.gex);
      crossings.push(a.strike + t * (b.strike - a.strike));
    }
  }
  return crossings.sort((x, y) => Math.abs(x - spot) - Math.abs(y - spot));
}

/** Same dealer-sign-adjusted, dollar-scaled aggregation as gexLadderAt, generalized to any bump-and-reprice Greek function (speed/color/zomma) - one ladder builder shared by every "family of gamma" derivative on this page. */
function greekLadderAt(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  greekFn: (spot: number, strike: number, T: number, vol: number, r: number, q: number, isCall: boolean) => number
): { strike: number; value: number }[] {
  const byStrike = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const g = greekFn(spot, row.strike, T, row.iv, r, q, row.side === "call");
    const dollar = dollarGammaFamily(g, row.oi, spot);
    const signed = row.side === "call" ? dollar : -dollar;
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + signed);
  }
  return [...byStrike.entries()]
    .map(([strike, value]) => ({ strike, value }))
    .sort((a, b) => a.strike - b.strike);
}

export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

/** Reflection-principle touch probability for a driftless process, using ATM IV uniformly (not each strike's own smile-local IV - see surfaceStrain.ts's identical historical note on why ATM IV, not local IV, is the right "will spot get there" input). */
export function touchProbability(strike: number, spot: number, atmIv: number, hoursAhead: number): number {
  if (hoursAhead <= 0) return strike === spot ? 1 : 0;
  if (atmIv <= 0 || spot <= 0) return 0;
  const T = hoursAhead / 24 / 365;
  const z = Math.abs(Math.log(strike / spot)) / (atmIv * Math.sqrt(T));
  return Math.min(1, 2 * (1 - normCdf(z)));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function quantile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ---------------------------------------------------------------------------
// 3. Gamma feedback curve
// ---------------------------------------------------------------------------

export interface GexCurvePoint {
  price: number;
  netGex: number;
}

function computeFeedbackCurve(chain: ChainStrikeInput[], spot: number, r: number, q: number, T: number, priceRangePct: number, steps: number): GexCurvePoint[] {
  const points: GexCurvePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const price = spot * (1 - priceRangePct + (2 * priceRangePct * i) / steps);
    points.push({ price, netGex: netGexAt(chain, price, T, r, q) });
  }
  return points;
}

// ---------------------------------------------------------------------------
// 4 + 5. Gamma transition intensity + cliff map
// ---------------------------------------------------------------------------

export interface TransitionRow {
  price: number;
  netGex: number;
  transitionIntensity: number;
  cliffScore: number;
  classification: "low" | "moderate" | "high" | "cliff";
}

function computeTransitionLadder(curve: GexCurvePoint[]): TransitionRow[] {
  if (curve.length < 3) return curve.map((p) => ({ ...p, transitionIntensity: 0, cliffScore: 0, classification: "low" }));

  const step = curve[1].price - curve[0].price || 1;
  const rows: TransitionRow[] = [];
  const intensities: number[] = [];

  for (let i = 1; i < curve.length - 1; i++) {
    const intensity = Math.abs((curve[i + 1].netGex - curve[i - 1].netGex) / (2 * step));
    intensities.push(intensity);
  }
  const p50 = quantile(intensities, 0.5);
  const p80 = quantile(intensities, 0.8);
  const p95 = quantile(intensities, 0.95);

  const secondDerivs: number[] = [];
  for (let i = 1; i < curve.length - 1; i++) {
    secondDerivs.push(Math.abs((curve[i + 1].netGex - 2 * curve[i].netGex + curve[i - 1].netGex) / (step * step)));
  }
  const maxSecond = Math.max(1e-9, ...secondDerivs);

  for (let i = 1; i < curve.length - 1; i++) {
    const intensity = intensities[i - 1];
    const cliffScore = (secondDerivs[i - 1] / maxSecond) * 100;
    const classification: TransitionRow["classification"] = intensity >= p95 ? "cliff" : intensity >= p80 ? "high" : intensity >= p50 ? "moderate" : "low";
    rows.push({ price: curve[i].price, netGex: curve[i].netGex, transitionIntensity: intensity, cliffScore, classification });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 6. Gamma flip band
// ---------------------------------------------------------------------------

export interface GammaFlipScenarioResult {
  name: string;
  label: string;
  flip: number | null;
}

export interface GammaFlipBand {
  central: number | null;
  low: number | null;
  high: number | null;
  signAgreementPct: number;
  scenarios: GammaFlipScenarioResult[];
}

function computeGammaFlipBand(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): GammaFlipBand {
  const scenarioDefs: { name: string; label: string; callWeight?: number; putWeight?: number; ivShift?: number }[] = [
    { name: "standard", label: "Standard convention" },
    { name: "reduced_put", label: "Reduced put-dealer exposure", putWeight: 0.5 },
    { name: "reduced_call", label: "Reduced call-dealer exposure", callWeight: 0.5 },
    { name: "conservative", label: "Conservative sign weighting", callWeight: 0.75, putWeight: 0.75 },
    { name: "aggressive", label: "Aggressive sign weighting", callWeight: 1.25, putWeight: 1.25 },
    { name: "iv_up", label: "IV +1 vol point", ivShift: 0.01 },
    { name: "iv_down", label: "IV -1 vol point", ivShift: -0.01 },
  ];

  const scenarios: GammaFlipScenarioResult[] = [];
  const flips: number[] = [];
  const signsAtSpot: number[] = [];

  for (const def of scenarioDefs) {
    const ladder = gexLadderAt(chain, spot, T, r, q, { callWeight: def.callWeight, putWeight: def.putWeight, ivShift: def.ivShift });
    const crossings = zeroCrossings(ladder, spot);
    const flip = crossings.length ? crossings[0] : null;
    scenarios.push({ name: def.name, label: def.label, flip });
    if (flip !== null) flips.push(flip);

    const nearest = [...ladder].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (nearest) signsAtSpot.push(Math.sign(nearest.gex));
  }

  const positiveCount = signsAtSpot.filter((s) => s > 0).length;
  const negativeCount = signsAtSpot.filter((s) => s < 0).length;
  const majority = Math.max(positiveCount, negativeCount);
  const signAgreementPct = signsAtSpot.length ? (majority / signsAtSpot.length) * 100 : 0;

  const central = scenarios.find((s) => s.name === "standard")?.flip ?? null;

  return {
    central,
    low: flips.length ? Math.min(...flips) : null,
    high: flips.length ? Math.max(...flips) : null,
    signAgreementPct,
    scenarios,
  };
}

// ---------------------------------------------------------------------------
// 7. Gamma wall quality
// ---------------------------------------------------------------------------

export interface WallQualityRow {
  strike: number;
  type: "call_wall" | "put_wall" | "cluster";
  gexShare: number;
  breadth: number;
  dominance: number;
  stability: number;
  qualityScore: number;
}

function scenarioStabilityMap(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  candidateStrikes: number[]
): Map<number, number> {
  const scenarioPoints: { spot: number; T: number }[] = [
    { spot, T },
    { spot: spot * 1.0025, T },
    { spot: spot * 0.9975, T },
    { spot, T: Math.max(1e-6, T * 0.5) },
    { spot, T: Math.max(1e-6, T * 0.1) },
  ];

  const hits = new Map<number, number>(candidateStrikes.map((s) => [s, 0]));
  for (const scen of scenarioPoints) {
    const ladder = gexLadderAt(chain, scen.spot, scen.T, r, q);
    const topSet = new Set(
      [...ladder]
        .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex))
        .slice(0, 8)
        .map((r2) => r2.strike)
    );
    for (const strike of candidateStrikes) {
      if (topSet.has(strike)) hits.set(strike, (hits.get(strike) ?? 0) + 1);
    }
  }

  const stability = new Map<number, number>();
  for (const strike of candidateStrikes) stability.set(strike, (hits.get(strike) ?? 0) / scenarioPoints.length);
  return stability;
}

function computeWallQuality(
  chain: ChainStrikeInput[],
  perStrike: StrikeRow0DTE[],
  spot: number,
  T: number,
  r: number,
  q: number,
  callWall: number,
  putWall: number
): WallQualityRow[] {
  const sorted = [...perStrike].sort((a, b) => a.strike - b.strike);
  const totalAbs = sorted.reduce((s, r) => s + Math.abs(r.gex), 0) || 1;
  const candidates = topStrikesByMagnitude(perStrike, (r) => r.gex, 12);
  const candidateStrikes = candidates.map((c) => c.strike);
  const stability = scenarioStabilityMap(chain, spot, T, r, q, candidateStrikes);

  const n = 3;
  return candidates
    .map((cand) => {
      const idx = sorted.findIndex((r) => r.strike === cand.strike);
      const windowRows = sorted.slice(Math.max(0, idx - n), Math.min(sorted.length, idx + n + 1));
      const windowAbsMean = windowRows.reduce((s, r) => s + Math.abs(r.gex), 0) / windowRows.length || 1;
      const dominanceRaw = Math.abs(cand.gex) / (windowAbsMean + 1e-9);
      const dominance = dominanceRaw / (1 + dominanceRaw); // squash to [0,1)

      const neighbors = windowRows.filter((r) => r.strike !== cand.strike);
      const breadth = neighbors.reduce((s, r) => s + Math.abs(r.gex), 0) / totalAbs;
      const gexShare = Math.abs(cand.gex) / totalAbs;
      const stab = stability.get(cand.strike) ?? 0;

      const qualityScore = (0.3 * dominance + 0.3 * gexShare * 4 + 0.2 * breadth * 4 + 0.2 * stab) * 100;

      const type: WallQualityRow["type"] = cand.strike === callWall ? "call_wall" : cand.strike === putWall ? "put_wall" : "cluster";

      return {
        strike: cand.strike,
        type,
        gexShare: gexShare * 100,
        breadth: breadth * 100,
        dominance: dominance * 100,
        stability: stab * 100,
        qualityScore: Math.max(0, Math.min(100, qualityScore)),
      };
    })
    .sort((a, b) => b.qualityScore - a.qualityScore);
}

// ---------------------------------------------------------------------------
// 8. Reachability-weighted GEX
// ---------------------------------------------------------------------------

export interface ReachabilityRow {
  strike: number;
  gex: number;
  touchProbability: number;
  rawRank: number;
  adjustedGex: number;
  adjustedRank: number;
}

function computeReachability(perStrike: StrikeRow0DTE[], spot: number, atmIv: number, hoursAhead: number): ReachabilityRow[] {
  const rawRanked = [...perStrike].sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex));
  const rawRankByStrike = new Map<number, number>(rawRanked.map((r, i) => [r.strike, i + 1]));

  const candidates = rawRanked.slice(0, 15).map((r) => {
    const p = touchProbability(r.strike, spot, atmIv, hoursAhead);
    return { strike: r.strike, gex: r.gex, touchProbability: p, adjustedGex: p * Math.abs(r.gex) };
  });

  const adjustedRanked = [...candidates].sort((a, b) => b.adjustedGex - a.adjustedGex);
  const adjustedRankByStrike = new Map<number, number>(adjustedRanked.map((r, i) => [r.strike, i + 1]));

  return candidates
    .map((c) => ({
      ...c,
      rawRank: rawRankByStrike.get(c.strike) ?? 0,
      adjustedRank: adjustedRankByStrike.get(c.strike) ?? 0,
    }))
    .sort((a, b) => a.adjustedRank - b.adjustedRank);
}

// ---------------------------------------------------------------------------
// 9. Gamma friction map
// ---------------------------------------------------------------------------

export interface FrictionPoint {
  price: number;
  friction: number;
  zone: "strong_stabilizing" | "moderate_stabilizing" | "neutral" | "moderate_amplifying" | "strong_amplifying";
}

function computeFriction(curve: GexCurvePoint[]): FrictionPoint[] {
  const maxAbs = Math.max(1e-9, ...curve.map((p) => Math.abs(p.netGex)));
  return curve.map((p) => {
    const friction = (p.netGex / maxAbs) * 100;
    const abs = Math.abs(friction);
    let zone: FrictionPoint["zone"];
    if (abs < 25) zone = "neutral";
    else if (friction > 0) zone = abs >= 60 ? "strong_stabilizing" : "moderate_stabilizing";
    else zone = abs >= 60 ? "strong_amplifying" : "moderate_amplifying";
    return { price: p.price, friction, zone };
  });
}

// ---------------------------------------------------------------------------
// 10. Gamma vacuum zones
// ---------------------------------------------------------------------------

export interface VacuumPoint {
  price: number;
  density: number;
  vacuumScore: number;
  zone: "wall" | "friction" | "vacuum";
}

function computeVacuum(perStrike: StrikeRow0DTE[], priceValues: number[], bandwidth: number, callWall: number, putWall: number): VacuumPoint[] {
  const h = Math.max(1e-6, bandwidth);
  const density = priceValues.map((price) =>
    perStrike.reduce((sum, r) => sum + Math.abs(r.gex) * Math.exp(-((r.strike - price) ** 2) / (2 * h * h)), 0)
  );
  const maxD = Math.max(1e-9, ...density);

  return priceValues.map((price, i) => {
    const vacuumScore = 1 - density[i] / maxD;
    const isWall = Math.abs(price - callWall) < h * 0.25 || Math.abs(price - putWall) < h * 0.25;
    const zone: VacuumPoint["zone"] = isWall ? "wall" : vacuumScore > 0.7 ? "vacuum" : "friction";
    return { price, density: density[i], vacuumScore, zone };
  });
}

// ---------------------------------------------------------------------------
// 11. Gamma pinning basin
// ---------------------------------------------------------------------------

export interface PinningBasin {
  low: number;
  high: number;
  center: number;
  score: number;
  invalidation: number;
}

function computePinningBasins(
  perStrike: StrikeRow0DTE[],
  spot: number,
  atmIv: number,
  hoursAhead: number,
  stability: Map<number, number>
): PinningBasin[] {
  const sorted = [...perStrike].sort((a, b) => a.strike - b.strike);
  const totalAbs = sorted.reduce((s, r) => s + Math.abs(r.gex), 0) || 1;
  const strikeStep = median(sorted.slice(1).map((r, i) => r.strike - sorted[i].strike)) || 1;

  const candidates = sorted.filter((r) => r.gex > 0);
  const scored = candidates.map((cand) => {
    const idx = sorted.findIndex((r) => r.strike === cand.strike);
    const window = sorted.slice(Math.max(0, idx - 5), Math.min(sorted.length, idx + 6));
    const below = window.filter((r) => r.strike < cand.strike).reduce((s, r) => s + Math.abs(r.gex), 0);
    const above = window.filter((r) => r.strike > cand.strike).reduce((s, r) => s + Math.abs(r.gex), 0);
    const localSymmetry = Math.min(below, above) / (Math.max(below, above) + 1e-9);

    const concentration = Math.abs(cand.gex) / totalAbs;
    const touch = touchProbability(cand.strike, spot, atmIv, hoursAhead);
    const stab = stability.get(cand.strike) ?? 0.4; // strikes outside the wall-quality candidate set get a neutral default, not zero
    const score = concentration * touch * stab * localSymmetry;
    return { strike: cand.strike, score };
  });

  const maxScore = Math.max(1e-12, ...scored.map((s) => s.score));
  const normalized = scored.map((s) => ({ strike: s.strike, score: (s.score / maxScore) * 100 }));
  const threshold = quantile(normalized.map((n) => n.score), 0.75);

  const strong = normalized.filter((n) => n.score >= threshold && n.score > 0).sort((a, b) => a.strike - b.strike);
  const basins: PinningBasin[] = [];
  let group: typeof strong = [];

  function flush() {
    if (!group.length) return;
    const low = group[0].strike;
    const high = group[group.length - 1].strike;
    const totalW = group.reduce((s, g) => s + g.score, 0) || 1;
    const center = group.reduce((s, g) => s + g.strike * g.score, 0) / totalW;
    const score = Math.max(...group.map((g) => g.score));
    basins.push({ low, high, center, score, invalidation: low - strikeStep });
  }

  for (const cand of strong) {
    if (group.length && cand.strike - group[group.length - 1].strike > strikeStep * 2.5) flush(), (group = []);
    group.push(cand);
  }
  flush();

  return basins.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ---------------------------------------------------------------------------
// 12. Gamma concentration metrics
// ---------------------------------------------------------------------------

export interface ConcentrationStats {
  hhi: number;
  entropy: number;
  effectiveStrikes: number;
  /** Book-wide breadth complement to HHI/entropy: % of total |GEX| held by just the 5 largest strikes. */
  topFivePct: number;
}

function computeConcentration(perStrike: StrikeRow0DTE[]): ConcentrationStats {
  const totalAbs = perStrike.reduce((s, r) => s + Math.abs(r.gex), 0) || 1;
  const shares = perStrike.map((r) => Math.abs(r.gex) / totalAbs).filter((p) => p > 0);
  const hhi = shares.reduce((s, p) => s + p * p, 0);
  const entropy = -shares.reduce((s, p) => s + p * Math.log(p), 0);
  const topFive = [...perStrike].sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 5);
  const topFivePct = (topFive.reduce((s, r) => s + Math.abs(r.gex), 0) / totalAbs) * 100;
  return { hhi, entropy, effectiveStrikes: Math.exp(entropy), topFivePct };
}

// ---------------------------------------------------------------------------
// 13. Upper-vs-lower gamma asymmetry
// ---------------------------------------------------------------------------

export interface AsymmetryStats {
  aboveAbs: number;
  belowAbs: number;
  asymmetryAbs: number;
  aboveSigned: number;
  belowSigned: number;
  asymmetrySigned: number;
}

function computeAsymmetry(perStrike: StrikeRow0DTE[], spot: number): AsymmetryStats {
  const above = perStrike.filter((r) => r.strike > spot);
  const below = perStrike.filter((r) => r.strike < spot);
  const aboveAbs = above.reduce((s, r) => s + Math.abs(r.gex), 0);
  const belowAbs = below.reduce((s, r) => s + Math.abs(r.gex), 0);
  const aboveSigned = above.reduce((s, r) => s + r.gex, 0);
  const belowSigned = below.reduce((s, r) => s + r.gex, 0);
  return {
    aboveAbs,
    belowAbs,
    asymmetryAbs: (aboveAbs - belowAbs) / (aboveAbs + belowAbs || 1),
    aboveSigned,
    belowSigned,
    asymmetrySigned: (aboveSigned - belowSigned) / (Math.abs(aboveSigned) + Math.abs(belowSigned) || 1),
  };
}

// ---------------------------------------------------------------------------
// 14. Distance-adjusted gamma pressure
// ---------------------------------------------------------------------------

export interface ProximityStats {
  fullBookGex: number;
  expectedMoveAdjustedGex: number;
  nearSpotGex: number;
  lambda: number;
}

function computeProximity(perStrike: StrikeRow0DTE[], spot: number, totalGex0dte: number, lambda: number): ProximityStats {
  const expectedMoveAdjustedGex = perStrike.filter((r) => Math.abs(r.strike - spot) <= lambda * 2).reduce((s, r) => s + r.gex, 0);
  const nearSpotGex = perStrike.reduce((s, r) => s + Math.exp(-Math.abs(r.strike - spot) / lambda) * r.gex, 0);
  return { fullBookGex: totalGex0dte, expectedMoveAdjustedGex, nearSpotGex, lambda };
}

// ---------------------------------------------------------------------------
// 15. Gamma-driven hedge requirement scenarios
// ---------------------------------------------------------------------------

export interface HedgeScenarioRow {
  movePct: number;
  shares: number;
  direction: "Buy" | "Sell";
  impactRatio: number | null;
}

function computeHedgeScenarios(totalGex0dte: number, spot: number, recentVolume5m: number | null): HedgeScenarioRow[] {
  const moves = [0.001, 0.0025, -0.001, -0.0025];
  return moves.map((movePct) => {
    // Derived from GEX_dollar = sum(s_i * Gamma_i * OI_i * 100 * S^2 * 0.01):
    // sum(s_i * Gamma_i * OI_i * 100) = GEX_dollar * 100 / S^2, so
    // deltaH_shares(deltaS) = -(GEX_dollar * 100 / S^2) * deltaS, deltaS = movePct * S.
    const shares = -(totalGex0dte * 100 * movePct) / spot;
    return {
      movePct: movePct * 100,
      shares,
      direction: shares >= 0 ? "Buy" : "Sell",
      impactRatio: recentVolume5m && recentVolume5m > 0 ? Math.abs(shares) / recentVolume5m : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 17. 0DTE - next-expiry gamma confluence
//
// "Next dominant expiration" isn't hardcoded to a fixed DTE (not always
// "4DTE Friday") - it's whichever dte>0 row in the cross-expiry table
// carries the largest total OI right now, which floats with the calendar
// (1DTE on a Thursday, the next Friday weekly on a Monday, etc). Confluence
// means the 0DTE call/put wall sits at (or very near) that other expiry's
// own call-resistance/put-support strike - the option-matrix endpoint only
// exposes one key strike per side per expiry, not that expiry's full
// per-strike chain, so this is a level-match, not a full second gamma
// curve overlay.
// ---------------------------------------------------------------------------

export interface GammaConfluenceLevel {
  side: "call" | "put";
  zeroDteStrike: number;
  nextExpiryStrike: number | null;
  distance: number | null;
  aligned: boolean;
}

export interface GammaConfluence {
  nextExpiry: { expiration: string; dte: number; totalOi: number; netGex: number } | null;
  levels: GammaConfluenceLevel[];
  label: "strong" | "partial" | "none" | "unavailable";
}

function computeGammaConfluence(crossExpiry: CrossExpiryRow[], callWall: number, putWall: number, spot: number): GammaConfluence {
  const candidates = crossExpiry.filter((r) => r.dte > 0);
  if (!candidates.length) return { nextExpiry: null, levels: [], label: "unavailable" };

  const nextExpiry = [...candidates].sort((a, b) => b.totalOi - a.totalOi)[0];
  const threshold = Math.max(spot * 0.0015, 0.5);

  const levels: GammaConfluenceLevel[] = [
    { side: "call", zeroDteStrike: callWall, nextExpiryStrike: nextExpiry.callResistance, distance: nextExpiry.callResistance !== null ? Math.abs(callWall - nextExpiry.callResistance) : null, aligned: nextExpiry.callResistance !== null && Math.abs(callWall - nextExpiry.callResistance) <= threshold },
    { side: "put", zeroDteStrike: putWall, nextExpiryStrike: nextExpiry.putSupport, distance: nextExpiry.putSupport !== null ? Math.abs(putWall - nextExpiry.putSupport) : null, aligned: nextExpiry.putSupport !== null && Math.abs(putWall - nextExpiry.putSupport) <= threshold },
  ];

  const alignedCount = levels.filter((l) => l.aligned).length;
  const label: GammaConfluence["label"] = alignedCount === 2 ? "strong" : alignedCount === 1 ? "partial" : "none";

  return {
    nextExpiry: { expiration: nextExpiry.expiration, dte: nextExpiry.dte, totalOi: nextExpiry.totalOi, netGex: nextExpiry.netGex },
    levels,
    label,
  };
}

// ---------------------------------------------------------------------------
// 16. Cross-expiry gamma stack
// ---------------------------------------------------------------------------

export interface CrossExpiryStackRow {
  expiration: string;
  dte: number;
  absGex: number;
  sharePct: number;
}

export interface CrossExpiryStack {
  rows: CrossExpiryStackRow[];
  zeroDteControlPct: number;
  nextExpiryPct: number;
  remainingPct: number;
}

function computeCrossExpiryStack(crossExpiry: CrossExpiryRow[]): CrossExpiryStack {
  const withAbs = crossExpiry.map((r) => ({ expiration: r.expiration, dte: r.dte, absGex: Math.abs(r.netGex) }));
  const total = withAbs.reduce((s, r) => s + r.absGex, 0) || 1;
  const rows = withAbs.map((r) => ({ ...r, sharePct: (r.absGex / total) * 100 }));

  const zeroDteControlPct = rows.filter((r) => r.dte === 0).reduce((s, r) => s + r.sharePct, 0);
  const nextDte = Math.min(...rows.filter((r) => r.dte > 0).map((r) => r.dte), Infinity);
  const nextExpiryPct = Number.isFinite(nextDte) ? rows.filter((r) => r.dte === nextDte).reduce((s, r) => s + r.sharePct, 0) : 0;
  const remainingPct = Math.max(0, 100 - zeroDteControlPct - nextExpiryPct);

  return { rows, zeroDteControlPct, nextExpiryPct, remainingPct };
}

// ---------------------------------------------------------------------------
// 18. Speed exposure
// ---------------------------------------------------------------------------

export interface SpeedRow {
  strike: number;
  speed: number;
}

function computeSpeedExposure(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): { perStrike: SpeedRow[]; total: number } {
  const rows = greekLadderAt(chain, spot, T, r, q, bsSpeedAt).map((r2) => ({ strike: r2.strike, speed: r2.value }));
  return { perStrike: rows, total: rows.reduce((s, r2) => s + r2.speed, 0) };
}

// ---------------------------------------------------------------------------
// 19. Color-adjusted forward GEX
//
// A linear (first-order Taylor, via "color" = d(Gamma)/dT) forward
// projection of net GEX a few minutes ahead, shown next to the actual full
// reprice at the same horizon (same repricing primitive the scenario
// surface already uses, held at the current spot). The gap between the two
// is the point: it shows directly how much the linear approximation
// breaks down as the horizon gets longer, instead of asserting the
// linear number is exact.
// ---------------------------------------------------------------------------

export interface ColorForwardRow {
  minutesAhead: number;
  linearProjection: number;
  actualReprice: number;
  divergence: number;
}

function computeColorAdjustedForwardGex(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number): ColorForwardRow[] {
  const totalColorDollar = greekLadderAt(chain, spot, T, r, q, bsColorAt).reduce((s, r2) => s + r2.value, 0);
  const horizons = [5, 10, 15, 20].filter((m) => m < totalMinutesToExpiry);
  // Anchor the linear projection at the SAME pricer/chain the reprice leg
  // uses - anchoring at the page-level net GEX (which can come from a
  // different engine, or the vendor feed) puts a constant baseline offset
  // in the divergence column that doesn't shrink as the horizon -> 0.
  const baseNetGex = netGexAt(chain, spot, T, r, q);

  return horizons.map((minutesAhead) => {
    // totalColorDollar is per calendar day; minutesAhead/(60*24) converts to days.
    const linearProjection = baseNetGex + totalColorDollar * (minutesAhead / (60 * 24));
    const Tat = Math.max(1e-6, T - minutesAhead / 60 / 24 / 365);
    const actualReprice = netGexAt(chain, spot, Tat, r, q);
    return { minutesAhead, linearProjection, actualReprice, divergence: linearProjection - actualReprice };
  });
}

// ---------------------------------------------------------------------------
// 20. Zomma / IV-scenario GEX
// ---------------------------------------------------------------------------

export interface ZommaRow {
  strike: number;
  zomma: number;
}

export interface IvScenarioPoint {
  ivShiftPoints: number;
  netGex: number;
}

function computeZommaExposure(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): { perStrike: ZommaRow[]; total: number } {
  const rows = greekLadderAt(chain, spot, T, r, q, bsZommaAt).map((r2) => ({ strike: r2.strike, zomma: r2.value }));
  return { perStrike: rows, total: rows.reduce((s, r2) => s + r2.zomma, 0) };
}

function computeIvScenarioCurve(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number): IvScenarioPoint[] {
  const shifts = [-0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04, 0.05];
  return shifts.map((ivShift) => ({
    ivShiftPoints: ivShift * 100,
    netGex: gexLadderAt(chain, spot, T, r, q, { ivShift }).reduce((s, row) => s + row.gex, 0),
  }));
}

// ---------------------------------------------------------------------------
// 21. Gamma flip gradient
//
// The gamma-flip-band (section 6) shows discrete dealer-sign scenarios;
// this instead asks a continuous-parameter question: for a SMALL change in
// IV (uniform shift) or in time elapsed, how much does the flip level
// itself move? A steep gradient means the flip is a moving target even
// under everyday IV/time drift, independent of the dealer-sign uncertainty
// the flip band already covers.
// ---------------------------------------------------------------------------

export interface GammaFlipGradient {
  perVolPoint: number | null;
  perTenMinutes: number | null;
}

function computeGammaFlipGradient(chain: ChainStrikeInput[], spot: number, T: number, r: number, q: number, totalMinutesToExpiry: number): GammaFlipGradient {
  const hVol = 0.01;
  const flipAtIv = (ivShift: number) => zeroCrossings(gexLadderAt(chain, spot, T, r, q, { ivShift }), spot)[0] ?? null;
  const flipUp = flipAtIv(hVol);
  const flipDown = flipAtIv(-hVol);
  const perVolPoint = flipUp !== null && flipDown !== null ? (flipUp - flipDown) / (2 * hVol * 100) : null;

  const hMinutes = Math.min(10, totalMinutesToExpiry * 0.4);
  const flipAtT = (T2: number) => zeroCrossings(gexLadderAt(chain, spot, T2, r, q), spot)[0] ?? null;
  const flipNow = flipAtT(T);
  const flipSoon = flipAtT(Math.max(1e-6, T - hMinutes / 60 / 24 / 365));
  const perTenMinutes = flipNow !== null && flipSoon !== null ? ((flipSoon - flipNow) / hMinutes) * 10 : null;

  return { perVolPoint, perTenMinutes };
}

// ---------------------------------------------------------------------------
// 22. Surface-adjusted GEX
//
// Every scenario elsewhere on this page freezes IV while spot moves
// ("sticky-strike" - each strike keeps its own current IV regardless of
// where spot goes). This compares that assumption against sticky-moneyness
// (each strike's IV instead recomputed from the fitted smile at its NEW
// moneyness relative to the bumped spot) at a few nearby prices - the gap
// between the two is how much the frozen-IV assumption used everywhere
// else on this page actually costs.
// ---------------------------------------------------------------------------

export interface SurfaceAdjustedRow {
  price: number;
  frozenIvGex: number;
  stickyMoneynessGex: number;
  divergence: number;
}

function computeSurfaceAdjustedGex(
  chain: ChainStrikeInput[],
  spot: number,
  T: number,
  r: number,
  q: number,
  sviParams: SviParams,
  forward: number
): SurfaceAdjustedRow[] {
  const priceShifts = [-0.01, -0.005, -0.0025, 0.0025, 0.005, 0.01];

  return priceShifts.map((shiftPct) => {
    const price = spot * (1 + shiftPct);
    const frozenIvGex = netGexAt(chain, price, T, r, q);

    let stickyMoneynessGex = 0;
    for (const row of chain) {
      if (row.oi <= 0 || row.iv <= 0) continue;
      const volAtHypo = sviImpliedVol(sviParams, row.strike * (spot / price), forward, T);
      const gamma = bsGammaAt(price, row.strike, T, volAtHypo, r, q, row.side === "call");
      const dollar = dollarGex(gamma, row.oi, price);
      stickyMoneynessGex += row.side === "call" ? dollar : -dollar;
    }

    return { price, frozenIvGex, stickyMoneynessGex, divergence: stickyMoneynessGex - frozenIvGex };
  });
}

// ---------------------------------------------------------------------------
// 23. Implied skewness and kurtosis
//
// Not the historical/realized skew and kurtosis the probability card
// elsewhere in this app already shows (that's from real past daily
// returns) - this is the skew/kurtosis IMPLIED by today's option smile
// itself, via Breeden-Litzenberger: the risk-neutral terminal density is
// the second derivative of the call price curve with respect to strike.
// Computed in log-moneyness space so it's dimensionless and comparable
// across symbols/expiries.
// ---------------------------------------------------------------------------

export interface ImpliedMoments {
  skewness: number;
  excessKurtosis: number;
}

function computeImpliedMoments(spot: number, T: number, r: number, q: number, sviParams: SviParams, forward: number): ImpliedMoments {
  const steps = 60;
  const kRange = 0.35; // log-moneyness window - wide enough to capture the smile's tails without the finite-difference stencil running off into numerical noise
  const strikes: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const k = -kRange + (2 * kRange * i) / steps;
    strikes.push(forward * Math.exp(k));
  }

  const callAt = (K: number) => {
    const vol = sviImpliedVol(sviParams, K, forward, T);
    return bsPrice({ spot, strike: K, T, vol, r, q, isCall: true });
  };

  const density: { x: number; d: number }[] = [];
  for (let i = 1; i < strikes.length - 1; i++) {
    const K = strikes[i];
    const h = Math.max(1e-6, (strikes[i + 1] - strikes[i - 1]) / 2);
    const d2CdK2 = (callAt(strikes[i + 1]) - 2 * callAt(K) + callAt(strikes[i - 1])) / (h * h);
    const q_K = Math.max(0, Math.exp(r * T) * d2CdK2); // Breeden-Litzenberger; clipped at 0 - a noisy/arbitrage-inconsistent smile can produce a small negative artifact here
    // q(K) is a density in STRIKE space; these moments are taken in
    // log-moneyness x = ln(K/F). On this uniform-in-x grid each cell spans
    // dK = K*dx, so the mass weight is q(K)*K - dropping the K Jacobian
    // tilts the density by e^{-x} and biases skew/kurtosis.
    density.push({ x: Math.log(K / forward), d: q_K * K });
  }

  const totalMass = density.reduce((s, p) => s + p.d, 0) || 1;
  const mean = density.reduce((s, p) => s + p.x * p.d, 0) / totalMass;
  const variance = density.reduce((s, p) => s + (p.x - mean) ** 2 * p.d, 0) / totalMass;
  const std = Math.sqrt(Math.max(1e-12, variance));
  const m3 = density.reduce((s, p) => s + (p.x - mean) ** 3 * p.d, 0) / totalMass;
  const m4 = density.reduce((s, p) => s + (p.x - mean) ** 4 * p.d, 0) / totalMass;

  return { skewness: m3 / std ** 3, excessKurtosis: m4 / std ** 4 - 3 };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface GexPageAnalytics {
  feedbackCurve: GexCurvePoint[];
  transitionLadder: TransitionRow[];
  gammaFlipBand: GammaFlipBand;
  wallQuality: WallQualityRow[];
  reachability: ReachabilityRow[];
  friction: FrictionPoint[];
  vacuum: VacuumPoint[];
  pinningBasins: PinningBasin[];
  concentration: ConcentrationStats;
  asymmetry: AsymmetryStats;
  proximity: ProximityStats;
  hedgeScenarios: HedgeScenarioRow[];
  crossExpiryStack: CrossExpiryStack;
  gammaConfluence: GammaConfluence;
  speedExposure: { perStrike: SpeedRow[]; total: number };
  colorForward: ColorForwardRow[];
  zommaExposure: { perStrike: ZommaRow[]; total: number };
  ivScenarioCurve: IvScenarioPoint[];
  gammaFlipGradient: GammaFlipGradient;
  surfaceAdjusted: SurfaceAdjustedRow[];
  impliedMoments: ImpliedMoments;
}

export function computeGexPageAnalytics(params: {
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
}): GexPageAnalytics {
  const { chain, perStrike, spot, r, q, dteHours, atmIv, expectedMove1s, callWall, putWall, totalGex0dte, crossExpiry, recentVolume5m, sviParams, forward } = params;

  const T = Math.max(dteHours, 0.05) / 24 / 365;
  const priceRangePct = 0.05;

  const feedbackCurve = computeFeedbackCurve(chain, spot, r, q, T, priceRangePct, 48);
  const transitionLadder = computeTransitionLadder(feedbackCurve);
  const gammaFlipBand = computeGammaFlipBand(chain, spot, T, r, q);
  const wallQuality = computeWallQuality(chain, perStrike, spot, T, r, q, callWall, putWall);
  const reachability = computeReachability(perStrike, spot, atmIv, dteHours);
  const friction = computeFriction(feedbackCurve);

  const lambda = expectedMove1s && expectedMove1s > 0 ? expectedMove1s : spot * 0.01;
  const priceValuesForVacuum = feedbackCurve.map((p) => p.price);
  const vacuum = computeVacuum(perStrike, priceValuesForVacuum, Math.max(lambda * 0.5, spot * 0.003), callWall, putWall);

  const stabilityMap = new Map(wallQuality.map((w) => [w.strike, w.stability / 100]));
  const pinningBasins = computePinningBasins(perStrike, spot, atmIv, dteHours, stabilityMap);

  const concentration = computeConcentration(perStrike);
  const asymmetry = computeAsymmetry(perStrike, spot);
  const proximity = computeProximity(perStrike, spot, totalGex0dte, lambda);
  const hedgeScenarios = computeHedgeScenarios(totalGex0dte, spot, recentVolume5m);
  const crossExpiryStack = computeCrossExpiryStack(crossExpiry);
  const gammaConfluence = computeGammaConfluence(crossExpiry, callWall, putWall, spot);

  const totalMinutesToExpiry = Math.max(dteHours * 60, 3);
  const speedExposure = computeSpeedExposure(chain, spot, T, r, q);
  const colorForward = computeColorAdjustedForwardGex(chain, spot, T, r, q, totalMinutesToExpiry);
  const zommaExposure = computeZommaExposure(chain, spot, T, r, q);
  const ivScenarioCurve = computeIvScenarioCurve(chain, spot, T, r, q);
  const gammaFlipGradient = computeGammaFlipGradient(chain, spot, T, r, q, totalMinutesToExpiry);
  const surfaceAdjusted = computeSurfaceAdjustedGex(chain, spot, T, r, q, sviParams, forward);
  const impliedMoments = computeImpliedMoments(spot, T, r, q, sviParams, forward);

  return {
    feedbackCurve,
    transitionLadder,
    gammaFlipBand,
    wallQuality,
    reachability,
    friction,
    vacuum,
    pinningBasins,
    concentration,
    asymmetry,
    proximity,
    hedgeScenarios,
    crossExpiryStack,
    gammaConfluence,
    speedExposure,
    colorForward,
    zommaExposure,
    ivScenarioCurve,
    gammaFlipGradient,
    surfaceAdjusted,
    impliedMoments,
  };
}
