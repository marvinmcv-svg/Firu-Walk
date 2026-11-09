// GET /api/config → AppConfig (server-truth business tunables) + demoMode +
// paymentsMock (the mock payment provider is active: dev "Simular pago").
// The demo login code is only exposed while demo mode is on; the ops alert
// phone numbers only to admins.

import { ok, run } from "@/lib/server/http";
import { getAppConfig } from "@/lib/server/config";
import { isDemoMode } from "@/lib/server/auth/demo";
import { mockPaymentsAllowed } from "@/lib/server/payments";
import { getSessionUser } from "@/lib/server/session";

export async function GET(req: Request) {
  return run(async () => {
    const cfg = await getAppConfig();
    const viewer = await getSessionUser(req).catch(() => null);
    const demoMode = isDemoMode();
    return ok({
      ...cfg,
      demo: { ...cfg.demo, otpCode: demoMode ? cfg.demo.otpCode : "" },
      safety: { ...cfg.safety, opsWhatsApp: viewer?.role === "ADMIN" ? cfg.safety.opsWhatsApp : "" },
      demoMode,
      paymentsMock: mockPaymentsAllowed(),
    });
  });
}
