import { Prisma, runInTransaction, type Tx } from "@/platform/db";

/**
 * Serialized reservations of a monthly AI cap (ADR 0035).
 *
 * Checking the cap and then calling the provider is a race: the cost of a run
 * is known only when it ends, so several runs started at once all saw the same
 * remaining budget (V8 report §5). Now a run first reserves part of the cap in
 * a transaction that holds a per-company, per-pool advisory lock; the next run
 * sees what is used plus what is held. The hold is removed when the run's real
 * cost is recorded, and it expires on its own if the process dies mid-run.
 */
export type BudgetPool = "AI" | "MARKETING";

/** Reserved per run: a generous estimate of one run's cost. */
export const HOLD_EUR = 0.3;
/** A hold older than this no longer counts (the run crashed or timed out). */
export const HOLD_MINUTES = 15;
/** By default a run is not started when less than this is free of the monthly cap. */
export const MIN_FREE_EUR = 0.1;

const lockKey = (companyId: string, pool: BudgetPool) => `ai-budget:${pool}:${companyId}`;

/**
 * Reserves budget for one run. `remainingEur` gives the cap minus recorded
 * costs, read with the transaction it is given. Returns the hold id, or null
 * when less than the minimum is free after the other runs' holds.
 */
export async function reserveBudget(
  companyId: string,
  pool: BudgetPool,
  remainingEur: (tx: Tx) => Promise<Prisma.Decimal.Value>,
  { minFreeEur = MIN_FREE_EUR, now = new Date() }: { minFreeEur?: number; now?: Date } = {},
): Promise<string | null> {
  return runInTransaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(companyId, pool)}, 0))) AS l`;
    await tx.aiBudgetHold.deleteMany({
      where: { companyId, expiresAt: { lte: now } },
    });
    const held = await tx.aiBudgetHold.aggregate({
      where: { companyId, pool, expiresAt: { gt: now } },
      _sum: { amountEur: true },
    });
    const free = new Prisma.Decimal(await remainingEur(tx)).minus(held._sum.amountEur ?? 0);
    if (free.lessThan(minFreeEur)) return null;
    const hold = await tx.aiBudgetHold.create({
      data: {
        companyId,
        pool,
        amountEur: Prisma.Decimal.min(free, HOLD_EUR).toFixed(6),
        expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
      },
      select: { id: true },
    });
    return hold.id;
  });
}

/** Removes a hold once the run's cost is recorded (best effort: holds also expire). */
export async function releaseBudget(companyId: string, holdId: string): Promise<void> {
  try {
    await runInTransaction((tx) => tx.aiBudgetHold.deleteMany({ where: { id: holdId, companyId } }));
  } catch {
    // The hold expires by itself; a failed cleanup must not fail the run.
  }
}

/**
 * Runs `run` under a budget hold, or `blocked` when the cap is used up. The
 * hold is released after `run` has recorded the real cost (or failed).
 */
export async function withBudgetHold<T>(
  companyId: string,
  pool: BudgetPool,
  remainingEur: (tx: Tx) => Promise<Prisma.Decimal.Value>,
  blocked: () => Promise<T>,
  run: () => Promise<T>,
  opts: { minFreeEur?: number } = {},
): Promise<T> {
  const hold = await reserveBudget(companyId, pool, remainingEur, opts);
  if (!hold) return blocked();
  try {
    return await run();
  } finally {
    await releaseBudget(companyId, hold);
  }
}
