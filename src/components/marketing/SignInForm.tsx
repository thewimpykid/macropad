"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="eyebrow mb-4">Sign in</div>
      <h1 className="font-display m-0 text-[2rem] uppercase leading-[0.98] tracking-[-0.02em]">
        Welcome back.
      </h1>

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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border px-3.5 py-2.5 font-sans text-[0.9rem] outline-none"
            style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
          />
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
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-6 font-sans text-[0.85rem] text-[var(--text-dim)]">
        No account yet?{" "}
        <Link href="/signup" className="font-semibold text-[var(--text)] hover:text-[var(--accent)]">
          Start your free trial
        </Link>
      </p>
    </div>
  );
}
