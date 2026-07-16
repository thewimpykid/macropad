/**
 * Black-Scholes (European, continuous dividend yield) option pricer.
 *
 * Replaces the former Leisen-Reimer American binomial pricer. Every
 * exposure page (GEX/DEX/Vanna/Charm/Vega/Theta, Hedge Activation, Hedge
 * Terrain, Surface Strain, Gamma Flip Band) now prices off this closed-form
 * model. Early exercise is not modeled - ITM American puts on SPY/QQQ/SPX/
 * NDX are worth marginally more than their European value here, a known,
 * accepted simplification of this rewrite (not a hidden one).
 *
 * Greeks are the exact closed-form derivatives (not bump-and-reprice
 * finite differences, which quietly biased every per-strike figure by the
 * bump width). Sign/scale conventions are unchanged: per-1-vol-point
 * vega/vanna, per-calendar-day theta/charm.
 *
 * GAMMA carries one exception: a 4-trading-hour minimum-T floor, applied
 * only inside the gamma term (see GAMMA_MIN_T_YEARS below). Raw closed-form
 * gamma at a 0DTE contract's real T (often under an hour late in the day)
 * collapses toward a near-Dirac spike at the money - confirmed directly
 * against a live vendor $-GEX-by-strike table: with the real T, dollar GEX
 * at strikes even $10-15 from spot fell to ~1e-9 despite real, large OI
 * sitting there, while the vendor's own table showed multi-million-dollar
 * walls at exactly those strikes. A real dealer book can't rebalance with
 * infinite precision in the literal final minutes, so instantaneous gamma
 * that close to expiry isn't the tradeable/charted profile any terminal
 * actually shows - the floor widens the peak back to a realistic
 * multi-strike spread without touching price/delta/theta/vega/vanna/charm.
 */

export interface PricerInputs {
  spot: number;
  strike: number;
  /** Years to expiry - fractional, from dte_hours where available. */
  T: number;
  vol: number;
  /** Continuously-compounded risk-free rate. */
  r: number;
  /** Continuous dividend yield (approximation for discrete cash dividends). */
  q: number;
  isCall: boolean;
}

function normPdf(z: number): number {
  return Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
}

function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

/** European Black-Scholes price. */
export function bsPrice(inputs: PricerInputs): number {
  const { spot, strike, T, vol, r, q, isCall } = inputs;

  if (T <= 0 || vol <= 0) {
    return isCall ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r - q + (vol * vol) / 2) * T) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;

  if (isCall) {
    return spot * Math.exp(-q * T) * normCdf(d1) - strike * Math.exp(-r * T) * normCdf(d2);
  }
  return strike * Math.exp(-r * T) * normCdf(-d2) - spot * Math.exp(-q * T) * normCdf(-d1);
}

/** Minimum T fed to the gamma term only - see the module docstring for why. Exported so alternative gamma models (e.g. gammaEngine's Corrado-Su tail-aware pricer) can apply the SAME floor - a consensus across models is only meaningful if they share the T treatment. */
export const GAMMA_MIN_T_YEARS = 4 / 24 / 365;

/** Closed-form gamma - exact at any T, no finite-difference bump size to get wrong - with the stated minimum-T floor applied only here. */
export function bsGamma(inputs: PricerInputs): number {
  if (inputs.T <= 0 || inputs.vol <= 0) return 0;
  const { spot, strike, vol, r, q } = inputs;
  const T = Math.max(inputs.T, GAMMA_MIN_T_YEARS);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r - q + (vol * vol) / 2) * T) / (vol * sqrtT);
  return (Math.exp(-q * T) * normPdf(d1)) / (spot * vol * sqrtT);
}

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number; // per calendar day
  vega: number; // per 1 vol point (0.01)
  vanna: number; // d(delta)/d(vol), per 1 vol point
  charm: number; // d(delta)/dT, per calendar day
}

