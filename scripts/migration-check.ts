/**
 * Migration test (CLAUDE.md "Testing rules"):
 *   1. create an empty database,
 *   2. apply all migrations,
 *   3. verify there is no drift between migrations and schema.prisma,
 *   4. run the seed against it.
 * Exits non-zero on any failure. Usage: pnpm test:migrations
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!base) throw new Error("TEST_DATABASE_URL or DATABASE_URL must be set");

function withDb(url: string, name: string) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

const target = withDb(base, "sk_management_migcheck");
const shadow = withDb(base, "sk_management_migcheck_shadow");

async function recreate(name: string) {
  const admin = new PrismaClient({ datasources: { db: { url: withDb(base!, "postgres") } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }
}

function run(step: string, cmd: string, env: Record<string, string>) {
  console.log(`\n▶ ${step}\n  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

async function main() {
  await recreate("sk_management_migcheck");
  await recreate("sk_management_migcheck_shadow");
  run("Apply migrations to an empty database", "npx prisma migrate deploy", { DATABASE_URL: target });
  run(
    "Check for schema drift (migrations vs schema.prisma)",
    `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "${shadow}" --exit-code`,
    { DATABASE_URL: target },
  );
  run("Check database matches schema.prisma", `npx prisma migrate diff --from-url "${target}" --to-schema-datamodel prisma/schema.prisma --exit-code`, { DATABASE_URL: target });
  run("Run the seed", "npx tsx prisma/seed.ts", { DATABASE_URL: target });

  const db = new PrismaClient({ datasources: { db: { url: target } } });
  const [companies, permissions, audit] = await Promise.all([db.company.count(), db.permission.count(), db.auditEvent.count()]);
  await db.$disconnect();
  if (companies !== 2 || permissions === 0 || audit === 0) throw new Error(`Seed verification failed (companies=${companies}, permissions=${permissions}, audit=${audit})`);
  console.log(`\n✔ Migration check passed: companies=${companies}, permissions=${permissions}, audit events=${audit}`);
}

main().catch((e) => {
  console.error("✖ Migration check failed:", e.message ?? e);
  process.exit(1);
});
