import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

/**
 * Landing spot for the Discord OAuth PKCE redirect. Exchanges the code for a
 * session, then checks the user is actually in the required Discord server -
 * Supabase's OAuth only proves "this is a real Discord account," membership
 * in a specific guild has to be checked separately against Discord's API
 * using the provider token from the `guilds` scope.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only ever redirect to a local path: `next` comes from the query string,
  // so without this check ?next=@evil.com or ?next=//evil.com becomes an
  // open redirect on a link users inherently trust (it arrives via our own
  // Discord sign-in flow).
  const rawNext = searchParams.get("next") ?? "/app";
  const isSafe = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\");
  const next = isSafe ? rawNext : "/app";
  const refCode = searchParams.get("ref")?.trim().slice(0, 64) || null;

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const requiredGuild = process.env.DISCORD_GUILD_ID;
      const providerToken = data.session?.provider_token;

      if (requiredGuild) {
        // On a brand-new Discord account/authorization Discord's API can be
        // briefly inconsistent (token not fully propagated yet) and return a
        // rate-limit or empty guild list right after consent - retry a
        // couple times before concluding they're actually not in the server,
        // instead of bouncing them out on the first flaky read.
        const membership = providerToken ? await checkGuildMembership(providerToken, requiredGuild) : "not-a-member";
        if (membership === "not-a-member") {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/signin?error=not_in_server`);
        }
      }

      // Referral credit - awaited so it actually completes before this
      // function returns (a fire-and-forget promise can get cut off when a
      // serverless invocation ends), but never blocks or fails sign-in
      // itself. Only recorded once per user (unique user_id), so
      // re-logging in later (with or without a ref param) can't
      // double-credit a code.
      if (refCode && data.session?.user && supabaseAdmin) {
        const user = data.session.user;
        const discordUsername = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.user_metadata?.custom_claims?.global_name ?? null) as string | null;
        try {
          // supabase-js resolves (doesn't throw) on a DB-level error like a
          // unique-violation on repeat login - the catch below is only for
          // a genuine network/client failure. Either way the result is
          // deliberately not inspected: this must never affect sign-in.
          await supabaseAdmin.from("referrals").insert({ code: refCode, user_id: user.id, discord_username: discordUsername });
        } catch {
          // network hiccup or table not migrated yet - not fatal to sign-in
        }
      }

      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=auth_callback_failed`);
}

type GuildCheck = "member" | "not-a-member";

/** Checks the Discord user's guild list (via the `guilds` scope token) for a specific server id. */
async function checkGuildMembership(providerToken: string, guildId: string): Promise<GuildCheck> {
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 400 * i));
    try {
      const res = await fetch("https://discord.com/api/users/@me/guilds", {
        headers: { Authorization: `Bearer ${providerToken}` },
      });
      if (!res.ok) continue; // transient (rate limit, propagation delay) - retry
      const guilds: { id: string }[] = await res.json();
      if (guilds.some((g) => g.id === guildId)) return "member";
      if (i === attempts - 1) return "not-a-member";
    } catch {
      // network hiccup - retry
    }
  }
  return "not-a-member";
}
