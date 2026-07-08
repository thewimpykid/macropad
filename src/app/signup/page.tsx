import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import SignUpForm from "@/components/marketing/SignUpForm";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />
      <main className="flex flex-1 items-center px-5 py-20 sm:px-8">
        <SignUpForm />
      </main>
      <MarketingFooter />
    </div>
  );
}
