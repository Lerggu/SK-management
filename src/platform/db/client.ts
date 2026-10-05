import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** Transaction client handed to repositories. */
export type Tx = Prisma.TransactionClient;

// ── V8: row-level security scope ─────────────────────────────────────
/**
 * The company a service call runs for. While a scope is active, every query
 * runs as the database role `sk_app` with `app.company_id` set, so PostgreSQL
 * row-level security (migration v8_rls) filters rows even if a repository
 * forgot its company condition. docs/adr/0022-row-level-security.md.
 */
export interface TenantScope {
  companyId: string;
  organizationId: string;
}

export const APP_DB_ROLE = "sk_app";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scopeStore = new AsyncLocalStorage<TenantScope>();

/** Runs `fn` with a tenant scope (used by the service registry wrapper). */
export function withTenantScope<T>(scope: TenantScope, fn: () => T): T {
  if (!UUID.test(scope.companyId) || !UUID.test(scope.organizationId)) throw new Error("Invalid tenant scope");
  return scopeStore.run(scope, fn);
}

export function currentTenantScope(): TenantScope | undefined {
  return scopeStore.getStore();
}

function scopeStatements(client: PrismaClient | Tx, scope: TenantScope) {
  return [
    client.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`),
    client.$executeRaw`SELECT set_config('app.company_id', ${scope.companyId}, true), set_config('app.organization_id', ${scope.organizationId}, true)`,
  ] as const;
}

/**
 * Runs `fn` in a database transaction. Services use this so that the change
 * and its audit event commit (or roll back) together. Inside a tenant scope
 * the transaction runs under row-level security.
 */
export function runInTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const scope = currentTenantScope();
  return db.$transaction(
    async (tx) => {
      if (scope) {
        const [role, config] = scopeStatements(tx, scope);
        await role;
        await config;
      }
      return fn(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 },
  );
}

const scopedClients = new Map<string, Tx>();

/** A client whose every model query runs in a short RLS-scoped transaction. */
function scopedClient(scope: TenantScope): Tx {
  const key = `${scope.companyId}:${scope.organizationId}`;
  let client = scopedClients.get(key);
  if (!client) {
    client = db.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const [, , result] = await db.$transaction([...scopeStatements(db, scope), query(args)]);
            return result;
          },
        },
      },
    }) as unknown as Tx;
    if (scopedClients.size > 500) scopedClients.clear();
    scopedClients.set(key, client);
  }
  return client;
}

/** Read-only access outside a transaction (row-level security inside a tenant scope). */
export function readClient(): Tx {
  const scope = currentTenantScope();
  return scope ? scopedClient(scope) : db;
}

export { Prisma };
