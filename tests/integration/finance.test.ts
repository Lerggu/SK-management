import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError } from "@/platform/errors";
import { budgetService, costService, projectFinanceService } from "@/modules/finance/service";
import { timesheetService } from "@/modules/timesheets/service";
import { diaryService } from "@/modules/diary/service";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { createMember, createTenant } from "../helpers/fixtures";

async function setup() {
  const t = await createTenant("Fin");
  const project = await projectService.create(t.ownerCtx, { code: "F", name: "Finance project" });
  const site = await siteService.create(t.ownerCtx, project.id, { name: "S" });
  const pm = await createMember(t, "PROJECT_MANAGER", [{ projectId: project.id }]);
  const sm = await createMember(t, "SITE_MANAGER", [{ projectId: project.id }]);
  const sup = await createMember(t, "SUPERVISOR", [{ projectId: project.id }]);
  const emp = await employeeService.create(t.ownerCtx, { employeeNumber: "E", firstName: "A", lastName: "B" });
  await employeeService.addRate(t.ownerCtx, emp.id, { rateType: "COST", amount: "40", validFrom: "2026-01-01" });
  const unrated = await employeeService.create(t.ownerCtx, { employeeNumber: "U", firstName: "No", lastName: "Rate" });
  const type = await equipmentTypeService.create(t.ownerCtx, { name: "Crane" });
  const crane = await equipmentService.create(t.ownerCtx, { equipmentTypeId: type.id, assetNumber: "C", name: "Crane" });
  await equipmentService.addRate(t.ownerCtx, crane.id, { rateType: "COST", amount: "100", validFrom: "2026-01-01" });
  return { t, project, site, pm, sm, sup, emp, unrated, crane };
}

async function approveHours(s: Awaited<ReturnType<typeof setup>>, employeeIds: string[], hours: string, workClass: "NORMAL" | "OVERTIME_50" = "NORMAL") {
  const entries = await timesheetService.createCrew(s.sup, { employeeIds, projectId: s.project.id, siteId: s.site.id, workDate: "2026-03-04", hours, workClass });
  await timesheetService.submitWeek(s.sup, { employeeId: employeeIds[0], date: "2026-03-04" });
  for (const id of employeeIds.slice(1)) await timesheetService.submitWeek(s.sup, { employeeId: id, date: "2026-03-04" });
  await timesheetService.decide(s.sm, { entryIds: entries.map((e) => e.id), decision: "APPROVE" });
  return entries;
}

