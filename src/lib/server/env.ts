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

  // Session signing secret (required from Milestone 2 — real auth).
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters").optional(),

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
  PAYMENT_PROVIDER: optionalStr,
  PAYMENT_API_KEY: optionalStr,
  PAYMENT_WEBHOOK_SECRET: optionalStr,

  // Seed safety switch (prisma/seed.ts refuses to run in production without it)
  ALLOW_SEED: z.enum(["true", "false"]).optional(),
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
