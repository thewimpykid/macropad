import { notFound } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getPanels } from "@/lib/getPanels";
import { getMarkets } from "@/lib/getMarkets";

/*
 * Local design-review route: renders the dashboard without auth so the UI
 * can be inspected without a Supabase account. 404s unless DEV_PREVIEW=1
 * is set in the environment - never reachable in production.
 */
export default async function DevPreviewPage() {
  if (process.env.DEV_PREVIEW !== "1") notFound();
  const [{ panels, lastUpdated }, markets] = await Promise.all([getPanels(), getMarkets()]);
  return <DashboardShell panels={panels} lastUpdated={lastUpdated} markets={markets} />;
}
