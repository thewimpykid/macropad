/**
 * AI Prompt - turns the current GexResponse into copy-pasteable prompts for
 * an external LLM (ChatGPT etc). This app already computes the analysis
 * (gamma/delta/vanna/charm/theta engines, effective GEX, shadow gamma) - the
 * point of this feature isn't to re-derive anything, it's to hand a general
 * LLM the SAME real numbers this app's own UI is built from, in one dense,
 * labeled block, so a second model can reason over the identical data
 * instead of a screenshot or a vague description.
 *
 * Three prompts, not one: a single "master" dump is thorough but can bury
 * the actual question inside a wall of numbers. MASTER is the full context
 * dump for open-ended analysis; QUICK_BIAS and HEDGE_CLIFF are narrower,
 * faster reads for a specific question, at the cost of leaving most of the
 * data out on purpose.
 */

import type { GexResponse } from "@/lib/gex";
import { fmtNum, fmtUsd } from "@/lib/gex";

function phaseBlock(label: string, hero: string | undefined, phase: { label: string; interpretation: string; tradingImplication?: string } | undefined) {
  if (!hero || !phase) return `${label}: unavailable this request.`;
  const implication = phase.tradingImplication ? `\nTrading implication: ${phase.tradingImplication}` : "";
  return `${label}\n${hero}\nPhase: ${phase.label}\nInterpretation: ${phase.interpretation}${implication}`;
}

function snapshotBlock(data: GexResponse): string {
  const grossGex = data.perStrike.reduce((s, r) => s + Math.abs(r.gex), 0);
  return `SYMBOL: ${data.symbol}
SPOT: $${fmtNum(data.spot, 2)}
0DTE EXPIRY: ${data.resolvedExpiry} (${fmtNum(data.dteHours, 2)} hours remaining)
ATM IV: ${data.atmIv !== undefined ? `${(data.atmIv * 100).toFixed(1)}%` : "unavailable"}
AS OF: ${new Date(data.asOf).toISOString()}

KEY LEVELS (self-computed 0DTE Black-Scholes on each contract's own live quoted IV/OI - not a black box):
  Call Wall: ${fmtNum(data.callWall, 2)}
  Put Wall: ${fmtNum(data.putWall, 2)}
  Max Pain (source API, not confirmed 0DTE-pure): ${fmtNum(data.maxPain, 2)}
  Gamma Flip: ${data.gammaFlip !== null ? fmtNum(data.gammaFlip, 2) : "none found"}
  King Node: strike ${fmtNum(data.kingNode.strike, 2)}, ${fmtUsd(data.kingNode.gex)} (${data.kingNode.type})
  Net GEX (0DTE): ${fmtUsd(data.totalGex0dte)}
  Gross GEX (0DTE, sum of |GEX| across all strikes): ${fmtUsd(grossGex)}`;
}

function dealerFlowBlock(data: GexResponse): string {
  if (!data.dealerFlow) return "DEALER FLOW: unavailable this request.";
  const f = data.dealerFlow;
  return `DEALER FLOW (source's own anomaly detector):
  Current Z-score: ${f.currentZ.toFixed(2)} (threshold ${f.zThreshold})
  Buy count: ${f.buyCount} / Sell count: ${f.sellCount}
  Imbalance flag: ${f.imbalance}`;
}

function zeroDteBlock(data: GexResponse): string {
  if (!data.zeroDte) return "0DTE CONTEXT: unavailable this request.";
  const z = data.zeroDte;
  return `0DTE CONTEXT:
  Expected move: ±${fmtNum(z.expectedMove1s, 2)} (1sigma), ±${fmtNum(z.expectedMove2s, 2)} (2sigma)
  Put/Call ratio: ${z.pcRatio.toFixed(2)} (${z.pcSentiment})
  Charm direction: ${z.charmDirection} — ${z.charmNote}
  Vanna direction: ${z.vannaDirection} — ${z.vannaNote}`;
}

