// Session helpers — httpOnly cookie holding a random token; the server keeps
// only its HMAC in the Session table (expiry + revocation on logout).
// Plain server utilities for route handlers (no 'use server').

import type { Prisma } from "@prisma/client";
import type { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { keyedHash, newSessionToken } from "./auth/crypto";
import { ApiError } from "./http";
import { clientIp, isHttps } from "./request";

const userInclude = { walker: true, zone: true } satisfies Prisma.UserInclude;

export type SessionUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export const SESSION_COOKIE = "fw_session";
export const SESSION_TTL_MS = 30 * 24 * 3_600_000;
/** Refresh lastSeenAt at most this often (avoids a write per request). */
const TOUCH_EVERY_MS = 3_600_000;

const tokenHash = (token: string) => keyedHash("session", token);

/** Read one cookie from the raw Cookie header (works outside Next's request scope). */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Create a session for `userId`; returns the raw token for the cookie. */
export async function createSession(userId: string, req: Request): Promise<string> {
  const token = newSessionToken();
  await db.session.create({
    data: {
      userId,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      ip: clientIp(req),
    },
  });
  return token;
}

/** Attach the session cookie to a response. */
export function setSessionCookie(res: NextResponse, token: string, req: Request): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(req),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(res: NextResponse, req: Request): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isHttps(req),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Revoke the session behind the request's cookie (logout). */
export async function revokeSession(req: Request): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return;
  await db.session.updateMany({
    where: { tokenHash: tokenHash(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Cookie → live session → User (with walker profile + zone), or null. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { include: userInclude } },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session.user;
}

/** Require a logged-in user, else 401. */
export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (!user) throw new ApiError(401, "Necesitas iniciar sesión para continuar.");
  return user;
}

/** Require a specific role, else 403. */
export function requireRole(user: SessionUser, role: "ADMIN" | "WALKER" | "OWNER"): void {
  if (user.role !== role) {
    throw new ApiError(403, "No tienes permisos para realizar esta acción.");
  }
}

/** Require a logged-in WALKER that has a walker profile. */
export async function requireWalker(req: Request): Promise<SessionUser> {
  const user = await requireUser(req);
  if (!user.walker) throw new ApiError(403, "Solo los paseadores pueden realizar esta acción.");
  return user;
}

/** Require the logged-in ADMIN. */
export async function requireAdmin(req: Request): Promise<SessionUser> {
  const user = await requireUser(req);
  requireRole(user, "ADMIN");
  return user;
}
