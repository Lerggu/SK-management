import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError } from "@/platform/errors";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { workCalendarService } from "@/modules/takt/calendar.service";
import { taktStructureService } from "@/modules/takt/structure.service";
import { taktPlanService } from "@/modules/takt/plan.service";
import { taktActivityService } from "@/modules/takt/activity.service";
import { lookaheadService } from "@/modules/takt/lookahead.service";
import { scheduleImportService } from "@/modules/takt/import.service";
import { auditFor, createMember, createTenant } from "../helpers/fixtures";

const fixture = (name: string) => ({ fileName: name, bytes: new Uint8Array(readFileSync(join(__dirname, "../fixtures/schedules", name))) });

async function setup(startDate = "2026-11-02") {
  const t = await createTenant("Takt");
  const project = await projectService.create(t.ownerCtx, { code: "T", name: "Takt project" });
  const site = await siteService.create(t.ownerCtx, project.id, { name: "Data Hall A" });
  const pm = await createMember(t, "PROJECT_MANAGER", [{ projectId: project.id }]);
  const sm = await createMember(t, "SITE_MANAGER", [{ projectId: project.id }]);
  const crane = await equipmentTypeService.create(t.ownerCtx, { name: "Nosturi", category: "CRANE" });
  const building = await taktStructureService.createBuilding(pm, { siteId: site.id, name: "DC1" });
  const areas = [];
  for (const code of ["A1", "A2", "A3"]) areas.push(await taktStructureService.createArea(pm, { buildingId: building.id, code, name: `Alue ${code}` }));
  const trays = await taktStructureService.createWorkPackage(pm, project.id, { code: "KH", name: "Kaapelihyllyt", trade: "Sähköasentaja", defaultCrewSize: "3", defaultDurationCycles: "1" });
  const cabling = await taktStructureService.createWorkPackage(pm, project.id, { code: "KA", name: "Kaapelointi", trade: "Sähköasentaja", defaultCrewSize: "4", defaultDurationCycles: "2", equipmentTypeId: crane.id, equipmentCount: "1" });
  const plan = await taktPlanService.create(pm, { siteId: site.id, name: "Sali A", startDate });
  const board0 = await taktPlanService.board(pm, plan.id);
  return { t, project, site, pm, sm, crane, building, areas, trays, cabling, plan, v1: board0.selected! };
}

