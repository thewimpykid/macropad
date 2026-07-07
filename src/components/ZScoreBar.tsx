/**
 * Signed indicator-score bar: fills from the center line toward the reading,
 * so direction is visible at a glance and magnitude is bar length. Scores
 * are method-based, bounded ±1 (see indicatorSignal.ts).
 */
export default function ZScoreBar({ z, tone }: { z: number; tone?: "up" | "down" | "flat" }) {
  const clamped = Math.max(-1, Math.min(1, z));
  // Rounded to 2dp: full-precision floats get re-serialized by the CSSOM and
  // trip React hydration diffing.
  const halfPct = Math.round(Math.abs(clamped) * 5000) / 100;
  const color =
    tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text-faint)";

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-[5px] flex-1 rounded-[2px] bg-[var(--border)]">
        <div className="absolute left-1/2 top-[-3px] h-[11px] w-px bg-[var(--border-strong)]" />
        <div
          className="absolute top-0 h-full rounded-[2px]"
          style={{
            width: `${halfPct}%`,
            backgroundColor: color,
            [clamped >= 0 ? "left" : "right"]: "50%",
          }}
        />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-[0.72rem] font-medium" style={{ color }}>
        {z > 0 ? "+" : ""}
        {z.toFixed(2)}
      </span>
    </div>
  );
}
