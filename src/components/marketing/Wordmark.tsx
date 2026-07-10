import BrandMark from "@/components/fx/BrandMark";

export default function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const text = size === "lg" ? "text-[1.05rem]" : size === "sm" ? "text-[0.78rem]" : "text-[0.88rem]";
  const mark = size === "lg" ? 26 : size === "sm" ? 18 : 22;
  return (
    <span className="flex select-none items-center gap-2.5 whitespace-nowrap">
      <BrandMark size={mark} className="shrink-0" />
      <span className={`font-mono font-bold tracking-[0.2em] text-[var(--text)] ${text}`}>
        TRIFEKTA<span className="blink-cursor text-[var(--text-faint)]">_</span>
      </span>
    </span>
  );
}
