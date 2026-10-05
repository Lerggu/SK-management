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
  };
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
    },
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
  });
});
