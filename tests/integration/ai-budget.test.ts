/**
 * Serialized AI budget holds (ADR 0035): runs in progress at the same time
 * reserve the monthly cap, so they cannot all pass the cap check; holds are
 * released when the cost is recorded and ignored once expired.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { FakeAiProvider, setAiProviderForTests } from "@/platform/ai";
import { HOLD_EUR, releaseBudget, reserveBudget } from "@/modules/ai/budget";
import { aiProjectControllerService } from "@/modules/ai/service";
import { projectService } from "@/modules/projects/service";
import { createTenant, type Tenant } from "../helpers/fixtures";

let t: Tenant;
let projectId: string;

beforeAll(async () => {
  t = await createTenant("AiHold");
  projectId = (await projectService.create(t.ownerCtx, { code: "H-1", name: "Hold project" })).id;
});

afterEach(() => setAiProviderForTests(new FakeAiProvider()));

describe("AI budget holds", () => {
  it("concurrent runs reserve the cap: the third is blocked before any finishes", async () => {
    await aiProjectControllerService.setBudget(t.ownerCtx, { monthlyBudgetEur: "0,40" });
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const fake = new FakeAiProvider({ costUsd: 0.3, gate });
    setAiProviderForTests(fake);

    const runs = [0, 1, 2].map(() => aiProjectControllerService.review(t.ownerCtx, projectId));
    // Two runs hold 0.30 € + 0.10 € of the 0.40 € cap; the third cannot start.
    await expect.poll(() => db.aiBudgetHold.count({ where: { companyId: t.companyId } })).toBe(2);
    await expect.poll(() => db.aiRun.count({ where: { companyId: t.companyId, status: "BLOCKED_BUDGET" } })).toBe(1);
    expect(fake.requests).toHaveLength(2);

    open();
    const statuses = (await Promise.all(runs)).map((r) => r.status).sort();
    expect(statuses).toEqual(["BLOCKED_BUDGET", "SUCCEEDED", "SUCCEEDED"]);
    expect(await db.aiBudgetHold.count({ where: { companyId: t.companyId } })).toBe(0);
  });

  it("holds are per company and pool, expire, and are released", async () => {
    const other = await createTenant("AiHoldOther");
    const remaining = async () => "1.00";
    const a = await reserveBudget(t.companyId, "AI", remaining);
    expect(a).not.toBeNull();
    expect(Number((await db.aiBudgetHold.findUniqueOrThrow({ where: { id: a! } })).amountEur)).toBe(HOLD_EUR);

    // Another company and the marketing pool have their own caps.
    expect(await reserveBudget(other.companyId, "AI", async () => "0.15")).not.toBeNull();
    expect(await reserveBudget(t.companyId, "MARKETING", async () => "0.15")).not.toBeNull();

    // 1.00 − 0.30 − 0.30 − 0.30 = 0.10 left: one more small hold, then none.
    expect(await reserveBudget(t.companyId, "AI", remaining)).not.toBeNull();
    expect(await reserveBudget(t.companyId, "AI", remaining)).not.toBeNull();
    expect(await reserveBudget(t.companyId, "AI", remaining)).not.toBeNull();
    expect(await reserveBudget(t.companyId, "AI", remaining)).toBeNull();

    // Twenty minutes later every hold has expired (a crashed run does not block forever).
    const later = new Date(Date.now() + 20 * 60_000);
    expect(await reserveBudget(t.companyId, "AI", remaining, { now: later })).not.toBeNull();

    await db.aiBudgetHold.deleteMany({ where: { companyId: { in: [t.companyId, other.companyId] } } });
    await releaseBudget(t.companyId, a!); // already gone: no error
  });
});
