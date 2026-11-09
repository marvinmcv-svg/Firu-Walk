// LlmClient — the one interface FirulAI talks to (Milestone 9). The provider
// (Anthropic or an OpenAI-compatible API such as NVIDIA in production, a deterministic mock in development and tests)
// runs the whole tool-use loop and reports token usage + cost so the caller
// can enforce per-IP and daily spend caps.

export interface LlmTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LlmToolDef {
  name: string;
  description: string;
  /** JSON Schema of the tool input (type: "object"). */
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface LlmToolOutcome {
  /** JSON text returned to the model. */
  content: string;
  isError?: boolean;
}

export interface LlmChatRequest {
  /** Stable system prompt (cached by providers that support it). */
  system: string;
  messages: LlmTurn[];
  /**
   * Per-turn operator note (e.g. "the visitor describes symptoms: no
   * diagnosis"). Sent with operator authority after the last user message,
   * never mixed into user text.
   */
  note?: string | null;
  tools: LlmToolDef[];
  runTool: (name: string, input: unknown) => Promise<LlmToolOutcome>;
  /** Max model calls in the tool loop (default 4). */
  maxRounds?: number;
}

export interface LlmUsage {
  inputTokens: number; // uncached + cache writes + cache reads
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicroUsd: number; // millionths of a US dollar
}

export interface LlmToolCall {
  name: string;
  input: unknown;
  ok: boolean;
}

export interface LlmChatResult {
  text: string;
  usage: LlmUsage;
  toolCalls: LlmToolCall[];
  /** Model that produced the final answer. */
  model: string;
  /** "end_turn" | "max_tokens" | "refusal" | "max_rounds" | … */
  stopReason: string;
}

export interface LlmClient {
  readonly name: "anthropic" | "openai" | "mock";
  readonly model: string;
  chat(req: LlmChatRequest): Promise<LlmChatResult>;
}

export const EMPTY_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costMicroUsd: 0,
};
