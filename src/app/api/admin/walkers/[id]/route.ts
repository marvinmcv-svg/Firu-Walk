// PATCH /api/admin/walkers/[id] (id = WalkerProfile id)
// {action:"approve"|"reject"|"suspend"|"reactivate", reason?} → WalkerProfileDTO
// Audit log + notify walker on every decision.

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { notify } from "@/lib/server/notify";
import { walkerProfileOf } from "@/lib/server/serialize";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    const action = optStr(body, "action");
    if (!action) {
      throw new ApiError(400, "Indica una acción: approve, reject, suspend o reactivate.");
    }
    const reason = optStr(body, "reason", { max: 300 }) ?? null;

    const profile = await db.walkerProfile.findUnique({
      where: { id },
      include: { user: true, zone: true },
    });
    if (!profile) throw new ApiError(404, "Perfil de paseador no encontrado.");
    const name = profile.user?.name ?? "El paseador";
    const zoneName = profile.zone?.name ?? "su zona";

    let data: Record<string, unknown>;
    let auditAction: string;
    let title: string;
    let notifBody: string;

    switch (action) {
      case "approve":
        if (profile.status === "ACTIVE") throw new ApiError(400, "Este paseador ya está activo.");
        data = { status: "ACTIVE", approvedAt: new Date(), suspendedReason: null };
        auditAction = "WALKER_APPROVED";
        title = "¡Bienvenido al equipo FiruWalk! 🎉";
        notifBody = `Felicitaciones ${name}, tu solicitud fue aprobada. Ya apareces como paseador verificado en ${zoneName} y puedes recibir solicitudes de reserva.`;
        break;
      case "reject":
        data = { status: "REJECTED" };
        auditAction = "WALKER_REJECTED";
        title = "Actualización de tu solicitud";
        notifBody = `Hola ${name}. Luego de revisar tu solicitud, por ahora no podremos activarte como paseador.${reason ? ` Motivo: «${reason}»` : ""} Puedes volver a aplicar más adelante.`;
        break;
      case "suspend":
        if (profile.status !== "ACTIVE") {
          throw new ApiError(400, "Solo se puede suspender a un paseador activo.");
        }
        data = { status: "SUSPENDED", suspendedReason: reason ?? "Suspendido por el equipo" };
        auditAction = "WALKER_SUSPENDED";
        title = "Cuenta suspendida ⛔";
        notifBody = `Hola ${name}. Tu cuenta fue suspendida${reason ? `: «${reason}»` : "."} Escríbenos por WhatsApp si crees que es un error.`;
        break;
      case "reactivate":
        if (profile.status !== "SUSPENDED") {
          throw new ApiError(400, "Solo se puede reactivar una cuenta suspendida.");
        }
        data = { status: "ACTIVE", suspendedReason: null };
        auditAction = "WALKER_REACTIVATED";
        title = "Cuenta reactivada ✅";
        notifBody = `Hola ${name}. Tu cuenta fue reactivada: ya vuelves a aparecer como paseador en ${zoneName}. ¡A pasear! 🐾`;
        break;
      default:
        throw new ApiError(400, `Acción desconocida: ${action}`);
    }

    const updated = await db.walkerProfile.update({
      where: { id: profile.id },
      data,
      include: { user: true, zone: true },
    });

    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: auditAction,
        entity: "walkerProfile",
        entityId: profile.id,
        detail: reason,
      },
    });
    await notify(profile.userId, "APPLICATION", title, notifBody, "home");

    return ok({
      ...walkerProfileOf(updated, updated.zone?.name ?? ""),
      name: updated.user?.name ?? "",
      phone: updated.user?.phone ?? "",
      avatarUrl: updated.user?.avatarUrl ?? null,
    });
  });
}