function probabilityBlock(data: GexResponse): string {
  const p = data.probability;
  const bands = Object.entries(p.bands1d)
    .map(([k, v]) => `${k}%: [${fmtNum(v[0], 2)}, ${fmtNum(v[1], 2)}]`)
    .join(", ");
  return `PROBABILITY (real historical daily-return stats, ${p.nDays} trading days):
  Mean daily return: ${p.muDailyPct.toFixed(3)}%, Std dev: ${p.sigmaDailyPct.toFixed(3)}%
  Skewness: ${p.skewness.toFixed(2)}, Excess kurtosis: ${p.excessKurtosis.toFixed(2)} (fat tails: ${p.fatTails ? "yes" : "no"})
  1-day confidence bands: ${bands || "unavailable"}`;
}

function effectiveGexTable(data: GexResponse, count: number): string {
  if (!data.effectiveGex || !data.effectiveGex.rows.length) return "EFFECTIVE GEX: unavailable this request.";
  const rows = [...data.effectiveGex.rows].sort((a, b) => Math.abs(a.strike - data.spot) - Math.abs(b.strike - data.spot)).slice(0, count).sort((a, b) => a.strike - b.strike);
  const header = `EFFECTIVE GEX (full delta reprice at scenario spot +/-${(data.effectiveGex.moveUpPct * 100).toFixed(1)}%, real $ from this app's own 0DTE chain - NOT a linear gamma-x-move estimate):
  Strike | Static GEX (today's gamma, fixed move) | Up scenario | Down scenario | Acceleration (how much bigger the effective move is than static)`;
  const lines = rows.map(
    (r) => `  ${fmtNum(r.strike, 0)} | ${fmtUsd(r.staticGex)} | ${fmtUsd(r.upEffective)} | ${fmtUsd(r.downEffective)} | ${r.acceleration.toFixed(2)}x`
  );
  return [header, ...lines].join("\n");
}

function shadowGammaTable(data: GexResponse, count: number): string {
  if (!data.effectiveGex || !data.effectiveGex.rows.length) return "SHADOW GAMMA: unavailable this request.";
  const rows = [...data.effectiveGex.rows].sort((a, b) => Math.abs(a.strike - data.spot) - Math.abs(b.strike - data.spot)).slice(0, count).sort((a, b) => a.strike - b.strike);
  const header = "SHADOW GAMMA (the slice of the effective move caused specifically by the vol surface shifting with spot - vanna - isolated from pure gamma):\n  Strike | Shadow Up | Shadow Down";
  const lines = rows.map((r) => `  ${fmtNum(r.strike, 0)} | ${fmtUsd(r.shadowGammaUp)} | ${fmtUsd(r.shadowGammaDown)}`);
  return [header, ...lines].join("\n");
}

function crossExpiryTable(data: GexResponse): string {
  if (!data.crossExpiry.length) return "CROSS-EXPIRY: unavailable this request.";
  const header = "CROSS-EXPIRY (source's own multi-expiry table, no OI weighting applied by this app):\n  Expiry | DTE | Net GEX | Call Resistance | Put Support | Total OI";
  const lines = data.crossExpiry
    .slice(0, 8)
    .map((r) => `  ${r.expiration} | ${r.dte} | ${fmtUsd(r.netGex)} | ${r.callResistance !== null ? fmtNum(r.callResistance, 2) : "-"} | ${r.putSupport !== null ? fmtNum(r.putSupport, 2) : "-"} | ${fmtNum(r.totalOi, 0)}`);
  return [header, ...lines].join("\n");
}

