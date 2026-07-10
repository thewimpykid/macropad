import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import Reveal from "@/components/fx/Reveal";
import { macroPanels } from "@/lib/macroData";

const HIDDEN_PANELS = new Set(["asset-news", "calendar"]);
const PANELS = macroPanels.filter((p) => !HIDDEN_PANELS.has(p.id));

export const metadata = {
  title: "Coverage — Trifekta",
  description:
    "Every panel and series Trifekta tracks: US macro, yield rates, COT positioning, transmission, geopolitics, and volatility.",
};

export default function CoveragePage() {
  const totalSeries = PANELS.reduce((n, p) => n + p.series.length, 0);

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />

      <main className="flex-1">
        <section className="relative border-b border-[var(--border)]">
          <div className="relative mx-auto max-w-[1120px] px-5 pb-16 pt-20 sm:px-8 sm:pt-24">
            <div className="eyebrow mb-4">Coverage catalog</div>
            <h1 className="display-hero m-0 max-w-2xl text-[2.4rem] sm:text-[3.4rem]">
              {PANELS.length} panels. {totalSeries} series.
            </h1>
            <p className="mt-5 max-w-lg font-sans text-[1rem] leading-relaxed text-[var(--text-dim)]">
              Every input feeding the board, with the exact source behind each one. Nothing on Trifekta is a
              black box.
            </p>
          </div>
        </section>

        {PANELS.map((panel, i) => (
          <section
            key={panel.id}
            id={panel.id}
            className="scroll-mt-16 border-b border-[var(--border)]"
            style={{ background: i % 2 === 1 ? "color-mix(in srgb, var(--panel) 62%, transparent)" : undefined }}
          >
            <div className="mx-auto max-w-[1120px] px-5 py-14 sm:px-8">
              <Reveal>
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_2fr]">
                  <div>
                    <div className="partno mb-3">
                      TF-{String(i + 1).padStart(2, "0")} / {String(PANELS.length).padStart(2, "0")}
                    </div>
                    <h2 className="font-display m-0 text-[1.5rem] leading-[1.08] sm:text-[1.8rem]">{panel.title}</h2>
                    <p className="m-0 mt-3 font-sans text-[0.88rem] leading-relaxed text-[var(--text-dim)]">
                      {panel.description}
                    </p>
                    <div className="eyebrow mt-5">{panel.series.length} series</div>
                  </div>

                  <div className="grid grid-cols-1 gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2">
                    {panel.series.map((s) => (
                      <div key={s.id} className="bg-[var(--bg)] px-4 py-3.5 transition-colors duration-150 hover:bg-[var(--panel-2)]">
                        <div className="font-sans text-[0.85rem] font-semibold text-[var(--text)]">{s.name}</div>
                        <div className="mt-1 font-sans text-[0.76rem] leading-snug text-[var(--text-faint)]">{s.note}</div>
                        <div className="partno mt-2.5">{s.source}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>
          </section>
        ))}

        <section className="mx-auto max-w-[1120px] px-5 py-24 text-center sm:px-8">
          <Reveal>
            <h2 className="font-display m-0 text-[2rem] leading-[1.05] sm:text-[2.8rem]">All of it, one screen.</h2>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/signup" className="btn btn-primary">
                Launch the desk
              </Link>
              <Link href="/pricing" className="btn btn-ghost">
                See pricing
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
