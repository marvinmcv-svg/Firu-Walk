// GET /api/config → AppConfig (server-truth business tunables) + demoMode.
// The demo login code is only exposed while demo mode is on.

import { ok, run } from "@/lib/server/http";
import { getAppConfig } from "@/lib/server/config";
import { isDemoMode } from "@/lib/server/auth/demo";

export async function GET() {
  return run(async () => {
    const cfg = await getAppConfig();
    const demoMode = isDemoMode();
    return ok({ ...cfg, demo: { ...cfg.demo, otpCode: demoMode ? cfg.demo.otpCode : "" }, demoMode });
  });
}
