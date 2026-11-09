// LlmClient selection (Milestone 9).
//   LLM_PROVIDER=anthropic  Claude via the Anthropic API — needs ANTHROPIC_API_KEY
//                           (LLM_API_KEY is accepted as an alias).
//   LLM_PROVIDER=mock       deterministic offline replies — refused in production.
// Unset: anthropic when a key is configured, otherwise mock outside production
// and "not configured" in production (FirulAI then answers with the canned
// WhatsApp reply).

import { log } from "../log";
import { AnthropicLlmClient } from "./anthropic";
import { MockLlmClient } from "./mock";
import type { LlmClient } from "./types";

export type { LlmClient } from "./types";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

let override: LlmClient | null | undefined;
let cached: { key: string; client: LlmClient | null } | null = null;

/** Tests: force a client (or null = not configured); undefined restores env selection. */
export function setLlmClientForTests(client: LlmClient | null | undefined): void {
  override = client;
}

export function getLlmClient(): LlmClient | null {
  if (override !== undefined) return override;
  const env = process.env;
  const apiKey = env.ANTHROPIC_API_KEY || env.LLM_API_KEY || "";
  const production = env.VERCEL_ENV === "production" || (env.NODE_ENV === "production" && !env.VERCEL_ENV);
  const provider = env.LLM_PROVIDER || (apiKey ? "anthropic" : production ? "" : "mock");
  const model = env.LLM_MODEL || "claude-opus-5-5";
  const effort: Effort = (EFFORTS as readonly string[]).includes(env.LLM_EFFORT ?? "")
    ? (env.LLM_EFFORT as Effort)
    : "low";

  const key = `${provider}|${model}|${effort}|${apiKey ? "k" : ""}`;
  if (cached?.key === key) return cached.client;

  let client: LlmClient | null = null;
  if (provider === "anthropic") {
    if (apiKey) client = new AnthropicLlmClient(apiKey, model, effort);
    else log.warn("llm.not_configured", { reason: "ANTHROPIC_API_KEY missing" });
  } else if (provider === "mock") {
    if (production) log.error("llm.mock_refused_in_production", {});
    else client = new MockLlmClient();
  }
  cached = { key, client };
  return client;
}
