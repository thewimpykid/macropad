import Link from "next/link";
import Wordmark from "@/components/marketing/Wordmark";

export default function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-5 py-14 sm:px-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <Wordmark size="sm" />
          <p className="mt-3 font-sans text-[0.82rem] leading-relaxed text-[var(--text-faint)]">
            Live macro desk: regime signals, positioning, and per-asset bias on one screen.
          </p>
          <div className="partno mt-5">SRC: FRED · CFTC · US TREASURY · CBOE</div>
        </div>

        <div className="grid grid-cols-2 gap-x-14 gap-y-8 sm:grid-cols-3">
          <div>
            <div className="eyebrow mb-3">Product</div>
            <div className="flex flex-col gap-2.5">
              <Link href="/#system" className="font-sans text-[0.82rem] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]">System</Link>
              <Link href="/coverage" className="font-sans text-[0.82rem] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]">Coverage</Link>
              <Link href="/pricing" className="font-sans text-[0.82rem] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]">Pricing</Link>
            </div>
          </div>
          <div>
            <div className="eyebrow mb-3">Company</div>
            <div className="flex flex-col gap-2.5">
              <a href="mailto:hello@trifekta.app" className="font-sans text-[0.82rem] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]">Contact</a>
              <a href="mailto:hello@trifekta.app" className="font-sans text-[0.82rem] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]">Support</a>
            </div>
          </div>
          <div>
            <div className="eyebrow mb-3">Desk</div>
            <div className="flex flex-col gap-2.5">
              <Link href="/signup" className="font-sans text-[0.82rem] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]">Launch the desk</Link>
              <Link href="/signin" className="font-sans text-[0.82rem] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]">Sign in</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--border)] px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3">
          <p className="m-0 font-mono text-[0.66rem] text-[var(--text-faint)]">
            &copy; {new Date().getFullYear()} Trifekta. Informational only — not investment advice.
          </p>
          <p className="m-0 font-mono text-[0.66rem] text-[var(--text-faint)]">Made for the regime, not the noise.</p>
        </div>
      </div>
    </footer>
  );
}
