import { after } from "next/server";
import DashboardShell from "@/components/DashboardShell";
import { getPanels } from "@/lib/getPanels";
import { getMarkets } from "@/lib/getMarkets";

// Rendered fresh on every request - ISR kept serving a stale cached shell
// after deploys (users saw the old UI until the hour-long revalidate window
// rolled over). The refresh pipeline is still rate-capped by the STALE_MS
// guard below, not by page caching, so per-request rendering doesn't add
// upstream API load - just a cheap Supabase read.
export const dynamic = "force-dynamic";

const STALE_MS = 55 * 60 * 1000; // guard against duplicate fires from concurrent regen requests

function refreshUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/api/refresh`;
  return `http://localhost:${process.env.PORT ?? 3000}/api/refresh`;
}

/**
 * The refresh pipeline fires only when the stored data is older than
 * STALE_MS - that guard (not page caching) is what caps calls against the
 * upstream rate limits (FRED/CFTC/Yahoo): no matter how many users hit
 * /app, the pipeline runs at most ~hourly, same cadence as the cron.
 */
export default async function AppPage() {
  const [{ panels, lastUpdated }, markets] = await Promise.all([getPanels(), getMarkets()]);

  const isStale = !lastUpdated || Date.now() - new Date(lastUpdated).getTime() > STALE_MS;
  if (isStale && process.env.CRON_SECRET) {
    after(async () => {
      try {
        await fetch(refreshUrl(), {
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
          cache: "no-store",
        });
      } catch {
        // best-effort - the Vercel cron remains the source of truth
      }
    });
  }

  return <DashboardShell panels={panels} lastUpdated={lastUpdated} markets={markets} />;
}
