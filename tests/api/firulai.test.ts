/// <reference types="bun-types" />
// Milestone 9 — FirulAI to production:
//   - LlmClient: mock intents run the real tools; the Anthropic adapter sends
//     the cached system prompt, fallbacks and effort, runs the tool loop and
//     prices the usage
//   - tools: live prices, zone coverage, booking deep link, WhatsApp handoff;
//     nothing that books or charges
//   - guardrails: no diagnosis (note + vet advice), card numbers redacted
//   - logging (no raw IP), per-IP and daily caps, kill switch, retention purge

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as firulai from "@/app/api/firulai/route";
import * as adminConfig from "@/app/api/admin/config/route";
import * as adminFirulai from "@/app/api/admin/firulai/route";
import * as adminFirulaiConv from "@/app/api/admin/firulai/[id]/route";
import { setLlmClientForTests } from "@/lib/server/llm";
import { MockLlmClient } from "@/lib/server/llm/mock";
import { AnthropicLlmClient } from "@/lib/server/llm/anthropic";
import type { LlmChatRequest, LlmChatResult, LlmClient } from "@/lib/server/llm/types";
import { TOOL_DEFS } from "@/lib/server/firulai/tools";
import { ipHashOf, purgeOldConversations } from "@/lib/server/firulai/usage";
import { getAppConfig } from "@/lib/server/config";
import { call, cookieFor, PHONES } from "./helpers";

type H = Parameters<typeof call>[0];
let ipSeq = 0;
let admin: string;

/** A fresh visitor IP per test keeps the per-minute limit and caps apart. */
function nextIp(): string {
  ipSeq++;
  return `10.9.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`;
}

function ask(text: string | { role: "user" | "assistant"; content: string }[], opts: { ip?: string; lang?: "es" | "en"; conversationId?: string | null } = {}) {
  const messages = typeof text === "string" ? [{ role: "user", content: text }] : text;
  return call(firulai.POST as H, {
    method: "POST",
    headers: { "x-forwarded-for": opts.ip ?? nextIp() },
    body: { messages, lang: opts.lang ?? "es", conversationId: opts.conversationId ?? null },
  });
}

/** Scripted client: records each request and answers with `reply`. */
class Scripted implements LlmClient {
  readonly name = "mock" as const;
  readonly model = "claude-opus-5-5";
  calls: LlmChatRequest[] = [];
  constructor(private reply: string | (() => Promise<LlmChatResult>), private cost = 1000) {}
  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    this.calls.push(req);
    if (typeof this.reply === "function") return this.reply();
    return {
      text: this.reply,
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: this.cost },
      toolCalls: [],
      model: this.model,
      stopReason: "end_turn",
    };
  }
}

async function setAi(patch: Record<string, number>) {
  const r = await call(adminConfig.PATCH as H, { method: "PATCH", cookie: admin, body: { section: "ai", patch } });
  expect(r.status).toBe(200);
}

beforeAll(async () => {
  admin = await cookieFor(PHONES.admin);
  process.env.APP_URL = "https://firu.test";
});

beforeEach(() => setLlmClientForTests(new MockLlmClient()));

afterAll(async () => {
  setLlmClientForTests(undefined);
  await setAi({ enabled: 1, dailyMessagesPerIp: 40, dailyCostCentsPerIp: 50, dailyCostCentsTotal: 1000, retentionDays: 90 });
  await db.aiUsageDay.deleteMany();
});

