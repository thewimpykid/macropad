import { Suspense } from "react";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import SignInForm from "@/components/marketing/SignInForm";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />
      <main className="flex flex-1 items-center px-5 py-20 sm:px-8">
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </main>
      <MarketingFooter />
    </div>
  );
}
