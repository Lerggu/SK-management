import { db } from "@/platform/db";

/** Liveness/readiness for the hosting platform (ADR 0024): the database answers. */
export async function checkHealth(): Promise<{ ok: boolean; database: "ok" | "error" }> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, database: "ok" };
  } catch {
    return { ok: false, database: "error" };
  }
}
