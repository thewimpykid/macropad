import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

/*
 * Shared chrome for /signin and /signup: the site-wide terrain does the
 * branding so the form itself stays plain — one centered card, no art
 * panel, no testimonial column.
 */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />
      <main className="relative flex flex-1 items-center justify-center px-5 py-20 sm:px-8">
        <div className="hud relative w-full max-w-sm border border-[var(--border)] bg-[color-mix(in_srgb,var(--panel)_88%,transparent)] p-8 backdrop-blur-[2px]">
          {children}
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
