// Print the ADMIN_PASSWORD_HASH value for a password (set it in Vercel env).
//   bun scripts/hash-password.ts 'my password'
import { hashPassword } from "../src/lib/server/auth/password";

const pw = process.argv[2];
if (!pw) {
  console.error("Usage: bun scripts/hash-password.ts '<password>'");
  process.exit(1);
}
console.log(hashPassword(pw));
