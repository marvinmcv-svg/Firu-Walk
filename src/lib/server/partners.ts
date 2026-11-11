// Partner program (Phase 3 growth): vets, pet shops, groomers, condominium
// administrations and relocation agencies send owners with their own code.
// Rewards are settled in referrals.ts (rewardPartnerIfDue); this module
// holds the admin-side pieces: codes, stats and the DTO.

import type { Partner } from "@prisma/client";
import { db } from "@/lib/db";
import type { PartnerDTO } from "@/lib/firu/types";
import { normalizeCode, partnerAccount } from "./referrals";

/** Public base URL for share links / QR: APP_URL, else the request origin. */
export function appBaseUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export const partnerShareUrl = (base: string, code: string) => `${base}/?ref=${encodeURIComponent(code)}`;

/** A free code for a new partner: letters of its name + 2 digits ("VETSOL27"). */
export async function suggestPartnerCode(name: string): Promise<string> {
  const stem = normalizeCode(name).replace(/[0-9]/g, "").slice(0, 6) || "FIRU";
  for (let i = 0; i < 20; i++) {
    const code = `${stem}${10 + Math.floor(Math.random() * 90)}`;
    if (!(await codeTaken(code))) return code;
  }
  return `${stem}${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

/** Codes are shared between owners and partners (one sign-up field). */
export async function codeTaken(code: string, exceptPartnerId?: string): Promise<boolean> {
  const [user, partner] = await Promise.all([
    db.user.findUnique({ where: { referralCode: code }, select: { id: true } }),
    db.partner.findUnique({ where: { code }, select: { id: true } }),
  ]);
  return !!user || (!!partner && partner.id !== exceptPartnerId);
}

/** Partners with their funnel and money (one query per metric, all partners). */
export async function partnerList(base: string): Promise<PartnerDTO[]> {
  const partners = await db.partner.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }] });
  if (partners.length === 0) return [];
  const ids = partners.map((p) => p.id);
  const [owners, activated, walks, ledger] = await Promise.all([
    db.user.groupBy({ by: ["partnerId"], where: { partnerId: { in: ids } }, _count: true }),
    db.user.groupBy({ by: ["partnerId"], where: { partnerId: { in: ids }, partnerRewardedAt: { not: null } }, _count: true }),
    db.walk.findMany({
      where: { status: "COMPLETED", owner: { partnerId: { in: ids } } },
      select: { owner: { select: { partnerId: true } } },
    }),
    db.ledgerEntry.groupBy({
      by: ["account"],
      where: { account: { in: ids.map(partnerAccount) } },
      _sum: { debitCents: true, creditCents: true },
    }),
  ]);
  const count = (rows: { partnerId: string | null; _count: number }[]) =>
    new Map(rows.map((r) => [r.partnerId, r._count]));
  const ownersBy = count(owners);
  const activatedBy = count(activated);
  const walksBy = new Map<string, number>();
  for (const w of walks) {
    const id = w.owner.partnerId!;
    walksBy.set(id, (walksBy.get(id) ?? 0) + 1);
  }
  const money = new Map(ledger.map((l) => [l.account, l._sum]));
  return partners.map((p) => {
    const m = money.get(partnerAccount(p.id));
    return partnerOf(p, base, {
      owners: ownersBy.get(p.id) ?? 0,
      activated: activatedBy.get(p.id) ?? 0,
      walks: walksBy.get(p.id) ?? 0,
      earnedCents: m?.creditCents ?? 0,
      owedCents: (m?.creditCents ?? 0) - (m?.debitCents ?? 0),
    });
  });
}

export function partnerOf(
  p: Partner,
  base: string,
  stats: Pick<PartnerDTO, "owners" | "activated" | "walks" | "earnedCents" | "owedCents"> = {
    owners: 0,
    activated: 0,
    walks: 0,
    earnedCents: 0,
    owedCents: 0,
  }
): PartnerDTO {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    code: p.code,
    contactName: p.contactName,
    contactPhone: p.contactPhone,
    zoneId: p.zoneId,
    notes: p.notes,
    referralFeeCents: p.referralFeeCents,
    giftWalk: p.giftWalk,
    active: p.active,
    shareUrl: partnerShareUrl(base, p.code),
    createdAt: p.createdAt.toISOString(),
    ...stats,
  };
}