describe("tools", () => {
  test("no tool can book, pay or touch money", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(names).toEqual(["check_price", "check_zone_coverage", "start_booking", "contact_human"]);
    for (const n of names) expect(n).not.toMatch(/pay|charge|refund|confirm|create/i);
  });

  test("prices come from the live config", async () => {
    const cfg = await getAppConfig();
    const r = await ask("¿Cuánto cuesta un paseo de 45 min?");
    expect(r.status).toBe(200);
    expect(r.json.degraded).toBeUndefined();
    const data = JSON.parse(r.json.reply.replace(/^\[mock\] check_price: /, ""));
    expect(data.asked).toBe(45);
    expect(data.perWalk["45"]).toBe(`Bs ${cfg.pricing.price45Cents / 100}`);
    expect(data.monthlyPlans.length).toBeGreaterThan(0);
    expect(r.json.actions).toEqual([]);
  });

  test("zone coverage matches zones without accents or case", async () => {
    const yes = await ask("¿Llegan a EQUIPETRÓL?");
    const data = JSON.parse(yes.json.reply.replace(/^\[mock\] check_zone_coverage: /, ""));
    expect(data.covered).toBe(true);
    expect(data.zone.key).toBe("equipetrol");
    const no = await ask("¿Cubren la zona de Cochabamba centro?");
    const d2 = JSON.parse(no.json.reply.replace(/^\[mock\] check_zone_coverage: /, ""));
    expect(d2.covered).toBe(false);
    expect(d2.coveredZones.length).toBeGreaterThan(0);
  });

  test("booking returns a deep link button and books nothing", async () => {
    const before = await db.booking.count();
    const r = await ask("Quiero reservar paseos de 45 minutos");
    expect(r.json.actions).toEqual([
      { type: "booking", url: "https://firu.test/?book=1&duration=45", zoneKey: null, durationMin: 45 },
    ]);
    expect(await db.booking.count()).toBe(before);
    expect(await db.payment.count({ where: { createdAt: { gt: new Date(Date.now() - 5000) } } })).toBe(0);
  });

  test("asking for a person hands off to WhatsApp", async () => {
    const r = await ask("Quiero hablar con una persona");
    expect(r.json.actions).toHaveLength(1);
    expect(r.json.actions[0].type).toBe("whatsapp");
    expect(r.json.actions[0].url).toStartWith("https://wa.me/591");
    const conv = await db.aiConversation.findUniqueOrThrow({ where: { id: r.json.conversationId } });
    expect(conv.handoff).toBe(true);
  });
});

describe("guardrails", () => {
  test("health questions: operator note to the model, vet advice guaranteed", async () => {
    const fake = new Scripted("Seguro es una gastritis, dale arroz.");
    setLlmClientForTests(fake);
    const r = await ask("Mi perro vomitó dos veces hoy, ¿qué le doy?");
    expect(fake.calls[0].note).toContain("Do not diagnose");
    expect(r.json.reply).toContain("veterinario");
    const en = await ask("My dog is limping, what medicine can I give?", { lang: "en" });
    expect(en.json.reply).toContain("vet");
    // Non-medical questions carry no note.
    await ask("¿Cuánto cuesta?");
    expect(fake.calls[2].note).toBeNull();
  });

  test("card numbers never reach the model or the log", async () => {
    const fake = new Scripted("No compartas datos de tarjeta por acá 🐾");
    setLlmClientForTests(fake);
    const r = await ask("Te paso mi tarjeta 4111 1111 1111 1111 para pagar");
    const sent = fake.calls[0].messages.at(-1)!.content;
    expect(sent).not.toContain("4111");
    expect(sent).toContain("[número oculto]");
    const logged = await db.aiMessage.findMany({ where: { conversationId: r.json.conversationId } });
    expect(logged.map((m) => m.content).join(" ")).not.toContain("4111");
  });

  test("markdown is flattened for the chat bubble", async () => {
    setLlmClientForTests(new Scripted("## Precios\n**Bs 15** por paseo"));
    const r = await ask("precios?");
    expect(r.json.reply).toBe("Precios\nBs 15 por paseo");
  });

  test("model errors, refusals and a missing key degrade to WhatsApp, never 500", async () => {
    setLlmClientForTests(new Scripted(() => Promise.reject(new Error("overloaded"))));
    const a = await ask("hola");
    expect(a.status).toBe(200);
    expect(a.json.degraded).toBe("llm_error");
    expect(a.json.actions[0].type).toBe("whatsapp");

    setLlmClientForTests(
      new Scripted(async () => ({
        text: "",
        usage: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 77 },
        toolCalls: [],
        model: "claude-opus-5-5",
        stopReason: "refusal",
      }))
    );
    const ip = nextIp();
    const b = await ask("hola", { ip });
    expect(b.json.degraded).toBe("llm_error");
    const usage = await db.aiUsageDay.findFirstOrThrow({ where: { key: `ip:${ipHashOf(ip)}` } });
    expect(usage.costMicroUsd).toBe(77); // the refused attempt still counts

    setLlmClientForTests(null);
    const c = await ask("hola");
    expect(c.json.degraded).toBe("llm_error");
  });

  test("invalid bodies are rejected", async () => {
    expect((await call(firulai.POST as H, { method: "POST", body: { messages: [] } })).status).toBe(400);
    const last = await ask([
      { role: "user", content: "hola" },
      { role: "assistant", content: "hola!" },
    ]);
    expect(last.status).toBe(400);
  });
});

