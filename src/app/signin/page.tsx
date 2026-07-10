import { Suspense } from "react";
import AuthShell from "@/components/marketing/AuthShell";
import SignInForm from "@/components/marketing/SignInForm";

export const metadata = {
  title: "Sign in — Trifekta",
};

export default function SignInPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
