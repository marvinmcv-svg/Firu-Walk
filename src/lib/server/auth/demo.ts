// Demo mode — one-click demo accounts and the fixed login code from
// config.demo.otpCode. Enabled with DEMO_MODE=true; never on a Vercel
// production deployment (env.ts also refuses that combination at boot).

/** Seeded demo phones live in the +591 7000 00xx range (prisma/seed.ts). */
export const DEMO_PHONE_PREFIX = "+59170000";

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true" && process.env.VERCEL_ENV !== "production";
}

export function isDemoPhone(phone: string): boolean {
  return phone.startsWith(DEMO_PHONE_PREFIX);
}
