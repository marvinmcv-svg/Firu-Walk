// HTTP helpers for FiruWalk route handlers.
// All errors are JSON `{ error: string }` with a Spanish, user-friendly message.

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { log } from "./log";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 200 JSON response. */
export function ok(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/** Error JSON response `{ error: msg }`. */
export function fail(status: number, msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status });
}

/**
 * Wraps a route body: ApiError → its status/message, anything else → 500.
 * Usage: `export async function GET(req: Request) { return run(async () => ok(await stuff())) }`
 */
export async function run(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return fail(err.status, err.message);
    log.error("api.unhandled", { err });
    Sentry.captureException(err);
    return fail(500, "Error interno del servidor. Intenta de nuevo.");
  }
}

// ---------------------------------------------------------------------
// Loose body validation helpers (Spanish 400s)
// ---------------------------------------------------------------------

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function reqStr(
  body: Record<string, unknown>,
  key: string,
  label: string,
  opts?: { max?: number }
): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) {
    throw new ApiError(400, `${label} es obligatorio.`);
  }
  const value = v.trim();
  if (opts?.max && value.length > opts.max) {
    throw new ApiError(400, `${label} es demasiado largo (máx. ${opts.max} caracteres).`);
  }
  return value;
}

export function optStr(
  body: Record<string, unknown>,
  key: string,
  opts?: { max?: number }
): string | undefined {
  const v = body[key];
  if (typeof v !== "string") return undefined;
  const value = v.trim();
  if (!value) return undefined;
  if (opts?.max && value.length > opts.max) {
    throw new ApiError(400, `El campo "${key}" es demasiado largo.`);
  }
  return value;
}

export function reqNum(
  body: Record<string, unknown>,
  key: string,
  label: string,
  opts?: { min?: number; max?: number; int?: boolean }
): number {
  const v = body[key];
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || Number.isNaN(n)) {
    throw new ApiError(400, `${label} debe ser un número.`);
  }
  if (opts?.int && !Number.isInteger(n)) {
    throw new ApiError(400, `${label} debe ser un número entero.`);
  }
  if (opts?.min !== undefined && n < opts.min) {
    throw new ApiError(400, `${label} debe ser al menos ${opts.min}.`);
  }
  if (opts?.max !== undefined && n > opts.max) {
    throw new ApiError(400, `${label} debe ser como máximo ${opts.max}.`);
  }
  return n;
}

export function optNum(body: Record<string, unknown>, key: string): number | undefined {
  const v = body[key];
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || Number.isNaN(n)) return undefined;
  return n;
}

export function reqBool(body: Record<string, unknown>, key: string, label: string): boolean {
  const v = body[key];
  if (typeof v !== "boolean") throw new ApiError(400, `${label} debe ser verdadero o falso.`);
  return v;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ApiError(400, `${label} inválido. Opciones: ${allowed.join(", ")}.`);
  }
  return value as T;
}
