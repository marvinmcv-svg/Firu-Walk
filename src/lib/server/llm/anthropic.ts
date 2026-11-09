// Anthropic (Claude) implementation of LlmClient.
//
// - Model from LLM_MODEL (default claude-opus-5-5), effort from LLM_EFFORT
//   (default "low": short receptionist answers, lowest latency and cost).
// - Server-side refusal fallbacks are on ("default" routing): if the model
//   declines, the API retries on a fallback model inside the same call.
// - The system prompt is sent as a cached block, so repeated chats only pay
//   full price for the new turns.
// - Tool loop is run here (manual loop, max `maxRounds` model calls); the
//   caller's runTool executes our own tools — FirulAI has no payment tools.

import Anthropic from "@anthropic-ai/sdk";
import { costMicroUsd } from "./pricing";
import type { LlmChatRequest, LlmChatResult, LlmClient, LlmToolCall, LlmUsage } from "./types";

type Msg = Anthropic.Beta.Messages.BetaMessageParam;
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const MAX_TOKENS = 2048; // thinking + a 2–4 sentence answer fits comfortably
const REQUEST_TIMEOUT_MS = 25_000;

export class AnthropicLlmClient implements LlmClient {
  readonly name = "anthropic" as const;
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    private effort: Effort,
    /** Tests: a fake fetch standing in for the API. */
    fetchImpl?: typeof fetch
  ) {
    this.client = new Anthropic({
      apiKey,
      maxRetries: fetchImpl ? 0 : 1,
      timeout: REQUEST_TIMEOUT_MS,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    const messages: Msg[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
    if (req.note) messages.push({ role: "system", content: req.note });

    const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0 };
    const toolCalls: LlmToolCall[] = [];
    const maxRounds = req.maxRounds ?? 4;
    let model = this.model;

    for (let round = 0; round < maxRounds; round++) {
      const res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: this.effort },
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        messages,
      });

      model = res.model;
      const u = res.usage;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheWrite = u.cache_creation_input_tokens ?? 0;
      usage.inputTokens += u.input_tokens + cacheRead + cacheWrite;
      usage.outputTokens += u.output_tokens;
      usage.cacheReadTokens += cacheRead;
      usage.cacheWriteTokens += cacheWrite;
      usage.costMicroUsd += costMicroUsd(res.model, {
        uncachedInput: u.input_tokens,
        output: u.output_tokens,
        cacheRead,
        cacheWrite,
      });

      const text = res.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (res.stop_reason === "tool_use") {
        const uses = res.content.filter(
          (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use"
        );
        // Keep the full assistant content (thinking blocks included) — the
        // API requires it unchanged within the tool loop.
        messages.push({ role: "assistant", content: res.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
        const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
        for (const use of uses) {
          const out = await req.runTool(use.name, use.input).catch((err: unknown) => ({
            content: JSON.stringify({ error: (err as Error)?.message ?? "tool failed" }),
            isError: true,
          }));
          toolCalls.push({ name: use.name, input: use.input, ok: !out.isError });
          results.push({ type: "tool_result", tool_use_id: use.id, content: out.content, is_error: out.isError });
        }
        messages.push({ role: "user", content: results });
        continue;
      }

      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
        continue;
      }

      return { text, usage, toolCalls, model, stopReason: res.stop_reason ?? "end_turn" };
    }
    return { text: "", usage, toolCalls, model, stopReason: "max_rounds" };
  }
}
