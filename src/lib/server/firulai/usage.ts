// FirulAI spend caps and conversation log (Milestone 9).
//
// Caps (Config `ai`, Bolivia calendar day):
//   - dailyMessagesPerIp   replies per visitor IP
//   - dailyCostCentsPerIp  model spend per visitor IP (US cents)
//   - dailyCostCentsTotal  model spend for everyone (US cents)
// Counters live in AiUsageDay ("global" and "ip:<hash>"). The check happens
// before calling the model; a reply can overshoot a cap by at most its own
// cost.
//
// Log: AiConversation + AiMessage. Raw IPs are never stored, only a keyed
// hash. Rows older than `ai.retentionDays` are purged by the daily job.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { AppConfig } from "@/lib/firu/types";
import { keyedHash } from "../auth/crypto";
import { boDateKey } from "../botime";
import type { LlmToolCall, LlmUsage } from "../llm/types";

export const MICRO_PER_CENT = 10_000; // US$0.01 = 10,000 micro-US$

export function ipHashOf(ip: string): string {
  return keyedHash("firulai-ip", ip).slice(0, 32);
}

export type CapHit = "ip_messages" | "ip_cost" | "global_cost";

export async function checkCaps(cfg: AppConfig, ipHash: string, now = new Date()): Promise<CapHit | null> {
  const day = boDateKey(now);
  const rows = await db.aiUsageDay.findMany({ where: { day, key: { in: ["global", `ip:${ipHash}`] } } });
  const global = rows.find((r) => r.key === "global");
  const ip = rows.find((r) => r.key !== "global");
  if (global && global.costMicroUsd >= cfg.ai.dailyCostCentsTotal * MICRO_PER_CENT) return "global_cost";
  if (ip && ip.requests >= cfg.ai.dailyMessagesPerIp) return "ip_messages";
  if (ip && ip.costMicroUsd >= cfg.ai.dailyCostCentsPerIp * MICRO_PER_CENT) return "ip_cost";
  return null;
}

export async function recordUsage(ipHash: string, usage: LlmUsage, now = new Date()): Promise<void> {
  const day = boDateKey(now);
  for (const key of ["global", `ip:${ipHash}`]) {
    await db.aiUsageDay.upsert({
      where: { day_key: { day, key } },
      create: {
        day,
        key,
        requests: 1,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costMicroUsd: usage.costMicroUsd,
      },
      update: {
        requests: { increment: 1 },
        inputTokens: { increment: usage.inputTokens },
        outputTokens: { increment: usage.outputTokens },
        costMicroUsd: { increment: usage.costMicroUsd },
      },
    });
  }
}

/**
 * The conversation to append to: the one the client sent if it belongs to the
 * same visitor (same user, or same IP when signed out), else a new one.
 */
export async function resolveConversation(input: {
  conversationId: string | null;
  userId: string | null;
  ipHash: string;
  lang: string;
}): Promise<string> {
  if (input.conversationId) {
    const c = await db.aiConversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, userId: true, ipHash: true },
    });
    if (c && (input.userId ? c.userId === input.userId : !c.userId && c.ipHash === input.ipHash)) return c.id;
  }
  const created = await db.aiConversation.create({
    data: { userId: input.userId, ipHash: input.ipHash, lang: input.lang },
  });
  return created.id;
}

export async function logExchange(input: {
  conversationId: string;
  userText: string;
  reply: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  degraded: string | null;
  handoff: boolean;
}): Promise<void> {
  await db.$transaction([
    db.aiMessage.create({
      data: { conversationId: input.conversationId, role: "user", content: input.userText.slice(0, 4000) },
    }),
    db.aiMessage.create({
      data: {
        conversationId: input.conversationId,
        role: "assistant",
        content: input.reply.slice(0, 4000),
        toolCalls: input.toolCalls.length ? (input.toolCalls as unknown as Prisma.InputJsonValue) : undefined,
        degraded: input.degraded,
      },
    }),
    db.aiConversation.update({
      where: { id: input.conversationId },
      data: {
        messageCount: { increment: 2 },
        inputTokens: { increment: input.usage.inputTokens },
        outputTokens: { increment: input.usage.outputTokens },
        costMicroUsd: { increment: input.usage.costMicroUsd },
        ...(input.handoff ? { handoff: true } : {}),
      },
    }),
  ]);
}

/** Daily job: delete chats (and their messages) past the retention window. */
export async function purgeOldConversations(cfg: AppConfig, now = new Date()): Promise<number> {
  const days = Math.max(1, cfg.ai.retentionDays);
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const res = await db.aiConversation.deleteMany({ where: { updatedAt: { lt: cutoff } } });
  await db.aiUsageDay.deleteMany({ where: { day: { lt: boDateKey(new Date(now.getTime() - 400 * 86_400_000)) } } });
  return res.count;
}
