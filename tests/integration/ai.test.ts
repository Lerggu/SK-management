/**
 * V8 AI Project Controller (Build Master §26, ADR 0023), with the deterministic
 * test provider: runs are stored with tool calls, cost and result; tools follow
 * the user's permissions; no personal data reaches the provider; the monthly
 * cap blocks runs; model output is validated; recommendations are decided once.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, ValidationError } from "@/platform/errors";
import type { PermissionKey, RequestContext } from "@/platform/authz";
import { FakeAiProvider, setAiProviderForTests } from "@/platform/ai";
import { estimateCostUsd } from "@/platform/ai/anthropic";
import { aiProjectControllerService, monthStart } from "@/modules/ai/service";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { variationService } from "@/modules/commercial/project.service";
import { hseObservationService } from "@/modules/hse/hse.service";
import { createMember, createTenant, type Tenant } from "../helpers/fixtures";

let t: Tenant;
let projectId: string;
let fake: FakeAiProvider;

function useFake(options: ConstructorParameters<typeof FakeAiProvider>[0] = {}) {
  fake = new FakeAiProvider(options);
  setAiProviderForTests(fake);
  return fake;
}

function without(ctx: RequestContext, ...keys: PermissionKey[]): RequestContext {
  return { ...ctx, permissions: new Set([...ctx.permissions].filter((k) => !keys.includes(k))) };
}

beforeAll(async () => {
  t = await createTenant("Ai");
  const p = await projectService.create(t.ownerCtx, { code: "AI-1", name: "AI test project" });
  projectId = p.id;
  await siteService.create(t.ownerCtx, p.id, { name: "AI site" });
  await employeeService.create(t.ownerCtx, { employeeNumber: "AI-E1", firstName: "Personal", lastName: "Name-Should-Not-Leak" });
  await variationService.create(t.ownerCtx, { projectId: p.id, title: "Extra cable route" });
  await hseObservationService.create(t.ownerCtx, { projectId: p.id, kind: "NEAR_MISS", title: "Open trench edge", occurredAt: "2026-10-01T08:00" });
});

afterEach(() => setAiProviderForTests(new FakeAiProvider()));

describe("AI project review", () => {
  it("stores the run, tool calls, cost and recommendations, and audits it", async () => {
    useFake({ costUsd: 0.05 });
    const run = await aiProjectControllerService.review(t.ownerCtx, projectId);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.provider).toBe("fake");
    expect(run.toolCalls.map((c) => c.name).sort()).toEqual(["cost_forecast", "hse_metrics", "lookahead_shortages", "project_overview", "schedule_status", "variations"]);
    expect(run.result?.items.length).toBeGreaterThan(0);
    expect(Number(run.costEur)).toBeCloseTo(0.046, 6); // 0.05 USD × 0.92

    const row = await db.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.promptVersion).toBe("project-controller/1");
    expect(row.requestedById).toBe(t.ownerCtx.user.id);
    const recs = await db.aiRecommendation.findMany({ where: { runId: run.id } });
    expect(recs).toHaveLength(1);
    expect(recs[0].status).toBe("PROPOSED");
    const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: run.id, action: "ai.run" } });
    expect(audit.after).toMatchObject({ status: "SUCCEEDED", provider: "fake", recommendations: 1 });
  });

  it("offers only tools the user may use", async () => {
    useFake();
    await aiProjectControllerService.review(without(t.ownerCtx, "commercial.view", "hse.view"), projectId);
    expect(fake.requests[0].tools.map((x) => x.name).sort()).toEqual(["lookahead_shortages", "project_overview", "schedule_status"]);
  });

  it("sends no personal data (names, e-mails, user ids) to the provider", async () => {
    let seen = "";
    useFake({
      respond: (outputs) => {
        seen = JSON.stringify(outputs);
        return { summary: "ok", items: [] };
      },
    });
    const run = await aiProjectControllerService.review(t.ownerCtx, projectId);
    expect(run.status).toBe("SUCCEEDED");
    expect(seen).toContain("AI-1");
    expect(seen).toContain("Extra cable route");
    for (const secret of ["Name-Should-Not-Leak", t.ownerCtx.user.email, t.ownerCtx.user.id, t.ownerCtx.user.name ?? "x-none"]) {
      expect(seen).not.toContain(secret);
    }
    const prompt = JSON.stringify(fake.requests[0].system + fake.requests[0].prompt);
    expect(prompt).not.toContain(t.ownerCtx.user.email);
  });

  it("answers questions in the user's language", async () => {
    useFake();
    const run = await aiProjectControllerService.ask({ ...t.ownerCtx, locale: "en" }, projectId, { question: "Where is the biggest cost risk?" });
    expect(run.kind).toBe("QUESTION");
    expect(run.question).toBe("Where is the biggest cost risk?");
    expect(fake.requests[0].system).toContain("in English");
    expect(fake.requests[0].prompt).toContain("<question>\nWhere is the biggest cost risk?\n</question>");
    await aiProjectControllerService.ask(t.ownerCtx, projectId, { question: "Mikä on tilanne?" });
    expect(fake.requests[1].system).toContain("in Finnish");
  });

  it("validates questions", async () => {
    await expect(aiProjectControllerService.ask(t.ownerCtx, projectId, { question: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(aiProjectControllerService.ask(t.ownerCtx, projectId, { question: "x".repeat(1001) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects invalid model output and keeps only real evidence", async () => {
    useFake({ respond: () => ({ summary: "", items: "nope" }) });
    const bad = await aiProjectControllerService.review(t.ownerCtx, projectId);
    expect(bad.status).toBe("FAILED");
    expect(bad.error).toBe("ai.errors.invalidResult");
    expect(await db.aiRecommendation.count({ where: { runId: bad.id } })).toBe(0);

    useFake({ respond: () => ({ summary: "s", items: [{ kind: "FACT", severity: "INFO", title: "t", detail: "d", evidence: ["made_up_tool", "project_overview", "project_overview"] }] }) });
    const good = await aiProjectControllerService.review(t.ownerCtx, projectId);
    expect(good.result?.items[0].evidence).toEqual(["project_overview"]);
  });

  it("records provider failures without recommendations", async () => {
    useFake({ fail: "upstream overloaded" });
    const run = await aiProjectControllerService.review(t.ownerCtx, projectId);
    expect(run.status).toBe("FAILED");
    expect(run.error).toBe("upstream overloaded");
  });

  it("is unavailable without a provider", async () => {
    setAiProviderForTests(null);
    await expect(aiProjectControllerService.review(t.ownerCtx, projectId)).rejects.toBeInstanceOf(ValidationError);
    expect((await aiProjectControllerService.overview(t.ownerCtx, projectId)).provider).toBeNull();
  });

  it("requires ai.use", async () => {
    const sm = await createMember(t, "SITE_MANAGER", [{ projectId }]);
    await expect(aiProjectControllerService.overview(sm, projectId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(aiProjectControllerService.review(without(t.ownerCtx, "ai.use"), projectId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("AI monthly budget", () => {
  it("blocks runs when the company's monthly cap is used, without calling the provider", async () => {
    const t2 = await createTenant("AiBudget");
    const p = await projectService.create(t2.ownerCtx, { code: "B-1", name: "Budget project" });
    await aiProjectControllerService.setBudget(t2.ownerCtx, { monthlyBudgetEur: "1,00" });

    useFake({ costUsd: 1 }); // 0.92 € — leaves 0.08 €, below the 0.10 € minimum
    expect((await aiProjectControllerService.review(t2.ownerCtx, p.id)).status).toBe("SUCCEEDED");
    const blocked = await aiProjectControllerService.review(t2.ownerCtx, p.id);
    expect(blocked.status).toBe("BLOCKED_BUDGET");
    expect(blocked.error).toBe("ai.errors.budgetExhausted");
    expect(fake.requests).toHaveLength(1);

    const overview = await aiProjectControllerService.overview(t2.ownerCtx, p.id);
    expect(overview.budget).toMatchObject({ limitEur: "1.00", usedEur: "0.9200", exhausted: true });

    await aiProjectControllerService.setBudget(t2.ownerCtx, { monthlyBudgetEur: "10" });
    expect((await aiProjectControllerService.review(t2.ownerCtx, p.id)).status).toBe("SUCCEEDED");
    const audit = await db.auditEvent.findMany({ where: { companyId: t2.companyId, action: "company.ai_budget.update" } });
    expect(audit).toHaveLength(2);
  });

  it("validates the budget and requires company.manage", async () => {
    await expect(aiProjectControllerService.setBudget(t.ownerCtx, { monthlyBudgetEur: "-1" })).rejects.toBeInstanceOf(ValidationError);
    const pd = await createMember(t, "PROJECT_DIRECTOR");
    await expect(aiProjectControllerService.setBudget(pd, { monthlyBudgetEur: "50" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("counts the month in Helsinki time", () => {
    // 2026-11-01 00:30 in Helsinki (EET, UTC+2) is still October in UTC.
    expect(monthStart(new Date("2026-10-31T22:30:00Z")).toISOString()).toBe("2026-10-31T22:00:00.000Z");
    // Summer time (EEST, UTC+3).
    expect(monthStart(new Date("2026-07-15T12:00:00Z")).toISOString()).toBe("2026-06-30T21:00:00.000Z");
  });
});

describe("AI recommendations", () => {
  it("are decided once, with an audit event", async () => {
    useFake();
    const run = await aiProjectControllerService.review(t.ownerCtx, projectId);
    const rec = await db.aiRecommendation.findFirstOrThrow({ where: { runId: run.id } });
    await aiProjectControllerService.decideRecommendation(t.ownerCtx, rec.id, { decision: "DISMISSED", note: "Already handled" });
    await expect(aiProjectControllerService.decideRecommendation(t.ownerCtx, rec.id, { decision: "ACCEPTED" })).rejects.toBeInstanceOf(ValidationError);
    const after = await db.aiRecommendation.findUniqueOrThrow({ where: { id: rec.id } });
    expect(after).toMatchObject({ status: "DISMISSED", decisionNote: "Already handled", decidedById: t.ownerCtx.user.id });
    expect(await db.auditEvent.count({ where: { entityId: rec.id, action: "ai.recommendation.dismiss" } })).toBe(1);
    const overview = await aiProjectControllerService.overview(t.ownerCtx, projectId);
    expect(overview.recommendations.find((r) => r.id === rec.id)?.status).toBe("DISMISSED");
  });

  it("AI runs are append-only in the database", async () => {
    const run = await db.aiRun.findFirstOrThrow({ where: { companyId: t.companyId } });
    await expect(db.aiRun.update({ where: { id: run.id }, data: { error: "x" } })).rejects.toThrow(/append-only/);
    await expect(db.aiRun.delete({ where: { id: run.id } })).rejects.toThrow(/append-only/);
  });
});

describe("Claude adapter cost estimate", () => {
  it("prices tokens from the list price and treats unknown models as Opus", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
    expect(estimateCostUsd("claude-opus-5-5", usage)).toBeCloseTo(4 + 2 + 0.2, 6);
    expect(estimateCostUsd("some-fallback-model", usage)).toBeCloseTo(6.2, 6);
  });
});
