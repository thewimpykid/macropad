/**
 * Finance-specific keyword-lexicon sentiment scorer. This is a real,
 * inspectable method — not a black box — but it is a keyword counter, not
 * an NLP model: it will misfire on sarcasm, complex negation, and headlines
 * where the bullish/bearish word describes a different asset than the one
 * being asked about. Treat it as a noisy directional signal across many
 * headlines, not a verdict on any single one. Every score is reproducible
 * from the word lists below.
 */

const BULLISH: Record<string, number> = {
  surge: 2, surges: 2, surging: 2, soar: 2, soars: 2, soaring: 2, rally: 2, rallies: 2, rallying: 2,
  jump: 1.5, jumps: 1.5, jumped: 1.5, spike: 1.5, spikes: 1.5, gain: 1, gains: 1, gained: 1,
  rise: 1, rises: 1, rising: 1, climb: 1, climbs: 1, climbing: 1, advance: 1, advances: 1,
  beat: 1.5, beats: 1.5, beating: 1.5, "top estimates": 1.5, outperform: 1.5, upgrade: 1.5, upgrades: 1.5,
  bullish: 2, optimism: 1.5, optimistic: 1.5, boom: 1.5, booming: 1.5, recovery: 1, recovers: 1, rebound: 1.5, rebounds: 1.5,
  cut: 0.8, cuts: 0.8, easing: 1, ease: 1, stimulus: 1, expansion: 1, growth: 0.8, strong: 1, strength: 1,
  record: 0.5, high: 0.3, highs: 0.3, breakthrough: 1, deal: 0.5, agreement: 0.5, resolved: 1, resolve: 1,
  relief: 1, cool: 0.5, cooling: 0.5, cools: 0.5,
  dovish: 1.8, "rate cut": 1.8, "soft landing": 2, disinflation: 1.2, resilient: 1, resilience: 1,
  accelerate: 1, accelerates: 1, accelerating: 1, upbeat: 1.5, robust: 1.2, exceeds: 1.2, exceeded: 1.2,
  tailwind: 1, tailwinds: 1, "rate pause": 0.8, ceasefire: 1.8, truce: 1.5,
  surplus: 1, outpace: 1, outpaces: 1, upgraded: 1.5, "beat expectations": 1.8,
};

const BEARISH: Record<string, number> = {
  plunge: 2.2, plunges: 2.2, plunging: 2.2, crash: 2.8, crashes: 2.8, crashing: 2.8, tumble: 2.2, tumbles: 2.2, tumbling: 2.2,
  slump: 1.8, slumps: 1.8, sink: 1.8, sinks: 1.8, sinking: 1.8, drop: 1.2, drops: 1.2, dropped: 1.2,
  fall: 1.2, falls: 1.2, falling: 1.2, fell: 1.2, decline: 1.2, declines: 1.2, slide: 1.2, slides: 1.2, sliding: 1.2,
  miss: 1.8, misses: 1.8, missed: 1.8, downgrade: 1.8, downgrades: 1.8, underperform: 1.8,
  bearish: 2.2, pessimism: 1.8, pessimistic: 1.8, recession: 2.5, contraction: 1.8, slowdown: 1.8, slows: 1.2,
  fear: 1.8, fears: 1.8, worry: 1.2, worries: 1.2, worried: 1.2, panic: 2.2, selloff: 2.2, "sell-off": 2.2,
  crisis: 2.2, turmoil: 2.2, risk: 0.6, risks: 0.6, warns: 1.2, warning: 1.2, warn: 1.2, cautious: 1, caution: 1,
  hike: 1, hikes: 1, hawkish: 1.5, tighten: 1.2, tightening: 1.2, inflation: 0.4, layoffs: 1.8, layoff: 1.8,
  default: 2.2, bankruptcy: 2.5, war: 1.8, conflict: 1.2, escalation: 1.8, escalates: 1.8, tariff: 1.2, tariffs: 1.2,
  shortage: 1.2, shutdown: 1.8, low: 0.4, lows: 0.4, weak: 1.2, weakness: 1.2, weakens: 1.2, plummet: 2.8, plummets: 2.8,
  strikes: 1.8, strike: 1.5, sanctions: 1.8, sanction: 1.5, standoff: 1.5, invasion: 2.2, attack: 1.8, attacks: 1.8,
  collapse: 2.5, collapses: 2.5, "missed expectations": 1.8, stagflation: 2.2, unemployment: 1, "job cuts": 1.8,
};

const NEGATORS = new Set(["not", "no", "never", "isn't", "wasn't", "doesn't", "didn't", "won't", "n't"]);

export interface SentimentResult {
  score: number; // -1..1
  label: "bullish" | "bearish" | "neutral";
  matchedWords: string[];
}

/** Scores a single headline. Deterministic and reproducible from the lexicon above. */
export function scoreSentiment(text: string): SentimentResult {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let raw = 0;
  const matched: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    // Check the two-word phrase first (e.g. "rate cut", "soft landing") so
    // it isn't swallowed by a unigram match on just one of its words.
    const bigram = i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : null;
    const bigramBull = bigram ? BULLISH[bigram] : undefined;
    const bigramBear = bigram ? BEARISH[bigram] : undefined;

    const word = bigram && (bigramBull !== undefined || bigramBear !== undefined) ? bigram : tokens[i];
    const bull = bigramBull !== undefined ? bigramBull : BULLISH[tokens[i]];
    const bear = bigramBear !== undefined ? bigramBear : BEARISH[tokens[i]];
    if (bull === undefined && bear === undefined) continue;

    // negation: flips sign if one of the 3 preceding tokens is a negator
    const windowStart = Math.max(0, i - 3);
    const negated = tokens.slice(windowStart, i).some((t) => NEGATORS.has(t));

    if (bull !== undefined) {
      raw += negated ? -bull : bull;
      matched.push(negated ? `not ${word}` : word);
    } else if (bear !== undefined) {
      raw -= negated ? -bear : bear;
      matched.push(negated ? `not ${word}` : word);
    }

    if (word === bigram) i++; // consumed both tokens of the phrase
  }

  // Polarize: stretch mid-strength scores outward instead of a flat linear
  // squash, so genuinely mixed headlines cluster near neutral while anything
  // with a real directional lean reads as clearly bullish/bearish. Divisor of
  // 3 (was 4) and exponent of 0.5 (was 0.65) both push harder toward the
  // extremes — a single strong word now saturates most of the range.
  const normalized = Math.max(-1, Math.min(1, raw / 3));
  const score = Math.sign(normalized) * Math.pow(Math.abs(normalized), 0.5);
  const label: SentimentResult["label"] = score > 0.1 ? "bullish" : score < -0.1 ? "bearish" : "neutral";

  return { score, label, matchedWords: matched };
}
