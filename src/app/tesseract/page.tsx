import { cookies } from "next/headers";
import { isAuthedCookie, TESS_COOKIE } from "@/lib/tesseractAuth";
import { TesseractGate } from "@/components/TesseractGate";
import OptionsFlowPage from "@/components/OptionsFlowPage";

export const dynamic = "force-dynamic";

export default async function TesseractPage() {
  const cookieStore = await cookies();
  const authed = isAuthedCookie(cookieStore.get(TESS_COOKIE)?.value);

  if (!authed) return <TesseractGate />;

  return (
    <div className="mx-auto max-w-[1800px] px-4 py-6">
      <OptionsFlowPage view="terminal" />
    </div>
  );
}
