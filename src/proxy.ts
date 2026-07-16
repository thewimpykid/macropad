import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/app"];
const AUTH_PAGES = ["/signin"];

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    }
  );

  // Required call: this both validates the session and refreshes it if
  // expired, keeping the cookie current for the rest of the request chain.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  const isAuthPage = AUTH_PAGES.some((p) => path === p);

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Referral capture: a link can point at any page (home, /app, /signin),
  // not just the sign-in form, so this is caught here rather than on one
  // specific route. Cookie only - never gates anything, just remembered
  // until the user actually signs in (see /auth/callback).
  const ref = request.nextUrl.searchParams.get("ref");
  if (ref) {
    response.cookies.set("ref_code", ref.slice(0, 64), { maxAge: 60 * 60 * 24 * 30, path: "/", sameSite: "lax" });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/refresh).*)"],
};