/**
 * Exact closed-form Greeks (Haug / standard generalized-BS derivatives with
 * continuous dividend yield). The former bump-and-reprice version's fixed
 * ~0.5%-of-spot and 1-vol-point bump widths quietly smeared every figure on
 * short-dated contracts - a 0DTE delta kink or gamma peak can be narrower
 * than the bump window itself. Conventions preserved exactly: theta and
 * charm are per CALENDAR DAY (d/dt forward, so theta is negative for a
 * decaying long option), vega and vanna are per 1 vol point (0.01).
 */
export function bsGreeks(inputs: PricerInputs): Greeks {
  const { spot, strike, T, vol, r, q, isCall } = inputs;
  const price = bsPrice(inputs);

  if (T <= 0 || vol <= 0) {
    // Expired/degenerate: intrinsic value, step-function delta, all higher-order Greeks dead.
    const itm = isCall ? spot > strike : spot < strike;
    return { price, delta: itm ? (isCall ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, vanna: 0, charm: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r - q + (vol * vol) / 2) * T) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);
  const pdf1 = normPdf(d1);

  const delta = isCall ? eqT * normCdf(d1) : eqT * (normCdf(d1) - 1);
  const gamma = bsGamma(inputs); // floored T, see bsGamma
  const vega = spot * eqT * pdf1 * sqrtT * 0.01; // per 1 vol point

  // dV/dt (calendar time moving forward), per day - negative for a decaying long option.
  const thetaYear = isCall
    ? (-spot * eqT * pdf1 * vol) / (2 * sqrtT) - r * strike * erT * normCdf(d2) + q * spot * eqT * normCdf(d1)
    : (-spot * eqT * pdf1 * vol) / (2 * sqrtT) + r * strike * erT * normCdf(-d2) - q * spot * eqT * normCdf(-d1);
  const theta = thetaYear / 365;

  const vanna = -eqT * pdf1 * (d2 / vol) * 0.01; // d(delta)/d(vol), per 1 vol point

  // d(delta)/dt (calendar time moving forward), per day.
  const charmCommon = -eqT * pdf1 * ((2 * (r - q) * T - d2 * vol * sqrtT) / (2 * T * vol * sqrtT));
  const charmYear = isCall ? charmCommon + q * eqT * normCdf(d1) : charmCommon - q * eqT * normCdf(-d1);
  const charm = charmYear / 365;

  return { price, delta, gamma, theta, vega, vanna, charm };
}

/** Delta only - closed form, same value bsGreeks reports - for scanning a grid of hypothetical spot/time/vol scenarios where only delta (to sum into total hedge shares) is needed, not the full Greek set. */
export function bsDelta(inputs: PricerInputs): number {
  const { spot, strike, T, vol, r, q, isCall } = inputs;
  if (T <= 0 || vol <= 0) {
    const itm = isCall ? spot > strike : spot < strike;
    return itm ? (isCall ? 1 : -1) : 0;
  }
  const d1 = (Math.log(spot / strike) + (r - q + (vol * vol) / 2) * T) / (vol * Math.sqrt(T));
  return isCall ? Math.exp(-q * T) * normCdf(d1) : Math.exp(-q * T) * (normCdf(d1) - 1);
}

/** Standard dollar-exposure convention: Greek x OI x contract multiplier x scale. Matches the industry GEX/DEX convention (Γ·OI·M·S²·0.01, Δ·OI·M·S). */
export function dollarGex(gamma: number, oi: number, spot: number, multiplier = 100): number {
  return gamma * oi * multiplier * spot * spot * 0.01;
}

export function dollarDex(delta: number, oi: number, spot: number, multiplier = 100): number {
  return delta * oi * multiplier * spot;
}

export function dollarVanna(vanna: number, oi: number, spot: number, multiplier = 100): number {
  return vanna * oi * multiplier * spot;
}

export function dollarCharm(charm: number, oi: number, spot: number, multiplier = 100): number {
  return charm * oi * multiplier * spot;
}

export function dollarVega(vega: number, oi: number, multiplier = 100): number {
  return vega * oi * multiplier;
}

export function dollarTheta(theta: number, oi: number, multiplier = 100): number {
  return theta * oi * multiplier;
}
