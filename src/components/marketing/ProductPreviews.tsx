import type { MacroPanel, MacroSeries } from "@/lib/macroData";
import { getSignTone } from "@/lib/bias";
import { computeMacroBias } from "@/lib/macroBias";
import { getLandingPanels } from "@/lib/landingData";
import ZScoreBar from "@/components/ZScoreBar";
import TerminalHero, { type HeroIndicator } from "@/components/marketing/TerminalHero";

/*
 * Live vignettes for the landing page. Each one renders a real slice of the
 * terminal from the same cached feed as the regime strip: real values, real
 * scores, real headlines. Nothing here is a mockup, so the marketing page
 * can never drift out of sync with what the product actually shows.
 */

function toneColor(tone: "up" | "down" | "flat"): string {
  return tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text-faint)";
}

function findSeries(panels: MacroPanel[], id: string): MacroSeries | null {
  for (const p of panels) {
    const hit = p.series.find((s) => s.id === id);
    if (hit) return hit;
  }
  return null;
}

function Frame({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="hud border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <span className="partno">{label}</span>
        {note && <span className="font-mono text-[0.62rem] text-[var(--text-faint)]">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Pending() {
  return (
    <div className="px-4 py-8 text-center font-mono text-[0.68rem] text-[var(--text-faint)]">
      AWAITING FIRST SYNC
    </div>
  );
}

/** One board tile, exactly as it renders inside the app. */
function Tile({ s }: { s: MacroSeries }) {
  const tone = getSignTone(s.id, s.zscore);
  const color = toneColor(tone);
  const strong = s.zscore !== null && Math.abs(s.zscore) >= 0.5;
  return (
    <div
      className="flex min-w-0 items-center justify-between gap-2 bg-[var(--bg)] px-3 py-2"
      style={strong ? { boxShadow: `inset 2px 0 0 ${color}` } : undefined}
    >
      <span className="min-w-0 truncate font-sans text-[0.74rem] text-[var(--text-dim)]">{s.name}</span>
      <span className="shrink-0 whitespace-nowrap font-mono text-[0.76rem]">
        <span className="font-semibold" style={{ color }}>{s.value}</span>
        {s.zscore !== null && (
          <span className="ml-1.5 text-[0.64rem]" style={{ color }}>
            {s.zscore > 0 ? "+" : ""}
            {s.zscore.toFixed(2)}
          </span>
        )}
      </span>
    </div>
  );
}

/** Real board tiles from the positioning panel (the hero already shows macro and rates). */
export function BoardPreview({ panels }: { panels: MacroPanel[] }) {
  const panel = panels.find((p) => p.id === "cot-positioning");
  const series = (panel?.series ?? []).slice(0, 8);

  return (
    <Frame label="BOARD / POSITIONING" note="8 of many">
      {series.length === 0 ? (
        <Pending />
      ) : (
        <div className="grid grid-cols-1 gap-px bg-[var(--border)] p-px sm:grid-cols-2">
          {series.map((s) => (
            <Tile key={s.id} s={s} />
          ))}
        </div>
      )}
    </Frame>
  );
}

/*
 * Hero: the interactive regime terminal. We flatten the live feed into a
 * scored, source-free indicator list server-side (tone computed here so the
 * bias config never ships to the public bundle) and hand it to the client
 * TerminalHero, where visitors actually type/click commands against it.
 */
const HERO_CATEGORY: Record<string, string> = {
  "us-macro": "MACRO",
  "yield-rates": "RATES",
  "cot-positioning": "COT",
  transmission: "FLOW",
  geopolitics: "GEO",
  volatility: "VOL",
};

export async function TerminalHeroLoader() {
  const { panels, lastUpdated } = await getLandingPanels();

  const indicators: HeroIndicator[] = [];
  for (const panel of panels) {
    const category = HERO_CATEGORY[panel.id];
    if (!category) continue; // skip asset-news / calendar catalogue panels
    for (const s of panel.series) {
      if (s.id === "geo:news-feed") continue;
      indicators.push({
        id: s.id,
        name: s.name,
        value: s.value,
        score: s.zscore,
        tone: getSignTone(s.id, s.zscore),
        category,
        note: s.note,
      });
    }
  }

  return <TerminalHero indicators={indicators} lastUpdated={lastUpdated} />;
}

/** Real signal scores across the four scoring methods. */
const SIGNAL_IDS = ["us-macro:cpi-yoy", "yield-rates:10y2y-spread", "us-macro:payrolls", "cot:es"];

export function SignalPreview({ panels }: { panels: MacroPanel[] }) {
  const rows = SIGNAL_IDS.map((id) => findSeries(panels, id)).filter(
    (s): s is MacroSeries => s !== null && s.zscore !== null
  );

  return (
    <Frame label="SIGNALS" note="scored -1 to +1">
      {rows.length === 0 ? (
        <Pending />
      ) : (
        <div className="flex flex-col gap-px bg-[var(--border)] p-px">
          {rows.map((s) => (
            <div key={s.id} className="bg-[var(--bg)] px-4 py-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-sans text-[0.78rem] text-[var(--text)]">{s.name}</span>
                <span className="shrink-0 font-mono text-[0.72rem] text-[var(--text-dim)]">{s.value}</span>
              </div>
              <ZScoreBar z={s.zscore as number} tone={getSignTone(s.id, s.zscore)} />
            </div>
          ))}
        </div>
      )}
    </Frame>
  );
}

/** The real composite bias, computed from the same live panels. */
function verdict(tone: "up" | "down" | "flat", strength: "mild" | "strong" | "extreme" | null): string {
  if (tone === "flat") return "Neutral";
  const lean = tone === "up" ? "risk on" : "risk off";
  return strength ? `${strength[0].toUpperCase()}${strength.slice(1)} ${lean}` : `Leaning ${lean}`;
}

export function BiasPreview({ panels }: { panels: MacroPanel[] }) {
  const bias = computeMacroBias(panels, { historyDays: 7, horizon: "short" });
  const { overall, pillars } = bias;
  const scored = pillars.filter((p) => p.score !== null);

  return (
    <Frame label="MACRO BIAS" note="1 week lookback">
      {overall.score === null || scored.length === 0 ? (
        <Pending />
      ) : (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
            <span className="font-sans text-[0.78rem] text-[var(--text-dim)]">Overall</span>
            <span className="font-mono text-[0.8rem] font-semibold" style={{ color: toneColor(overall.tone) }}>
              {verdict(overall.tone, overall.strength)} {overall.score > 0 ? "+" : ""}
              {overall.score.toFixed(2)}
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            {scored.map((p) => (
              <div key={p.id} className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
                <span className="truncate font-mono text-[0.64rem] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                  {p.label}
                </span>
                <ZScoreBar z={p.score as number} tone={p.tone} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Frame>
  );
}

/** Real scored headlines from the live news feed. Outlet names stay off the marketing page. */
function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const TONE_LABEL = { bullish: "BULL", bearish: "BEAR", neutral: "NEUT" } as const;

export function NewsPreview({ panels }: { panels: MacroPanel[] }) {
  const feed = findSeries(panels, "geo:news-feed");
  const headlines = (feed?.payload?.headlines ?? []).slice(0, 4);

  return (
    <Frame label="NEWS SENTIMENT" note={feed && feed.value !== "-" ? `pooled read ${feed.value}` : undefined}>
      {headlines.length === 0 ? (
        <Pending />
      ) : (
        <div className="flex flex-col gap-px bg-[var(--border)] p-px">
          {headlines.map((h, i) => {
            const color =
              h.sentimentLabel === "bullish" ? "var(--up)" : h.sentimentLabel === "bearish" ? "var(--down)" : "var(--text-faint)";
            return (
              <div key={`${h.title}-${i}`} className="flex items-center gap-3 bg-[var(--bg)] px-4 py-2.5">
                <span className="w-9 shrink-0 font-mono text-[0.6rem] font-semibold" style={{ color }}>
                  {TONE_LABEL[h.sentimentLabel]}
                </span>
                <span className="min-w-0 flex-1 truncate font-sans text-[0.76rem] text-[var(--text-dim)]">{h.title}</span>
                <span className="shrink-0 font-mono text-[0.6rem] text-[var(--text-faint)]">
                  {h.kind && h.kind !== "headline" ? "DATA" : fmtDay(h.pubDate)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Frame>
  );
}
