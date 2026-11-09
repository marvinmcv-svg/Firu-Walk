// OpenAI-compatible implementation of LlmClient — used for NVIDIA's hosted
// API (https://integrate.api.nvidia.com/v1, Nemotron models), and works with
// any other /chat/completions endpoint that supports function calling.
//
// - Plain fetch, no SDK. Non-streaming: FirulAI answers in one bubble.
// - Reasoning ("thinking") is off by default for receptionist latency; turn
//   it on with LLM_THINKING=on (sent as chat_template_kwargs.enable_thinking).
//   Reasoning text is never shown or logged.
// - The per-turn operator note is appended to the system message: many open
//   model chat templates only accept a system message in first position.
// - Tool loop runs here (max `maxRounds` model calls), like the Anthropic one.

import { costMicroUsd } from "./pricing";
import type { LlmChatRequest, LlmChatResult, LlmClient, LlmToolCall, LlmUsage } from "./types";

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

const MAX_TOKENS = 2048;
const MAX_TOKENS_THINKING = 8192;
const REQUEST_TIMEOUT_MS = 25_000;

interface ToolCallOut {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCallOut[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface CompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null; tool_calls?: ToolCallOut[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

export class OpenAiCompatLlmClient implements LlmClient {
  readonly name = "openai" as const;
  private fetchImpl: typeof fetch;

  constructor(
    private apiKey: string,
    readonly model: string,
    private opts: { baseUrl?: string; thinking?: boolean } = {},
    /** Tests: a fake fetch standing in for the API. */
    fetchImpl?: typeof fetch
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    const system = req.note ? `${req.system}\n\n[Operator note for this turn]\n${req.note}` : req.system;
    const messages: Msg[] = [{ role: "system", content: system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))];
    const tools = req.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0 };
    const toolCalls: LlmToolCall[] = [];
    const maxRounds = req.maxRounds ?? 4;
    let model = this.model;

    for (let round = 0; round < maxRounds; round++) {
      const res = await this.complete({
        model: this.model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.4,
        max_tokens: this.opts.thinking ? MAX_TOKENS_THINKING : MAX_TOKENS,
        stream: false,
        chat_template_kwargs: { enable_thinking: !!this.opts.thinking },
      });

      model = res.model || this.model;
      const u = res.usage ?? {};
      const input = u.prompt_tokens ?? 0;
      const output = u.completion_tokens ?? 0;
      const cacheRead = Math.min(u.prompt_tokens_details?.cached_tokens ?? 0, input);
      usage.inputTokens += input;
      usage.outputTokens += output;
      usage.cacheReadTokens += cacheRead;
      usage.costMicroUsd += costMicroUsd(model, { uncachedInput: input - cacheRead, output, cacheRead, cacheWrite: 0 });

      const choice = res.choices?.[0];
      const msg = choice?.message ?? {};
      const text = stripThinking(msg.content ?? "");
      const calls = msg.tool_calls ?? [];

      if (calls.length > 0) {
        messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
        for (const call of calls) {
          let input: unknown = {};
          let out: { content: string; isError?: boolean };
          try {
            input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
            out = await req.runTool(call.function.name, input);
          } catch (err) {
            out = { content: JSON.stringify({ error: (err as Error)?.message ?? "tool failed" }), isError: true };
          }
          toolCalls.push({ name: call.function.name, input, ok: !out.isError });
          messages.push({ role: "tool", tool_call_id: call.id, content: out.content });
        }
        continue;
      }

      const finish = choice?.finish_reason ?? "stop";
      const stopReason = finish === "stop" ? "end_turn" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : finish;
      return { text, usage, toolCalls, model, stopReason };
    }
    return { text: "", usage, toolCalls, model, stopReason: "max_rounds" };
  }

  private async complete(body: Record<string, unknown>): Promise<CompletionResponse> {
    const base = (this.opts.baseUrl || NVIDIA_BASE_URL).replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Status only — provider error bodies can echo the prompt.
      throw new Error(`LLM API ${res.status}`);
    }
    return (await res.json()) as CompletionResponse;
  }
}

/** Some templates inline the reasoning as <think>…</think> in content. */
function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "").trim();
}
