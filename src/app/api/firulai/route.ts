// POST /api/firulai — FirulAI, the FiruWalk dog receptionist (Milestone 9).
// Body: { messages: {role:"user"|"assistant", content}[], lang:"es"|"en", conversationId? }
// → 200 { reply, actions, conversationId, degraded? }
//     actions: buttons for the chat ("booking" deep link, "whatsapp" handoff)
//     degraded: "llm_error" | "limit" | "disabled" — a canned reply was used
//   400 invalid body · 429 too many messages per minute
//
// The model runs behind LlmClient (src/lib/server/llm). The system prompt is
// built from live Config + zones. Guardrails: no diagnosis (operator note +
// vet advice appended), card numbers redacted, read-only tools only (no
// payments), WhatsApp handoff. Every exchange is logged (visitors see a
// notice in the chat) and counted against per-IP and daily spend caps.

import { z } from "zod";
import { db } from "@/lib/db";
import { getAppConfig } from "@/lib/server/config";
import { fail, ok, readJson } from "@/lib/server/http";
import { log } from "@/lib/server/log";
import { rateLimit } from "@/lib/server/rateLimit";
import { clientIp } from "@/lib/server/request";
import { getSessionUser } from "@/lib/server/session";
import { isDemoMode } from "@/lib/server/auth/demo";
import { getLlmClient } from "@/lib/server/llm";
import { EMPTY_USAGE, type LlmChatResult, type LlmTurn } from "@/lib/server/llm/types";
import { buildSystemPrompt, type Lang } from "@/lib/server/firulai/prompt";
import { runFirulaiTool, TOOL_DEFS, whatsappLink, type FirulaiAction } from "@/lib/server/firulai/tools";
import { ensureVetAdvice, looksMedical, medicalNote, plainText, redactPaymentData } from "@/lib/server/firulai/guardrails";
import { checkCaps, ipHashOf, logExchange, recordUsage, resolveConversation, type CapHit } from "@/lib/server/firulai/usage";

const MAX_TURNS = 10; // history window sent to the model
const MAX_PER_MSG = 2000; // per-message char cap
const MAX_TOTAL = 6000; // whole-history char budget
const LLM_TIMEOUT_MS = 30_000;
const RATE_LIMIT = 20; // requests per minute per IP
const RATE_WINDOW_MS = 60_000;

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1, "Mensaje vacío."),
      })
    )
    .min(1, "Sin mensajes para responder.")
    .max(60),
  lang: z.enum(["es", "en"]).optional(),
  conversationId: z.string().regex(/^[a-z0-9]{10,40}$/).nullish(),
});

