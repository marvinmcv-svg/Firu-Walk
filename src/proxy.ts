// Next.js proxy (formerly "middleware") — CSRF guard for the API.
// Session cookies are SameSite=Lax, which already blocks most cross-site
// writes; this adds a same-origin check on every state-changing /api request.
// Requests without Origin and Sec-Fetch-Site (curl, server-to-server) pass:
// they can't carry a victim's browser cookies.

import { NextResponse, type NextRequest } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isCrossSiteWrite(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  return req.headers.get("sec-fetch-site") === "cross-site";
}

export function proxy(req: NextRequest) {
  if (isCrossSiteWrite(req)) {
    return NextResponse.json(
      { error: "Solicitud bloqueada: origen no permitido." },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
