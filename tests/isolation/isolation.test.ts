/**
 * Tenant isolation suite.
 *
 * Company A owns a full set of data. A user of company B — with every
 * permission in B (CEO, ALL project access) — tries to reach A's data through
 * every service method. Cross-company access must be 404 (NotFoundError) for
 * ids in the path, rejected for ids referenced in input, and invisible in
 * lists. A meta-test fails if any method in SERVICE_REGISTRY has no case.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import type { RequestContext, UserContext } from "@/platform/authz";
import { SERVICE_REGISTRY } from "@/modules/registry";
import { resolveRequestContext } from "@/modules/companies/context";
import { companyAdminService, companyDirectoryService } from "@/modules/companies/service";
import { dashboardService } from "@/modules/companies/dashboard";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { documentService } from "@/modules/documents/service";
import { profileService } from "@/modules/identity/service";
import { timesheetService } from "@/modules/timesheets/service";
import { diaryService } from "@/modules/diary/service";
import { budgetService, costService, projectFinanceService } from "@/modules/finance/service";
import { workCalendarService } from "@/modules/takt/calendar.service";
import { taktStructureService } from "@/modules/takt/structure.service";
import { taktPlanService } from "@/modules/takt/plan.service";
import { taktActivityService } from "@/modules/takt/activity.service";
import { lookaheadService } from "@/modules/takt/lookahead.service";
import { scheduleImportService } from "@/modules/takt/import.service";
import { createMember, createTenant, meta, textFile, type Tenant } from "../helpers/fixtures";

interface World {
  a: Tenant;
  b: Tenant;
  bCtx: RequestContext;
  bUser: UserContext;
  ids: {
    project: string;
    site: string;
    employee: string;
    employeeRate: string;
    equipmentType: string;
    equipment: string;
    equipmentRate: string;
    document: string;
    version: string;
    link: string;
    projectMembership: string;
    membership: string;
    memberUserId: string;
    role: string;
    timeEntry: string;
    report: string;
    reportEntry: string;
    attachment: string;
    budget: string;
    budgetLine: string;
    activeBudget: string;
    cost: string;
    exportBatch: string;
    holiday: string;
    building: string;
    area: string;
    workPackage: string;
    plan: string;
    baseline: string;
    draft: string;
    activity: string;
    activity2: string;
    dependency: string;
    constraint: string;
    scheduleImport: string;
  };
  b3: { plan: string; version: string; activity: string };
  bSite: string;
  bProject: string;
  bDocument: string;
  bEquipmentType: string;
}

let w: World;
let aAuditCountBefore = 0;

async function expectNotFound(p: Promise<unknown>) {
  await expect(p).rejects.toBeInstanceOf(NotFoundError);
}

/** Referenced foreign ids must never succeed (404 or validation error). */
async function expectRejected(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "cross-company reference unexpectedly succeeded").not.toBeNull();
  expect(err instanceof NotFoundError || err instanceof ValidationError).toBe(true);
}

