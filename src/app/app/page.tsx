import DashboardShell from "@/components/DashboardShell";
import { getPanels } from "@/lib/getPanels";
import { getMarkets } from "@/lib/getMarkets";

export const revalidate = 3600;

export default async function AppPage() {
  const [{ panels, lastUpdated }, markets] = await Promise.all([getPanels(), getMarkets()]);
  return <DashboardShell panels={panels} lastUpdated={lastUpdated} markets={markets} />;
}
