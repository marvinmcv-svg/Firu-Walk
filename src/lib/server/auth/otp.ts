// Phone login codes: issue (with rate limits + resend cooldown) and verify
// (expiry, max attempts, constant-time compare). Codes are stored only as
// HMACs and are single-use. In demo mode the code is config.demo.otpCode and
// nothing is sent.

import { db } from "@/lib/db";
import { getAppConfig } from "../config";
import { ApiError } from "../http";
import { log } from "../log";
import { enforceRateLimit } from "../rateLimit";
import { keyedHash, newOtpCode, safeEqualHex } from "./crypto";
import { isDemoMode } from "./demo";
import { getOtpSenders } from "./otpSenders";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;
const HOUR = 3_600_000;

const codeHash = (phone: string, code: string) => keyedHash("otp", `${phone}:${code}`);

export interface IssuedCode {
  channel: string;
  resendInSeconds: number;
  demo: boolean;
}

/** Create a fresh code for `phone` and deliver it. Previous open codes are voided. */
export async function issueLoginCode(phone: string, ip: string): Promise<IssuedCode> {
  await enforceRateLimit(`otp:req:ip:${ip}`, 20, HOUR);
  await enforceRateLimit(`otp:req:phone:${phone}`, 5, HOUR);

  const last = await db.otpChallenge.findFirst({
    where: { phone },
    orderBy: { createdAt: "desc" },
  });
  if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000);
    throw new ApiError(429, `Espera ${wait} s antes de pedir otro código.`);
  }

  const demo = isDemoMode();
  const code = demo ? (await getAppConfig()).demo.otpCode : newOtpCode();
  const senders = demo ? [] : getOtpSenders();
  if (!demo && senders.length === 0) {
    log.error("otp.no_sender_configured");
    throw new ApiError(503, "El inicio de sesión por código no está disponible en este momento.");
  }

  await db.otpChallenge.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  let channel = "demo";
  for (const sender of senders) {
    try {
      await sender.send(phone, code);
      channel = sender.channel;
      break;
    } catch (err) {
      log.warn("otp.send_failed", { channel: sender.channel, err });
    }
  }
  if (!demo && channel === "demo") {
    throw new ApiError(503, "No pudimos enviar el código. Intenta de nuevo en unos minutos.");
  }

  await db.otpChallenge.create({
    data: {
      phone,
      codeHash: codeHash(phone, code),
      channel,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      ip,
    },
  });
  log.info("otp.issued", { channel });
  return { channel, resendInSeconds: OTP_RESEND_COOLDOWN_MS / 1000, demo };
}

/** Check `code` against the latest open challenge for `phone`; consumes it on success. */
export async function verifyLoginCode(phone: string, code: string, ip: string): Promise<void> {
  await enforceRateLimit(`otp:verify:ip:${ip}`, 30, 15 * 60_000);

  const challenge = await db.otpChallenge.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) {
    throw new ApiError(400, "El código expiró o no existe. Pide uno nuevo.");
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    await db.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    throw new ApiError(429, "Demasiados intentos con este código. Pide uno nuevo.");
  }

  const ok = /^\d{6}$/.test(code) && safeEqualHex(challenge.codeHash, codeHash(phone, code));
  if (!ok) {
    const attempts = challenge.attempts + 1;
    await db.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts, ...(attempts >= OTP_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
    });
    const left = OTP_MAX_ATTEMPTS - attempts;
    throw new ApiError(
      400,
      left > 0
        ? `Código incorrecto. Te quedan ${left} intento${left === 1 ? "" : "s"}.`
        : "Código incorrecto. Pide uno nuevo."
    );
  }

  // Single use: the conditional update guards against two concurrent verifies.
  const consumed = await db.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    throw new ApiError(400, "El código expiró o no existe. Pide uno nuevo.");
  }
}
