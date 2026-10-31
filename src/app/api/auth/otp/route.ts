// POST /api/auth/otp {phone} → {channel, resendInSeconds, demo}
// Sends a 6-digit login code (WhatsApp → SMS). Rate limited per phone and IP,
// 60 s resend cooldown. In demo mode nothing is sent (code = config.demo.otpCode).

import { ok, readJson, reqStr, run } from "@/lib/server/http";
import { issueLoginCode } from "@/lib/server/auth/otp";
import { requirePhone } from "@/lib/server/auth/phone";
import { clientIp } from "@/lib/server/request";

export async function POST(req: Request) {
  return run(async () => {
    const body = await readJson(req);
    const phone = requirePhone(reqStr(body, "phone", "El teléfono", { max: 30 }));
    return ok(await issueLoginCode(phone, clientIp(req)));
  });
}
