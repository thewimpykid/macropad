import { unstable_cache } from "next/cache";
import { getPanels } from "@/lib/getPanels";
import { getSignTone } from "@/lib/bias";

/*
 * Live regime heatmap on the landing page — the product selling itself.
 * One row per panel, one cell per indicator, stepped intensity with a gray
 * dead-zone for insignificant reads (|score| < 0.15): color marks meaning,
 * never decoration. Data is the same feed the app runs on, cached 30min so
 * the marketing page never adds load to the pipeline.
 */

const getCachedPanels = unstable_cache(async () => getPanels(), ["landing-regime-strip"], { revalidate: 1800 });

const SHORT: Record<string, string> = {
  "us-macro": "US MACRO",
  "yield-rates": "RATES",
  "cot-positioning": "COT",
  transmission: "TRANSMISSION",
  geopolitics: "GEOPOLITICS",
  volatility: "VOLATILITY",
};

const HIDDEN = new Set(["asset-news"]);

function cellStyle(seriesId: string, score: number | null): React.CSSProperties {
  if (score === null) return { background: "var(--panel-2)" };
  const mag = Math.abs(score);
  if (mag < 0.15) return { background: "var(--panel-3)" }; // dead-zone: flat is a fact too
  const tone = getSignTone(seriesId, score);
  const rgb = tone === "up" ? "62, 207, 142" : tone === "down" ? "240, 85, 93" : "156, 156, 163";
  const alpha = mag >= 0.7 ? 0.8 : mag >= 0.4 ? 0.5 : 0.26;
  return { background: `rgba(${rgb}, ${alpha})` };
}

export default async function RegimeStrip() {
  const { panels, lastUpdated } = await getCachedPanels();
  const rows = panels
    .filter((p) => !HIDDEN.has(p.id))
    .map((p) => ({
      id: p.id,
      label: SHORT[p.id] ?? p.title.toUpperCase(),
      series: p.series.filter((s) => s.id !== "geo:news-feed"),
    }))
    .filter((p) => p.series.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className="hud border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--border)] px-4 py-2.5">
        <span className="eyebrow flex items-center gap-2" style={{ color: "var(--text-dim)" }}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--up)] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--up)]" />
          </span>
          Live regime read
        </span>
        <span className="partno">
          {lastUpdated
            ? `SYNCED ${new Date(lastUpdated).toISOString().slice(0, 16).replace("T", " ")}Z`
            : "AWAITING FIRST SYNC"}
        </span>
      </div>

      <div className="flex flex-col gap-px bg-[var(--border)] p-px">
        {rows.map((panel, i) => (
          <div key={panel.id} className="flex items-stretch gap-px">
            <div className="flex w-[7.5rem] shrink-0 items-center bg-[var(--panel)] px-3 sm:w-[10rem]">
              <span className="partno truncate">
                TF-{String(i + 1).padStart(2, "0")} {panel.label}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 gap-px">
              {panel.series.map((s) => (
                <div
                  key={s.id}
                  className="h-8 min-w-0 flex-1"
                  style={cellStyle(s.id, s.zscore)}
                  title={`${s.name}: ${s.value}${s.zscore !== null ? ` (${s.zscore > 0 ? "+" : ""}${s.zscore.toFixed(2)})` : ""}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[var(--border)] px-4 py-2.5">
        <span className="flex items-center gap-1.5 font-mono text-[0.62rem] text-[var(--text-faint)]">
          <span className="inline-block h-2 w-2" style={{ background: "rgba(62,207,142,0.8)" }} /> bullish read
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[0.62rem] text-[var(--text-faint)]">
          <span className="inline-block h-2 w-2" style={{ background: "rgba(240,85,93,0.8)" }} /> bearish read
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[0.62rem] text-[var(--text-faint)]">
          <span className="inline-block h-2 w-2" style={{ background: "var(--panel-3)" }} /> no strong signal
        </span>
        <span className="ml-auto font-mono text-[0.62rem] text-[var(--text-faint)]">one cell per indicator</span>
      </div>
    </div>
  );
}
