// Session helpers — demo auth via `X-User-Id` header (see worklog.md).
// No 'use server' here: these are plain server utilities for route handlers.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "./http";

const userInclude = { walker: true, zone: true } satisfies Prisma.UserInclude;

export type SessionUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;

/** Read the X-User-Id header → User (with walker profile + zone) or null. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const id = req.headers.get("x-user-id");
  if (!id) return null;
  try {
    return await db.user.findUnique({ where: { id }, include: userInclude });
  } catch {
    return null;
  }
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
