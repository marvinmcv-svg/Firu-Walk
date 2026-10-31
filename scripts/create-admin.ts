// Create or promote an ADMIN account. Admins are never created through the
// app's signup flows — only with this script, run by someone with DB access.
//
//   bun scripts/create-admin.ts +59171234567 "Nombre Apellido"

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const [rawPhone, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();
  if (!rawPhone || !name) {
    console.error('Usage: bun scripts/create-admin.ts +5917xxxxxxx "Full Name"');
    process.exit(1);
  }
  let phone = rawPhone.replace(/[\s\-().]/g, "");
  if (/^7\d{7}$/.test(phone)) phone = `+591${phone}`;
  if (/^5917\d{7}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+\d{8,15}$/.test(phone)) {
    console.error(`Invalid phone: ${rawPhone}`);
    process.exit(1);
  }

  const existing = await db.user.findUnique({ where: { phone }, include: { walker: true } });
  if (existing?.walker) {
    console.error("That phone belongs to a walker account; use a different number for admin.");
    process.exit(1);
  }
  const admin = existing
    ? await db.user.update({ where: { id: existing.id }, data: { role: "ADMIN", name } })
    : await db.user.create({ data: { phone, name, role: "ADMIN" } });

  await db.auditLog.create({
    data: { action: "ADMIN_CREATED", entity: "User", entityId: admin.id, detail: `via CLI (${phone})` },
  });
  console.log(`${existing ? "Promoted" : "Created"} ADMIN ${admin.name} (${phone}). Sign in with a login code.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