beforeAll(async () => {
  const a = await createTenant("IsoA");
  const b = await createTenant("IsoB");
  const actx = a.ownerCtx;

  const project = await projectService.create(actx, { code: "A-1", name: "A secret project" });
  const site = await siteService.create(actx, project.id, { name: "A site" });
  const employee = await employeeService.create(actx, { employeeNumber: "A-E1", firstName: "A", lastName: "Worker" });
  const employeeRate = await employeeService.addRate(actx, employee.id, { rateType: "COST", amount: "50", validFrom: "2026-01-01" });
  const type = await equipmentTypeService.create(actx, { name: "A crane" });
  const equipment = await equipmentService.create(actx, { equipmentTypeId: type.id, assetNumber: "A-EQ", name: "A crane 1", currentProjectId: project.id });
  const equipmentRate = await equipmentService.addRate(actx, equipment.id, { rateType: "BILLING", amount: "150", validFrom: "2026-01-01" });
  const doc = await documentService.create(actx, { title: "A drawing", projectId: project.id }, textFile("a.pdf", "A content"));
  const link = await documentService.addLink(actx, doc.id, { entityType: "EMPLOYEE", entityId: employee.id });
  const member = await createMember(a, "SUPERVISOR");
  const pm = await projectService.assignMember(actx, project.id, { userId: member.user.id, roleId: await a.roleId("SUPERVISOR") });

  const bProject = await projectService.create(b.ownerCtx, { code: "B-1", name: "B project" });
  const bDocument = await documentService.create(b.ownerCtx, { title: "B doc" }, textFile("b.pdf"));
  const bType = await equipmentTypeService.create(b.ownerCtx, { name: "B type" });
  const bSite = await siteService.create(b.ownerCtx, bProject.id, { name: "B site" });
  // B owner has an employee record, so "own hours" paths are exercised.
  await employeeService.create(b.ownerCtx, { employeeNumber: "B-OWN", firstName: "B", lastName: "Owner", userId: b.ownerCtx.user.id });

  // ── V2 data in company A ──
  const te = await timesheetService.create(actx, { employeeId: employee.id, projectId: project.id, siteId: site.id, workDate: "2026-03-02", hours: "8" });
  await timesheetService.submitWeek(actx, { employeeId: employee.id, date: "2026-03-02" });
  await timesheetService.decide(actx, { entryIds: [te.id], decision: "APPROVE" });
  const te2 = await timesheetService.create(actx, { employeeId: employee.id, projectId: project.id, workDate: "2026-02-02", hours: "4" });
  await timesheetService.submitWeek(actx, { employeeId: employee.id, date: "2026-02-02" });
  await timesheetService.decide(actx, { entryIds: [te2.id], decision: "APPROVE" });
  const exportBatch = await timesheetService.exportApproved(actx, { from: "2026-02-01", to: "2026-02-28" });
  const report = await diaryService.open(actx, { siteId: site.id, date: "2026-03-02" });
  const reportEntry = await diaryService.addEntry(actx, report.id, { kind: "WORK", description: "A work" });
  const attachment = await diaryService.addAttachment(actx, report.id, {}, { fileName: "a.jpg", bytes: new Uint8Array([255, 216, 255]) });
  const activeBudget = await budgetService.createVersion(actx, project.id, {});
  await budgetService.addLine(actx, activeBudget.id, { category: "LABOR", description: "A labour", amount: "1000" });
  await budgetService.activate(actx, activeBudget.id);
  const draftBudget = await budgetService.createVersion(actx, project.id, { copyFromCurrent: true });
  const budgetLine = (await budgetService.listVersions(actx, project.id)).find((v) => v.id === draftBudget.id)!.lines[0];
  const cost = await costService.create(actx, project.id, { category: "MATERIALS", entryDate: "2026-03-02", description: "A cable", amount: "500" });

  // ── V3 data in company A ──
  await workCalendarService.addHoliday(actx, { date: "2026-11-20", name: "A secret day" });
  const holiday = (await workCalendarService.get(actx)).holidays.find((h) => h.name === "A secret day")!;
  const building = await taktStructureService.createBuilding(actx, { siteId: site.id, name: "A building" });
  const area = await taktStructureService.createArea(actx, { buildingId: building.id, code: "A1", name: "A area 1" });
  await taktStructureService.createArea(actx, { buildingId: building.id, code: "A2", name: "A area 2" });
  const wp = await taktStructureService.createWorkPackage(actx, project.id, { code: "AW", name: "A wagon", trade: "A-secret-trade", defaultCrewSize: "2", defaultDurationCycles: "1" });
  const plan = await taktPlanService.create(actx, { siteId: site.id, name: "A plan", startDate: "2026-11-02" });
  const v1 = (await taktPlanService.board(actx, plan.id)).selected!;
  await taktPlanService.generateTrain(actx, v1.id, {});
  await taktPlanService.propose(actx, v1.id);
  await taktPlanService.approve(actx, v1.id);
  const draft = await taktPlanService.createDraft(actx, plan.id, { reason: "A change" });
  const acts = (await taktPlanService.board(actx, plan.id)).activities;
  const activity = acts.find((x) => x.taktArea.code === "A1")!;
  const activity2 = acts.find((x) => x.taktArea.code === "A2")!;
  const dependency = await taktActivityService.addDependency(actx, { predecessorId: activity.id, successorId: activity2.id });
  const constraint = await taktActivityService.addConstraint(actx, activity.id, { type: "PERMIT", description: "A permit" });
  const scheduleImport = await scheduleImportService.preview(actx, plan.id, { buildingId: building.id, areaLevel: "1" }, {
    fileName: "a.xml",
    bytes: new TextEncoder().encode(
      `<Project><Tasks><Task><UID>1</UID><Name>A zone</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task><Task><UID>2</UID><Name>A task</Name><OutlineLevel>2</OutlineLevel><Start>2026-11-02T08:00:00</Start><Finish>2026-11-02T16:00:00</Finish></Task></Tasks></Project>`,
    ),
  });


  // ── V3 data in company B (for cross-references) ──
  const bBuilding = await taktStructureService.createBuilding(b.ownerCtx, { siteId: bSite.id, name: "B building" });
  const bArea = await taktStructureService.createArea(b.ownerCtx, { buildingId: bBuilding.id, code: "B1", name: "B area" });
  const bWp = await taktStructureService.createWorkPackage(b.ownerCtx, bProject.id, { code: "BW", name: "B wagon" });
  const bPlan = await taktPlanService.create(b.ownerCtx, { siteId: bSite.id, name: "B plan", startDate: "2026-11-02" });
  const bVersion = (await taktPlanService.board(b.ownerCtx, bPlan.id)).selected!;
  const bActivity = await taktActivityService.create(b.ownerCtx, bPlan.id, { workPackageId: bWp.id, taktAreaId: bArea.id });

  w = {
    a,
    b,
    bCtx: b.ownerCtx,
    bUser: b.owner,
    ids: {
      project: project.id,
      site: site.id,
      employee: employee.id,
      employeeRate: employeeRate.id,
      equipmentType: type.id,
      equipment: equipment.id,
      equipmentRate: equipmentRate.id,
      document: doc.id,
      version: doc.currentVersion.id,
      link: link.id,
      projectMembership: pm.id,
      membership: member.membershipId,
      memberUserId: member.user.id,
      role: await a.roleId("EMPLOYEE"),
      timeEntry: te.id,
      report: report.id,
      reportEntry: reportEntry.id,
      attachment: attachment.id,
      budget: draftBudget.id,
      budgetLine: budgetLine.id,
      activeBudget: activeBudget.id,
      cost: cost.id,
      exportBatch: exportBatch.batchId,
      holiday: holiday.id!,
      building: building.id,
      area: area.id,
      workPackage: wp.id,
      plan: plan.id,
      baseline: v1.id,
      draft: draft.id,
      activity: activity.id,
      activity2: activity2.id,
      dependency: dependency.id,
      constraint: constraint.id,
      scheduleImport: scheduleImport.id,
    },
    b3: { plan: bPlan.id, version: bVersion.id, activity: bActivity.id },
    bSite: bSite.id,
    bProject: bProject.id,
    bDocument: bDocument.id,
    bEquipmentType: bType.id,
  };
  aAuditCountBefore = await db.auditEvent.count({ where: { companyId: a.companyId } });
});

