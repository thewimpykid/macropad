import { NextResponse, type NextRequest } from "next/server";
import { checkCode, tessToken, TESS_COOKIE } from "@/lib/tesseractAuth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  if (!checkCode(code)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const token = tessToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 500 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(TESS_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
