/**
 * Production control phase 4 (ADR 0026): AI staffing suggestions and §27
 * logistics risk analysis, with the deterministic test provider. Real
 * PostgreSQL. Checks that no names reach the provider, that model picks are
 * validated against the offered candidates, that a person's acceptance goes
 * through the booking rules, and that risks never change anything.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { FakeAiProvider, setAiProviderForTests } from "@/platform/ai";
import type { RequestContext } from "@/platform/authz";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { logisticsRequestService } from "@/modules/logistics/logistics.service";
import { qualificationTypeService } from "@/modules/hr/settings.service";
import { qualificationService } from "@/modules/hr/card.service";
import { staffingService, taskTypeService } from "@/modules/production/service";
import { logisticsAiService } from "@/modules/production/ai.service";
import { productionCalendarService } from "@/modules/production/calendar.service";
import { deviationService } from "@/modules/production/deviation.service";
import { createMember, createTenant, type Tenant } from "../helpers/fixtures";

let t: Tenant;
let o: RequestContext;
let projectId: string;
let siteId: string;
let liftType: string;
let riggerRole: string;
let fake: FakeAiProvider;
const people: string[] = [];

function useFake(options: ConstructorParameters<typeof FakeAiProvider>[0] = {}) {
  fake = new FakeAiProvider(options);
  setAiProviderForTests(fake);
  return fake;
}
afterEach(() => setAiProviderForTests(undefined));

const inDays = (d: number, h: number) => {
  const x = new Date(Date.now() + d * 86_400_000);
  return `${x.toLocaleDateString("sv-SE", { timeZone: "Europe/Helsinki" })}T${String(h).padStart(2, "0")}:00`;
};
const lift = (title: string, day = 3, weightKg = "2000") =>
  logisticsRequestService.create(o, { siteId, serviceType: "LIFT", title, requestedStart: inDays(day, 8), requestedEnd: inDays(day, 12), weightKg, taskTypeId: liftType, submit: "on" });

beforeAll(async () => {
  t = await createTenant("ProdAi");
  o = t.ownerCtx;
  const project = await projectService.create(o, { code: "PA", name: "Production AI project" });
  projectId = project.id;
  siteId = (await siteService.create(o, project.id, { name: "Site PA" })).id;
  const card = (await qualificationTypeService.create(o, { name: "Taakankiinnittäjäkortti" })).id;
  for (const [n, first] of [["A1", "Salainen"], ["A2", "Yksityinen"], ["A3", "Henkilö"]]) {
    const id = (await employeeService.create(o, { employeeNumber: n, firstName: first, lastName: "Sukunimi-Ei-Vuoda", trade: "Asentaja" })).id;
    await qualificationService.add(o, id, { typeId: card, expiresOn: "2030-01-01" });
    people.push(id);
  }
  // A person without the card is blocked and must never be offered to the AI.
  people.push((await employeeService.create(o, { employeeNumber: "A4", firstName: "Kortiton", lastName: "Estetty" })).id);
  const craneType = await equipmentTypeService.create(o, { name: "Nosturi", category: "CRANE" });
  await equipmentService.create(o, { equipmentTypeId: craneType.id, assetNumber: "PA-N1", name: "Nosturi PA" });
  const type = await taskTypeService.create(o, { name: "Nosto", serviceType: "LIFT", color: "amber" });
  liftType = type.id;
  riggerRole = (await taskTypeService.addRole(o, type.id, { kind: "PERSON", label: "Taakankiinnittäjä", quantity: "2", qualificationTypeId: card })).id;
  await taskTypeService.addRole(o, type.id, { kind: "EQUIPMENT", label: "Nosturi", equipmentTypeId: craneType.id });
});

describe("AI staffing suggestion", () => {
  it("sends only pseudonymous needs and non-blocked candidates, stores resolved picks, and a person accepts them", async () => {
    useFake();
    const task = await lift("Elementtinosto");
    const run = await logisticsAiService.suggest(o, task.id);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.kind).toBe("STAFFING");

    // No names, employee numbers, asset numbers or ids reach the provider.
    const toolOutput = JSON.stringify(await fake.requests[0].executeTool("task_staffing", {}));
    for (const leak of ["Salainen", "Sukunimi", "Kortiton", "Estetty", "PA-N1", "A1", ...people]) expect(toolOutput).not.toContain(leak);
    expect(toolOutput).toContain("Taakankiinnittäjäkortti");
    const payload = JSON.parse(toolOutput) as { needs: { need: string; candidates: { candidate: string }[] }[] };
    expect(payload.needs.map((n) => n.candidates.length)).toEqual([3, 1]); // the card-less person is not offered
    expect(fake.requests[0].resultSchema).toBeDefined();

    const s = await logisticsAiService.suggestion(o, task.id);
    expect(s.suggestion?.picks).toHaveLength(3);
    expect(s.suggestion?.picks.every((p) => p.applicable)).toBe(true);
    expect(s.canAccept).toBe(true);
    const cal = await productionCalendarService.view(o, { zoom: "month", date: inDays(3, 0).slice(0, 10) });
    expect(cal.tasks.find((x) => x.id === task.id)?.aiSuggested).toBe(true);

    expect(await logisticsAiService.accept(o, run.id)).toEqual({ assigned: 3, skipped: 0 });
    const after = await staffingService.get(o, task.id);
    expect(after.readiness).toBe("READY");
    expect((await logisticsAiService.suggestion(o, task.id)).canAccept).toBe(false);
    // Accepting again books nothing more: the picks no longer fit open needs.
    expect(await logisticsAiService.accept(o, run.id)).toEqual({ assigned: 0, skipped: 3 });
    const audit = await db.auditEvent.findFirst({ where: { companyId: t.companyId, action: "ai.staffing.accept", entityId: run.id } });
    expect(audit).not.toBeNull();
  });

  it("drops model picks that were not offered, duplicate or over the open quantity", async () => {
    useFake({
      respond: () => ({
        summary: "ok",
        picks: [
          { need: "N1", candidate: "C1", reason: "a" },
          { need: "N1", candidate: "C1", reason: "duplicate" },
          { need: "N1", candidate: "C2", reason: "b" },
          { need: "N1", candidate: "C3", reason: "over quantity" },
          { need: "N2", candidate: "C1", reason: "not offered for N2" },
          { need: "N9", candidate: "C2", reason: "unknown need" },
        ],
      }),
    });
    const task = await lift("Validointi", 5);
    const run = await logisticsAiService.suggest(o, task.id);
    const result = (await db.aiRun.findUniqueOrThrow({ where: { id: run.id } })).result as { picks: { roleId: string }[]; rejected: number };
    expect(result.picks).toHaveLength(2);
    expect(result.picks.every((p) => p.roleId === riggerRole)).toBe(true);
    expect(result.rejected).toBe(4);
  });

  it("stores invalid model output as a failed run", async () => {
    useFake({ respond: () => ({ picks: "nope" }) });
    const run = await logisticsAiService.suggest(o, (await lift("Rikki", 6)).id);
    expect(run.status).toBe("FAILED");
    expect(run.error).toBe("ai.errors.invalidResult");
    await expect(logisticsAiService.accept(o, run.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("needs booking.manage and ai.use; supervisors and clients cannot run it", async () => {
    useFake();
    const task = await lift("Oikeudet", 7);
    const sup = await createMember(t, "SUPERVISOR", [{ projectId }]);
    await expect(logisticsAiService.suggest(sup, task.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await logisticsAiService.suggestion(sup, task.id)).canRun).toBe(false);
    const client = await createMember(t, "CLIENT", [{ projectId }]);
    await expect(logisticsAiService.suggest(client, task.id)).rejects.toBeInstanceOf(NotFoundError);
    const lc = await createMember(t, "LOGISTICS_COORDINATOR", [{ projectId }]);
    expect((await logisticsAiService.suggest(lc, task.id)).status).toBe("SUCCEEDED");
  });

  it("is refused when nothing is open, and blocked by the monthly cap without calling the provider", async () => {
    useFake();
    const plain = await logisticsRequestService.create(o, { siteId, serviceType: "OTHER", title: "Ei tyyppiä", requestedStart: inDays(8, 8), requestedEnd: inDays(8, 9) });
    await expect(logisticsAiService.suggest(o, plain.id)).rejects.toBeInstanceOf(ValidationError);

    const t2 = await createTenant("ProdAiBudget");
    const p2 = await projectService.create(t2.ownerCtx, { code: "B", name: "B" });
    const s2 = await siteService.create(t2.ownerCtx, p2.id, { name: "B" });
    const ty = await taskTypeService.create(t2.ownerCtx, { name: "Purku", serviceType: "DELIVERY" });
    await taskTypeService.addRole(t2.ownerCtx, ty.id, { kind: "PERSON", label: "Purkaja", quantity: "1" });
    await employeeService.create(t2.ownerCtx, { employeeNumber: "B1", firstName: "B", lastName: "B" });
    const r2 = await logisticsRequestService.create(t2.ownerCtx, { siteId: s2.id, serviceType: "DELIVERY", title: "B", requestedStart: inDays(2, 8), requestedEnd: inDays(2, 9), taskTypeId: ty.id });
    await db.company.update({ where: { id: t2.companyId }, data: { aiMonthlyBudgetEur: 0 } });
    const blocked = await logisticsAiService.suggest(t2.ownerCtx, r2.id);
    expect(blocked.status).toBe("BLOCKED_BUDGET");
    expect(fake.requests).toHaveLength(0);
  });
});

describe("§27 logistics risks", () => {
  it("detects shortages, conflicts and deviations as facts, and the AI analysis stores recommendations without changing anything", async () => {
    useFake();
    const soon = await lift("Kiireellinen nosto", 1);
    const dev = await lift("Poikkeamanosto", 2);
    await deviationService.report(o, dev.id, { type: "SAFETY", comment: "Nostoalue auki" });
    // The same person on two overlapping tasks.
    const a = await logisticsRequestService.create(o, { siteId, serviceType: "LIFT", title: "Konflikti A", requestedStart: inDays(4, 8), requestedEnd: inDays(4, 12), taskTypeId: liftType, weightKg: "100", submit: "on" });
    const b = await logisticsRequestService.create(o, { siteId, serviceType: "LIFT", title: "Konflikti B", requestedStart: inDays(4, 10), requestedEnd: inDays(4, 14), taskTypeId: liftType, weightKg: "100", submit: "on" });
    await staffingService.assign(o, a.id, { roleId: riggerRole, resource: `EMPLOYEE:${people[2]}` });
    await staffingService.assign(o, b.id, { roleId: riggerRole, resource: `EMPLOYEE:${people[2]}` }).catch(() => undefined);

    const before = await db.logisticsRequest.findMany({ where: { companyId: t.companyId }, select: { id: true, requestedStart: true, requestedEnd: true, status: true } });
    const r = await logisticsAiService.risks(o, projectId);
    const types = (k: string) => r.facts.filter((f) => f.type === k);
    expect(types("RESOURCE_SHORTAGE").find((f) => f.taskId === soon.id)?.severity).toBe("CRITICAL");
    expect(types("OPEN_DEVIATION").find((f) => f.taskId === dev.id)?.severity).toBe("CRITICAL");
    expect(JSON.stringify(r.facts)).not.toContain("Sukunimi");
    if ((await db.resourceBooking.count({ where: { companyId: t.companyId, employeeId: people[2], status: { in: ["REQUESTED", "APPROVED"] } } })) > 1) {
      expect(types("BOOKING_CONFLICT").length).toBeGreaterThan(0);
    }

    const run = await logisticsAiService.analyseRisks(o, projectId);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.kind).toBe("LOGISTICS_RISK");
    expect(fake.requests.at(-1)?.tools.map((x) => x.name)).toEqual(["logistics_risks"]);
    const latest = await logisticsAiService.risks(o, projectId);
    expect(latest.analysis?.id).toBe(run.id);
    expect(latest.analysis?.recommendations.length).toBeGreaterThan(0);
    const after = await db.logisticsRequest.findMany({ where: { companyId: t.companyId, id: { in: before.map((x) => x.id) } }, select: { id: true, requestedStart: true, requestedEnd: true, status: true } });
    expect(after).toEqual(expect.arrayContaining(before));
  });

  it("supervisors see the facts but cannot run the AI; clients see nothing", async () => {
    const sup = await createMember(t, "SUPERVISOR", [{ projectId }]);
    const r = await logisticsAiService.risks(sup, projectId);
    expect(r.canAnalyse).toBe(false);
    expect(r.facts.some((f) => f.type === "BOOKING_CONFLICT" || f.type === "IDLE_CAPACITY")).toBe(false); // needs booking.manage
    await expect(logisticsAiService.analyseRisks(sup, projectId)).rejects.toBeInstanceOf(ForbiddenError);
    const client = await createMember(t, "CLIENT", [{ projectId }]);
    await expect(logisticsAiService.risks(client, projectId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