describe("logging", () => {
  test("chats are saved without the raw IP and continue on the same conversation", async () => {
    const ip = "203.0.113.77";
    const first = await ask("hola", { ip });
    const id = first.json.conversationId;
    expect(id).toBeString();
    const second = await ask(
      [
        { role: "user", content: "hola" },
        { role: "assistant", content: first.json.reply },
        { role: "user", content: "¿cuánto cuesta?" },
      ],
      { ip, conversationId: id }
    );
    expect(second.json.conversationId).toBe(id);
    const conv = await db.aiConversation.findUniqueOrThrow({ where: { id }, include: { messages: true } });
    expect(conv.messageCount).toBe(4);
    expect(conv.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(conv.ipHash).not.toContain("203.0.113");
    expect(conv.costMicroUsd).toBeGreaterThan(0);
    expect(conv.messages.find((m) => m.role === "assistant" && m.toolCalls)).toBeTruthy();

    // Someone else can't append to it.
    const other = await ask("hola", { ip: "198.51.100.5", conversationId: id });
    expect(other.json.conversationId).not.toBe(id);
  });

  test("the daily job deletes chats past the retention window", async () => {
    const r = await ask("hola");
    const old = new Date(Date.now() - 100 * 86_400_000);
    await db.$executeRaw`UPDATE "AiConversation" SET "updatedAt" = ${old} WHERE id = ${r.json.conversationId}`;
    const purged = await purgeOldConversations(await getAppConfig());
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await db.aiConversation.count({ where: { id: r.json.conversationId } })).toBe(0);
    expect(await db.aiMessage.count({ where: { conversationId: r.json.conversationId } })).toBe(0);
  });
});