describe("project finance (V2 acceptance)", () => {
  it("approved time entries feed actual labour cost; drafts and submitted do not", async () => {
    const s = await setup();
    await timesheetService.createCrew(s.sup, { employeeIds: [s.emp.id], projectId: s.project.id, workDate: "2026-03-12", hours: "5" }); // draft in another week
    await approveHours(s, [s.emp.id], "8");
    await approveHours(s, [s.emp.id], "2", "OVERTIME_50");
    const sum = await projectFinanceService.summary(s.pm, s.project.id);
    const labor = sum.comparison.categories.find((c) => c.category === "LABOR")!;
    expect(labor.actual.toString()).toBe("440"); // 8×40 + 2×40×1.5
    expect(sum.hours.approved.toString()).toBe("10");
    expect(sum.workflow.drafts.entries).toBe(1);
  });

  it("hours without an hourly rate are reported as unpriced, not guessed", async () => {
    const s = await setup();
    await approveHours(s, [s.emp.id, s.unrated.id], "8");
    const sum = await projectFinanceService.summary(s.pm, s.project.id);
    expect(sum.breakdown.laborComputed.toString()).toBe("320");
    expect(sum.warnings.unpricedLaborEntries).toBe(1);
    expect(sum.hours.unpriced.toString()).toBe("8");
  });

  it("corrections change actual cost after approval", async () => {
    const s = await setup();
    const [e] = await approveHours(s, [s.emp.id], "8");
    const fix = await timesheetService.createCorrection(s.sup, e.id, { hours: "-1", note: "virhe" });
    expect((await projectFinanceService.summary(s.pm, s.project.id)).breakdown.laborComputed.toString()).toBe("320");
    await timesheetService.decide(s.sm, { entryIds: [fix.id], decision: "APPROVE" });
    expect((await projectFinanceService.summary(s.pm, s.project.id)).breakdown.laborComputed.toString()).toBe("280");
  });

  it("budget vs actual with versions: original kept, new version supersedes it", async () => {
    const s = await setup();
    const v1 = await budgetService.createVersion(s.pm, s.project.id, {});
    await budgetService.addLine(s.pm, v1.id, { category: "LABOR", description: "Työ", amount: "1000" });
    await budgetService.addLine(s.pm, v1.id, { category: "MATERIALS", description: "Kaapeli", amount: "2 000,00" });
    await budgetService.activate(s.pm, v1.id);
    await expect(budgetService.addLine(s.pm, v1.id, { category: "OTHER", description: "x", amount: "1" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.budgetFrozen"] } });
    await expect(db.budgetLine.create({ data: { companyId: s.t.companyId, budgetId: v1.id, category: "OTHER", description: "x", amount: "1" } })).rejects.toThrow(/draft/);

    await approveHours(s, [s.emp.id], "8");
    await costService.create(s.pm, s.project.id, { category: "MATERIALS", entryDate: "2026-03-04", description: "Kaapelirumpu", amount: "2500" });
    let sum = await projectFinanceService.summary(s.pm, s.project.id);
    const by = Object.fromEntries(sum.comparison.categories.map((c) => [c.category, c]));
    expect(by.LABOR.variance.toString()).toBe("680");
    expect(by.MATERIALS.variance.toString()).toBe("-500");
    expect(sum.comparison.total.budget.toString()).toBe("3000");
    expect(sum.comparison.total.actual.toString()).toBe("2820");

    const v2 = await budgetService.createVersion(s.pm, s.project.id, { note: "Lisätyö", copyFromCurrent: true });
    const lines = (await budgetService.listVersions(s.pm, s.project.id)).find((v) => v.id === v2.id)!.lines;
    await budgetService.updateLine(s.pm, lines.find((l) => l.category === "MATERIALS")!.id, { category: "MATERIALS", description: "Kaapeli", amount: "3000" });
    await budgetService.activate(s.pm, v2.id);
    const versions = await budgetService.listVersions(s.pm, s.project.id);
    expect(versions.map((v) => [v.versionNumber, v.status])).toEqual([
      [2, "ACTIVE"],
      [1, "SUPERSEDED"],
    ]);
    sum = await projectFinanceService.summary(s.pm, s.project.id);
    expect(sum.comparison.total.budget.toString()).toBe("4000");
  });

  it("signed diary equipment hours become equipment cost", async () => {
    const s = await setup();
    const r = await diaryService.open(s.sup, { siteId: s.site.id, date: "2026-03-04" });
    await diaryService.addEntry(s.sup, r.id, { kind: "EQUIPMENT", equipmentId: s.crane.id, hours: "3" });
    expect((await projectFinanceService.summary(s.pm, s.project.id)).breakdown.equipmentComputed.toString()).toBe("0");
    await diaryService.sign(s.sup, r.id);
    expect((await projectFinanceService.summary(s.pm, s.project.id)).breakdown.equipmentComputed.toString()).toBe("300");
  });

  it("finance is sensitive: site managers, supervisors and clients cannot see it", async () => {
    const s = await setup();
    await expect(projectFinanceService.summary(s.sm, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(projectFinanceService.summary(s.sup, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
    const client = await createMember(s.t, "CLIENT", [{ projectId: s.project.id, role: "PROJECT_MANAGER" }]);
    // Even with a PM project role, an external member never gets finance.
    await expect(projectFinanceService.summary(client, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cost corrections are audited archives", async () => {
    const s = await setup();
    const c = await costService.create(s.pm, s.project.id, { category: "OTHER", entryDate: "2026-03-04", description: "Väärä", amount: "100" });
    await costService.archive(s.pm, c.id);
    expect(await costService.list(s.pm, s.project.id)).toEqual([]);
    const actions = (await db.auditEvent.findMany({ where: { entityId: c.id }, orderBy: { occurredAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["cost_entry.create", "cost_entry.archive"]);
    await expect(costService.create(s.pm, s.project.id, { category: "OTHER", entryDate: "2026-03-04", description: "x", amount: "0" })).rejects.toMatchObject({ fieldErrors: { amount: ["validation.amountNonZero"] } });
  });
});
