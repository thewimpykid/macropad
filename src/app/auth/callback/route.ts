import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Shared landing spot for every Supabase email-link/OAuth redirect (Google
 * sign-in, password recovery) - both use the same PKCE `code` exchange, they
 * just differ in where `next` sends the user afterward.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only ever redirect to a local path: `next` comes from the query string,
  // so without this check ?next=@evil.com or ?next=//evil.com becomes an
  // open redirect on a link users inherently trust (it arrives via our own
  // password-reset email).
  const rawNext = searchParams.get("next") ?? "/app";
  const isSafe = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\");
  const next = isSafe ? rawNext : "/app";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=auth_callback_failed`);
}
