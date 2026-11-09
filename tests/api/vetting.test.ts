/// <reference types="bun-types" />
// Milestone 7 — walker vetting & documents.
// Acceptance: documents are never publicly reachable; only admins get
// short-lived signed links; the CI number is encrypted at rest and never
// returned; approval needs documents + CI + the full checklist.

import { beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as myVetting from "@/app/api/walkers/me/vetting/route";
import * as myDocuments from "@/app/api/walkers/me/documents/route";
import * as myDocComplete from "@/app/api/walkers/me/documents/[id]/complete/route";
import * as myIdNumber from "@/app/api/walkers/me/id-number/route";
import * as adminVetting from "@/app/api/admin/walkers/[id]/vetting/route";
import * as adminReview from "@/app/api/admin/walkers/[id]/review/route";
import * as adminWalker from "@/app/api/admin/walkers/[id]/route";
import * as adminWalkers from "@/app/api/admin/walkers/route";
import * as me from "@/app/api/users/me/route";
import * as mockStore from "@/app/api/storage/mock/route";
import { decryptField, encryptField } from "@/lib/server/crypto/fieldCrypto";
import { getStorage } from "@/lib/server/storage";
import { MockStorageProvider, signMockToken } from "@/lib/server/storage/mockProvider";
import { call, cookieFor, ORIGIN, PHONES } from "./helpers";

type H = Parameters<typeof call>[0];
const cookies: Record<string, string> = {};
let joseWalkerId: string;
const CI = "8123457 SC";

/** Call the mock storage route the way a browser follows a presigned URL. */
async function hitStorage(method: "PUT" | "GET", url: string, body?: Uint8Array, contentType?: string) {
  const req = new Request(new URL(url, ORIGIN), {
    method,
    headers: contentType ? { "content-type": contentType } : {},
    body: body ? new Blob([new Uint8Array(body)]) : undefined,
  });
  return method === "PUT" ? mockStore.PUT(req) : mockStore.GET(req);
}

/** Full upload: ticket → PUT bytes → complete. Returns the ticket + vetting. */
async function uploadDoc(kind: string, contentType = "image/jpeg", bytes = new Uint8Array([0xff, 0xd8, 1, 2, 3])) {
  const ticket = await call(myDocuments.POST as H, {
    method: "POST",
    cookie: cookies.jose,
    body: { kind, contentType, sizeBytes: bytes.byteLength },
  });
  expect(ticket.status).toBe(200);
  const put = await hitStorage("PUT", ticket.json.url, bytes, contentType);
  expect(put.status).toBe(200);
  const done = await call(myDocComplete.POST as H, {
    method: "POST",
    cookie: cookies.jose,
    params: { id: ticket.json.documentId },
  });
  return { ticket: ticket.json, done };
}

beforeAll(async () => {
  for (const [k, phone] of Object.entries(PHONES)) cookies[k] = await cookieFor(phone);
  const jose = await db.user.findUniqueOrThrow({ where: { phone: PHONES.jose }, include: { walker: true } });
  joseWalkerId = jose.walker!.id;
  expect(jose.walker!.status).toBe("PENDING");
});

describe("field encryption", () => {
  test("round-trips and uses a fresh IV every time", () => {
    const a = encryptField(CI);
    const b = encryptField(CI);
    expect(a).not.toBe(b);
    expect(a).not.toContain("8123457");
    expect(decryptField(a)).toBe(CI);
  });

  test("tampering is detected", () => {
    const [v, iv, tag, ct] = encryptField(CI).split(":");
    const flipped = ct.slice(0, -2) + (ct.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptField([v, iv, tag, flipped].join(":"))).toThrow();
  });
});

describe("storage provider selection", () => {
  test("mock storage is refused on the production deployment", () => {
    const prev = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      expect(() => getStorage()).toThrow();
    } finally {
      if (prev === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prev;
    }
  });
});

describe("walker uploads", () => {
  test("starts with every required document missing", async () => {
    const r = await call(myVetting.GET as H, { cookie: cookies.jose });
    expect(r.status).toBe(200);
    expect(r.json.missing).toEqual(["CI_FRONT", "CI_BACK", "SELFIE", "BACKGROUND_CERT"]);
    expect(r.json.documentsComplete).toBe(false);
    expect(r.json.storageReady).toBe(true);
  });

  test("rejects disallowed types and oversize files", async () => {
    const badType = await call(myDocuments.POST as H, {
      method: "POST",
      cookie: cookies.jose,
      body: { kind: "CI_FRONT", contentType: "text/html", sizeBytes: 10 },
    });
    expect(badType.status).toBe(400);
    const tooBig = await call(myDocuments.POST as H, {
      method: "POST",
      cookie: cookies.jose,
      body: { kind: "SELFIE", contentType: "image/jpeg", sizeBytes: 50 * 1024 * 1024 },
    });
    expect(tooBig.status).toBe(400);
  });

  test("owners and active walkers cannot upload vetting documents", async () => {
    const owner = await call(myDocuments.POST as H, {
      method: "POST",
      cookie: cookies.ana,
      body: { kind: "CI_FRONT", contentType: "image/jpeg", sizeBytes: 10 },
    });
    expect(owner.status).toBe(403);
    const active = await call(myDocuments.POST as H, {
      method: "POST",
      cookie: cookies.luis,
      body: { kind: "CI_FRONT", contentType: "image/jpeg", sizeBytes: 10 },
    });
    expect(active.status).toBe(409);
  });

  test("a document counts only after the server verifies the upload", async () => {
    const ticket = await call(myDocuments.POST as H, {
      method: "POST",
      cookie: cookies.jose,
      body: { kind: "CI_FRONT", contentType: "image/jpeg", sizeBytes: 5 },
    });
    // Nothing PUT yet → completing fails and nothing is listed.
    const early = await call(myDocComplete.POST as H, {
      method: "POST",
      cookie: cookies.jose,
      params: { id: ticket.json.documentId },
    });
    expect(early.status).toBe(400);
    const v = await call(myVetting.GET as H, { cookie: cookies.jose });
    expect(v.json.documents).toHaveLength(0);
  });

  test("another walker cannot complete (or probe) someone else's document", async () => {
    const ticket = await call(myDocuments.POST as H, {
      method: "POST",
      cookie: cookies.jose,
      body: { kind: "CI_BACK", contentType: "image/jpeg", sizeBytes: 5 },
    });
    const r = await call(myDocComplete.POST as H, {
      method: "POST",
      cookie: cookies.gabriela,
      params: { id: ticket.json.documentId },
    });
    expect(r.status).toBe(404);
  });

  test("full upload flow: presigned PUT → complete", async () => {
    const { ticket, done } = await uploadDoc("CI_FRONT");
    expect(ticket.url).toStartWith("/api/storage/mock?");
    expect(done.status).toBe(200);
    expect(done.json.missing).not.toContain("CI_FRONT");
    // The walker never gets a link back to their documents.
    expect(JSON.stringify(done.json)).not.toContain("/api/storage");
  });

  test("re-uploading replaces the previous file", async () => {
    const before = await db.walkerDocument.findFirstOrThrow({
      where: { walkerId: joseWalkerId, kind: "CI_FRONT", uploadedAt: { not: null } },
    });
    await uploadDoc("CI_FRONT");
    const rows = await db.walkerDocument.findMany({ where: { walkerId: joseWalkerId, kind: "CI_FRONT", uploadedAt: { not: null } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(before.id);
    expect(await new MockStorageProvider().head(before.storageKey)).toBeNull();
  });
});

describe("documents are never publicly reachable", () => {
  let key: string;
  beforeAll(async () => {
    key = (await db.walkerDocument.findFirstOrThrow({ where: { walkerId: joseWalkerId, uploadedAt: { not: null } } })).storageKey;
  });

  test("no signature → 403", async () => {
    const r = await hitStorage("GET", `/api/storage/mock?key=${encodeURIComponent(key)}`);
    expect(r.status).toBe(403);
  });

  test("tampered or expired signatures → 403", async () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const good = signMockToken("get", key, exp);
    const bad = await hitStorage("GET", `/api/storage/mock?${new URLSearchParams({ key, exp: String(exp), sig: good.slice(0, -1) + "x" })}`);
    expect(bad.status).toBe(403);
    const past = Math.floor(Date.now() / 1000) - 1;
    const expired = await hitStorage("GET", `/api/storage/mock?${new URLSearchParams({ key, exp: String(past), sig: signMockToken("get", key, past) })}`);
    expect(expired.status).toBe(403);
  });

  test("an upload URL cannot be reused to read, nor with another content type", async () => {
    const ticket = await call(myDocuments.POST as H, {
      method: "POST",
      cookie: cookies.jose,
      body: { kind: "SELFIE", contentType: "image/jpeg", sizeBytes: 3 },
    });
    expect((await hitStorage("GET", ticket.json.url)).status).toBe(403);
    expect((await hitStorage("PUT", ticket.json.url, new Uint8Array([1, 2, 3]), "text/html")).status).toBe(403);
  });

  test("admin links are signed, short-lived and audit-logged; owners and walkers get 403", async () => {
    for (const who of ["ana", "luis", "jose"] as const) {
      const r = await call(adminVetting.GET as H, { params: { id: joseWalkerId }, cookie: cookies[who] });
      expect(r.status).toBe(403);
    }
    const r = await call(adminVetting.GET as H, { params: { id: joseWalkerId }, cookie: cookies.admin });
    expect(r.status).toBe(200);
    const doc = r.json.documents[0];
    expect(doc.viewUrl).toContain("sig=");
    const exp = Number(new URL(doc.viewUrl, ORIGIN).searchParams.get("exp"));
    expect(exp - Date.now() / 1000).toBeLessThanOrEqual(5 * 60 + 1);
    const file = await hitStorage("GET", doc.viewUrl);
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toContain("no-store");
    const audit = await db.auditLog.findFirst({ where: { action: "WALKER_DOCS_VIEWED", entityId: joseWalkerId } });
    expect(audit).not.toBeNull();
  });
});

describe("CI number", () => {
  test("is stored encrypted and only the last 4 digits come back", async () => {
    const r = await call(myIdNumber.PUT as H, { method: "PUT", cookie: cookies.jose, body: { idNumber: CI } });
    expect(r.status).toBe(200);
    expect(r.json.idDocLast4).toBe("3457");
    expect(JSON.stringify(r.json)).not.toContain("8123457");

    const row = await db.walkerProfile.findUniqueOrThrow({ where: { id: joseWalkerId } });
    expect(row.idDocCipher).not.toContain("8123457");
    expect(decryptField(row.idDocCipher!)).toBe("8123457SC");

    for (const res of [
      await call(adminWalkers.GET as H, { cookie: cookies.admin }),
      await call(adminVetting.GET as H, { params: { id: joseWalkerId }, cookie: cookies.admin }),
      await call(me.GET as H, { cookie: cookies.jose }),
    ]) {
      expect(JSON.stringify(res.json)).not.toContain("8123457");
      expect(JSON.stringify(res.json)).not.toContain(row.idDocCipher!);
    }
  });

  test("rejects malformed numbers", async () => {
    const r = await call(myIdNumber.PUT as H, { method: "PUT", cookie: cookies.jose, body: { idNumber: "abc" } });
    expect(r.status).toBe(400);
  });
});

describe("approval gate", () => {
  const approve = () =>
    call(adminWalker.PATCH as H, { method: "PATCH", params: { id: joseWalkerId }, cookie: cookies.admin, body: { action: "approve" } });

  test("blocked while documents are missing", async () => {
    const r = await approve();
    expect(r.status).toBe(409);
    expect(r.json.error).toContain("documentos");
  });

  test("blocked until the whole checklist is done", async () => {
    await uploadDoc("CI_BACK");
    await uploadDoc("SELFIE");
    await uploadDoc("BACKGROUND_CERT", "application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const v = await call(myVetting.GET as H, { cookie: cookies.jose });
    expect(v.json.documentsComplete).toBe(true);

    const partial = await call(adminReview.PATCH as H, {
      method: "PATCH",
      params: { id: joseWalkerId },
      cookie: cookies.admin,
      body: { identityOk: true, backgroundOk: true, interviewDone: true },
    });
    expect(partial.status).toBe(200);
    expect(partial.json.readyToApprove).toBe(false);
    expect((await approve()).status).toBe(409);
  });

  test("checklist values must be booleans", async () => {
    const r = await call(adminReview.PATCH as H, {
      method: "PATCH",
      params: { id: joseWalkerId },
      cookie: cookies.admin,
      body: { trialWalkDone: "yes" },
    });
    expect(r.status).toBe(400);
  });

  test("approves once documents, CI and checklist are complete", async () => {
    const done = await call(adminReview.PATCH as H, {
      method: "PATCH",
      params: { id: joseWalkerId },
      cookie: cookies.admin,
      body: { trialWalkDone: true, notes: "Entrevista y paseo de prueba OK." },
    });
    expect(done.json.readyToApprove).toBe(true);
    const r = await approve();
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("ACTIVE");
    expect(await db.auditLog.count({ where: { action: "WALKER_REVIEW_UPDATED", entityId: joseWalkerId } })).toBeGreaterThanOrEqual(2);
  });

  test("once approved, documents can no longer be changed", async () => {
    const r = await call(myDocuments.POST as H, {
      method: "POST",
      cookie: cookies.jose,
      body: { kind: "SELFIE", contentType: "image/jpeg", sizeBytes: 10 },
    });
    expect(r.status).toBe(409);
  });
});
