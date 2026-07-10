import AuthShell from "@/components/marketing/AuthShell";
import SignUpForm from "@/components/marketing/SignUpForm";

export const metadata = {
  title: "Start free trial — Trifekta",
};

export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUpForm />
    </AuthShell>
  );
}
