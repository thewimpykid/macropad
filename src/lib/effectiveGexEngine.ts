/**
 * Effective GEX and Shadow Gamma - scenario-based per-strike hedge pressure,
 * replacing the earlier Hedge Acceleration & Cliff Map.
 *
 * STANDARD (static) GEX multiplies the CURRENT gamma by a fixed 1% move,
 * treating gamma as constant across that move. It isn't: gamma itself
 * shifts as spot approaches a strike, and implied vol shifts with spot
 * (vanna). EFFECTIVE GEX instead fully reprices each contract's delta at a
 * scenario spot and takes the actual delta change - the real definition of
 * "how much would dealer hedging actually move," not a linear snapshot.
 *
 * Two delta reprices are computed per contract per scenario:
 *  - FROZEN-IV: contract's own quoted IV held fixed, spot bumped. This is
 *    the pure gamma effect (same repricing style as this app's other
 *    frozen-vol Greeks).
 *  - SURFACE-CONSISTENT (sticky-moneyness): IV is re-read off this
 *    session's fitted SVI smile at the shifted moneyness, the same
 *    technique vannaEngine.ts's surfaceVexLadderAt already uses for its own
 *    scenario views - not a new, unverified methodology.
 *
 * SHADOW GAMMA is the incremental hedge dollars the surface-consistent
 * reprice captures that the frozen-IV reprice doesn't - i.e. the delta
 * change caused specifically by the vol surface moving with spot (vanna),
 * isolated from pure spot-driven gamma. It is exactly the "Vanna x
 * dIV/dSpot" term the effective-gamma decomposition describes, computed
 * directly rather than estimated from a separate vanna figure.
 *
 * Known simplifications (stated, not hidden):
 *  - Dealer sign (q) uses this app's existing call=+1/put=-1 convention
 *    (same as every other GEX figure here) - an assumed convention, not
 *    observed dealer positioning, since OI alone can't say who's long/short.
 *  - No hedge-participation or liquidity weighting (p_active, w_liquidity)
 *    is applied - there's no real per-contract activity data behind those
 *    weights in this app's feed, and inventing one would be exactly the
 *    synthetic-data problem this app avoids elsewhere. Every contract with
 *    real OI/IV is weighted equally.
 *  - The scenario move size is a fixed +/-1% of spot (same convention as
 *    this app's existing 1%-move dollar-GEX figures), not a probabilistic
 *    path.
 */

import { bsDelta } from "@/lib/blackScholes";
import { sviImpliedVol, type SviParams } from "@/lib/svi";
import type { ChainStrikeInput } from "@/lib/gex";

const MULTIPLIER = 100;

function dealerSign(side: "call" | "put"): 1 | -1 {
  return side === "call" ? 1 : -1;
}

/** Per-strike aggregated (Delta1 - Delta0) x q x OI x M, in shares - not yet dollarized. useSurface picks frozen-IV vs sticky-moneyness smile repricing. */
function scenarioDeltaShares(
  chain: ChainStrikeInput[],
  spot: number,
  evalSpot: number,
  T: number,
  r: number,
  q: number,
  sviParams: SviParams,
  forward: number,
  useSurface: boolean
): Map<number, number> {
  const out = new Map<number, number>();
  for (const row of chain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const isCall = row.side === "call";
    // The surface branch reads BOTH legs off the fitted smile (current
    // moneyness for delta0, shifted moneyness for delta1) so shadow gamma is
    // purely the surface-moves-with-spot term. Mixing a quoted-IV delta0
    // with an SVI delta1 would leave a nonzero "delta change" even at a
    // zero-size move wherever the fit deviates from the quote. (The live
    // pipeline pre-smooths chain IVs to the SVI fit, so vol0 === row.iv
    // there - this keeps the engine correct for raw-quote chains too.)
    const vol0 = useSurface ? sviImpliedVol(sviParams, row.strike, forward, T) : row.iv;
    const delta0 = bsDelta({ spot, strike: row.strike, T, vol: vol0, r, q, isCall });
    const vol1 = useSurface ? sviImpliedVol(sviParams, row.strike * (spot / evalSpot), forward, T) : row.iv;
    const delta1 = bsDelta({ spot: evalSpot, strike: row.strike, T, vol: vol1, r, q, isCall });
    const shares = dealerSign(row.side) * row.oi * MULTIPLIER * (delta1 - delta0);
    out.set(row.strike, (out.get(row.strike) ?? 0) + shares);
  }
  return out;
}

