import { Prisma } from "@prisma/client";

export function isUniqueViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export function isForeignKeyViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
}

/** Exclusion-constraint violation (SQLSTATE 23P01), optionally of a named constraint. */
export function isExclusionViolation(e: unknown, constraint?: string): boolean {
  const message = e instanceof Error ? e.message : "";
  return (message.includes("23P01") || message.includes("exclusion constraint")) && (!constraint || message.includes(constraint));
}

/** Check-constraint violation (SQLSTATE 23514), optionally of a named constraint. */
export function isCheckViolation(e: unknown, constraint?: string): boolean {
  const message = e instanceof Error ? e.message : "";
  return (message.includes("23514") || message.includes("check constraint")) && (!constraint || message.includes(constraint));
}
