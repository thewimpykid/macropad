import type { IndicatorRead, PillarResult } from "@/lib/macroBias";

/** Shared presentational pieces between MacroBiasPage (live) and ReplayPage (point-in-time) - same rendering, different `asOfDate`. */

export function toneColor(tone: "up" | "down" | "flat"): string {
  return tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--flat)";
}

export function verdictLabel(tone: "up" | "down" | "flat", strength: "mild" | "strong" | "extreme" | null): string {
  if (tone === "flat" || !strength) return "Neutral / mixed";
  const side = tone === "up" ? "Risk-on" : "Risk-off";
  if (strength === "extreme") return `Extreme ${side.toLowerCase()}`;
  if (strength === "strong") return `Strong ${side.toLowerCase()}`;
  return `Mild ${side.toLowerCase()}`;
}

export function Bar({ score, tone }: { score: number; tone: "up" | "down" | "flat" }) {
  const clamped = Math.max(-1, Math.min(1, score));
  const pct = ((clamped + 1) / 2) * 100;
  return (
    <div className="relative h-2 rounded-full bg-[var(--border)]">
      <div className="absolute left-1/2 top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2 bg-[var(--text-faint)]" />
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-[var(--panel)]"
        style={{ left: `${pct}%`, background: toneColor(tone) }}
      />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap rounded-md border border-[var(--border)] bg-[var(--panel-2)] p-0.5">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className="rounded px-2.5 py-1 font-sans text-[0.7rem] font-semibold transition-colors"
          style={
            value === opt.id
              ? { background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--accent)" }
              : { color: "var(--text-faint)" }
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function IndicatorRow({ indicator, weight }: { indicator: IndicatorRead; weight: number }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-sans text-[0.78rem]">
          {indicator.name}
          {weight !== 1 && (
            <span className="ml-1.5 font-mono text-[0.6rem] text-[var(--text-faint)]">{weight.toFixed(1)}x</span>
          )}
        </div>
        {indicator.label && (
          <div className="truncate font-mono text-[0.62rem] text-[var(--text-faint)]">{indicator.label}</div>
        )}
      </div>
      <div className="w-24 shrink-0">
        {indicator.directional !== null ? <Bar score={indicator.directional} tone={indicator.tone} /> : null}
      </div>
      <div className="w-12 shrink-0 text-right font-mono text-[0.72rem]" style={{ color: indicator.directional !== null ? toneColor(indicator.tone) : "var(--text-faint)" }}>
        {indicator.directional === null ? "-" : `${indicator.directional > 0 ? "+" : ""}${indicator.directional.toFixed(2)}`}
      </div>
    </div>
  );
}

export function PillarCard({ pillar, weights }: { pillar: PillarResult; weights: Record<string, number> }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <div className="font-sans text-[0.88rem] font-semibold">{pillar.label}</div>
          <div className="mt-0.5 font-sans text-[0.7rem] leading-snug text-[var(--text-faint)]">{pillar.description}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[1rem] font-bold" style={{ color: pillar.score !== null ? toneColor(pillar.tone) : "var(--text-faint)" }}>
            {pillar.score === null ? "-" : `${pillar.score > 0 ? "+" : ""}${pillar.score.toFixed(2)}`}
          </div>
          <div className="font-mono text-[0.6rem] uppercase tracking-wide text-[var(--text-faint)]">
            {pillar.score === null ? "no data" : verdictLabel(pillar.tone, pillar.strength)}
          </div>
        </div>
      </div>
      {pillar.score !== null && (
        <div className="px-4 pt-3">
          <Bar score={pillar.score} tone={pillar.tone} />
        </div>
      )}
      <div className="divide-y divide-[var(--border)] px-1 py-1">
        {pillar.indicators.map((indicator) => (
          <IndicatorRow key={indicator.seriesId} indicator={indicator} weight={weights[indicator.seriesId] ?? 1} />
        ))}
      </div>
    </div>
  );
}
