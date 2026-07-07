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
};

const BEARISH: Record<string, number> = {
  plunge: 2, plunges: 2, plunging: 2, crash: 2.5, crashes: 2.5, crashing: 2.5, tumble: 2, tumbles: 2, tumbling: 2,
  slump: 1.5, slumps: 1.5, sink: 1.5, sinks: 1.5, sinking: 1.5, drop: 1, drops: 1, dropped: 1,
  fall: 1, falls: 1, falling: 1, fell: 1, decline: 1, declines: 1, slide: 1, slides: 1, sliding: 1,
  miss: 1.5, misses: 1.5, missed: 1.5, downgrade: 1.5, downgrades: 1.5, underperform: 1.5,
  bearish: 2, pessimism: 1.5, pessimistic: 1.5, recession: 2, contraction: 1.5, slowdown: 1.5, slows: 1,
  fear: 1.5, fears: 1.5, worry: 1, worries: 1, worried: 1, panic: 2, selloff: 2, "sell-off": 2,
  crisis: 2, turmoil: 2, risk: 0.5, risks: 0.5, warns: 1, warning: 1, warn: 1, cautious: 0.8, caution: 0.8,
  hike: 0.8, hikes: 0.8, hawkish: 1.2, tighten: 1, tightening: 1, inflation: 0.3, layoffs: 1.5, layoff: 1.5,
  default: 2, bankruptcy: 2, war: 1.5, conflict: 1, escalation: 1.5, escalates: 1.5, tariff: 1, tariffs: 1,
  shortage: 1, shutdown: 1.5, low: 0.3, lows: 0.3, weak: 1, weakness: 1, weakens: 1, plummet: 2.5, plummets: 2.5,
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
    const word = tokens[i];
    const bull = BULLISH[word];
    const bear = BEARISH[word];
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
  }

  const score = Math.max(-1, Math.min(1, raw / 4)); // squash to -1..1, 4 pts ~= strong single-headline signal
  const label: SentimentResult["label"] = score > 0.15 ? "bullish" : score < -0.15 ? "bearish" : "neutral";

  return { score, label, matchedWords: matched };
}
