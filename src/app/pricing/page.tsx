import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import Reveal from "@/components/fx/Reveal";

export const metadata = {
  title: "Pricing — Macropad",
  description: "Launch pricing: the full desk, free during the trial window.",
};

const FEATURES = [
  "Every panel — macro, rates, COT, transmission, geopolitics, volatility",
  "Method-fit signal scores on every series",
  "Per-asset news with event-based sentiment",
  "Board view: the whole desk on one screen",
  "Custom dashboards and custom bias weights",
  "Full history and specialized stats per indicator",
  "Daily sync, timestamped on every board",
];

const LAUNCH_TERMS = [
  ["T-01", "Trial users lock in early access", "Everyone who signs up during launch keeps full access through the trial period. No surprise downgrades."],
  ["T-02", "A paid Pro tier is coming", "Once the desk is proven out, Pro pricing lands. This window won't last."],
  ["T-03", "You hear about it first", "No silent price change. Trial users get notice before anything switches."],
] as const;

const FAQ = [
  {
    q: "What's included in the free trial?",
    a: "Everything. Every panel, every asset, full news and sentiment coverage, custom dashboards and bias. Nothing is held back for a later tier during the trial.",
  },
  {
    q: "Where does the data come from?",
    a: "Macro and yield series from FRED and the US Treasury, positioning from CFTC COT reports, volatility from CBOE, headlines from policy and markets desks — each board shows the exact source behind every number.",
  },
  {
    q: "How often does it refresh?",
    a: "Daily, synced at 13:00 UTC on trading days. Every board shows the exact last-synced timestamp — no guessing.",
  },
  {
    q: "Do I need to connect my own accounts?",
    a: "No. Macropad pulls and scores everything server-side. You just open the board.",
  },
  {
    q: "What happens after the trial?",
    a: "Pro pricing comes later. You'll get notice before anything changes — nothing switches off automatically.",
  },
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />

      <main className="flex-1">
        <section className="relative border-b border-[var(--border)]">
          <div className="relative mx-auto max-w-[1120px] px-5 pb-16 pt-20 sm:px-8 sm:pt-24">
            <div className="eyebrow mb-4">Pricing</div>
            <h1 className="display-hero m-0 max-w-2xl text-[2.4rem] sm:text-[3.4rem]">
              Free trial. Every feature.
            </h1>
            <p className="mt-5 max-w-lg font-sans text-[1rem] leading-relaxed text-[var(--text-dim)]">
              Pro pricing lands later. Right now the trial is the whole desk, nothing gated.
            </p>
          </div>
        </section>

        <section className="border-b border-[var(--border)]">
          <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
            {/* Featured plan: one surface step up, no colored border. */}
            <Reveal>
              <div className="hud flex flex-col border border-[var(--border-strong)] bg-[var(--panel-2)] p-8">
                <div className="flex items-baseline justify-between">
                  <span className="partno">PLAN-00 / FULL ACCESS</span>
                  <span className="border border-[var(--border-strong)] px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">
                    Launch window
                  </span>
                </div>

                <div className="mt-6 flex items-baseline gap-2">
                  <span className="font-display text-[3rem] leading-none tracking-[-0.03em]">$0</span>
                  <span className="font-mono text-[0.72rem] text-[var(--text-faint)]">during trial</span>
                </div>
                <p className="m-0 mt-3 font-sans text-[0.88rem] leading-relaxed text-[var(--text-dim)]">
                  Every panel, every asset, every feature. Pro pricing arrives later — trial users get advance
                  notice first.
                </p>

                <ul className="m-0 mt-8 flex flex-1 list-none flex-col gap-3 p-0">
                  {FEATURES.map((f) => (
                    <li key={f} className="flex items-start gap-3 font-sans text-[0.86rem] leading-snug text-[var(--text)]">
                      <span className="mt-[3px] shrink-0 font-mono text-[0.72rem] text-[var(--text-faint)]">+</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <Link href="/signup" className="btn btn-primary mt-9 w-full">
                  Launch free trial
                </Link>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <div className="flex flex-col gap-8 lg:pt-4">
                <div>
                  <div className="eyebrow mb-3">Why free right now</div>
                  <h2 className="font-display m-0 text-[1.5rem] leading-[1.12] sm:text-[1.8rem]">
                    This is launch pricing, not the price.
                  </h2>
                  <p className="m-0 mt-4 font-sans text-[0.92rem] leading-relaxed text-[var(--text-dim)]">
                    Macropad just launched. Free access is how the board gets in front of real desks while we find
                    out what's worth charging for — it is not a permanent tier.
                  </p>
                </div>

                <div className="flex flex-col border-t border-[var(--border)]">
                  {LAUNCH_TERMS.map(([code, title, desc]) => (
                    <div key={code} className="grid grid-cols-[4rem_1fr] gap-4 border-b border-[var(--border)] py-5">
                      <span className="partno pt-0.5">{code}</span>
                      <div>
                        <div className="font-sans text-[0.92rem] font-semibold text-[var(--text)]">{title}</div>
                        <p className="m-0 mt-1.5 font-sans text-[0.85rem] leading-relaxed text-[var(--text-dim)]">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[820px] px-5 py-20 sm:px-8">
          <Reveal>
            <div className="eyebrow mb-3">FAQ</div>
            <h2 className="font-display m-0 text-[1.7rem] leading-[1.08] sm:text-[2.1rem]">Questions, answered.</h2>
          </Reveal>

          <div className="mt-10 flex flex-col">
            {FAQ.map((item, i) => (
              <Reveal key={item.q} delay={i * 40}>
                <div className="border-t border-[var(--border)] py-6">
                  <h3 className="m-0 text-[0.98rem] font-semibold">{item.q}</h3>
                  <p className="m-0 mt-2.5 font-sans text-[0.87rem] leading-relaxed text-[var(--text-dim)]">{item.a}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
