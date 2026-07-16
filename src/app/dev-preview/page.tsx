import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import DashboardShell from "@/components/DashboardShell";
import { getPanels } from "@/lib/getPanels";
import { getMarkets } from "@/lib/getMarkets";
import { isAuthedCookie, TESS_COOKIE } from "@/lib/tesseractAuth";

/*
 * Local design-review route: renders the dashboard without auth so the UI
 * can be inspected without a Supabase account. 404s unless DEV_PREVIEW=1
 * is set in the environment - never reachable in production. Only bypasses
 * the Discord/Supabase gate - the Tesseract access-code gate still reflects
 * whatever's actually in the cookie, same as the real /app route.
 */
export default async function DevPreviewPage() {
  if (process.env.DEV_PREVIEW !== "1") notFound();
  const [{ panels, lastUpdated }, markets, cookieStore] = await Promise.all([getPanels(), getMarkets(), cookies()]);
  const tesseractAuthed = isAuthedCookie(cookieStore.get(TESS_COOKIE)?.value);
  return <DashboardShell panels={panels} lastUpdated={lastUpdated} markets={markets} tesseractAuthed={tesseractAuthed} />;
}