type Case = () => Promise<void>;

const cases: Record<string, Case> = {
  // ── companies ───────────────────────────────────────────────────
  "companyDirectory.listMyCompanies": async () => {
    const list = await companyDirectoryService.listMyCompanies(w.bUser);
    expect(list.map((c) => c.id)).not.toContain(w.a.companyId);
  },
  "companyDirectory.listCreatableOrganizations": async () => {
    const orgs = await companyDirectoryService.listCreatableOrganizations(w.bUser);
    expect(orgs.map((o) => o.id)).not.toContain(w.a.organizationId);
  },
  "companyDirectory.createCompany": () =>
    expectNotFound(companyDirectoryService.createCompany(w.bUser, { organizationId: w.a.organizationId, name: "Intruder", slug: `intruder-${Date.now()}` })),
  "companyAdmin.getSettings": async () => {
    expect((await companyAdminService.getSettings(w.bCtx)).id).toBe(w.b.companyId);
  },
  "companyAdmin.updateSettings": async () => {
    await companyAdminService.updateSettings(w.bCtx, { name: "IsoB renamed", defaultLocale: "fi" });
    expect((await db.company.findUniqueOrThrow({ where: { id: w.a.companyId } })).name).toBe("IsoA Oy");
  },
  "companyAdmin.listMembers": async () => {
    const members = await companyAdminService.listMembers(w.bCtx);
    expect(members.map((m) => m.id)).not.toContain(w.ids.membership);
  },
  "companyAdmin.inviteMember": () => expectRejected(companyAdminService.inviteMember(w.bCtx, { email: `x${Date.now()}@example.test`, roleIds: [w.ids.role] })),
  "companyAdmin.updateMemberRoles": () => expectNotFound(companyAdminService.updateMemberRoles(w.bCtx, w.ids.membership, { roleIds: [w.ids.role] })),
  "companyAdmin.setMemberStatus": () => expectNotFound(companyAdminService.setMemberStatus(w.bCtx, w.ids.membership, { status: "DISABLED" })),
  "companyAdmin.listRoles": async () => {
    const roles = await companyAdminService.listRoles(w.bCtx);
    expect(roles.map((r) => r.id)).not.toContain(w.ids.role);
  },
  "companyAdmin.updateRolePermissions": () => expectNotFound(companyAdminService.updateRolePermissions(w.bCtx, w.ids.role, { permissionKeys: ["project.view"] })),
  "companyAdmin.listAuditEvents": async () => {
    const events = await companyAdminService.listAuditEvents(w.bCtx, { limit: 200 });
    expect(events.every((e) => e.companyId === w.b.companyId)).toBe(true);
  },
  "companyAdmin.rememberCompany": async () => {
    await companyAdminService.rememberCompany(w.bCtx);
    expect((await db.user.findUniqueOrThrow({ where: { id: w.bCtx.user.id } })).lastCompanyId).toBe(w.b.companyId);
  },
  "dashboard.summary": async () => {
    const s = await dashboardService.summary(w.bCtx);
    expect(s.projects).toBe(await db.project.count({ where: { companyId: w.b.companyId, archivedAt: null } }));
    expect(s.employees).toBe(await db.employee.count({ where: { companyId: w.b.companyId, archivedAt: null } }));
    expect((s.recentAudit ?? []).every((e) => e.companyId === w.b.companyId)).toBe(true);
  },

  // ── projects / sites ────────────────────────────────────────────
  "project.list": async () => {
    expect((await projectService.list(w.bCtx, { includeArchived: true })).map((p) => p.id)).toEqual([w.bProject]);
  },
  "project.get": () => expectNotFound(projectService.get(w.bCtx, w.ids.project)),
  "project.create": async () => {
    const p = await projectService.create(w.bCtx, { code: "A-1", name: "Same code, other company" });
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).companyId).toBe(w.b.companyId);
  },
  "project.update": () => expectNotFound(projectService.update(w.bCtx, w.ids.project, { code: "X", name: "Hijacked" })),
  "project.archive": () => expectNotFound(projectService.archive(w.bCtx, w.ids.project)),
  "project.listMembers": () => expectNotFound(projectService.listMembers(w.bCtx, w.ids.project)),
  "project.assignMember": async () => {
    await expectNotFound(projectService.assignMember(w.bCtx, w.ids.project, { userId: w.bCtx.user.id, roleId: await w.b.roleId("EMPLOYEE") }));
    await expectRejected(projectService.assignMember(w.bCtx, w.bProject, { userId: w.ids.memberUserId, roleId: await w.b.roleId("EMPLOYEE") }));
    await expectRejected(projectService.assignMember(w.bCtx, w.bProject, { userId: w.bCtx.user.id, roleId: w.ids.role }));
  },
  "project.listAssignable": async () => {
    await expectNotFound(projectService.listAssignable(w.bCtx, w.ids.project));
    const own = await projectService.listAssignable(w.bCtx, w.bProject);
    expect(own.users.map((u) => u.id)).not.toContain(w.ids.memberUserId);
    expect(own.roles.map((r) => r.id)).not.toContain(w.ids.role);
  },
  "project.removeMember": () => expectNotFound(projectService.removeMember(w.bCtx, w.ids.projectMembership)),
  "site.list": () => expectNotFound(siteService.list(w.bCtx, w.ids.project)),
  "site.get": () => expectNotFound(siteService.get(w.bCtx, w.ids.site)),
  "site.create": () => expectNotFound(siteService.create(w.bCtx, w.ids.project, { name: "Injected site" })),
  "site.update": () => expectNotFound(siteService.update(w.bCtx, w.ids.site, { name: "Hijacked" })),
  "site.archive": () => expectNotFound(siteService.archive(w.bCtx, w.ids.site)),

  // ── workforce ───────────────────────────────────────────────────
  "employee.list": async () => {
    expect((await employeeService.list(w.bCtx, { includeArchived: true })).map((e) => e.id)).not.toContain(w.ids.employee);
  },
  "employee.get": () => expectNotFound(employeeService.get(w.bCtx, w.ids.employee)),
  "employee.create": () => expectRejected(employeeService.create(w.bCtx, { employeeNumber: "B-X", firstName: "B", lastName: "X", userId: w.ids.memberUserId })),
  "employee.update": () => expectNotFound(employeeService.update(w.bCtx, w.ids.employee, { employeeNumber: "A-E1", firstName: "H", lastName: "J" })),
  "employee.archive": () => expectNotFound(employeeService.archive(w.bCtx, w.ids.employee)),
  "employee.listRates": () => expectNotFound(employeeService.listRates(w.bCtx, w.ids.employee)),
  "employee.addRate": () => expectNotFound(employeeService.addRate(w.bCtx, w.ids.employee, { rateType: "COST", amount: "1", validFrom: "2027-01-01" })),
  "employee.archiveRate": () => expectNotFound(employeeService.archiveRate(w.bCtx, w.ids.employeeRate)),

  // ── equipment ───────────────────────────────────────────────────
  "equipmentType.list": async () => {
    expect((await equipmentTypeService.list(w.bCtx, { includeArchived: true })).map((t) => t.id)).not.toContain(w.ids.equipmentType);
  },
  "equipmentType.create": async () => {
    const t = await equipmentTypeService.create(w.bCtx, { name: "A crane" });
    expect(t.companyId).toBe(w.b.companyId);
  },
  "equipmentType.update": () => expectNotFound(equipmentTypeService.update(w.bCtx, w.ids.equipmentType, { name: "Hijacked" })),
  "equipmentType.archive": () => expectNotFound(equipmentTypeService.archive(w.bCtx, w.ids.equipmentType)),
  "equipment.list": async () => {
    expect((await equipmentService.list(w.bCtx, { includeArchived: true })).map((e) => e.id)).not.toContain(w.ids.equipment);
  },
  "equipment.get": () => expectNotFound(equipmentService.get(w.bCtx, w.ids.equipment)),
  "equipment.create": async () => {
    await expectRejected(equipmentService.create(w.bCtx, { equipmentTypeId: w.ids.equipmentType, assetNumber: "B-1", name: "x" }));
    await expectRejected(equipmentService.create(w.bCtx, { equipmentTypeId: w.bEquipmentType, assetNumber: "B-2", name: "x", currentProjectId: w.ids.project }));
    await expectRejected(
      equipmentService.create(w.bCtx, { equipmentTypeId: w.bEquipmentType, assetNumber: "B-3", name: "x", currentProjectId: w.bProject, currentSiteId: w.ids.site }),
    );
  },
  "equipment.update": () => expectNotFound(equipmentService.update(w.bCtx, w.ids.equipment, { equipmentTypeId: w.bEquipmentType, assetNumber: "A-EQ", name: "Hijacked" })),
  "equipment.archive": () => expectNotFound(equipmentService.archive(w.bCtx, w.ids.equipment)),
  "equipment.listRates": () => expectNotFound(equipmentService.listRates(w.bCtx, w.ids.equipment)),
  "equipment.addRate": () => expectNotFound(equipmentService.addRate(w.bCtx, w.ids.equipment, { rateType: "COST", amount: "1", validFrom: "2027-01-01" })),
  "equipment.archiveRate": () => expectNotFound(equipmentService.archiveRate(w.bCtx, w.ids.equipmentRate)),

  // ── documents ───────────────────────────────────────────────────
  "document.list": async () => {
    expect((await documentService.list(w.bCtx, { includeArchived: true })).map((d) => d.id)).toEqual([w.bDocument]);
    const filtered = await documentService.list(w.bCtx, { projectId: w.ids.project }).catch((e: unknown) => {
      expect(e).toBeInstanceOf(NotFoundError);
      return [];
    });
    expect(filtered).toEqual([]);
  },
  "document.get": () => expectNotFound(documentService.get(w.bCtx, w.ids.document)),
  "document.create": () => expectRejected(documentService.create(w.bCtx, { title: "x", projectId: w.ids.project }, textFile("x.pdf"))),
  "document.updateMetadata": () => expectNotFound(documentService.updateMetadata(w.bCtx, w.ids.document, { title: "Hijacked" })),
  "document.archive": () => expectNotFound(documentService.archive(w.bCtx, w.ids.document)),
  "document.uploadVersion": () => expectNotFound(documentService.uploadVersion(w.bCtx, w.ids.document, {}, textFile("x.pdf"))),
  "document.setVersionApproval": () => expectNotFound(documentService.setVersionApproval(w.bCtx, w.ids.version, { state: "APPROVED" })),
  "document.downloadVersion": () => expectNotFound(documentService.downloadVersion(w.bCtx, w.ids.version)),
  "document.addLink": async () => {
    await expectNotFound(documentService.addLink(w.bCtx, w.ids.document, { entityType: "PROJECT", entityId: w.bProject }));
    await expectRejected(documentService.addLink(w.bCtx, w.bDocument, { entityType: "EMPLOYEE", entityId: w.ids.employee }));
    await expectRejected(documentService.addLink(w.bCtx, w.bDocument, { entityType: "SITE", entityId: w.ids.site }));
  },
  "document.removeLink": () => expectNotFound(documentService.removeLink(w.bCtx, w.ids.link)),
  "document.listLinkedTo": async () => {
    expect(await documentService.listLinkedTo(w.bCtx, { entityType: "EMPLOYEE", entityId: w.ids.employee })).toEqual([]);
  },

  // ── identity (user-scoped, never another user's data) ────────────
  "profile.getProfile": async () => {
    expect((await profileService.getProfile(w.bUser)).id).toBe(w.bUser.user.id);
  },
  // ── V2: time tracking ───────────────────────────────────────────
  "timesheet.entryOptions": async () => {
    const o = await timesheetService.entryOptions(w.bCtx);
    expect(o.crewEmployees.map((e) => e.id)).not.toContain(w.ids.employee);
    expect(o.ownEmployee?.id).not.toBe(w.ids.employee);
  },
  "timesheet.listWeek": async () => {
    await expectRejected(timesheetService.listWeek(w.bCtx, { employeeId: w.ids.employee, date: "2026-03-02" }));
    const own = await timesheetService.listWeek(w.bCtx, { date: "2026-03-02" });
    expect(own.entries.map((e) => e.id)).not.toContain(w.ids.timeEntry);
  },
  "timesheet.create": async () => {
    await expectRejected(timesheetService.create(w.bCtx, { employeeId: w.ids.employee, projectId: w.bProject, workDate: "2026-03-03", hours: "1" }));
    await expectRejected(timesheetService.create(w.bCtx, { projectId: w.ids.project, workDate: "2026-03-03", hours: "1" }));
    await expectRejected(timesheetService.create(w.bCtx, { projectId: w.bProject, siteId: w.ids.site, workDate: "2026-03-03", hours: "1" }));
  },
  "timesheet.createCrew": () => expectRejected(timesheetService.createCrew(w.bCtx, { employeeIds: [w.ids.employee], projectId: w.bProject, workDate: "2026-03-03", hours: "1" })),
  "timesheet.update": () => expectNotFound(timesheetService.update(w.bCtx, w.ids.timeEntry, { projectId: w.bProject, workDate: "2026-03-03", hours: "1" })),
  "timesheet.archive": () => expectNotFound(timesheetService.archive(w.bCtx, w.ids.timeEntry)),
  "timesheet.submitWeek": () => expectRejected(timesheetService.submitWeek(w.bCtx, { employeeId: w.ids.employee, date: "2026-03-02" })),
  "timesheet.listForApproval": async () => {
    expect((await timesheetService.listForApproval(w.bCtx)).every((e) => e.projectId !== w.ids.project)).toBe(true);
    await expectNotFound(timesheetService.listForApproval(w.bCtx, { projectId: w.ids.project }).then((r) => (r.length ? r : Promise.reject(new NotFoundError()))));
  },
  "timesheet.decide": () => expectNotFound(timesheetService.decide(w.bCtx, { entryIds: [w.ids.timeEntry], decision: "APPROVE" })),
  "timesheet.createCorrection": () => expectNotFound(timesheetService.createCorrection(w.bCtx, w.ids.timeEntry, { hours: "-1", note: "x" })),
  "timesheet.exportApproved": async () => {
    await expectRejected(timesheetService.exportApproved(w.bCtx, { from: "2026-03-01", to: "2026-03-31" }));
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: w.ids.timeEntry } })).status).toBe("APPROVED");
  },
  "timesheet.exportRows": () => expectNotFound(timesheetService.exportRows(w.bCtx, w.ids.exportBatch)),

  // ── V2: site diary ──────────────────────────────────────────────
  "diary.list": () => expectNotFound(diaryService.list(w.bCtx, { projectId: w.ids.project })),
  "diary.open": () => expectNotFound(diaryService.open(w.bCtx, { siteId: w.ids.site, date: "2026-03-02" })),
  "diary.get": () => expectNotFound(diaryService.get(w.bCtx, w.ids.report)),
  "diary.equipmentOptions": async () => {
    await expectNotFound(diaryService.equipmentOptions(w.bCtx, w.ids.report));
    const own = await diaryService.open(w.bCtx, { siteId: w.bSite, date: "2026-03-02" });
    expect((await diaryService.equipmentOptions(w.bCtx, own.id)).map((e) => e.id)).not.toContain(w.ids.equipment);
  },
  "diary.update": () => expectNotFound(diaryService.update(w.bCtx, w.ids.report, { summary: "Hijacked" })),
  "diary.addEntry": async () => {
    await expectNotFound(diaryService.addEntry(w.bCtx, w.ids.report, { kind: "WORK", description: "x" }));
    const own = await diaryService.open(w.bCtx, { siteId: w.bSite, date: "2026-03-02" });
    await expectRejected(diaryService.addEntry(w.bCtx, own.id, { kind: "EQUIPMENT", equipmentId: w.ids.equipment, hours: "2" }));
  },
  "diary.removeEntry": () => expectNotFound(diaryService.removeEntry(w.bCtx, w.ids.reportEntry)),
  "diary.addAttachment": () => expectNotFound(diaryService.addAttachment(w.bCtx, w.ids.report, {}, { fileName: "x.jpg", bytes: new Uint8Array([1]) })),
  "diary.downloadAttachment": () => expectNotFound(diaryService.downloadAttachment(w.bCtx, w.ids.attachment)),
  "diary.sign": () => expectNotFound(diaryService.sign(w.bCtx, w.ids.report)),

  // ── V2: finance ─────────────────────────────────────────────────
  "budget.listVersions": () => expectNotFound(budgetService.listVersions(w.bCtx, w.ids.project)),
  "budget.createVersion": () => expectNotFound(budgetService.createVersion(w.bCtx, w.ids.project, {})),
  "budget.addLine": () => expectNotFound(budgetService.addLine(w.bCtx, w.ids.budget, { category: "OTHER", description: "x", amount: "1" })),
  "budget.updateLine": () => expectNotFound(budgetService.updateLine(w.bCtx, w.ids.budgetLine, { category: "OTHER", description: "x", amount: "1" })),
  "budget.removeLine": () => expectNotFound(budgetService.removeLine(w.bCtx, w.ids.budgetLine)),
  "budget.discardDraft": () => expectNotFound(budgetService.discardDraft(w.bCtx, w.ids.budget)),
  "budget.activate": () => expectNotFound(budgetService.activate(w.bCtx, w.ids.budget)),
  "cost.list": () => expectNotFound(costService.list(w.bCtx, w.ids.project)),
  "cost.create": async () => {
    await expectNotFound(costService.create(w.bCtx, w.ids.project, { category: "OTHER", entryDate: "2026-03-02", description: "x", amount: "1" }));
    await expectRejected(costService.create(w.bCtx, w.bProject, { category: "OTHER", entryDate: "2026-03-02", description: "x", amount: "1", siteId: w.ids.site }));
  },
  "cost.archive": () => expectNotFound(costService.archive(w.bCtx, w.ids.cost)),
  "projectFinance.summary": async () => {
    await expectNotFound(projectFinanceService.summary(w.bCtx, w.ids.project));
    const own = await projectFinanceService.summary(w.bCtx, w.bProject);
    expect(own.comparison.total.actual.toString()).toBe("0");
  },

  // ── V3 takt ─────────────────────────────────────────────────────
  "workCalendar.get": async () => {
    const cal = await workCalendarService.get(w.bCtx);
    expect(cal.holidays.map((h) => h.id)).not.toContain(w.ids.holiday);
    expect(cal.holidays.map((h) => h.name)).not.toContain("A secret day");
  },
  "workCalendar.updateWeekdays": async () => {
    await workCalendarService.updateWeekdays(w.bCtx, { workingWeekdays: [1, 2, 3, 4] });
    expect((await workCalendarService.get(w.a.ownerCtx)).workingWeekdays).toEqual([1, 2, 3, 4, 5]);
  },
  "workCalendar.addHoliday": async () => {
    await workCalendarService.addHoliday(w.bCtx, { date: "2026-11-21", name: "B day" });
    expect((await workCalendarService.get(w.a.ownerCtx)).holidays.map((h) => h.name)).not.toContain("B day");
  },
  "workCalendar.removeHoliday": () => expectNotFound(workCalendarService.removeHoliday(w.bCtx, w.ids.holiday)),
  "workCalendar.addFinnishHolidays": async () => {
    const before = (await workCalendarService.get(w.a.ownerCtx)).holidays.length;
    await workCalendarService.addFinnishHolidays(w.bCtx, { year: 2031 });
    expect((await workCalendarService.get(w.a.ownerCtx)).holidays).toHaveLength(before);
  },
  "taktStructure.overview": () => expectNotFound(taktStructureService.overview(w.bCtx, w.ids.project)),
  "taktStructure.createBuilding": () => expectNotFound(taktStructureService.createBuilding(w.bCtx, { siteId: w.ids.site, name: "Intruder" })),
  "taktStructure.archiveBuilding": () => expectNotFound(taktStructureService.archiveBuilding(w.bCtx, w.ids.building)),
  "taktStructure.createArea": () => expectNotFound(taktStructureService.createArea(w.bCtx, { buildingId: w.ids.building, code: "X", name: "X" })),
  "taktStructure.updateArea": () => expectNotFound(taktStructureService.updateArea(w.bCtx, w.ids.area, { code: "X", name: "X" })),
  "taktStructure.archiveArea": () => expectNotFound(taktStructureService.archiveArea(w.bCtx, w.ids.area)),
  "taktStructure.createWorkPackage": async () => {
    await expectNotFound(taktStructureService.createWorkPackage(w.bCtx, w.ids.project, { code: "X", name: "X" }));
    await expectRejected(taktStructureService.createWorkPackage(w.bCtx, w.bProject, { code: "XE", name: "X", equipmentTypeId: w.ids.equipmentType, equipmentCount: "1" }));
  },
  "taktStructure.updateWorkPackage": () => expectNotFound(taktStructureService.updateWorkPackage(w.bCtx, w.ids.workPackage, { code: "X", name: "X" })),
  "taktStructure.archiveWorkPackage": () => expectNotFound(taktStructureService.archiveWorkPackage(w.bCtx, w.ids.workPackage)),
  "taktPlan.list": async () => {
    const plans = await taktPlanService.list(w.bCtx);
    expect(plans.map((p) => p.id)).not.toContain(w.ids.plan);
  },
  "taktPlan.create": () => expectNotFound(taktPlanService.create(w.bCtx, { siteId: w.ids.site, name: "Intruder", startDate: "2026-11-02" })),
  "taktPlan.board": async () => {
    await expectNotFound(taktPlanService.board(w.bCtx, w.ids.plan));
    await expectNotFound(taktPlanService.board(w.bCtx, w.b3.plan, { versionId: w.ids.baseline }));
  },
  "taktPlan.createDraft": () => expectNotFound(taktPlanService.createDraft(w.bCtx, w.ids.plan, {})),
  "taktPlan.updateDraft": () => expectNotFound(taktPlanService.updateDraft(w.bCtx, w.ids.draft, { startDate: "2026-12-01" })),
  "taktPlan.discardDraft": () => expectNotFound(taktPlanService.discardDraft(w.bCtx, w.ids.draft)),
  "taktPlan.propose": () => expectNotFound(taktPlanService.propose(w.bCtx, w.ids.draft)),
  "taktPlan.returnToDraft": () => expectNotFound(taktPlanService.returnToDraft(w.bCtx, w.ids.draft, { note: "x" })),
  "taktPlan.approve": () => expectNotFound(taktPlanService.approve(w.bCtx, w.ids.draft)),
  "taktPlan.compare": async () => {
    await expectNotFound(taktPlanService.compare(w.bCtx, w.ids.plan, { versionId: w.ids.draft }));
    await expectNotFound(taktPlanService.compare(w.bCtx, w.b3.plan, { versionId: w.ids.draft }));
  },
  "taktPlan.generateTrain": () => expectNotFound(taktPlanService.generateTrain(w.bCtx, w.ids.draft, {})),
  "taktPlan.setAssignment": async () => {
    await expectNotFound(taktPlanService.setAssignment(w.bCtx, w.ids.draft, w.ids.activity, { startCycle: 1, durationCycles: 1 }));
    await expectNotFound(taktPlanService.setAssignment(w.bCtx, w.b3.version, w.ids.activity, { startCycle: 1, durationCycles: 1 }));
  },
  "taktPlan.removeAssignment": async () => {
    await expectNotFound(taktPlanService.removeAssignment(w.bCtx, w.ids.draft, w.ids.activity));
    await expectNotFound(taktPlanService.removeAssignment(w.bCtx, w.b3.version, w.ids.activity));
  },
  "taktPlan.shiftWorkPackage": async () => {
    await expectNotFound(taktPlanService.shiftWorkPackage(w.bCtx, w.ids.draft, w.ids.workPackage, { days: 1 }));
    await expectNotFound(taktPlanService.shiftWorkPackage(w.bCtx, w.b3.version, w.ids.workPackage, { days: 1 }));
  },
  "taktActivity.get": () => expectNotFound(taktActivityService.get(w.bCtx, w.ids.activity)),
  "taktActivity.listForWeek": () => expectNotFound(taktActivityService.listForWeek(w.bCtx, w.ids.plan)),
  "taktActivity.create": async () => {
    await expectNotFound(taktActivityService.create(w.bCtx, w.ids.plan, { workPackageId: w.ids.workPackage, taktAreaId: w.ids.area }));
    await expectRejected(taktActivityService.create(w.bCtx, w.b3.plan, { workPackageId: w.ids.workPackage, taktAreaId: w.ids.area }));
  },
  "taktActivity.update": () => expectNotFound(taktActivityService.update(w.bCtx, w.ids.activity, { name: "x", crewSize: "1" })),
  "taktActivity.archive": () => expectNotFound(taktActivityService.archive(w.bCtx, w.ids.activity)),
  "taktActivity.addDependency": async () => {
    await expectNotFound(taktActivityService.addDependency(w.bCtx, { predecessorId: w.ids.activity2, successorId: w.ids.activity }));
    await expectRejected(taktActivityService.addDependency(w.bCtx, { predecessorId: w.ids.activity, successorId: w.b3.activity }));
  },
  "taktActivity.removeDependency": () => expectNotFound(taktActivityService.removeDependency(w.bCtx, w.ids.dependency)),
  "taktActivity.addConstraint": () => expectNotFound(taktActivityService.addConstraint(w.bCtx, w.ids.activity, { type: "OTHER", description: "x" })),
  "taktActivity.clearConstraint": () => expectNotFound(taktActivityService.clearConstraint(w.bCtx, w.ids.constraint)),
  "taktActivity.recordProgress": () => expectNotFound(taktActivityService.recordProgress(w.bCtx, w.ids.activity, { progressPct: "50", reportDate: "2026-09-01" })),
  "taktActivity.setBlocked": () => expectNotFound(taktActivityService.setBlocked(w.bCtx, w.ids.activity, { blocked: true, delayReason: "x" })),
  "lookahead.compute": async () => {
    await expectNotFound(lookaheadService.compute(w.bCtx, { weeks: 2, projectId: w.ids.project }));
    const own = await lookaheadService.compute(w.bCtx, { weeks: 12, from: "2026-11-02" });
    expect(own.rows.map((r) => r.label)).not.toContain("A-secret-trade");
    expect(own.projects.map((p) => p.id)).not.toContain(w.ids.project);
  },
  "scheduleImport.preview": async () => {
    await expectNotFound(scheduleImportService.preview(w.bCtx, w.ids.plan, { buildingId: w.ids.building }, { fileName: "x.xml", bytes: new Uint8Array([1]) }));
    await expectRejected(scheduleImportService.preview(w.bCtx, w.b3.plan, { buildingId: w.ids.building }, { fileName: "x.xml", bytes: new Uint8Array([1]) }));
  },
  "scheduleImport.get": () => expectNotFound(scheduleImportService.get(w.bCtx, w.ids.scheduleImport)),
  "scheduleImport.download": () => expectNotFound(scheduleImportService.download(w.bCtx, w.ids.scheduleImport)),
  "scheduleImport.discard": () => expectNotFound(scheduleImportService.discard(w.bCtx, w.ids.scheduleImport)),
  "scheduleImport.apply": () => expectNotFound(scheduleImportService.apply(w.bCtx, w.ids.scheduleImport)),

  "profile.setLocale": async () => {
    await profileService.setLocale(w.bUser, { locale: "en" });
    expect((await db.user.findUniqueOrThrow({ where: { id: w.a.owner.user.id } })).locale).toBeNull();
  },
};

