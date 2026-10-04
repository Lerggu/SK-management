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

/**
 * Runs `fn` in a database transaction. Services use this so that the change
 * and its audit event commit (or roll back) together.
 */
export function runInTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
}

/** Read-only access outside a transaction. */
export function readClient(): Tx {
  return db;
}

export { Prisma };
