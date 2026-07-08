import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import DecryptText from "@/components/marketing/DecryptText";

const COVERAGE = [
  { icon: "us-macro", title: "US Macroeconomics", desc: "CPI, payrolls, PCE, ISM — the releases that move every desk." },
  { icon: "yield-rates", title: "Yield Rates", desc: "Curve shape, real yields, breakevens, term premium." },
  { icon: "cot-positioning", title: "COT Positioning", desc: "CFTC net positioning across futures, tracked weekly." },
  { icon: "transmission", title: "Transmission Check", desc: "Credit spreads, liquidity, financial conditions." },
  { icon: "geopolitics", title: "Geopolitics", desc: "Live-scored macro headlines from real policy desks." },
  { icon: "volatility", title: "Volatility", desc: "Vol surface, skew, term structure across assets." },
];

const FEATURES = [
  {
    n: "01",
    title: "One screen, no noise",
    desc: "Every regime signal on a single dense board. No dashboards to build, no charts to hunt through.",
  },
  {
    n: "02",
    title: "Per-asset net bias",
    desc: "Every macro read rolled into a directional bias per ticker — bullish, bearish, or flat, with the reasoning behind it.",
  },
  {
    n: "03",
    title: "Recency-weighted sentiment",
    desc: "Headlines scored on a finance lexicon and decayed on a half-life — recent news moves the number more than yesterday's.",
  },
  {
    n: "04",
    title: "Synced automatically",
    desc: "Refreshes on schedule, every session. Open it and the desk is already current.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-[var(--border)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(color-mix(in srgb, var(--border) 55%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--border) 55%, transparent) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)",
              WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)",
            }}
          />

          <div className="relative mx-auto max-w-[1180px] px-5 pb-20 pt-20 sm:px-8 sm:pb-28 sm:pt-28">
            <div className="eyebrow mb-5 flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--up)] opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--up)]" />
              </span>
              Live macro desk
            </div>

            <h1 className="font-display m-0 flex max-w-3xl flex-wrap items-center gap-x-4 text-[2.6rem] uppercase leading-[0.98] tracking-[-0.02em] sm:text-[4.2rem]">
              <span>
                Read the <span className="glow-accent" style={{ color: "var(--accent)" }}>regime</span>,
                <br />
                not the noise.
              </span>
              <DecryptText
                text="[DECRYPTED]"
                className="self-start font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] normal-case"
                style={{ color: "var(--accent)" }}
              />
            </h1>

            <p className="mt-6 max-w-xl font-sans text-[1.02rem] leading-relaxed text-[var(--text-dim)] sm:text-[1.1rem]">
              Macropad compresses US macro, rates, positioning, transmission, geopolitics, and vol into one dense
              board — with a live per-asset bias derived from all of it.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/app"
                className="border border-[var(--accent)] bg-[var(--accent)] px-6 py-3 font-sans text-[0.85rem] font-semibold uppercase tracking-wide text-black transition-opacity hover:opacity-85"
              >
                Launch the desk
              </Link>
              <Link
                href="/pricing"
                className="border border-[var(--border-strong)] px-6 py-3 font-sans text-[0.85rem] font-semibold uppercase tracking-wide text-[var(--text)] transition-colors hover:border-[var(--text-dim)]"
              >
                See pricing
              </Link>
            </div>

            <div className="mt-16 flex flex-wrap gap-x-10 gap-y-4 border-t border-[var(--border)] pt-8">
              {[
                ["6", "signal panels"],
                ["10", "assets scored"],
                ["24/5", "refresh cycle"],
                ["1", "screen, zero scrolling"],
              ].map(([stat, label]) => (
                <div key={label}>
                  <div className="font-display text-[1.6rem] leading-none">{stat}</div>
                  <div className="eyebrow mt-1.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Product / features */}
        <section id="product" className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-[1180px] px-5 py-20 sm:px-8">
            <div className="eyebrow mb-3">Product</div>
            <h2 className="font-display m-0 max-w-lg text-[1.9rem] uppercase leading-[1.05] tracking-[-0.02em] sm:text-[2.4rem]">
              Built for people who trade on regime, not headlines.
            </h2>

            <div className="mt-14 grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <div key={f.n} className="border-t border-[var(--border)] pt-5">
                  <div className="eyebrow" style={{ color: "var(--accent)" }}>{f.n}</div>
                  <h3 className="m-0 mt-2.5 text-[1.15rem] font-semibold">{f.title}</h3>
                  <p className="m-0 mt-2 font-sans text-[0.9rem] leading-relaxed text-[var(--text-dim)]">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Coverage */}
        <section id="coverage" className="border-b border-[var(--border)] bg-[var(--panel)]">
          <div className="mx-auto max-w-[1180px] px-5 py-20 sm:px-8">
            <div className="eyebrow mb-3">Coverage</div>
            <h2 className="font-display m-0 max-w-lg text-[1.9rem] uppercase leading-[1.05] tracking-[-0.02em] sm:text-[2.4rem]">
              Six panels. Every regime input that matters.
            </h2>

            <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden border border-[var(--border)] sm:grid-cols-2 lg:grid-cols-3" style={{ background: "var(--border)" }}>
              {COVERAGE.map((c) => (
                <div key={c.icon} className="bg-[var(--bg)] p-6">
                  <h3 className="m-0 text-[1.02rem] font-semibold">{c.title}</h3>
                  <p className="m-0 mt-2 font-sans text-[0.85rem] leading-relaxed text-[var(--text-faint)]">{c.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-[1180px] px-5 py-24 text-center sm:px-8">
          <h2 className="font-display m-0 text-[2rem] uppercase leading-[1.05] tracking-[-0.02em] sm:text-[2.8rem]">
            Stop rebuilding this in a spreadsheet.
          </h2>
          <p className="mx-auto mt-4 max-w-md font-sans text-[0.95rem] leading-relaxed text-[var(--text-dim)]">
            One board, synced daily, zero setup.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/app"
              className="border border-[var(--accent)] bg-[var(--accent)] px-6 py-3 font-sans text-[0.85rem] font-semibold uppercase tracking-wide text-black transition-opacity hover:opacity-85"
            >
              Launch the desk
            </Link>
            <Link
              href="/pricing"
              className="border border-[var(--border-strong)] px-6 py-3 font-sans text-[0.85rem] font-semibold uppercase tracking-wide text-[var(--text)] transition-colors hover:border-[var(--text-dim)]"
            >
              See pricing
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
