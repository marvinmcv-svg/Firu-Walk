"use client";

// Typed fetch helpers for the FiruWalk API.
// Auth rides on the httpOnly session cookie (same-origin fetch sends it).
// A 401 while the UI thinks it is logged in means the session expired or was
// revoked → drop the local session so the landing/login screen shows.

import type {} from "./types"; // side-effect: keep types import path stable
import { useFiruSession } from "./session";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string> | undefined),
  };
  const res = await fetch(path, {
    ...rest,
    headers,
    credentials: "same-origin",
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && !path.startsWith("/api/auth/") && useFiruSession.getState().user) {
    useFiruSession.getState().clearLocal();
  }
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* ignore parse issues */
    }
    throw new ApiError(res.status, message);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, json?: unknown) =>
    request<T>(path, { method: "POST", json }),
  patch: <T>(path: string, json?: unknown) =>
    request<T>(path, { method: "PATCH", json }),
  del: <T>(path: string, json?: unknown) =>
    request<T>(path, { method: "DELETE", json }),
};

/** Query keys convention */
export const qk = {
  config: ["config"] as const,
  me: ["me"] as const,
  zones: ["zones"] as const,
  dogs: (ownerId?: string) => ["dogs", ownerId] as const,
  walkers: (zoneId?: string) => ["walkers", zoneId] as const,
  walker: (userId: string) => ["walker", userId] as const,
  match: ["match"] as const,
  bookings: ["bookings"] as const,
  booking: (id: string) => ["booking", id] as const,
  walks: ["walks"] as const,
  walk: (id: string) => ["walk", id] as const,
  payments: ["payments"] as const,
  wallet: ["wallet"] as const,
  payouts: ["payouts"] as const,
  disputes: ["disputes"] as const,
  notifications: ["notifications"] as const,
  adminMetrics: ["admin", "metrics"] as const,
  adminWalkers: ["admin", "walkers"] as const,
  adminBookings: ["admin", "bookings"] as const,
  adminUsers: ["admin", "users"] as const,
  demoAccounts: ["demo-accounts"] as const,
};
