import { backtestTooltip, type BacktestEvidence } from "@/lib/backtestImportance";

/**
 * Tiny "this input mattered in the backtest" marker. Amber on purpose —
 * evidence is non-directional, so it must never read as green/red.
 */
export default function BacktestChip({ evidence }: { evidence: BacktestEvidence }) {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded border px-1.5 py-[2px] font-mono text-[0.58rem] font-semibold uppercase tracking-[0.12em]"
      style={{ color: "var(--amber)", borderColor: "color-mix(in srgb, var(--amber) 30%, var(--border))" }}
      title={backtestTooltip(evidence)}
    >
      bt {evidence.rank} · {Math.round(evidence.weeklyShare * 100)}%
    </span>
  );
}
