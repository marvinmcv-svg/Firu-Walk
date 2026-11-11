// Shared owner flows for API tests: sign up by phone code, make a new owner
// bookable, book with a walker, walk it end to end, check the ledger.

import { expect } from "bun:test";
import { db } from "@/lib/db";
import * as otpRoute from "@/app/api/auth/otp/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as bookingsRoute from "@/app/api/bookings/route";
import * as bookingRoute from "@/app/api/bookings/[id]/route";
import * as walkRoute from "@/app/api/walks/[id]/route";
import type { OtpSender } from "@/lib/server/auth/otpSenders";
import { ledgerTotals } from "@/lib/server/ledger";
import { call, PHONES } from "./helpers";

export type H = Parameters<typeof call>[0];

/** Captures login codes instead of sending them (install with setOtpSendersForTests). */
export class CaptureSender implements OtpSender {
  readonly channel = "sms" as const;
  codes = new Map<string, string>();
  async send(phone: string, code: string) {
    this.codes.set(phone, code);
  }
}

let seq = 0;
/** A never-seen Bolivian mobile; `block` keeps suites apart. */
export const freshPhone = (block: number) =>
  `+5916${String(block * 100_000 + (process.pid % 1000) * 100 + seq++).padStart(7, "0").slice(-7)}`;

const cookieFrom = (res: Response) => {
  const m = /fw_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "");
  return m ? `fw_session=${m[1]}` : "";
};

/** Sign up a new owner through OTP + login (extra body: referralCode, channel…). */
export async function signUp(sender: CaptureSender, block: number, extra: Record<string, unknown> = {}) {
  const phone = freshPhone(block);
  expect((await call(otpRoute.POST as H, { method: "POST", body: { phone } })).status).toBe(200);
  const r = await call(loginRoute.POST as H, {
    method: "POST",
    body: { phone, code: sender.codes.get(phone)!, acceptTerms: true, ...extra },
  });
  expect(r.status).toBe(200);
  return { ...r, phone, cookie: cookieFrom(r.res), id: r.json.user.id as string };
}

export function dayAhead(days: number): string {
  return new Date(Date.now() - 4 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

/** Give a new owner Ana's zone/address and a dog so they can book. */
export async function makeBookable(ownerId: string) {
  const ana = await db.user.findUniqueOrThrow({ where: { phone: PHONES.ana } });
  await db.user.update({
    where: { id: ownerId },
    data: { name: "Bea Prueba", zoneId: ana.zoneId, addressLat: ana.addressLat, addressLng: ana.addressLng },
  });
  await db.dog.create({ data: { ownerId, name: "Toby", breed: "Mestizo", size: "M", ageYears: 2, temperament: "CALM" } });
}

/** One-off 30-min booking with `walkerId` as preferred walker. */
export async function book(ownerId: string, cookie: string, walkerId: string, body: Record<string, unknown>) {
  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId }, include: { dogs: true } });
  const r = await call(bookingsRoute.POST as H, {
    method: "POST",
    cookie,
    body: {
      dogId: owner.dogs[0].id,
      zoneId: owner.zoneId,
      type: "ONE_OFF",
      durationMin: 30,
      schedule: [{ date: dayAhead(2), minute: 600 }],
      preferredWalkerUserId: walkerId,
      ...body,
    },
  });
  expect(r.status).toBe(201);
  return r.json as { id: string; payment: { id: string; method: string; status: string } };
}

/** The walker accepts, starts at the owner's door and finishes the walk. */
export async function walkIt(bookingId: string, walkerCookie: string) {
  expect(
    (await call(bookingRoute.PATCH as H, { method: "PATCH", params: { id: bookingId }, cookie: walkerCookie, body: { action: "accept" } }))
      .status
  ).toBe(200);
  const walk = await db.walk.findFirstOrThrow({ where: { bookingId, status: "SCHEDULED" } });
  await db.walk.update({ where: { id: walk.id }, data: { scheduledStart: new Date() } });
  const owner = await db.user.findUniqueOrThrow({ where: { id: walk.ownerId } });
  const pos = { lat: owner.addressLat!, lng: owner.addressLng!, acc: 5 };
  for (const action of ["start", "finish"]) {
    const r = await call(walkRoute.PATCH as H, {
      method: "PATCH",
      params: { id: walk.id },
      cookie: walkerCookie,
      body: { action, ...pos, ...(action === "finish" ? { report: { note: "ok", pee: true } } : {}) },
    });
    expect(r.status).toBe(200);
  }
  return walk.id;
}

export async function expectLedgerBalanced() {
  const t = await ledgerTotals();
  expect(t.debitCents).toBe(t.creditCents);
  expect(t.unbalancedTxns).toEqual([]);
}
