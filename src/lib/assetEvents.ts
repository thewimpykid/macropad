import { impactsForSymbol } from "@/lib/markets";
import { getSignalConfig } from "@/lib/indicatorSignal";
import { distanceSignal, type HistPoint } from "@/lib/stats";
import type { ExtraStat } from "@/lib/macroData";

/** Minimal shape this needs from an already-computed refresh row, not the DB row type directly. */
export interface IndicatorRow {
  id: string;
  name: string;
  value: string;
  zscore: number | null;
  history?: HistPoint[] | null;
  extra_stats?: ExtraStat[] | null;
  source: string;
}

export interface AssetEvent {
  title: string;
  link: string | null;
  pubDate: string | null;
  source: string;
  sentimentScore: number;
  sentimentLabel: "bullish" | "bearish" | "neutral";
  kind: "indicator" | "metric";
  description: string;
}

function labelFor(score: number): "bullish" | "bearish" | "neutral" {
  return score > 0.1 ? "bullish" : score < -0.1 ? "bearish" : "neutral";
}

function clamp(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

/**
 * Per-point score for a historical reading. Anchor/threshold methods are
 * cheap to recompute exactly (distance from a fixed reference), so those get
 * a real historical score. Momentum/positioning need the surrounding window
 * to recompute properly, which isn't worth doing per point here, so those
 * fall back to the indicator's current overall score as an approximation.
 */
function scoreAtPoint(row: IndicatorRow, sign: 1 | -1, pointValue: number): number {
  const config = getSignalConfig(row.id);
  if (config && (config.method === "anchor" || config.method === "threshold")) {
    return clamp(distanceSignal(pointValue, config.reference ?? 0, config.band ?? 1) * sign);
  }
  return row.zscore === null ? 0 : clamp(row.zscore * sign);
}

/**
 * Builds real, dated events for an asset straight from the same FRED/CFTC
 * data and impact model that drives the rest of the app, instead of trying
 * to guess sentiment from scraped article text. Every tracked asset has a
 * defined set of indicators that move it (see markets.ts IMPACTS), so this
 * guarantees baseline coverage for every asset regardless of how much news
 * happens to be in an RSS feed that day. Historical points come from the
 * indicator's own real history, so a "headline" like "CPI Inflation (YoY):
 * 3.10%" is dated to the actual release date it happened on, not scraped.
 */
export function buildAssetIndicatorEvents(symbol: string, rows: IndicatorRow[]): AssetEvent[] {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const impacts = impactsForSymbol(symbol);
  const events: AssetEvent[] = [];

  for (const { seriesId, impact } of impacts) {
    const row = rowById.get(seriesId);
    if (!row || row.zscore === null) continue;

    // Null, never "now", when the indicator has no history to date it to - a
    // fabricated current timestamp would sort this event to the top of the
    // asset feed and hand it maximum recency weight in the sentiment average.
    const latestDate = row.history?.length ? row.history[row.history.length - 1].date : null;
    const currentScore = clamp(row.zscore * impact.sign);
    events.push({
      title: `${row.name}: ${row.value}`,
      link: null,
      pubDate: latestDate,
      source: row.source,
      sentimentScore: currentScore,
      sentimentLabel: labelFor(currentScore),
      kind: "indicator",
      description: impact.rationale,
    });

    // Extra stats (Sahm Rule, COT index, etc) carry their own real caption
    // already written when they were computed, one more event each.
    for (const stat of row.extra_stats ?? []) {
      if (!stat.caption) continue;
      const statScore = stat.zscore !== null && stat.zscore !== undefined ? clamp(stat.zscore * impact.sign) : currentScore;
      events.push({
        title: `${stat.label}: ${stat.value}`,
        link: null,
        pubDate: latestDate,
        source: row.source,
        sentimentScore: statScore,
        sentimentLabel: labelFor(statScore),
        kind: "metric",
        description: stat.caption,
      });
    }

    // A handful of real historical readings from this indicator's actual
    // release dates, so an asset with few linked indicators still gets
    // meaningful depth instead of just one current-state card.
    const hist = row.history ?? [];
    if (hist.length > 8) {
      const samples = 6;
      const stride = Math.max(1, Math.floor((hist.length - 1) / samples));
      for (let i = hist.length - 1 - stride; i >= 0; i -= stride) {
        const point = hist[i];
        const score = scoreAtPoint(row, impact.sign, point.value);
        events.push({
          title: `${row.name}: ${point.value.toFixed(2)}`,
          link: null,
          pubDate: point.date,
          source: row.source,
          sentimentScore: score,
          sentimentLabel: labelFor(score),
          kind: "indicator",
          description: impact.rationale,
        });
      }
    }
  }

  return events;
}
