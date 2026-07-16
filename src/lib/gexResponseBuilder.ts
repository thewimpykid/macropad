/** Builds a full GexResponse from a fetched Y3Core (front book) plus whatever Chart/Heatmap/Topo column books are on hand - shared by the synchronous bootstrap path and the background refresh step in gexStore.ts, so both produce byte-identical shapes. */

import { deriveGexResponse, type GexResponse, type GexSymbol, type IvSmilePoint, type ProbabilityStats } from "@/lib/gex";
import { fitSvi, sviImpliedVol, type SviPoint } from "@/lib/svi";
import { computeGexPageAnalytics } from "@/lib/gexAnalytics";
import { computeGammaEngine, computeIvSurfaceFitError } from "@/lib/gammaEngine";
import { computeDeltaEngine } from "@/lib/deltaEngine";
import { computeThetaEngine } from "@/lib/thetaEngine";
import { computeVannaEngine } from "@/lib/vannaEngine";
import { computeCharmEngine } from "@/lib/charmEngine";
import { computeEffectiveGex } from "@/lib/effectiveGexEngine";
import { buildTopoProfile, topoTenorLabels } from "@/lib/topoProfile";
import { buildY3osHeatmapGrids, type ColumnBook, type Y3Core } from "@/lib/y3osFeed";

const EMPTY_PROBABILITY: ProbabilityStats = { muDailyPct: 0, sigmaDailyPct: 0, skewness: 0, excessKurtosis: 0, fatTails: false, nDays: 0, bands1d: {} };

export function buildGexResponse(symbol: GexSymbol, core: Y3Core, columns: ColumnBook[], movePctOverride?: number): GexResponse {
  const { spot, forward, r, q, T, dteHours, resolvedExpiry, atmIv, chain: rawChain, perStrike, maxPain, crossExpiry, zeroDte } = core;

  const sviPoints: SviPoint[] = rawChain
    .filter((row) => row.iv > 0)
    .map((row) => ({ k: Math.log(row.strike / forward), w: row.iv * row.iv * T, weight: Math.max(1, row.oi) }));
  const sviParams = fitSvi(sviPoints);
  const chain = rawChain.map((row) => ({ ...row, iv: row.iv > 0 ? sviImpliedVol(sviParams, row.strike, forward, T) : 0 }));

  const ivSmileByStrike = new Map<number, { call?: number; put?: number }>();
  for (const row of rawChain) {
    if (row.oi <= 0 || row.iv <= 0) continue;
    const entry = ivSmileByStrike.get(row.strike) ?? {};
    entry[row.side] = row.iv;
    ivSmileByStrike.set(row.strike, entry);
  }
  const ivSmile: IvSmilePoint[] = [...ivSmileByStrike.entries()]
    .map(([strike, { call, put }]) => ({ strike, callIv: call ?? null, putIv: put ?? null, fittedIv: sviImpliedVol(sviParams, strike, forward, T) }))
    .sort((a, b) => a.strike - b.strike);

  const response = deriveGexResponse({
    symbol,
    spot,
    resolvedExpiry,
    dteHours,
    perStrike,
    maxPain,
    probability: EMPTY_PROBABILITY,
    dealerFlow: null,
    crossExpiry,
    zeroDte,
    pricerInputs: { r, q },
  });

  response.atmIv = atmIv;
  response.ivSmile = ivSmile;

  const validContracts = chain.filter((row) => row.oi > 0 && row.iv > 0).length;
  const invalidContracts = rawChain.filter((row) => !(row.oi > 0 && row.iv > 0)).length;

  response.gexPage = computeGexPageAnalytics({
    chain,
    perStrike,
    spot,
    r,
    q,
    dteHours,
    atmIv,
    expectedMove1s: zeroDte.expectedMove1s,
    callWall: response.callWall,
    putWall: response.putWall,
    totalGex0dte: response.totalGex0dte,
    crossExpiry,
    recentVolume5m: null,
    sviParams,
    forward,
  });

  response.gammaEngine = computeGammaEngine({
    symbol,
    chain,
    perStrike,
    spot,
    r,
    q,
    dteHours,
    atmIv,
    expectedMove1s: zeroDte.expectedMove1s,
    callWall: response.callWall,
    putWall: response.putWall,
    totalGex0dte: response.totalGex0dte,
    crossExpiry,
    recentVolume5m: null,
    sviParams,
    forward,
    skew: response.gexPage.impliedMoments.skewness,
    kurtExcess: response.gexPage.impliedMoments.excessKurtosis,
    flowImbalance: null,
    validContracts,
    ivSurfaceFitError: computeIvSurfaceFitError(rawChain, sviParams, forward, T),
    pricerEngineLabel: "Vendor-computed per-strike greeks (y3os /greeks, real OI/IV) for GEX/DEX/VEX/CEX/TEX/VEGAEX; this app's own Black-Scholes reprice only for the Effective GEX/Shadow Gamma scenario tables",
  });

  response.deltaEngine = computeDeltaEngine({
    symbol,
    chain,
    perStrike,
    spot,
    r,
    q,
    dteHours,
    atmIv,
    expectedMove1s: zeroDte.expectedMove1s,
    crossExpiry,
    recentVolume5m: null,
    recentVolume15m: null,
    recentVolume30m: null,
    sviParams,
    forward,
    flowImbalance: null,
    netGexSign: Math.sign(response.totalGex0dte),
    validContracts,
    invalidContracts,
  });

  response.thetaEngine = computeThetaEngine({
    symbol,
    chain,
    perStrike,
    spot,
    r,
    q,
    dteHours,
    expectedMove1s: zeroDte.expectedMove1s,
    crossExpiry,
    thetaHeatmap: null,
    flowImbalance: null,
    validContracts,
  });

  response.vannaEngine = computeVannaEngine({
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
    vannaSurfacePoints: [],
    recentVolume5m: null,
    recentVolume15m: null,
    flowImbalance: null,
    netGexSign: Math.sign(response.totalGex0dte),
    validContracts,
    invalidContracts,
  });

  response.charmEngine = computeCharmEngine({
    symbol,
    chain,
    perStrike,
    spot,
    r,
    q,
    dteHours,
    forward,
    sviParams,
    charmSurfacePoints: [],
    expectedMove1s: zeroDte.expectedMove1s,
    recentVolume5m: null,
    recentVolume15m: null,
    flowImbalance: null,
    netGexSign: Math.sign(response.totalGex0dte),
    validContracts,
    invalidContracts,
  });

  const heatmapGrids = buildY3osHeatmapGrids(columns);
  response.strikeExpiryHeatmaps = heatmapGrids;
  response.topo = buildTopoProfile(heatmapGrids, spot);
  response.topoTenorLabels = topoTenorLabels(heatmapGrids);

  const sortedStrikes = [...new Set(perStrike.map((row) => row.strike))].sort((a, b) => a - b);
  const strikeGaps = sortedStrikes.slice(1).map((s, i) => s - sortedStrikes[i]).filter((g) => g > 0).sort((a, b) => a - b);
  const strikeInterval = strikeGaps.length ? strikeGaps[Math.floor(strikeGaps.length / 2)] : 1;
  const autoMovePct = Math.min(0.5, (strikeInterval * 15) / spot);
  const scenarioMovePct = movePctOverride !== undefined && movePctOverride > 0 ? Math.min(0.5, movePctOverride / 100) : autoMovePct;

  response.effectiveGex = computeEffectiveGex({
    chain,
    perStrike,
    spot,
    T,
    r,
    q,
    sviParams,
    forward,
    moveUpPct: scenarioMovePct,
    moveDownPct: scenarioMovePct,
  });

  return response;
}
