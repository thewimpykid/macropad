/**
 * Raw SVI (Gatheral) single-expiry implied-volatility slice fit.
 *
 * We only ever price one expiry slice at a time (the 0DTE book), so this is
 * single-slice SVI, not a full multi-expiry SSVI surface - stated
 * explicitly, not implied. Raw per-contract IV is noisy (bid/ask spread,
 * stale quotes, thin strikes); SVI fits a smooth, standard 5-parameter
 * curve through it in total-variance/log-moneyness space before any IV
 * reaches the pricer, so a single noisy quote can't swing that strike's
 * Greeks on its own.
 *
 * w(k) = a + b*(rho*(k-m) + sqrt((k-m)^2 + sigma^2))
 * where k = ln(K/F) (log-moneyness vs forward) and w = IV^2 * T (total variance).
 */

export interface SviParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export function sviTotalVariance(p: SviParams, k: number): number {
  const dk = k - p.m;
  return p.a + p.b * (p.rho * dk + Math.sqrt(dk * dk + p.sigma * p.sigma));
}

export interface SviPoint {
  k: number; // log-moneyness
  w: number; // observed total variance (iv^2 * T)
  weight: number; // e.g. OI-based, so liquid strikes pull the fit harder
}

function sse(params: SviParams, points: SviPoint[]): number {
  let sum = 0;
  for (const pt of points) {
    const model = sviTotalVariance(params, pt.k);
    const residual = model - pt.w;
    sum += pt.weight * residual * residual;
  }
  return sum;
}

/**
 * Nelder-Mead simplex minimization - no external optimization library needed
 * for a 5-parameter fit. stepSizes controls the initial simplex spread per
 * parameter - defaulting to "10% of x0, or 0.1 if x0 is ~0" silently breaks
 * on parameters whose natural scale isn't near 1 (e.g. SVI's m/sigma for
 * 0DTE strikes, where the real log-moneyness range can be +-0.03 - a fixed
 * 0.1 step is 3x the entire data range and the optimizer barely moves).
 */
function nelderMead(objective: (x: number[]) => number, x0: number[], stepSizes: number[], iterations = 400): number[] {
  const n = x0.length;
  const alpha = 1,
    gamma = 2,
    rho = 0.5,
    sigma = 0.5;

  let simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const point = x0.slice();
    point[i] += stepSizes[i];
    simplex.push(point);
  }

  for (let iter = 0; iter < iterations; iter++) {
    simplex.sort((a, b) => objective(a) - objective(b));
    const best = simplex[0];
    const worst = simplex[n];
    const secondWorst = simplex[n - 1];

    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    }

    const reflected = centroid.map((c, j) => c + alpha * (c - worst[j]));
    const reflectedScore = objective(reflected);

    if (reflectedScore < objective(best)) {
      const expanded = centroid.map((c, j) => c + gamma * (reflected[j] - c));
      simplex[n] = objective(expanded) < reflectedScore ? expanded : reflected;
    } else if (reflectedScore < objective(secondWorst)) {
      simplex[n] = reflected;
    } else {
      const contracted = centroid.map((c, j) => c + rho * (worst[j] - c));
      if (objective(contracted) < objective(worst)) {
        simplex[n] = contracted;
      } else {
        simplex = simplex.map((point, i) => (i === 0 ? point : best.map((b, j) => b + sigma * (point[j] - b))));
      }
    }
  }

  simplex.sort((a, b) => objective(a) - objective(b));
  return simplex[0];
}

/** Fits raw SVI to a set of (log-moneyness, total-variance) points. Falls back to the flat-variance average if fewer than 5 points (can't identify 5 params from less data). */
export function fitSvi(points: SviPoint[]): SviParams {
  const validPoints = points.filter((p) => Number.isFinite(p.w) && p.w > 0);
  if (validPoints.length < 5) {
    const avgW = validPoints.reduce((s, p) => s + p.w, 0) / Math.max(1, validPoints.length);
    return { a: avgW || 0.01, b: 0, rho: 0, m: 0, sigma: 0.1 };
  }

  const avgW = validPoints.reduce((s, p) => s + p.w, 0) / validPoints.length;

  // sigma/m must be scaled to this data's own log-moneyness range, not a
  // fixed guess - 0DTE strikes cluster within a few % of spot (k range as
  // narrow as +-0.03), and a sigma=0.1 starting guess (appropriate for a
  // multi-week surface) swamps sqrt((k-m)^2+sigma^2) with sigma^2 regardless
  // of k, degenerating the fit to a flat curve. Caught exactly this: a real
  // fit against live 0DTE data returned identical IV at three different
  // strikes before this fix.
  const ks = validPoints.map((p) => p.k);
  const kMin = Math.min(...ks);
  const kMax = Math.max(...ks);
  const kRange = Math.max(1e-4, kMax - kMin);
  const kMean = ks.reduce((s, k) => s + k, 0) / ks.length;

  const objective = (x: number[]) => {
    const [a, b, rho, m, sigma] = x;
    if (b < 0 || Math.abs(rho) >= 1 || sigma <= 0) return Number.POSITIVE_INFINITY; // keep the fit in the parameter region that defines a valid variance curve
    // Gatheral positivity: min total variance is a + b*sigma*sqrt(1-rho^2).
    // Without this, `a` can converge negative and the slice dips below zero
    // away from the data - sviImpliedVol's 1e-8 clamp then feeds near-zero
    // IV into every consumer that evaluates the extrapolated wings.
    if (a + b * sigma * Math.sqrt(1 - rho * rho) < 0) return Number.POSITIVE_INFINITY;
    return sse({ a, b, rho, m, sigma }, validPoints);
  };

  const stepSizes = [avgW * 0.5 || 1e-6, avgW * 0.5 || 1e-6, 0.1, kRange * 0.25 || 1e-3, kRange * 0.25 || 1e-3];

  // Multi-start: a single Nelder-Mead run can settle into a bad local
  // minimum (caught exactly this against live 0DTE data - one starting
  // guess converged to a nearly-flat curve that ignored the real smile
  // shape entirely). Several starting guesses spanning plausible rho/curve
  // combinations, keep whichever converges to the lowest SSE.
  const startingGuesses = [-0.7, -0.3, 0, 0.3, 0.7].map((rho0) => [avgW * 0.5, avgW * 0.5, rho0, kMean, kRange / 4]);
  let bestParams: SviParams | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const guess of startingGuesses) {
    const [a, b, rho, m, sigma] = nelderMead(objective, guess, stepSizes);
    const candidate: SviParams = { a, b: Math.max(0, b), rho: Math.max(-0.999, Math.min(0.999, rho)), m, sigma: Math.max(1e-4, sigma) };
    // Re-check positivity on the CLAMPED candidate - clamping b/rho/sigma can move it out of the region the objective enforced.
    if (candidate.a + candidate.b * candidate.sigma * Math.sqrt(1 - candidate.rho * candidate.rho) < 0) continue;
    const score = sse(candidate, validPoints);
    if (score < bestScore) {
      bestScore = score;
      bestParams = candidate;
    }
  }

  // Every start converged outside the valid region - fall back to the flat-variance slice rather than returning an arbitrage-violating fit.
  return bestParams ?? { a: avgW || 0.01, b: 0, rho: 0, m: 0, sigma: 0.1 };
}

/** Smoothed IV at a given strike, from a fitted SVI slice. */
export function sviImpliedVol(params: SviParams, strike: number, forward: number, T: number): number {
  const k = Math.log(strike / forward);
  const w = Math.max(1e-8, sviTotalVariance(params, k));
  return Math.sqrt(w / T);
}
