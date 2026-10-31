// Environment config — validated with Zod once per process.
// instrumentation.ts calls getEnv() at boot so a misconfigured deploy fails
// fast with a readable message instead of 500s on the first request.
// Every variable here must also be documented in .env.example.

import { z } from "zod";

const optionalUrl = z.string().url().optional();
const optionalStr = z.string().min(1).optional();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Database (PostgreSQL). DIRECT_URL is only read by Prisma migrations.
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgresql:// connection string"),
  DIRECT_URL: z.string().regex(/^postgres(ql)?:\/\//).optional(),

  // Redis — rate limits, sessions, socket adapter (used from Milestone 2).
  REDIS_URL: z.string().regex(/^rediss?:\/\//, "REDIS_URL must be redis:// or rediss://").optional(),

  // Public base URL of the app (links in notifications, OTP messages…).
  APP_URL: optionalUrl,

  // HMAC key for session tokens and login codes. Required in production.
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters").optional(),

  // Demo mode: one-click demo accounts + fixed login code (config.demo.otpCode).
  // Never allowed on a Vercel production deployment.
  DEMO_MODE: z.enum(["true", "false"]).optional(),
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),

  // Realtime live-service: shared HS256 key (required in production when
  // LIVE_SERVICE_INTERNAL_URL is set) and the service's internal publish URL.
  REALTIME_SECRET: z.string().min(32, "REALTIME_SECRET must be at least 32 characters").optional(),
  LIVE_SERVICE_INTERNAL_URL: optionalUrl,
  NEXT_PUBLIC_LIVE_URL: optionalUrl,
  // Walker GPS simulator in the browser (development / e2e only). Simulated
  // fixes look real to the server, so it must never reach production.
  NEXT_PUBLIC_GPS_SIM: z.enum(["true", "false"]).optional(),

  // Observability
  SENTRY_DSN: optionalUrl,
  NEXT_PUBLIC_SENTRY_DSN: optionalUrl,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_QUERIES: z.enum(["true", "false"]).optional(),

  // Integrations (filled in by later milestones)
  STORAGE_BUCKET: optionalStr,
  STORAGE_ENDPOINT: optionalUrl,
  STORAGE_ACCESS_KEY_ID: optionalStr,
  STORAGE_SECRET_ACCESS_KEY: optionalStr,
  LLM_API_KEY: optionalStr,
  WHATSAPP_TOKEN: optionalStr,
  WHATSAPP_PHONE_NUMBER_ID: optionalStr,
  WHATSAPP_OTP_TEMPLATE: optionalStr,
  WHATSAPP_OTP_LANGUAGE: optionalStr,
  TWILIO_ACCOUNT_SID: optionalStr,
  TWILIO_AUTH_TOKEN: optionalStr,
  TWILIO_FROM: optionalStr,
  // Payments (Milestone 5). "mock" is refused in production; "bankqr" is the
  // adapter skeleton for the provider the business picks.
  PAYMENT_PROVIDER: z.enum(["mock", "bankqr"]).optional(),
  PAYMENT_API_URL: optionalUrl,
  PAYMENT_API_KEY: optionalStr,
  PAYMENT_WEBHOOK_SECRET: z.string().min(16, "PAYMENT_WEBHOOK_SECRET must be at least 16 characters").optional(),
  // Bearer token for /api/cron/* (Vercel Cron sends it automatically).
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters").optional(),

  // Seed safety switch (prisma/seed.ts refuses to run in production without it)
  ALLOW_SEED: z.enum(["true", "false"]).optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && !env.SESSION_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["SESSION_SECRET"],
      message: "SESSION_SECRET is required in production (openssl rand -base64 48)",
    });
  }
  if (env.NODE_ENV === "production" && env.LIVE_SERVICE_INTERNAL_URL && !env.REALTIME_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["REALTIME_SECRET"],
      message: "REALTIME_SECRET is required in production when the live-service is configured",
    });
  }
  if ((env.VERCEL_ENV === "production" || env.NODE_ENV === "production") && env.NEXT_PUBLIC_GPS_SIM === "true") {
    ctx.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_GPS_SIM"],
      message: "NEXT_PUBLIC_GPS_SIM must not be enabled in production builds",
    });
  }
  if (env.PAYMENT_PROVIDER === "bankqr" && !env.PAYMENT_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["PAYMENT_WEBHOOK_SECRET"],
      message: "PAYMENT_WEBHOOK_SECRET is required with a real payment provider",
    });
  }
  if (env.VERCEL_ENV === "production" && env.DEMO_MODE === "true") {
    ctx.addIssue({
      code: "custom",
      path: ["DEMO_MODE"],
      message: "DEMO_MODE must not be enabled on the production deployment",
    });
  }
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parse + validate process.env (cached). Throws one readable error listing every problem. */
export function getEnv(): Env {
  if (cached) return cached;
  // Empty strings (common in .env files and dashboards) count as "not set".
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "")
  );
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}
