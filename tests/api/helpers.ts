// Helpers for calling Next.js route handlers directly in tests.

import { db } from "@/lib/db";
import { createSession } from "@/lib/server/session";

export const ORIGIN = "http://localhost:3000";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface CallOpts {
  method?: string;
  path?: string;
  body?: unknown;
  cookie?: string | null;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

/** Invoke a route handler with a synthetic same-origin request. */
export async function call(handler: Handler, opts: CallOpts = {}): Promise<{ status: number; json: any; res: Response }> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    origin: ORIGIN,
    host: "localhost:3000",
    "x-forwarded-for": "10.0.0.1",
    ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(opts.cookie ? { cookie: opts.cookie } : {}),
    ...opts.headers,
  };
  const req = new Request(`${ORIGIN}${opts.path ?? "/api/x"}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, res };
}

/** Session cookie header for the seeded user with this phone. */
export async function cookieFor(phone: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({ where: { phone } });
  const token = await createSession(user.id, new Request(ORIGIN));
  return `fw_session=${token}`;
}

export async function userId(phone: string): Promise<string> {
  return (await db.user.findUniqueOrThrow({ where: { phone } })).id;
}

/** Seeded demo accounts (prisma/seed.ts). */
export const PHONES = {
  admin: "+59170000001",
  ana: "+59170000101", // owner (Max)
  carlos: "+59170000102", // owner (Luna)
  sofia: "+59170000103",
  marco: "+59170000104",
  luis: "+59170000201", // active walker
  gabriela: "+59170000202",
  jose: "+59170000209", // pending walker
} as const;