export function buildMasterPrompt(data: GexResponse): string {
  return `You are an expert options market-maker/dealer-positioning analyst. Below is a complete, real, live snapshot of ${data.symbol}'s 0DTE options dealer positioning, pulled directly from a live options-flow terminal - every figure is real market data or a value this app itself computed from real per-contract data, not a hypothetical. Use ALL of the data below together (don't just look at one section) to reason about likely dealer hedging behavior for the rest of today's session.

${snapshotBlock(data)}

${phaseBlock("GAMMA REGIME", data.gammaEngine?.heroStatement, data.gammaEngine?.phase)}

${phaseBlock("DELTA / DEALER INVENTORY", data.deltaEngine?.heroStatement, data.deltaEngine?.phase)}

${phaseBlock("VANNA (IV-shock hedge flow)", data.vannaEngine?.heroStatement, data.vannaEngine?.phase)}

${phaseBlock("CHARM (time-decay hedge flow)", data.charmEngine?.heroStatement, data.charmEngine?.phase)}

${phaseBlock("THETA (decay regime)", data.thetaEngine?.heroStatement, data.thetaEngine?.phase)}

${dealerFlowBlock(data)}

${zeroDteBlock(data)}

${probabilityBlock(data)}

${effectiveGexTable(data, 15)}

${shadowGammaTable(data, 15)}

${crossExpiryTable(data)}

METHODOLOGY NOTES (read before answering):
- Dealer sign (call=+1/put=-1) is an assumed industry convention, not observed per-trade positioning - open interest alone can't say who's actually long or short.
- Effective GEX/Shadow Gamma use a full delta reprice under a surface-consistent (sticky-moneyness) IV smile, not a linear gamma-x-move estimate - they capture how gamma and the vol surface itself change as spot moves.
- Cross-expiry figures are the source API's own raw numbers, not recomputed by this app.

TASK: Using everything above, give me:
1. Your directional bias for the rest of today's session and why.
2. The 2-3 key strikes to watch, and what would happen if spot reaches each one (pin, reversal, acceleration).
3. The most likely pinning/reversal scenario into today's close.
4. Where a gamma cliff / violent move is most likely, using the Effective GEX acceleration column and Shadow Gamma.
5. Your confidence level and what specific data point would change your mind.`;
}

export function buildQuickBiasPrompt(data: GexResponse): string {
  return `You are a 0DTE options dealer-positioning analyst. Give me a quick, one-paragraph directional bias read using this live snapshot of ${data.symbol}:

${snapshotBlock(data)}

${phaseBlock("GAMMA REGIME", data.gammaEngine?.heroStatement, data.gammaEngine?.phase)}

${zeroDteBlock(data)}

TASK: In one short paragraph, tell me: is dealer positioning stabilizing or destabilizing right now, which direction has less resistance, and the single most important strike to watch into the close. Be direct, not hedgy - give me your actual read, not a list of possibilities.`;
}

export function buildKeyLevelsPrompt(data: GexResponse): string {
  return `You are a 0DTE options key-levels analyst. Use this real data from ${data.symbol} to explain what today's structurally important strikes actually mean:

${snapshotBlock(data)}

${effectiveGexTable(data, 15)}

METHODOLOGY: Call Wall/Put Wall/King Node/Gamma Flip are computed from this app's own self-computed 0DTE Black-Scholes gamma on each contract's live quoted IV/OI, not a source-side black box. Gamma Flip is the strike where net dealer gamma crosses zero (long-gamma/pinning above it, short-gamma/volatile below it, or vice versa - state which way for this snapshot). The Effective GEX table shows how each nearby strike's exposure actually reprices under a real scenario move, not just today's static gamma.

TASK: Using the key levels and the effective GEX table together, tell me:
1. What Call Wall, Put Wall, Gamma Flip, King Node and Max Pain each mean for today's session individually.
2. Which of these levels are reinforcing each other (pointing to the same zone) vs conflicting.
3. The single most important level to watch right now and why.
4. What changes about the picture if spot crosses Gamma Flip.`;
}

export interface PromptDef {
  id: "master" | "quickbias" | "keylevels";
  label: string;
  description: string;
  build: (data: GexResponse) => string;
}

export const PROMPTS: PromptDef[] = [
  { id: "master", label: "MASTER", description: "Full context dump - every section, for open-ended analysis.", build: buildMasterPrompt },
  { id: "quickbias", label: "QUICK BIAS", description: "Condensed - fast directional read only.", build: buildQuickBiasPrompt },
  { id: "keylevels", label: "KEY LEVELS", description: "Call Wall/Put Wall/Gamma Flip/King Node - what today's structural levels mean.", build: buildKeyLevelsPrompt },
];
