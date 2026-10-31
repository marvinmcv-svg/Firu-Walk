/// <reference types="bun-types" />
// Authentication: login codes, sessions, logout, demo mode, CSRF guard.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { setOtpSendersForTests, type OtpSender } from "@/lib/server/auth/otpSenders";
import { isCrossSiteWrite } from "@/proxy";
import * as otpRoute from "@/app/api/auth/otp/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as logoutRoute from "@/app/api/auth/logout/route";
import * as demoLoginRoute from "@/app/api/auth/demo-login/route";
import * as demoAccountsRoute from "@/app/api/auth/demo-accounts/route";
import * as configRoute from "@/app/api/config/route";
import * as meRoute from "@/app/api/users/me/route";
import * as adminUsersRoute from "@/app/api/admin/users/route";
import { call, cookieFor, PHONES, userId } from "./helpers";

/** Captures codes instead of sending them. */
class CaptureSender implements OtpSender {
  readonly channel = "sms" as const;
  codes = new Map<string, string>();
  async send(phone: string, code: string) {
    this.codes.set(phone, code);
  }
}

let sender: CaptureSender;
let phoneSeq = 0;
/** A fresh never-seen phone per test (avoids cooldown/rate-limit bleed). */
const freshPhone = () => `+5917${String(1_000_000 + process.pid * 100 + phoneSeq++).slice(-7)}`;

const cookieFrom = (res: Response) => {
  const set = res.headers.get("set-cookie") ?? "";
  const m = /fw_session=([^;]*)/.exec(set);
  return m ? `fw_session=${m[1]}` : null;
};

beforeEach(async () => {
  sender = new CaptureSender();
  setOtpSendersForTests([sender]);
  process.env.DEMO_MODE = "false";
  await db.rateLimit.deleteMany();
});
afterEach(() => setOtpSendersForTests(null));

