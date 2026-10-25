// GET /api/config → AppConfig (server-truth business tunables)

import { ok, run } from "@/lib/server/http";
import { getAppConfig } from "@/lib/server/config";

export async function GET() {
  return run(async () => ok(await getAppConfig()));
}