const CANNED: Record<"llm_error" | "disabled" | CapHit, Record<Lang, string>> = {
  llm_error: {
    es: "¡Guau! 🐾 Mis patitas están ocupadas ahora mismo. Escribinos por WhatsApp y el equipo te ayuda al toque.",
    en: "Woof! 🐾 My paws are a bit busy right now. Message us on WhatsApp and the team will help you out.",
  },
  disabled: {
    es: "¡Guau! 🐾 Hoy estoy descansando. Escribinos por WhatsApp y el equipo te ayuda al toque.",
    en: "Woof! 🐾 I'm resting today. Message us on WhatsApp and the team will help you out.",
  },
  ip_messages: {
    es: "¡Guau! 🐾 Ya charlamos un montón hoy. Para seguir, escribinos por WhatsApp y una persona del equipo te ayuda.",
    en: "Woof! 🐾 We've chatted a lot today. To keep going, message us on WhatsApp and a person from the team will help.",
  },
  ip_cost: {
    es: "¡Guau! 🐾 Ya charlamos un montón hoy. Para seguir, escribinos por WhatsApp y una persona del equipo te ayuda.",
    en: "Woof! 🐾 We've chatted a lot today. To keep going, message us on WhatsApp and a person from the team will help.",
  },
  global_cost: {
    es: "¡Guau! 🐾 Hoy tuve muchísimas consultas y necesito una siesta. Escribinos por WhatsApp y el equipo te ayuda al toque.",
    en: "Woof! 🐾 I've had lots of questions today and need a nap. Message us on WhatsApp and the team will help you out.",
  },
};

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limit = await rateLimit(`firulai:ip:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) return fail(429, "Demasiadas consultas seguidas. Esperá un momentito 🐾");

  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Cuerpo de la petición inválido.");
  const lang: Lang = parsed.data.lang === "en" ? "en" : "es";
  const turns: LlmTurn[] = parsed.data.messages.map((m) => ({
    role: m.role,
    content: redactPaymentData(m.content.slice(0, MAX_PER_MSG)),
  }));
  if (turns[turns.length - 1].role !== "user") return fail(400, "El último mensaje debe ser del usuario.");
  // The model expects the conversation to start with the visitor.
  while (turns.length > 1 && turns[0].role !== "user") turns.shift();
  let window = turns.slice(-MAX_TURNS);
  while (window.length > 1 && window.reduce((a, t) => a + t.content.length, 0) > MAX_TOTAL) window = window.slice(1);
  while (window.length > 1 && window[0].role !== "user") window = window.slice(1);
  const userText = window[window.length - 1].content;

  const [cfg, zones, plans, viewer] = await Promise.all([
    getAppConfig(),
    db.zone.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { key: true, name: true } }),
    db.plan.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { name: true, walks: true, durationMin: true, priceCents: true },
    }),
    getSessionUser(req).catch(() => null),
  ]);
  const ipHash = ipHashOf(ip);
  const actions: FirulaiAction[] = [];
  const waHandoff = (): FirulaiAction => ({
    type: "whatsapp",
    url: whatsappLink(
      cfg.platform.supportWhatsApp,
      lang === "en" ? "Hi FiruWalk 🐾 I'm coming from the FirulAI chat." : "Hola FiruWalk 🐾 Vengo del chat de FirulAI."
    ),
  });

  let conversationId: string | null = null;
  try {
    conversationId = await resolveConversation({
      conversationId: parsed.data.conversationId ?? null,
      userId: viewer?.id ?? null,
      ipHash,
      lang,
    });
  } catch (err) {
    log.warn("firulai.conversation_failed", { err });
  }

  // ---- canned replies: switched off, or over a cap ----
  const blocked: "disabled" | CapHit | null = !cfg.ai.enabled ? "disabled" : await checkCaps(cfg, ipHash);
  let result: LlmChatResult | null = null;
  let degraded: string | null = null;

  if (blocked) {
    degraded = blocked === "disabled" ? "disabled" : "limit";
    actions.push(waHandoff());
    log.info("firulai.blocked", { reason: blocked });
  } else {
    const llm = getLlmClient();
    const medical = looksMedical(userText);
    const startedAt = Date.now();
    try {
      if (!llm) throw new Error("LLM not configured");
      let timer: ReturnType<typeof setTimeout> | undefined;
      result = await Promise.race([
        llm.chat({
          system: buildSystemPrompt(cfg, zones.map((z) => z.name), lang, { demoMode: isDemoMode() }),
          messages: window,
          note: medical ? medicalNote(lang) : null,
          tools: TOOL_DEFS,
          runTool: (name, input) => runFirulaiTool(name, input, { cfg, zones, plans, appUrl: appUrl(), lang, actions }),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("LLM timeout")), LLM_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      if (result.stopReason === "refusal" || !result.text) throw new Error(`no answer (${result.stopReason})`);
      result = { ...result, text: medical ? ensureVetAdvice(plainText(result.text), lang) : plainText(result.text) };
      // Never log message content to the app logs — only sizes and timings.
      log.info("firulai.ok", {
        provider: llm.name,
        model: result.model,
        turns: window.length,
        tools: result.toolCalls.map((c) => c.name),
        inputTokens: result.usage.inputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        outputTokens: result.usage.outputTokens,
        costMicroUsd: result.usage.costMicroUsd,
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      // A partial run (e.g. refusal after tool calls) still cost tokens: keep its usage.
      result = result ? { ...result, text: "" } : null;
      degraded = "llm_error";
      if (!actions.some((a) => a.type === "whatsapp")) actions.push(waHandoff());
      log.warn("firulai.degraded", {
        reason: (err instanceof Error ? err.message : "unknown").slice(0, 200),
        turns: window.length,
        ms: Date.now() - startedAt,
      });
    }
  }

  const reply = blocked ? CANNED[blocked][lang] : degraded ? CANNED.llm_error[lang] : result!.text;
  const usage = result?.usage ?? EMPTY_USAGE;

  // ---- usage + log (never fails the reply) ----
  try {
    if (!blocked) await recordUsage(ipHash, usage);
    if (conversationId) {
      await logExchange({
        conversationId,
        userText,
        reply,
        toolCalls: result?.toolCalls ?? [],
        usage,
        degraded,
        handoff: actions.some((a) => a.type === "whatsapp"),
      });
    }
  } catch (err) {
    log.warn("firulai.log_failed", { err });
  }

  return ok({ reply, actions, conversationId, ...(degraded ? { degraded } : {}) });
}
