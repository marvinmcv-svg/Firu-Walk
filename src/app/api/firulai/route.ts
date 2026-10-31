// POST /api/firulai — FirulAI, the FiruWalk dog receptionist.
// Body: { messages: {role:"user"|"assistant", content:string}[], lang:"es"|"en" }
// → 200 { reply: string } · 200 { reply, degraded: true } on LLM failure
//   (the UI never breaks) · 400/429 { error }.
// The system prompt is seeded with LIVE business data (Config table + zones),
// so answers always match the running product. z-ai-web-dev-sdk is backend-only.

import { db } from "@/lib/db";
import { getAppConfig } from "@/lib/server/config";
import { fail, ok } from "@/lib/server/http";
import { log } from "@/lib/server/log";
import ZAI from "z-ai-web-dev-sdk";

type Lang = "es" | "en";
interface Turn {
  role: "user" | "assistant";
  content: string;
}

const MAX_TURNS = 10; // history window sent to the LLM
const MAX_PER_MSG = 2000; // per-message char cap
const MAX_TOTAL = 6000; // whole-history char budget
const LLM_TIMEOUT_MS = 30_000;
const RATE_LIMIT = 20; // requests per window per IP
const RATE_WINDOW_MS = 60_000;

/** Hardcoded graceful fallbacks (both languages) — used when the LLM fails. */
const FALLBACK: Record<Lang, string> = {
  es: "¡Guau! 🐾 Mis patitas están ocupadas ahora mismo. Escribinos por WhatsApp y el equipo humano te ayuda al toque: https://wa.me/59177165787",
  en: "Woof! 🐾 My paws are a bit busy right now. Message us on WhatsApp and the human team will help you out: https://wa.me/59177165787",
};

/* ---------------- Naive in-memory rate limit (per instance) ---------------- */

const hits = new Map<string, { count: number; resetAt: number }>();

function overRate(ip: string): boolean {
  const now = Date.now();
  // occasional sweep so the map never grows unbounded
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k);
    }
  }
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

/* ------------------------------ helpers ------------------------------ */

/** Integer centavos → "Bs 15" / "Bs 15.50" (prompt-friendly money format). */
function bs(cents: number): string {
  const v = cents / 100;
  return `Bs ${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

function buildSystemPrompt(
  cfg: Awaited<ReturnType<typeof getAppConfig>>,
  zoneNames: string[],
  lang: Lang
): string {
  const p = cfg.platform;
  const wa = `https://wa.me/${p.supportWhatsApp.replace(/[^\d]/g, "")}`;
  const zones =
    zoneNames.length > 0 ? zoneNames.join(", ") : "zona por zona (consultá por la tuya)";
  return [
    `You are FirulAI, "la recepcionista perruna de FiruWalk" — you ARE the friendly dog from the FiruWalk logo: a minimalist hand-drawn face, green nose, small red tongue, super friendly. You help families with their dog-walking questions in ${p.city}, Bolivia.`,
    ``,
    `PERSONALITY & RULES:`,
    `- Warm, playful and CONCISE: reply in 2 to 4 short sentences.`,
    `- At most ONE emoji per reply, only 🐾 or 🧡 (optional, not every message).`,
    `- NEVER invent facts beyond the business data below. If you are unsure or lack the data, say so honestly and offer the WhatsApp handoff (${wa}).`,
    `- When the user asks for a human, needs support, or goes off-script, kindly point them to WhatsApp: ${wa}.`,
    ``,
    `LIVE BUSINESS DATA (authoritative):`,
    `- City: ${p.city}, Bolivia.`,
    `- Prices per walk: 30 min = ${bs(cfg.pricing.price30Cents)} · 45 min = ${bs(cfg.pricing.price45Cents)} · 60 min = ${bs(cfg.pricing.price60Cents)}.`,
    `- Guarantee: ${p.guaranteeText}`,
    `- Commission: ${cfg.fees.commissionPct}% charged to the walker (owners pay no extra fee; tips go 100% to the walker).`,
    `- Cancellation policy: free until ${cfg.policy.cancellationFreeHours} hours before the walk; after that, the walker keeps ${cfg.policy.lateCancelWalkerSharePct}% of the walk price.`,
    `- Support WhatsApp: ${p.supportWhatsApp} → ${wa}`,
    `- Covered zones: ${zones}.`,
    ``,
    `HOW FIRUWALK WORKS:`,
    `1. Owners book recurring (or one-off) walks with verified walkers from their zone; matching shows at most 4 candidates.`,
    `2. During the walk, the owner follows it LIVE with GPS tracking.`,
    `3. Afterwards they get a photo report with the route map, distance and pee/poo/water notes, then rate the walker and can leave a tip.`,
    ``,
    `PAYMENTS: QR Simple, bank transfer or cash. Money is held by the platform and released to the walker only when the walk completes with its report.`,
    ``,
    `WALKERS: hand-vetted — ID document + selfie + references reviewed before activation.`,
    ``,
    `DEMO (this is a demo product): any phone number logs in with the SMS code 123456; there is also an "apply as walker" form on the landing page.`,
    ``,
    `LANGUAGE: Reply ONLY in ${
      lang === "es"
        ? "Spanish with a warm Bolivian tone (friendly es-BO, tuteo)"
        : "natural, friendly English"
    }.`,
  ].join("\n");
}

