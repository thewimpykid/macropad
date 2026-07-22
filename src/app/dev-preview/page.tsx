import { notFound } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getPanels } from "@/lib/getPanels";
import { getMarkets } from "@/lib/getMarkets";
import { isDevPreview } from "@/lib/apiAccess";

/*
 * Local design-review route: renders the dashboard without auth so the UI
 * can be inspected without a Supabase account. 404s unless DEV_PREVIEW=1 is
 * set AND the build is non-production - a served prod build always 404s here
 * regardless of the flag (see isDevPreview).
 */
export default async function DevPreviewPage() {
  if (!isDevPreview()) notFound();
  const [{ panels, lastUpdated }, markets] = await Promise.all([getPanels(), getMarkets()]);
  return <DashboardShell panels={panels} lastUpdated={lastUpdated} markets={markets} />;
}
