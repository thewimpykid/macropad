"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignUpForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.signUp({ email, password });

    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }

    // If the Supabase project requires email confirmation, signUp succeeds
    // but returns no session yet - tell the user to check their inbox
    // instead of silently doing nothing.
    if (!data.session) {
      setCheckEmail(true);
      return;
    }

    router.push("/app");
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="eyebrow mb-4">Free trial</div>
      <h1 className="font-display m-0 text-[2rem] uppercase leading-[0.98] tracking-[-0.02em]">
        Launch the desk.
      </h1>
      <p className="mt-3 font-sans text-[0.9rem] leading-relaxed text-[var(--text-dim)]">
        Every feature, no card required. Pro pricing is coming later, you&apos;ll get notice first.
      </p>

      {checkEmail ? (
        <div className="mt-8 border p-5" style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 5%, var(--panel))" }}>
          <p className="m-0 font-sans text-[0.88rem] leading-relaxed text-[var(--text)]">
            Check <span className="font-semibold">{email}</span> for a confirmation link to finish setting up
            your account.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-sans text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border px-3.5 py-2.5 font-sans text-[0.9rem] outline-none"
              style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-sans text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Password</span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border px-3.5 py-2.5 font-sans text-[0.9rem] outline-none"
              style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
            />
            <span className="font-sans text-[0.72rem] text-[var(--text-faint)]">At least 6 characters.</span>
          </label>

          {error && (
            <p className="m-0 font-sans text-[0.82rem] leading-relaxed" style={{ color: "var(--down)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 border border-[var(--accent)] bg-[var(--accent)] py-3 text-center font-sans text-[0.85rem] font-semibold uppercase tracking-wide text-black transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {pending ? "Creating account..." : "Start free trial"}
          </button>
        </form>
      )}

      <p className="mt-6 font-sans text-[0.85rem] text-[var(--text-dim)]">
        Already have an account?{" "}
        <Link href="/signin" className="font-semibold text-[var(--text)] hover:text-[var(--accent)]">
          Sign in
        </Link>
      </p>
    </div>
  );
}