describe("admin view", () => {
  test("usage and conversations are admin-only", async () => {
    const r = await ask("¿Cuánto cuesta?");
    const owner = await cookieFor(PHONES.ana);
    expect((await call(adminFirulai.GET as H, { cookie: owner })).status).toBe(403);
    expect((await call(adminFirulai.GET as H, {})).status).toBe(401);
    const list = await call(adminFirulai.GET as H, { cookie: admin });
    expect(list.status).toBe(200);
    expect(list.json.days[0].requests).toBeGreaterThan(0);
    const row = list.json.conversations.find((c: { id: string }) => c.id === r.json.conversationId);
    expect(row.preview).toBe("¿Cuánto cuesta?");
    expect(JSON.stringify(list.json)).not.toContain("ipHash");
    const one = await call(adminFirulaiConv.GET as H, { cookie: admin, params: { id: r.json.conversationId } });
    expect(one.json.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect((await call(adminFirulaiConv.GET as H, { cookie: owner, params: { id: r.json.conversationId } })).status).toBe(403);
  });
});

describe("caps", () => {
  test("messages per IP per day", async () => {
    await setAi({ dailyMessagesPerIp: 2 });
    const fake = new Scripted("ok");
    setLlmClientForTests(fake);
    const ip = nextIp();
    expect((await ask("hola", { ip })).json.degraded).toBeUndefined();
    expect((await ask("hola", { ip })).json.degraded).toBeUndefined();
    const third = await ask("hola", { ip });
    expect(third.json.degraded).toBe("limit");
    expect(third.json.actions[0].type).toBe("whatsapp");
    expect(fake.calls).toHaveLength(2);
    expect((await ask("hola")).json.degraded).toBeUndefined(); // another visitor is fine
    await setAi({ dailyMessagesPerIp: 40 });
  });

  test("spend per IP and for everyone", async () => {
    await setAi({ dailyCostCentsPerIp: 1 }); // US$0.01 = 10,000 micro
    setLlmClientForTests(new Scripted("ok", 6000));
    const ip = nextIp();
    await ask("hola", { ip });
    await ask("hola", { ip });
    expect((await ask("hola", { ip })).json.degraded).toBe("limit");
    await setAi({ dailyCostCentsPerIp: 50, dailyCostCentsTotal: 0 });
    expect((await ask("hola")).json.degraded).toBe("limit");
    await setAi({ dailyCostCentsTotal: 1000 });
  });

  test("the kill switch answers without calling the model", async () => {
    await setAi({ enabled: 0 });
    const fake = new Scripted("ok");
    setLlmClientForTests(fake);
    const r = await ask("hola");
    expect(r.json.degraded).toBe("disabled");
    expect(fake.calls).toHaveLength(0);
    await setAi({ enabled: 1 });
  });
});

describe("Anthropic adapter", () => {
  test("cached system prompt, fallbacks, effort, tool loop and priced usage", async () => {
    const bodies: Record<string, unknown>[] = [];
    const headers: Headers[] = [];
    const responses = [
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "tool_use", id: "tu_1", name: "check_price", input: { durationMin: 30 } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
      },
      {
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: "Un paseo de 30 min cuesta Bs 15 🐾" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
      },
    ];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      headers.push(new Headers(init.headers));
      return new Response(JSON.stringify(responses[bodies.length - 1]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = new AnthropicLlmClient("sk-test", "claude-opus-5-5", "low", fakeFetch);
    const ran: unknown[] = [];
    const res = await client.chat({
      system: "SYSTEM",
      messages: [{ role: "user", content: "¿Precio?" }],
      note: "operator note",
      tools: TOOL_DEFS,
      runTool: async (name, input) => {
        ran.push([name, input]);
        return { content: '{"perWalk":{"30":"Bs 15"}}' };
      },
    });
    expect(res.text).toBe("Un paseo de 30 min cuesta Bs 15 🐾");
    expect(res.toolCalls).toEqual([{ name: "check_price", input: { durationMin: 30 }, ok: true }]);
    expect(ran).toEqual([["check_price", { durationMin: 30 }]]);

    const first = bodies[0] as { system: { cache_control: unknown }[]; fallbacks: unknown; output_config: unknown; messages: { role: string }[]; model: string };
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.fallbacks).toBe("default");
    expect(first.output_config).toEqual({ effort: "low" });
    expect(first.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(first.messages.map((m) => m.role)).toEqual(["user", "system"]);
    expect(headers[0].get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    // Second call carries the assistant tool_use turn and the tool result.
    const second = bodies[1] as { messages: { role: string; content: unknown }[] };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "system", "assistant", "user"]);

    // 300 uncached × $4 + 80 out × $20 + 2000 cache reads × $0.20 (per M tokens) = 1200 + 1600 + 400 micro-US$
    expect(res.usage.costMicroUsd).toBe(3200);
    expect(res.usage.inputTokens).toBe(2300);
    expect(res.usage.cacheReadTokens).toBe(2000);
  });
});
