/// <reference types="bun-types" />
// Runs once before the API test files: points Prisma at the disposable test
// database, applies migrations and loads the demo seed (which WIPES it).

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "Set TEST_DATABASE_URL to a disposable Postgres database (it is wiped), e.g.\n" +
      "  TEST_DATABASE_URL=postgresql://firu:firu@localhost:5432/firuwalk_test bun test"
  );
}
if (url === process.env.DATABASE_URL && !/test/i.test(url)) {
  throw new Error("TEST_DATABASE_URL must not be your development DATABASE_URL.");
}

process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.REDIS_URL; // exercise the Postgres rate-limit path
process.env.DEMO_MODE = "false";
process.env.LOG_LEVEL = "error";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123456789";

for (const cmd of [
  ["bunx", "prisma", "migrate", "deploy"],
  ["bun", "prisma/seed.ts"],
]) {
  const r = Bun.spawnSync(cmd, { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed:\n${r.stderr.toString()}`);
  }
}
