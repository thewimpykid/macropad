/**
 * Access gate for the standalone /tesseract page - a passphrase gate, not
 * full auth. The cookie value is an HMAC of a fixed marker keyed by the
 * access code (never the code itself, so it can't be read back out of the
 * cookie) - can't be forged by just setting a cookie manually without
 * knowing TESSERACT_ACCESS_CODE, which never reaches the client (checked
 * server-side only, in this file and in /api/gex).
 */
import { createHmac, timingSafeEqual } from "crypto";

export const TESS_COOKIE = "tess_auth";

function secret(): string | null {
  return process.env.TESSERACT_ACCESS_CODE || null;
}

export function tessToken(): string | null {
  const s = secret();
  if (!s) return null;
  return createHmac("sha256", s).update("tesseract-ok").digest("hex");
}

export function checkCode(code: string): boolean {
  const s = secret();
  if (!s) return false;
  const a = Buffer.from(code);
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAuthedCookie(cookieValue: string | undefined): boolean {
  const expected = tessToken();
  if (!expected || !cookieValue) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