describe("takt plan versioning", () => {
  it("train → propose → baseline (frozen) → new version → compare → new baseline supersedes", async () => {
    const s = await setup();
    const train = await taktPlanService.generateTrain(s.pm, s.v1.id, { startCycle: 0, bufferCycles: 0 });
    expect(train).toMatchObject({ taktTime: 2, assignments: 6, activitiesCreated: 6, dependenciesCreated: 3 });

    const board = await taktPlanService.board(s.pm, s.plan.id);
    const at = (wp: string, area: string) => board.activities.find((a) => a.workPackage.code === wp && a.taktArea.code === area)!;
    // KH: A1 cycle 0 (Mon 11-02), A2 cycle 2; KA starts at cycle 2 in A1 and lasts 2 cycles.
    expect([at("KH", "A1").plannedStart, at("KH", "A2").plannedStart, at("KA", "A1").plannedStart, at("KA", "A1").plannedEnd]).toEqual(["2026-11-02", "2026-11-04", "2026-11-04", "2026-11-05"]);

    await taktPlanService.propose(s.sm, s.v1.id);
    await expect(taktPlanService.approve(s.sm, s.v1.id)).rejects.toBeInstanceOf(ForbiddenError);
    const baseline = await taktPlanService.approve(s.pm, s.v1.id);
    expect(baseline.status).toBe("BASELINE");
    // 6 crew requirements + 3 crane requirements (cabling)
    expect(await db.resourceRequirement.count({ where: { versionId: baseline.id } })).toBe(9);

    // The baseline cannot be changed, not even directly in the database.
    await expect(taktPlanService.setAssignment(s.pm, baseline.id, at("KH", "A1").id, { startCycle: 5, durationCycles: 1 })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.versionNotDraft"] } });
    const asg = await db.taktAssignment.findFirstOrThrow({ where: { versionId: baseline.id } });
    await expect(db.taktAssignment.update({ where: { id: asg.id }, data: { startCycle: 9 } })).rejects.toThrow(/draft/);
    await expect(db.taktPlanVersion.update({ where: { id: baseline.id }, data: { startDate: new Date("2026-12-01") } })).rejects.toThrow(/frozen/);
    await expect(db.resourceRequirement.deleteMany({ where: { versionId: baseline.id } })).rejects.toThrow(/immutable/);

    // A change is a new version.
    const v2 = await taktPlanService.createDraft(s.pm, s.plan.id, { reason: "Kaapelitoimitus myöhässä" });
    expect(v2.versionNumber).toBe(2);
    await expect(taktPlanService.createDraft(s.pm, s.plan.id, {})).rejects.toMatchObject({ fieldErrors: { _form: ["validation.openVersionExists"] } });
    expect(await db.taktAssignment.count({ where: { versionId: v2.id } })).toBe(6);
    await taktPlanService.shiftWorkPackage(s.pm, v2.id, s.cabling.id, { days: "2" });
    const cmp = await taktPlanService.compare(s.pm, s.plan.id, { versionId: v2.id });
    expect(cmp.summary).toMatchObject({ moved: 3, added: 0, removed: 0, finishDelta: 2 });
    expect(cmp.rows.filter((r) => r.change === "MOVED").every((r) => r.startDelta === 2)).toBe(true);

    await taktPlanService.propose(s.pm, v2.id);
    await taktPlanService.returnToDraft(s.pm, v2.id, { note: "Tarkista A3" });
    await taktPlanService.propose(s.pm, v2.id);
    await taktPlanService.approve(s.pm, v2.id);
    const versions = await db.taktPlanVersion.findMany({ where: { planId: s.plan.id }, orderBy: { versionNumber: "asc" } });
    expect(versions.map((v) => v.status)).toEqual(["SUPERSEDED", "BASELINE"]);
    await expect(db.taktPlanVersion.delete({ where: { id: versions[0].id } })).rejects.toThrow(/draft/);
    // The original baseline's dates are unchanged.
    expect((await db.taktAssignment.findMany({ where: { versionId: versions[0].id } })).map((a) => a.startCycle).sort()).toEqual([0, 2, 2, 4, 4, 6]);

    const actions = (await db.auditEvent.findMany({ where: { companyId: s.t.companyId, entityType: "takt_plan_version" }, orderBy: { occurredAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["takt_plan.train_generate", "takt_plan.version_propose", "takt_plan.baseline_approve", "takt_plan.version_create", "takt_plan.work_package_shift", "takt_plan.version_return"]));
    expect(actions.filter((a) => a === "takt_plan.baseline_approve")).toHaveLength(2);
  });

  it("only drafts can be edited or discarded; the only version cannot be discarded", async () => {
    const s = await setup();
    await expect(taktPlanService.discardDraft(s.pm, s.v1.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.cannotDiscardOnlyVersion"] } });
    await expect(taktPlanService.propose(s.pm, s.v1.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.emptyPlan"] } });
    await taktPlanService.generateTrain(s.pm, s.v1.id, {});
    await taktPlanService.propose(s.pm, s.v1.id);
    await expect(taktPlanService.updateDraft(s.pm, s.v1.id, { startDate: "2026-11-09" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.versionNotDraft"] } });
    await expect(db.taktPlanVersion.update({ where: { id: s.v1.id }, data: { status: "BASELINE" } })).resolves.toBeTruthy(); // allowed transition at DB level
    await expect(db.taktPlanVersion.update({ where: { id: s.v1.id }, data: { status: "DRAFT" } })).rejects.toThrow(/frozen/);
  });

  it("holidays shift planned dates", async () => {
    const s = await setup("2026-12-23");
    await taktPlanService.generateTrain(s.pm, s.v1.id, {});
    const board = await taktPlanService.board(s.pm, s.plan.id);
    // Wed 12-23 → next working day after 24–27 (Christmas + weekend) is Mon 12-28
    expect(board.cycleDates.slice(0, 3)).toEqual(["2026-12-23", "2026-12-28", "2026-12-29"]);
  });
});

describe("readiness, constraints and progress", () => {
  async function started() {
    const s = await setup("2026-09-01");
    await taktPlanService.generateTrain(s.pm, s.v1.id, {});
    await taktPlanService.propose(s.pm, s.v1.id);
    await taktPlanService.approve(s.pm, s.v1.id);
    const board = await taktPlanService.board(s.pm, s.plan.id);
    const at = (wp: string, area: string) => board.activities.find((a) => a.workPackage.code === wp && a.taktArea.code === area)!;
    return { ...s, first: at("KH", "A1"), second: at("KA", "A1") };
  }

  it("derives READY / BLOCKED / IN_PROGRESS / COMPLETE from predecessors, constraints and progress", async () => {
    const s = await started();
    const supervisor = await createMember(s.t, "SUPERVISOR", [{ projectId: s.project.id }]);
    expect(s.first.status).toBe("READY");
    // Planned start is in the past and the FS predecessor is not complete → BLOCKED
    expect(s.second.status).toBe("BLOCKED");
    expect(s.second.reasons).toEqual(["predecessor"]);

    const c = await taktActivityService.addConstraint(supervisor, s.first.id, { type: "MATERIAL", description: "Hyllytoimitus puuttuu", dueDate: "2026-09-05" });
    expect((await taktActivityService.get(supervisor, s.first.id)).status).toBe("BLOCKED");
    await taktActivityService.clearConstraint(supervisor, c.id);
    expect((await taktActivityService.get(supervisor, s.first.id)).status).toBe("READY");

    await taktActivityService.recordProgress(supervisor, s.first.id, { progressPct: "40", reportDate: "2026-09-01", note: "Aloitettu" });
    let detail = await taktActivityService.get(supervisor, s.first.id);
    expect(detail).toMatchObject({ status: "IN_PROGRESS" });
    expect(detail.activity.actualStart?.toISOString().slice(0, 10)).toBe("2026-09-01");
    await taktActivityService.recordProgress(supervisor, s.first.id, { progressPct: "100", reportDate: "2026-09-02" });
    detail = await taktActivityService.get(supervisor, s.first.id);
    expect(detail.status).toBe("COMPLETE");
    expect(detail.activity.progress).toHaveLength(2);
    expect((await taktActivityService.get(supervisor, s.second.id)).status).toBe("READY");

    await taktActivityService.setBlocked(supervisor, s.second.id, { blocked: "on", delayReason: "Nosturi rikki", recoveryAction: "Varanosturi maanantaina" });
    expect((await taktActivityService.get(supervisor, s.second.id)).status).toBe("BLOCKED");
    await taktActivityService.setBlocked(supervisor, s.second.id, { blocked: false });
    expect((await taktActivityService.get(supervisor, s.second.id)).status).toBe("READY");

    await expect(taktActivityService.recordProgress(supervisor, s.first.id, { progressPct: "10", reportDate: "2099-01-01" })).rejects.toMatchObject({ fieldErrors: { reportDate: ["validation.futureDate"] } });
    await expect(taktActivityService.setBlocked(supervisor, s.first.id, { blocked: true })).rejects.toMatchObject({ fieldErrors: { delayReason: ["validation.required"] } });
    const p = await db.activityProgress.findFirstOrThrow({ where: { activityId: s.first.id } });
    await expect(db.activityProgress.update({ where: { id: p.id }, data: { progressPct: 1 } })).rejects.toThrow(/append-only/);
    expect((await auditFor(s.t.companyId, s.first.id)).map((a) => a.action)).toEqual(["takt_activity.progress", "takt_activity.progress"]);
    expect((await auditFor(s.t.companyId, s.second.id)).map((a) => a.action)).toEqual(["takt_activity.block", "takt_activity.unblock"]);

    const week = await taktActivityService.listForWeek(supervisor, s.plan.id, { date: "2026-09-02" });
    expect(week.activities.map((a) => a.id)).toContain(s.second.id);
  });

  it("permissions: employees view only, clients and unassigned users see nothing", async () => {
    const s = await started();
    const emp = await createMember(s.t, "EMPLOYEE", [{ projectId: s.project.id }]);
    expect((await taktActivityService.get(emp, s.first.id)).activity.id).toBe(s.first.id);
    await expect(taktActivityService.recordProgress(emp, s.first.id, { progressPct: "10", reportDate: "2026-09-01" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(taktPlanService.createDraft(emp, s.plan.id, {})).rejects.toBeInstanceOf(ForbiddenError);
    const client = await createMember(s.t, "CLIENT", [{ projectId: s.project.id }]);
    await expect(taktPlanService.board(client, s.plan.id)).rejects.toBeInstanceOf(NotFoundError);
    const other = await createMember(s.t, "PROJECT_MANAGER");
    await expect(taktPlanService.board(other, s.plan.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await taktPlanService.list(other)).toHaveLength(0);
  });

  it("rejects dependency cycles", async () => {
    const s = await started();
    await expect(taktActivityService.addDependency(s.pm, { predecessorId: s.second.id, successorId: s.first.id })).rejects.toMatchObject({ fieldErrors: { predecessorId: ["validation.dependencyCycle"] } });
    await expect(taktActivityService.addDependency(s.pm, { predecessorId: s.first.id, successorId: s.second.id })).rejects.toMatchObject({ fieldErrors: { predecessorId: ["validation.dependencyExists"] } });
  });
});

describe("look-ahead", () => {
  it("produces weekly resource requirements from the baseline and flags shortages", async () => {
    const s = await setup();
    await taktPlanService.generateTrain(s.pm, s.v1.id, {});
    for (const n of ["1", "2", "3"]) await employeeService.create(s.t.ownerCtx, { employeeNumber: `E${n}`, firstName: "Testi", lastName: n, trade: "Sähköasentaja" });
    const before = await lookaheadService.compute(s.pm, { weeks: "2", from: "2026-11-02" });
    expect(before.rows).toHaveLength(0); // no baseline yet
    await taktPlanService.propose(s.pm, s.v1.id);
    await taktPlanService.approve(s.pm, s.v1.id);
    const la = await lookaheadService.compute(s.pm, { weeks: "2", from: "2026-11-02", projectId: s.project.id });
    expect(la.weekStarts).toEqual(["2026-11-02", "2026-11-09"]);
    const el = la.rows.find((r) => r.kind === "TRADE")!;
    expect(el).toMatchObject({ label: "Sähköasentaja", capacity: 3 });
    // Wed 11-04: KH A2 (3) + KA A1 (4) = 7 people needed, 3 available
    expect(el.cells[0]).toMatchObject({ peak: 7, shortage: 4 });
    const crane = la.rows.find((r) => r.kind === "EQUIPMENT_TYPE")!;
    expect(crane).toMatchObject({ label: "Nosturi", lifting: true, capacity: 0 });
    await equipmentService.create(s.t.ownerCtx, { equipmentTypeId: s.crane.id, assetNumber: "N1", name: "Nosturi 1" });
    const after = await lookaheadService.compute(s.pm, { weeks: "6", from: "2026-11-02" });
    expect(after.rows.find((r) => r.kind === "EQUIPMENT_TYPE")!.capacity).toBe(1);
    expect(after.weekStarts).toHaveLength(6);
  });
});

describe("schedule import", () => {
  it.each(["data-hall-b.xml", "data-hall-b.xer"])("imports %s into a draft version with areas, work packages and dependencies", async (file) => {
    const s = await setup();
    const { id } = await scheduleImportService.preview(s.pm, s.plan.id, { buildingId: s.building.id, areaLevel: "1" }, fixture(file));
    const pending = await scheduleImportService.get(s.pm, id);
    expect(pending.preview.counts).toEqual({ tasks: 6, mapped: 4, merged: 0, unmapped: 1, milestones: 1, links: 4 });
    expect(pending.sha256).toMatch(/^[0-9a-f]{64}$/);
    const result = await scheduleImportService.apply(s.pm, id);
    expect(result).toMatchObject({ versionNumber: 1, areasCreated: 2, workPackagesCreated: 2, activitiesCreated: 4, assignments: 4, dependenciesCreated: 4, startDate: "2026-11-02" });
    const board = await taktPlanService.board(s.pm, s.plan.id);
    const b2 = board.activities.find((a) => a.taktArea.name === "Zone B2" && a.workPackage.name === "Cabling")!;
    expect([b2.plannedStart, b2.plannedEnd]).toEqual(["2026-11-09", "2026-11-10"]);
    const deps = await db.activityDependency.findMany({ where: { planId: s.plan.id } });
    expect(deps.map((d) => `${d.type}:${d.lagDays}`).sort()).toEqual(["FS:0", "FS:0", "FS:1", "SS:0"]);
    await expect(scheduleImportService.apply(s.pm, id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.importNotPending"] } });
    expect((await auditFor(s.t.companyId, id)).map((a) => a.action)).toEqual(["schedule_import.preview", "schedule_import.apply"]);
    const original = await scheduleImportService.download(s.pm, id);
    expect(original.fileName).toBe(file);
  });

  it("never writes into a baseline: a proposed version blocks the import, a baseline gets a new draft", async () => {
    const s = await setup();
    await taktPlanService.generateTrain(s.pm, s.v1.id, {});
    await taktPlanService.propose(s.pm, s.v1.id);
    const first = await scheduleImportService.preview(s.pm, s.plan.id, { buildingId: s.building.id }, fixture("data-hall-b.xml"));
    await expect(scheduleImportService.apply(s.pm, first.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.versionProposed"] } });
    await taktPlanService.approve(s.pm, s.v1.id);
    const result = await scheduleImportService.apply(s.pm, first.id);
    expect(result.versionNumber).toBe(2);
    expect(await db.taktAssignment.count({ where: { versionId: s.v1.id } })).toBe(6);
    expect(await db.taktAssignment.count({ where: { versionId: result.versionId } })).toBe(10);
  });

  it("rejects unknown or broken files and can discard a preview", async () => {
    const s = await setup();
    await expect(scheduleImportService.preview(s.pm, s.plan.id, { buildingId: s.building.id }, { fileName: "plan.mpp", bytes: new Uint8Array([1, 2]) })).rejects.toMatchObject({ fieldErrors: { file: ["validation.scheduleFormat"] } });
    await expect(scheduleImportService.preview(s.pm, s.plan.id, { buildingId: s.building.id }, { fileName: "plan.xml", bytes: new TextEncoder().encode("<html/>") })).rejects.toMatchObject({ fieldErrors: { file: ["validation.scheduleInvalid"] } });
    const sm = s.sm;
    const p = await scheduleImportService.preview(sm, s.plan.id, { buildingId: s.building.id }, fixture("data-hall-b.xer"));
    await scheduleImportService.discard(sm, p.id);
    await expect(scheduleImportService.apply(sm, p.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.importNotPending"] } });
    const supervisor = await createMember(s.t, "SUPERVISOR", [{ projectId: s.project.id }]);
    await expect(scheduleImportService.preview(supervisor, s.plan.id, { buildingId: s.building.id }, fixture("data-hall-b.xer"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("work calendar", () => {
  it("defaults to Mon–Fri with Finnish holidays; managed with company.manage", async () => {
    const t = await createTenant("Cal");
    const before = await workCalendarService.get(t.ownerCtx);
    expect(before.persisted).toBe(false);
    expect(before.holidays.some((h) => h.name === "Itsenäisyyspäivä")).toBe(true);
    await workCalendarService.addHoliday(t.ownerCtx, { date: "2026-11-20", name: "Yrityksen virkistyspäivä" });
    const after = await workCalendarService.get(t.ownerCtx);
    expect(after.persisted).toBe(true);
    expect(after.holidays.find((h) => h.date === "2026-11-20")?.name).toBe("Yrityksen virkistyspäivä");
    const pm = await createMember(t, "PROJECT_MANAGER");
    await expect(workCalendarService.addHoliday(pm, { date: "2026-11-21", name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await workCalendarService.get(pm)).canManage).toBe(false);
    await workCalendarService.updateWeekdays(t.ownerCtx, { workingWeekdays: ["1", "2", "3", "4", "5", "6"] });
    expect((await workCalendarService.get(t.ownerCtx)).workingWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
    const h = after.holidays.find((x) => x.date === "2026-11-20")!;
    await workCalendarService.removeHoliday(t.ownerCtx, h.id!);
    expect((await workCalendarService.addFinnishHolidays(t.ownerCtx, { year: "2030" })).added).toBe(15);
  });
});
