import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

const FEATURES = [
  "All 6 macro panels",
  "Per-asset net bias, 10 tickers",
  "Hourly refresh",
  "General + per-asset news, sentiment trend",
  "Board overview page",
  "Custom dashboards and bias pages",
  "3D headline scatter, full history",
];

const FAQ = [
  {
    q: "What's included in the free trial?",
    a: "Everything. All 6 panels, every asset, full news and sentiment coverage, custom dashboards. Nothing is held back for a later tier during the trial.",
  },
  {
    q: "Where does the data come from?",
    a: "Macro releases and yield data from public series, COT from CFTC, headlines from real policy and markets desks (CNBC, Fed, WSJ, Yahoo, FXStreet), scored with a finance-specific sentiment lexicon.",
  },
  {
    q: "How often does it refresh?",
    a: "Hourly. Every board shows the exact last-synced timestamp — no guessing.",
  },
  {
    q: "Do I need to connect my own accounts?",
    a: "No. Macropad pulls and scores everything server-side. You just open the board.",
  },
  {
    q: "What happens after the trial?",
    a: "Pro pricing is coming later. We'll give you notice before anything changes — nothing switches off automatically.",
  },
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />

      <main className="flex-1">
        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-20 sm:px-8 sm:pt-24">
            <div className="eyebrow mb-4">Pricing</div>
            <h1 className="font-display m-0 max-w-2xl text-[2.4rem] uppercase leading-[0.98] tracking-[-0.02em] sm:text-[3.4rem]">
              Free trial. Every feature.
            </h1>
            <p className="mt-5 max-w-lg font-sans text-[1rem] leading-relaxed text-[var(--text-dim)]">
              Pro pricing lands later. Right now the trial is the whole board, nothing gated.
            </p>
          </div>
        </section>

        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-[560px] px-5 py-16 sm:px-8">
            <div
              className="relative flex flex-col border p-8"
              style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 5%, var(--panel))" }}
            >
              <div
                className="absolute -top-3 left-8 px-2 py-0.5 font-mono text-[0.62rem] font-bold uppercase tracking-wide"
                style={{ background: "var(--accent)", color: "#000" }}
              >
                Free trial
              </div>

              <div className="eyebrow">Full access</div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="font-display text-[2.4rem] leading-none">$0</span>
                <span className="font-sans text-[0.85rem] text-[var(--text-faint)]">during trial</span>
              </div>
              <p className="m-0 mt-2.5 font-sans text-[0.88rem] leading-relaxed text-[var(--text-dim)]">
                Every panel, every asset, every feature. Pro tier with paid pricing arrives later — trial users get
                advance notice first.
              </p>

              <ul className="m-0 mt-7 flex flex-1 list-none flex-col gap-3 p-0">
                {FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 font-sans text-[0.86rem] leading-snug text-[var(--text)]">
                    <span className="mt-[3px] shrink-0 font-mono text-[0.78rem]" style={{ color: "var(--accent)" }}>
                      &#9656;
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href="/app"
                className="mt-8 block border py-3 text-center font-sans text-[0.8rem] font-semibold uppercase tracking-wide transition-opacity hover:opacity-85"
                style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#000" }}
              >
                Launch free trial
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[820px] px-5 py-20 sm:px-8">
          <div className="eyebrow mb-3">FAQ</div>
          <h2 className="font-display m-0 text-[1.7rem] uppercase leading-[1.05] tracking-[-0.02em] sm:text-[2.1rem]">
            Questions, answered.
          </h2>

          <div className="mt-10 flex flex-col">
            {FAQ.map((item) => (
              <div key={item.q} className="border-t border-[var(--border)] py-6">
                <h3 className="m-0 text-[0.98rem] font-semibold">{item.q}</h3>
                <p className="m-0 mt-2.5 font-sans text-[0.87rem] leading-relaxed text-[var(--text-dim)]">{item.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
