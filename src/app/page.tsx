import Link from "next/link";
import { Suspense } from "react";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import RegimeStrip from "@/components/marketing/RegimeStrip";
import Reveal from "@/components/fx/Reveal";
import { macroPanels } from "@/lib/macroData";

const HIDDEN_PANELS = new Set(["asset-news", "calendar"]);
const PANELS = macroPanels.filter((p) => !HIDDEN_PANELS.has(p.id));
const TOTAL_SERIES = PANELS.reduce((n, p) => n + p.series.length, 0);

const SOURCES = ["FRED", "CFTC", "US TREASURY", "BLS", "CBOE", "YAHOO FINANCE"];

const MODULES = [
  {
    tag: "BOARD",
    title: "Every indicator on one screen",
    desc: `${PANELS.length} panels — US macro, rates, COT positioning, transmission, geopolitics, volatility — compressed to a single dense board. No dashboards to build, no charts to hunt through.`,
  },
  {
    tag: "SIGNALS",
    title: "Scores that fit the indicator",
    desc: "Each series is scored −1 to +1 by the method its behavior calls for: distance from an anchor (CPI vs target), threshold state (curve inversion), pace (payroll momentum), or positioning extremes (COT). No one-size z-score.",
  },
  {
    tag: "NEWS",
    title: "Sentiment from events, not word-counting",
    desc: "Headlines are scored against real indicator events and recency-weighted, so the number moves when the macro picture moves — not when a journalist gets excited.",
  },
  {
    tag: "CUSTOM",
    title: "Your bias, your weights",
    desc: "Set sign, weight, and threshold per indicator and compose your own net bias per asset. The desk gives you evidence; the call stays yours.",
  },
];

function StripSkeleton() {
  return <div className="h-[280px] border border-[var(--border)] bg-[var(--panel)]" aria-hidden />;
}

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />

      <main className="flex-1">
        {/* Hero — the regime as terrain (site-wide backdrop shows through) */}
        <section className="relative border-b border-[var(--border)]">
          <div className="relative mx-auto max-w-[1120px] px-5 pt-20 sm:px-8 sm:pt-28">
            <div className="eyebrow mb-6 flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--up)] opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--up)]" />
              </span>
              Live macro desk
            </div>

            <h1 className="display-hero m-0 max-w-3xl text-balance text-[2.9rem] sm:text-[4.6rem]">
              Read the regime, not the noise.
            </h1>

            <p className="mt-6 max-w-xl font-sans text-[1.02rem] leading-relaxed text-[var(--text-dim)] sm:text-[1.1rem]">
              Trifekta compresses {TOTAL_SERIES} macro series — liquidity, rates, positioning, transmission,
              geopolitics, volatility — into one dense board, with every read scored and every score sourced.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/signup" className="btn btn-primary">
                Launch the desk
              </Link>
              <Link href="/coverage" className="btn btn-ghost">
                See what it tracks
              </Link>
            </div>

            <div className="partno mt-8 w-fit bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] py-1" style={{ color: "var(--text-dim)" }}>
              SRC: FRED · CFTC · US TREASURY · CBOE — SYNCED DAILY 13:00 UTC
            </div>

            <div className="relative mt-14 pb-20 sm:pb-24">
              <Suspense fallback={<StripSkeleton />}>
                <RegimeStrip />
              </Suspense>
            </div>
          </div>
        </section>

        {/* Data provenance strip */}
        <section className="border-b border-[var(--border)]">
          <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-6 sm:px-8">
            <span className="eyebrow shrink-0">Data sources</span>
            {SOURCES.map((s) => (
              <span key={s} className="font-mono text-[0.72rem] tracking-[0.08em] text-[var(--text-faint)]">
                {s}
              </span>
            ))}
          </div>
        </section>

        {/* System — spec-sheet rows, not feature cards */}
        <section id="system" className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-[1120px] px-5 py-24 sm:px-8">
            <Reveal>
              <div className="eyebrow mb-3">System</div>
              <h2 className="font-display m-0 max-w-xl text-[1.9rem] leading-[1.08] sm:text-[2.5rem]">
                Built for people who trade the regime, not the headline.
              </h2>
            </Reveal>

            <div className="mt-14 flex flex-col">
              {MODULES.map((m, i) => (
                <Reveal key={m.tag} delay={i * 60}>
                  <div className="grid grid-cols-1 gap-x-10 gap-y-2 border-t border-[var(--border)] py-7 sm:grid-cols-[8rem_16rem_1fr]">
                    <span className="partno pt-1">[{m.tag}]</span>
                    <h3 className="m-0 text-[1.05rem] font-semibold leading-snug">{m.title}</h3>
                    <p className="m-0 font-sans text-[0.9rem] leading-relaxed text-[var(--text-dim)]">{m.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Coverage catalog teaser */}
        <section className="border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--panel)_62%,transparent)]">
          <div className="mx-auto max-w-[1120px] px-5 py-24 sm:px-8">
            <Reveal>
              <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="eyebrow mb-3">Coverage</div>
                  <h2 className="font-display m-0 max-w-lg text-[1.7rem] leading-[1.08] sm:text-[2.1rem]">
                    {PANELS.length} panels. {TOTAL_SERIES} series. Zero black boxes.
                  </h2>
                </div>
                <Link href="/coverage" className="btn btn-ghost shrink-0 self-start sm:self-auto">
                  Full catalog
                </Link>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
                {PANELS.map((p, i) => (
                  <Link
                    key={p.id}
                    href={`/coverage#${p.id}`}
                    className="group bg-[var(--panel)] px-5 py-4 transition-colors duration-150 hover:bg-[var(--panel-2)]"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="partno">TF-{String(i + 1).padStart(2, "0")}</span>
                      <span className="font-mono text-[0.62rem] text-[var(--text-faint)]">
                        {p.series.length} series
                      </span>
                    </div>
                    <div className="mt-2 font-sans text-[0.95rem] font-semibold text-[var(--text)]">{p.title}</div>
                    <div className="mt-1 truncate font-sans text-[0.76rem] text-[var(--text-faint)]">
                      {p.series
                        .slice(0, 3)
                        .map((s) => s.name)
                        .join(" · ")}
                    </div>
                  </Link>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <section className="relative">
          <div className="relative mx-auto max-w-[1120px] px-5 py-28 text-center sm:px-8">
            <Reveal>
              <h2 className="font-display m-0 text-[2rem] leading-[1.05] sm:text-[2.8rem]">
                Stop rebuilding this in a spreadsheet.
              </h2>
              <p className="mx-auto mt-4 max-w-md font-sans text-[0.95rem] leading-relaxed text-[var(--text-dim)]">
                One board, synced daily, zero setup. Free during launch.
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Link href="/signup" className="btn btn-primary">
                  Launch the desk
                </Link>
                <Link href="/pricing" className="btn btn-ghost">
                  See pricing
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
