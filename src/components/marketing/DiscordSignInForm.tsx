"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const ERROR_MESSAGES: Record<string, string> = {
  auth_callback_failed: "Something went wrong finishing sign-in. Try again.",
  not_in_server: "That Discord account isn't in the required server yet.",
};

const DISCORD_INVITE_URL = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;

function DiscordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.076.076 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.028ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.955 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.947 2.419-2.157 2.419Z" />
    </svg>
  );
}

export default function DiscordSignInForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/app";
  const errorCode = searchParams.get("error");
  const [pending, setPending] = useState(false);

  async function handleSignIn() {
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        // `guilds` lets the callback check server membership after auth.
        scopes: "identify guilds",
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // Browser navigates away to Discord on success, so no further state update needed here.
  }

  return (
    <div>
      <div className="partno mb-4">AUTH / SIGN IN</div>
      <h1 className="font-display m-0 text-[1.7rem] leading-[1.05]">Welcome back.</h1>
      <p className="mt-3 font-sans text-[0.88rem] leading-relaxed text-[var(--text-dim)]">
        Sign in with Discord. You&apos;ll need to be a member of our Discord server.
      </p>

      {errorCode && (
        <p className="m-0 mt-6 font-mono text-[0.72rem] leading-relaxed" style={{ color: "var(--down)" }}>
          ERR: {ERROR_MESSAGES[errorCode] ?? "Sign-in failed. Try again."}
        </p>
      )}

      <button
        type="button"
        onClick={handleSignIn}
        disabled={pending}
        className="btn btn-primary mt-8 flex w-full items-center justify-center gap-2 disabled:opacity-50"
      >
        <DiscordIcon />
        {pending ? "Redirecting…" : "Continue with Discord"}
      </button>

      {DISCORD_INVITE_URL && (
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary mt-3 flex w-full items-center justify-center gap-2"
        >
          <DiscordIcon />
          Join the server
        </a>
      )}
    </div>
  );
}
