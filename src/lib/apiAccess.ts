import type { NextRequest } from "next/server";

/**
 * The local design-review escape hatch (DEV_PREVIEW=1 disables the auth gate
 * on /dev-preview and /api/gex). Hard-gated on NODE_ENV so that even if the
 * flag ever leaks into a production deploy's env it CANNOT re-open those
 * surfaces - a served prod build ignores it entirely. Never rely on the flag
 * alone.
 */
export function isDevPreview(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_PREVIEW === "1";
}

/**
 * Founder-only direct API access, via an `x-api-key` header that is never
 * shipped to any client. Reads FOUNDER_API_KEY, falling back to CRON_SECRET
 * so it works on the existing Vercel env without adding a new variable.
 * Returns false when neither env var is set (never open-by-default).
 */
export function hasFounderKey(request: NextRequest): boolean {
  const secret = process.env.FOUNDER_API_KEY ?? process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("x-api-key") === secret;
}

/**
 * Data endpoints are for the website's own pages, not for direct
 * consumption: require the fetch to originate from a page on this same
 * host. Browsers stamp `Sec-Fetch-Site: same-origin` on the app's own
 * fetch() calls and it cannot be set cross-site by a page; when the header
 * is absent (older Safari), fall back to matching Origin/Referer against
 * the request host. curl/scripts send none of these. This is a raised bar,
 * not cryptographic proof - a determined user with valid credentials can
 * spoof headers - but it keeps signed-in users from casually treating the
 * JSON endpoint as a public API for their own programs.
 */
export function isSiteRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null) return secFetchSite === "same-origin";

  const host = request.headers.get("host");
  if (!host) return false;
  for (const header of ["origin", "referer"] as const) {
    const value = request.headers.get(header);
    if (value) {
      try {
        return new URL(value).host === host;
      } catch {
        return false;
      }
    }
  }
  return false;
}
