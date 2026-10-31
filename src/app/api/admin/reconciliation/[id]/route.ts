// PATCH /api/admin/reconciliation/[id] {resolution} → ReconIssueDTO
// Close an issue after ops fixed it (manual confirm, refund sent, provider
// corrected…). The note is required and audit-logged.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { reconIssueOf } from "@/lib/server/serialize";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const resolution = reqStr(await readJson(req), "resolution", "La nota de resolución", { max: 500 });
    const issue = await db.reconciliationIssue.findUnique({ where: { id } });
    if (!issue) throw new ApiError(404, "Diferencia no encontrada.");
    if (issue.status !== "OPEN") throw new ApiError(400, "Esta diferencia ya fue resuelta.");
    const updated = await db.reconciliationIssue.update({
      where: { id },
      data: { status: "RESOLVED", resolution, resolvedById: admin.id, resolvedAt: new Date() },
    });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "RECON_ISSUE_RESOLVED", entity: "reconciliationIssue", entityId: id, detail: resolution },
    });
    return ok(reconIssueOf(updated));
  });
}
