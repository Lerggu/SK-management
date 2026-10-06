/**
 * Database role bootstrap at container start (ADR 0024). Runs before the
 * migrations when DATABASE_ADMIN_URL (the server administrator, database
 * `postgres`) is set, so nobody has to run SQL by hand. Idempotent:
 *   - sk_owner: application login with the password from DATABASE_URL
 *     (created, or its password re-aligned with DATABASE_URL)
 *   - sk_app:   NOLOGIN row-level-security role; sk_owner holds it WITH ADMIN
 *   - the application database, owned by sk_owner, with sk_owner owning the
 *     `public` schema (on Azure the default owner blocks migrations)
 */
import { PrismaClient } from "@prisma/client";

const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;
const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

function withDatabase(url: string, db: string) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function bootstrapDatabase(adminUrl: string, appUrl: string, log: (m: string) => void = console.log) {
  const app = new URL(appUrl);
  const owner = decodeURIComponent(app.username);
  const password = decodeURIComponent(app.password);
  const database = app.pathname.replace(/^\//, "");
  if (!owner || !password || !database) throw new Error("DATABASE_URL must contain user, password and database");

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const role = await admin.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${quoteLiteral(owner)}`);
    if (role[0].n === 0) {
      await admin.$executeRawUnsafe(`CREATE ROLE ${quoteIdent(owner)} LOGIN PASSWORD ${quoteLiteral(password)}`);
      log(`DB bootstrap: created role ${owner}`);
    } else {
      await admin.$executeRawUnsafe(`ALTER ROLE ${quoteIdent(owner)} PASSWORD ${quoteLiteral(password)}`);
    }
    const appRole = await admin.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'sk_app'`);
    if (appRole[0].n === 0) {
      await admin.$executeRawUnsafe(`CREATE ROLE sk_app NOLOGIN`);
      log("DB bootstrap: created role sk_app");
    }
    await admin.$executeRawUnsafe(`GRANT sk_app TO ${quoteIdent(owner)} WITH ADMIN OPTION`);
    // PostgreSQL 16: the administrator must be able to SET ROLE to the new owner.
    await admin.$executeRawUnsafe(`GRANT ${quoteIdent(owner)} TO CURRENT_USER`);
    const db = await admin.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_database WHERE datname = ${quoteLiteral(database)}`);
    if (db[0].n === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(owner)}`);
      log(`DB bootstrap: created database ${database}`);
    }
    const inDb = new PrismaClient({ datasources: { db: { url: withDatabase(adminUrl, database) } } });
    try {
      await inDb.$executeRawUnsafe(`ALTER SCHEMA public OWNER TO ${quoteIdent(owner)}`);
    } finally {
      await inDb.$disconnect();
    }
    await admin.$executeRawUnsafe(`REVOKE ${quoteIdent(owner)} FROM CURRENT_USER`);
    log("DB bootstrap: roles and schema ok");
  } finally {
    await admin.$disconnect();
  }
}

if (process.argv[1]?.endsWith("db-bootstrap.ts")) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    console.log("DB bootstrap: DATABASE_ADMIN_URL not set — skipped.");
  } else if (!appUrl) {
    console.error("DB bootstrap: DATABASE_URL is not set");
    process.exitCode = 1;
  } else {
    bootstrapDatabase(adminUrl, appUrl).catch((e) => {
      console.error("DB bootstrap failed:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    });
  }
}