describe("tenant isolation: every service method has a case", () => {
  const methods = Object.entries(SERVICE_REGISTRY).flatMap(([service, obj]) => Object.keys(obj).map((m) => `${service}.${m}`));

  it("registry is not empty", () => {
    expect(methods.length).toBeGreaterThan(40);
  });

  it.each(methods)("%s has an isolation case", (name) => {
    expect(cases[name], `Missing isolation case for ${name} — add one to tests/isolation/isolation.test.ts`).toBeTypeOf("function");
  });

  it("has no stale cases", () => {
    expect(Object.keys(cases).filter((k) => !methods.includes(k))).toEqual([]);
  });
});

describe("tenant isolation: company B user cannot reach company A data", () => {
  it("cannot resolve a context for a company they are not a member of (404)", async () => {
    await expectNotFound(resolveRequestContext({ userId: w.bCtx.user.id, companySlug: w.a.slug, meta, locale: "fi" }));
    await expectNotFound(resolveRequestContext({ userId: w.bCtx.user.id, companySlug: "does-not-exist", meta, locale: "fi" }));
  });

  for (const [name, run] of Object.entries(cases)) {
    it(name, run);
  }

  it("company A data and audit trail are untouched by company B", async () => {
    expect((await db.project.findUniqueOrThrow({ where: { id: w.ids.project } })).name).toBe("A secret project");
    expect((await db.project.findUniqueOrThrow({ where: { id: w.ids.project } })).archivedAt).toBeNull();
    expect(await db.site.count({ where: { projectId: w.ids.project } })).toBe(1);
    expect(await db.documentVersion.count({ where: { documentId: w.ids.document } })).toBe(1);
    expect(await db.auditEvent.count({ where: { companyId: w.a.companyId } })).toBe(aAuditCountBefore);
    expect((await db.dailyReport.findUniqueOrThrow({ where: { id: w.ids.report } })).status).toBe("DRAFT");
    expect((await db.budget.findUniqueOrThrow({ where: { id: w.ids.budget } })).status).toBe("DRAFT");
    expect((await db.costEntry.findUniqueOrThrow({ where: { id: w.ids.cost } })).archivedAt).toBeNull();
    expect((await db.taktPlanVersion.findUniqueOrThrow({ where: { id: w.ids.draft } })).status).toBe("DRAFT");
    expect((await db.taktPlanVersion.findUniqueOrThrow({ where: { id: w.ids.baseline } })).status).toBe("BASELINE");
    expect((await db.taktActivity.findUniqueOrThrow({ where: { id: w.ids.activity } })).progressPct).toBe(0);
    expect((await db.scheduleImport.findUniqueOrThrow({ where: { id: w.ids.scheduleImport } })).status).toBe("PREVIEW");
    expect(await db.activityDependency.count({ where: { planId: w.ids.plan } })).toBe(1);
  });
});
