import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

/**
 * Creates a fresh, fully migrated test database (real PostgreSQL, no mocks).
 * Uses TEST_DATABASE_URL; the database is dropped and recreated each run.
 */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.includes("test")) {
    throw new Error(`Refusing to recreate "${dbName}": test database names must contain "test"`);
  }
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";

  const admin = new PrismaClient({ datasources: { db: { url: maintenance.toString() } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