describe("login with a phone code", () => {
  test("code → session cookie → authenticated request", async () => {
    const phone = freshPhone();
    const r1 = await call(otpRoute.POST, { method: "POST", body: { phone } });
    expect(r1.status).toBe(200);
    expect(r1.json.channel).toBe("sms");
    expect(r1.json.demo).toBe(false);
    const code = sender.codes.get(phone)!;
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(r1.json)).not.toContain(code);

    const r2 = await call(loginRoute.POST, { method: "POST", body: { phone, code } });
    expect(r2.status).toBe(200);
    expect(r2.json.isNew).toBe(true);
    expect(r2.json.user.role).toBe("OWNER");
    const setCookie = r2.res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");

    const me = await call(meRoute.GET, { cookie: cookieFrom(r2.res) });
    expect(me.status).toBe(200);
    expect(me.json.phone).toBe(phone);
  });

  test("codes are stored hashed, never in clear", async () => {
    const phone = freshPhone();
    await call(otpRoute.POST, { method: "POST", body: { phone } });
    const ch = await db.otpChallenge.findFirstOrThrow({ where: { phone } });
    expect(ch.codeHash).not.toContain(sender.codes.get(phone)!);
    expect(ch.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("wrong code counts attempts and burns the code after 5", async () => {
    const phone = freshPhone();
    await call(otpRoute.POST, { method: "POST", body: { phone } });
    const code = sender.codes.get(phone)!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i <= 5; i++) {
      const r = await call(loginRoute.POST, { method: "POST", body: { phone, code: wrong } });
      expect(r.status).toBe(400);
      expect(r.json.error).not.toContain(code);
    }
    const late = await call(loginRoute.POST, { method: "POST", body: { phone, code } });
    expect(late.status).toBe(400);
    expect(late.json.error).toContain("expiró");
  });

  test("a code works only once", async () => {
    const phone = freshPhone();
    await call(otpRoute.POST, { method: "POST", body: { phone } });
    const code = sender.codes.get(phone)!;
    expect((await call(loginRoute.POST, { method: "POST", body: { phone, code } })).status).toBe(200);
    expect((await call(loginRoute.POST, { method: "POST", body: { phone, code } })).status).toBe(400);
  });

  test("expired codes are rejected", async () => {
    const phone = freshPhone();
    await call(otpRoute.POST, { method: "POST", body: { phone } });
    await db.otpChallenge.updateMany({ where: { phone }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await call(loginRoute.POST, {
      method: "POST",
      body: { phone, code: sender.codes.get(phone)! },
    });
    expect(r.status).toBe(400);
  });

  test("resend cooldown of 60 s", async () => {
    const phone = freshPhone();
    expect((await call(otpRoute.POST, { method: "POST", body: { phone } })).status).toBe(200);
    const again = await call(otpRoute.POST, { method: "POST", body: { phone } });
    expect(again.status).toBe(429);
  });

  test("per-phone hourly limit", async () => {
    const phone = freshPhone();
    for (let i = 0; i < 5; i++) {
      await db.otpChallenge.deleteMany({ where: { phone } }); // skip the cooldown
      expect((await call(otpRoute.POST, { method: "POST", body: { phone } })).status).toBe(200);
    }
    await db.otpChallenge.deleteMany({ where: { phone } });
    expect((await call(otpRoute.POST, { method: "POST", body: { phone } })).status).toBe(429);
  });

  test("no configured sender → 503, nothing stored", async () => {
    setOtpSendersForTests([]);
    const phone = freshPhone();
    const r = await call(otpRoute.POST, { method: "POST", body: { phone } });
    expect(r.status).toBe(503);
    expect(await db.otpChallenge.count({ where: { phone } })).toBe(0);
  });

  test("falls back to the next channel when one fails", async () => {
    const broken: OtpSender = {
      channel: "whatsapp",
      send: async () => {
        throw new Error("down");
      },
    };
    setOtpSendersForTests([broken, sender]);
    const phone = freshPhone();
    const r = await call(otpRoute.POST, { method: "POST", body: { phone } });
    expect(r.status).toBe(200);
    expect(r.json.channel).toBe("sms");
  });

  test("an existing admin logs in as admin; signup never creates admins", async () => {
    await call(otpRoute.POST, { method: "POST", body: { phone: PHONES.admin } });
    const r = await call(loginRoute.POST, {
      method: "POST",
      body: { phone: PHONES.admin, code: sender.codes.get(PHONES.admin)! },
    });
    expect(r.status).toBe(200);
    expect(r.json.user.role).toBe("ADMIN");
    expect(r.json.isNew).toBe(false);
  });
});

describe("sessions", () => {
  test("X-User-Id header is ignored", async () => {
    const adminId = await userId(PHONES.admin);
    const r = await call(adminUsersRoute.GET, { headers: { "x-user-id": adminId } });
    expect(r.status).toBe(401);
  });

  test("forged cookie → 401", async () => {
    const r = await call(meRoute.GET, { cookie: "fw_session=not-a-real-token" });
    expect(r.status).toBe(401);
  });

  test("logout revokes the session", async () => {
    const cookie = await cookieFor(PHONES.ana);
    expect((await call(meRoute.GET, { cookie })).status).toBe(200);
    const out = await call(logoutRoute.POST, { method: "POST", cookie });
    expect(out.status).toBe(200);
    expect(out.res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await call(meRoute.GET, { cookie })).status).toBe(401);
  });

  test("expired session → 401", async () => {
    const cookie = await cookieFor(PHONES.carlos);
    await db.session.updateMany({
      where: { userId: await userId(PHONES.carlos) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await call(meRoute.GET, { cookie })).status).toBe(401);
  });
});

describe("demo mode", () => {
  test("off: demo endpoints 404 and the demo code is hidden", async () => {
    expect((await call(demoAccountsRoute.GET)).status).toBe(404);
    const anaId = await userId(PHONES.ana);
    expect((await call(demoLoginRoute.POST, { method: "POST", body: { userId: anaId } })).status).toBe(404);
    const cfg = await call(configRoute.GET);
    expect(cfg.json.demoMode).toBe(false);
    expect(cfg.json.demo.otpCode).toBe("");
  });

  test("on: one-click login for demo accounts only", async () => {
    process.env.DEMO_MODE = "true";
    const anaId = await userId(PHONES.ana);
    const ok = await call(demoLoginRoute.POST, { method: "POST", body: { userId: anaId } });
    expect(ok.status).toBe(200);
    expect(cookieFrom(ok.res)).not.toBeNull();

    const outsider = await db.user.create({ data: { phone: freshPhone(), name: "Real", role: "OWNER" } });
    const denied = await call(demoLoginRoute.POST, { method: "POST", body: { userId: outsider.id } });
    expect(denied.status).toBe(403);
  });

  test("on: the fixed demo code works and nothing is sent", async () => {
    process.env.DEMO_MODE = "true";
    const phone = freshPhone();
    const r = await call(otpRoute.POST, { method: "POST", body: { phone } });
    expect(r.json.demo).toBe(true);
    expect(sender.codes.size).toBe(0);
    const login = await call(loginRoute.POST, { method: "POST", body: { phone, code: "123456" } });
    expect(login.status).toBe(200);
  });

  test("never on a Vercel production deployment", async () => {
    process.env.DEMO_MODE = "true";
    process.env.VERCEL_ENV = "production";
    try {
      expect((await call(demoAccountsRoute.GET)).status).toBe(404);
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});

describe("CSRF guard", () => {
  const req = (method: string, headers: Record<string, string>) =>
    new Request("http://localhost:3000/api/bookings", { method, headers: { host: "localhost:3000", ...headers } });

  test("blocks cross-origin writes", () => {
    expect(isCrossSiteWrite(req("POST", { origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteWrite(req("DELETE", { "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSiteWrite(req("PATCH", { origin: "null" }))).toBe(true);
  });

  test("allows same-origin writes, reads and non-browser clients", () => {
    expect(isCrossSiteWrite(req("POST", { origin: "http://localhost:3000" }))).toBe(false);
    expect(isCrossSiteWrite(req("GET", { origin: "https://evil.example" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", {}))).toBe(false);
  });
});
