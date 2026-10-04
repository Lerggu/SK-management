import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * Fresh E2E database: migrate + fictional seed. Runs as part of the
 * Playwright webServer command so it completes before the app starts.
 */
async function prepare() {
  const url = process.env.DATABASE_URL!;
  if (!url.includes("e2e")) throw new Error("Refusing to reset a non-E2E database");
  const name = new URL(url).pathname.slice(1);
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const admin = new PrismaClient({ datasources: { db: { url: maintenance.toString() } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}

prepare().catch((e) => {
  console.error(e);
  process.exit(1);
});
