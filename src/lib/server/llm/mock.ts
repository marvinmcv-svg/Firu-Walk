// Deterministic LlmClient for development and tests (no network, no key).
// Recognizes a few intents, calls the matching tool like a real model would,
// and answers from the tool result. Usage is estimated from text length and
// priced like the production model, so spend caps can be exercised.

import { costMicroUsd } from "./pricing";
import type { LlmChatRequest, LlmChatResult, LlmClient, LlmToolCall } from "./types";

const INTENTS: { tool: string; re: RegExp; input: (text: string) => Record<string, unknown> }[] = [
  {
    tool: "contact_human",
    re: /\b(humano|persona|human|agente|agent)\b/i,
    input: () => ({ reason: "El visitante pidió hablar con una persona." }),
  },
  {
    tool: "start_booking",
    re: /\b(reserv\w*|agend\w*|book\w*)\b/i,
    input: (t) => ({ ...durationOf(t) }),
  },
  {
    tool: "check_zone_coverage",
    re: /\b(zona|barrio|llegan|cubren|zone|area|cover\w*)\b/i,
    input: (t) => ({ place: t }),
  },
  {
    tool: "check_price",
    re: /\b(precio\w*|cu[aá]nto|cuesta|tarifa\w*|price\w*|cost\w*|how much)\b/i,
    input: (t) => ({ ...durationOf(t) }),
  },
];

function durationOf(text: string): { durationMin?: number } {
  const m = text.match(/\b(30|45|60)\s*(min|minutos|minutes)?\b/i);
  return m ? { durationMin: Number(m[1]) } : {};
}

const tokens = (s: string) => Math.ceil(s.length / 4);

export class MockLlmClient implements LlmClient {
  readonly name = "mock" as const;
  readonly model = "mock";

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const toolCalls: LlmToolCall[] = [];
    let text: string;
    const intent = INTENTS.find((i) => i.re.test(last) && req.tools.some((t) => t.name === i.tool));
    if (intent) {
      const input = intent.input(last);
      const out = await req.runTool(intent.tool, input);
      toolCalls.push({ name: intent.tool, input, ok: !out.isError });
      text = `[mock] ${intent.tool}: ${out.content}`;
    } else {
      text = "[mock] ¡Guau! 🐾 ¿En qué te ayudo con tu peludo?";
    }
    if (req.note) text += ` [note] ${req.note}`;

    const inputTokens =
      tokens(req.system) + req.messages.reduce((a, m) => a + tokens(m.content), 0) + tokens(JSON.stringify(req.tools));
    const outputTokens = tokens(text);
    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costMicroUsd: costMicroUsd("claude-opus-5-5", { uncachedInput: inputTokens, output: outputTokens, cacheRead: 0, cacheWrite: 0 }),
      },
      toolCalls,
      model: this.model,
      stopReason: "end_turn",
    };
  }
}