export interface EffectiveGexRow {
  strike: number;
  /** Existing self-computed 0DTE $GEX for a 1% move, current gamma held constant - the "standard" figure. */
  staticGex: number;
  /** Full delta reprice at spot+1%, surface-consistent IV - the real hedge-dollar change. */
  upEffective: number;
  /** Full delta reprice at spot-1%, surface-consistent IV. */
  downEffective: number;
  /** How much larger the effective figure is than the static one, in the more extreme direction - flags strikes whose static GEX understates the real hedge cliff. */
  acceleration: number;
  /** Incremental hedge dollars from the vol surface moving with spot (vanna), isolated from pure gamma, at spot+1%. */
  shadowGammaUp: number;
  /** Same isolation at spot-1%. */
  shadowGammaDown: number;
}

export interface EffectiveGexResult {
  rows: EffectiveGexRow[];
  moveUpPct: number;
  moveDownPct: number;
  disclosures: string[];
}

export function computeEffectiveGex(params: {
  chain: ChainStrikeInput[];
  perStrike: { strike: number; gex: number }[];
  spot: number;
  T: number;
  r: number;
  q: number;
  sviParams: SviParams;
  forward: number;
  moveUpPct?: number;
  moveDownPct?: number;
}): EffectiveGexResult {
  const { chain, perStrike, spot, T, r, q, sviParams, forward, moveUpPct = 0.01, moveDownPct = 0.01 } = params;
  const spotUp = spot * (1 + moveUpPct);
  const spotDown = spot * (1 - moveDownPct);

  const surfaceUp = scenarioDeltaShares(chain, spot, spotUp, T, r, q, sviParams, forward, true);
  const surfaceDown = scenarioDeltaShares(chain, spot, spotDown, T, r, q, sviParams, forward, true);
  const frozenUp = scenarioDeltaShares(chain, spot, spotUp, T, r, q, sviParams, forward, false);
  const frozenDown = scenarioDeltaShares(chain, spot, spotDown, T, r, q, sviParams, forward, false);

  const staticByStrike = new Map(perStrike.map((r) => [r.strike, r.gex]));
  const strikes = [...new Set([...surfaceUp.keys(), ...surfaceDown.keys(), ...staticByStrike.keys()])].sort((a, b) => a - b);

  const rows: EffectiveGexRow[] = strikes.map((strike) => {
    const staticGex = staticByStrike.get(strike) ?? 0;
    const upEffective = (surfaceUp.get(strike) ?? 0) * spotUp;
    const downEffective = (surfaceDown.get(strike) ?? 0) * spotDown;
    const shadowGammaUp = upEffective - (frozenUp.get(strike) ?? 0) * spotUp;
    const shadowGammaDown = downEffective - (frozenDown.get(strike) ?? 0) * spotDown;

    const maxEff = Math.max(Math.abs(upEffective), Math.abs(downEffective));
    const acceleration = maxEff / Math.max(Math.abs(staticGex), 1_000_000);

    return { strike, staticGex, upEffective, downEffective, acceleration, shadowGammaUp, shadowGammaDown };
  });

  return {
    rows,
    moveUpPct,
    moveDownPct,
    disclosures: [
      "Effective GEX fully reprices delta at the scenario spot instead of multiplying today's gamma by a fixed move - it captures gamma's own change and vanna's IV-surface effect, which static GEX assumes away.",
      "Dealer sign uses this app's standard call=+1/put=-1 convention, an assumed convention (not observed per-trade dealer positioning) - open interest alone can't say who's actually long or short.",
      "No hedge-participation or liquidity weighting is applied - every contract with real OI/IV counts equally, since this app has no real per-contract activity data to weight by.",
    ],
  };
}