/** Best-effort reply extraction from an OpenAI-style completion object. */
function extractReply(completion: unknown): string | null {
  if (!completion || typeof completion !== "object") return null;
  const c = completion as { choices?: unknown; message?: { content?: unknown }; content?: unknown };
  if (Array.isArray(c.choices) && c.choices.length > 0) {
    const content = (c.choices[0] as { message?: { content?: unknown } })?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
  }
  const alt = c.message?.content ?? c.content;
  if (typeof alt === "string" && alt.trim()) return alt.trim();
  return null;
}

/* -------------------------------- POST -------------------------------- */

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  if (overRate(ip)) {
    return fail(429, "Demasiadas consultas seguidas. Esperá un momentito 🐾");
  }

  // ---- parse + validate body ----
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Cuerpo de la petición inválido.");
  }
  const { messages, lang } = (body ?? {}) as { messages?: unknown; lang?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) {
    return fail(400, "Sin mensajes para responder.");
  }
  const turns: Turn[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") return fail(400, "Mensaje inválido.");
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return fail(400, "Rol de mensaje inválido.");
    if (typeof content !== "string" || !content.trim()) return fail(400, "Mensaje vacío.");
    turns.push({ role, content: content.trim().slice(0, MAX_PER_MSG) });
  }
  if (turns[turns.length - 1].role !== "user") {
    return fail(400, "El último mensaje debe ser del usuario.");
  }
  const useLang: Lang = lang === "en" ? "en" : "es";

  // ---- safety window: last 10 turns, oldest dropped until under budget ----
  let window = turns.slice(-MAX_TURNS);
  while (window.length > 1 && window.reduce((a, t) => a + t.content.length, 0) > MAX_TOTAL) {
    window = window.slice(1);
  }

  // ---- live business data ----
  const [cfg, zones] = await Promise.all([
    getAppConfig(),
    db.zone.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { name: true },
    }),
  ]);
  const systemPrompt = buildSystemPrompt(cfg, zones.map((z) => z.name), useLang);

  // ---- LLM call with timeout; never break the UI ----
  const startedAt = Date.now();
  try {
    const zai = await ZAI.create();
    const completion = await Promise.race([
      zai.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, ...window],
        thinking: { type: "disabled" },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM timeout")), LLM_TIMEOUT_MS)
      ),
    ]);
    const reply = extractReply(completion);
    if (!reply) throw new Error("empty completion");
    // Never log user content — only sizes/timings.
    log.info("firulai.ok", {
      turns: window.length,
      replyChars: reply.length,
      ms: Date.now() - startedAt,
    });
    return ok({ reply });
  } catch (err) {
    const reason = (err instanceof Error ? err.message : "unknown").slice(0, 200);
    log.warn("firulai.degraded", { reason, turns: window.length, ms: Date.now() - startedAt });
    return ok({ reply: FALLBACK[useLang], degraded: true });
  }
}
