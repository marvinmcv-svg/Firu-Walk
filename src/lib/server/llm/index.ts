// LlmClient selection (Milestone 9).
//   LLM_PROVIDER=nvidia     NVIDIA's OpenAI-compatible API (Nemotron) — needs
//                           NVIDIA_API_KEY. LLM_MODEL default
//                           nvidia/nemotron-3-ultra-550b-a55b; LLM_THINKING=on
//                           enables reasoning (slower).
//   LLM_PROVIDER=openai     any OpenAI-compatible /chat/completions endpoint:
//                           LLM_BASE_URL + LLM_API_KEY.
//   LLM_PROVIDER=anthropic  Claude via the Anthropic API — needs ANTHROPIC_API_KEY.
//   LLM_PROVIDER=mock       deterministic offline replies — refused in production.
// LLM_API_KEY works as the key for any provider.
// Unset: nvidia when NVIDIA_API_KEY is set, else anthropic when an Anthropic
// key is set, else mock outside production and "not configured" in
// production (FirulAI then answers with the canned WhatsApp reply).

import { log } from "../log";
import { AnthropicLlmClient } from "./anthropic";
import { MockLlmClient } from "./mock";
import { NVIDIA_BASE_URL, OpenAiCompatLlmClient } from "./openaiCompat";
import type { LlmClient } from "./types";

export type { LlmClient } from "./types";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

export const DEFAULT_MODELS = {
  anthropic: "claude-opus-5-5",
  nvidia: "nvidia/nemotron-3-ultra-550b-a55b",
} as const;

let override: LlmClient | null | undefined;
let cached: { key: string; client: LlmClient | null } | null = null;

/** Tests: force a client (or null = not configured); undefined restores env selection. */
export function setLlmClientForTests(client: LlmClient | null | undefined): void {
  override = client;
}

export function getLlmClient(): LlmClient | null {
  if (override !== undefined) return override;
  const env = process.env;
  const production = env.VERCEL_ENV === "production" || (env.NODE_ENV === "production" && !env.VERCEL_ENV);
  const provider =
    env.LLM_PROVIDER ||
    (env.NVIDIA_API_KEY
      ? "nvidia"
      : env.ANTHROPIC_API_KEY || env.LLM_API_KEY
        ? "anthropic"
        : production
          ? ""
          : "mock");
  const apiKey =
    provider === "nvidia"
      ? env.NVIDIA_API_KEY || env.LLM_API_KEY || ""
      : provider === "anthropic"
        ? env.ANTHROPIC_API_KEY || env.LLM_API_KEY || ""
        : env.LLM_API_KEY || "";
  const model = env.LLM_MODEL || (provider === "nvidia" ? DEFAULT_MODELS.nvidia : DEFAULT_MODELS.anthropic);
  const effort: Effort = (EFFORTS as readonly string[]).includes(env.LLM_EFFORT ?? "")
    ? (env.LLM_EFFORT as Effort)
    : "low";
  const thinking = env.LLM_THINKING === "on";
  const baseUrl = env.LLM_BASE_URL || (provider === "nvidia" ? NVIDIA_BASE_URL : "");

  const key = `${provider}|${model}|${effort}|${thinking}|${baseUrl}|${apiKey ? apiKey.slice(-6) : ""}`;
  if (cached?.key === key) return cached.client;

  let client: LlmClient | null = null;
  if (provider === "anthropic") {
    if (apiKey) client = new AnthropicLlmClient(apiKey, model, effort);
    else log.warn("llm.not_configured", { reason: "ANTHROPIC_API_KEY missing" });
  } else if (provider === "nvidia" || provider === "openai") {
    if (!apiKey) log.warn("llm.not_configured", { reason: provider === "nvidia" ? "NVIDIA_API_KEY missing" : "LLM_API_KEY missing" });
    else if (!baseUrl) log.warn("llm.not_configured", { reason: "LLM_BASE_URL missing" });
    else client = new OpenAiCompatLlmClient(apiKey, model, { baseUrl, thinking });
  } else if (provider === "mock") {
    if (production) log.error("llm.mock_refused_in_production", {});
    else client = new MockLlmClient();
  }
  cached = { key, client };
  return client;
}
