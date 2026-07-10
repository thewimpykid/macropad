import type { MacroPanel, MacroSeries } from "@/lib/macroData";
import { getBias, getSignTone } from "@/lib/bias";

function statusColor(status: MacroSeries["status"]): string {
  return status === "up" ? "var(--up)" : status === "down" ? "var(--down)" : "var(--text-faint)";
}

function Tile({ name, value, score, color, title }: { name: string; value: string; score: number | null; color: string; title?: string }) {
  const strong = score !== null && Math.abs(score) >= 0.5;
  return (
    <div
      className="flex min-w-0 items-center justify-between gap-2 bg-[var(--bg)] px-3 py-2 transition-colors duration-150 hover:bg-[var(--panel-2)]"
      style={strong ? { boxShadow: `inset 2px 0 0 ${color}` } : undefined}
      title={title}
    >
      <span className="min-w-0 truncate font-sans text-[0.74rem] text-[var(--text-dim)]">{name}</span>
      <span className="shrink-0 whitespace-nowrap font-mono text-[0.76rem]">
        <span className="font-semibold" style={{ color }}>{value}</span>
        {score !== null && (
          <span className="ml-1.5 text-[0.64rem]" style={{ color }}>
            {score > 0 ? "+" : ""}
            {score.toFixed(2)}
          </span>
        )}
      </span>
    </div>
  );
}

/** One-line-per-indicator overview, everything on screen at once — a seamless hairline grid, no charts, no depth. */
export default function BoardPage({ panels, newsSeries }: { panels: MacroPanel[]; newsSeries: MacroSeries[] }) {
  return (
    <div className="flex flex-col gap-6">
      {newsSeries.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline gap-3">
            <span className="partno">TF-00 NEWS SENTIMENT</span>
          </div>
          <div className="grid grid-cols-1 gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {newsSeries.map((s) => (
              <Tile key={s.id} name={s.name} value={s.value} score={null} color={statusColor(s.status)} title={s.note} />
            ))}
          </div>
        </section>
      )}

      {panels.map((panel, i) => {
        const series = panel.series.filter((s) => s.id !== "geo:news-feed");
        if (series.length === 0) return null;
        return (
          <section key={panel.id}>
            <div className="mb-2 flex items-baseline gap-3">
              <span className="partno">
                TF-{String(i + 1).padStart(2, "0")} {panel.title.toUpperCase()}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {series.map((s) => {
                const bias = getBias(s.id, s.zscore);
                const tone = getSignTone(s.id, s.zscore);
                const color = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text-faint)";
                return <Tile key={s.id} name={s.name} value={s.value} score={s.zscore} color={color} title={bias?.label ?? s.note} />;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
