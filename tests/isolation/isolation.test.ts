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
import { bookingService } from "@/modules/logistics/booking.service";
import { deliveryService, logisticsBoardService, logisticsLocationService, logisticsRequestService } from "@/modules/logistics/logistics.service";
import { liftingAccessoryService, liftPlanService } from "@/modules/lifting/lift.service";
import { cableDrumService, materialBatchService, materialLabelService, materialTraceService, scanService } from "@/modules/lifting/material.service";
import { commercialDashboardService, customerService, opportunityService } from "@/modules/commercial/crm.service";
import { quoteService } from "@/modules/commercial/quote.service";
import { contractService, forecastService, variationService } from "@/modules/commercial/project.service";
import { invoiceService } from "@/modules/commercial/invoice.service";
import { clientApprovalService } from "@/modules/commercial/client-approval.service";
import { hseActionService, hseObservationService, hseOverviewService, hsePhotoService, incidentService } from "@/modules/hse/hse.service";
import { hseInspectionService, riskAssessmentService, toolboxTalkService, workPermitService } from "@/modules/hse/planning.service";
import { scheduleSummaryService } from "@/modules/takt/summary.service";
import { portalService } from "@/modules/portal/service";
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
    gate: string;
    logisticsRequest: string;
    delivery: string;
    booking: string;
    storage: string;
    accessory: string;
    liftPlan: string;
    batch: string;
    drum: string;
  };
  b5: { liftPlan: string; drum: string; batch: string };
  v6: { customer: string; contact: string; opportunity: string; quote: string; quoteLine: string; contract: string; variation: string; candidate: string; exportBatch: string };
  b6: { customer: string; variation: string };
  v7: { observation: string; incident: string; action: string; photo: string; risk: string; riskItem: string; permit: string; inspection: string; approval: string; approvalHash: string; variation: string };
  b7: { incident: string; clientApprover: RequestContext };
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


  // ── V4 data in company A ──
  const gate = await logisticsLocationService.create(actx, { siteId: site.id, kind: "GATE", name: "A gate", opens: "06:00", closes: "18:00" });
  const logisticsRequest = await logisticsRequestService.create(actx, { siteId: site.id, activityId: activity.id, serviceType: "DELIVERY", title: "A secret delivery", requestedStart: "2026-11-02T07:00", requestedEnd: "2026-11-02T08:00", submit: "on" });
  const delivery = await deliveryService.create(actx, { siteId: site.id, gateId: gate.id, supplier: "A supplier", material: "A material", date: "2026-11-02", startTime: "07:00" });
  const [booking] = await bookingService.create(actx, { resources: [`EQUIPMENT:${equipment.id}`], projectId: project.id, startsAt: "2026-11-02T07:00", endsAt: "2026-11-02T15:00" });
  await equipmentService.update(actx, equipment.id, { equipmentTypeId: type.id, assetNumber: "A-EQ", name: "A crane 1", currentProjectId: project.id, shareableInGroup: "on" });

  // ── V5 data in company A ──
  const storage = await logisticsLocationService.create(actx, { siteId: site.id, kind: "STORAGE", name: "A yard" });
  const accessory = await liftingAccessoryService.create(actx, { code: "A-SL1", name: "A sling", kind: "SLING", wllKg: "2000", nextInspectionDate: "2027-06-01" });
  const liftPlan = await liftPlanService.create(actx, { siteId: site.id, activityId: activity.id, title: "A secret lift", plannedStart: "2026-11-03T08:00", plannedEnd: "2026-11-03T09:00" });
  await liftPlanService.updateDraft(actx, liftPlan.id, { loadDescription: "A beam", loadWeightKg: "1000", craneId: equipment.id, radiusM: "10", craneCapacityKg: "5000" });
  await liftPlanService.addAccessory(actx, liftPlan.id, { accessoryId: accessory.id, count: 1 });
  const batch = await materialBatchService.create(actx, { siteId: site.id, code: "A-MB1", material: "A secret cable trays", quantity: "40", unit: "m", deliveryId: delivery.id, activityId: activity.id });
  const drum = await cableDrumService.create(actx, { siteId: site.id, code: "A-CD1", cableType: "A cable", originalLengthM: "500", locationId: storage.id });
  await cableDrumService.pull(actx, drum.id, { lengthM: "20", activityId: activity.id, pulledOn: "2026-11-03" });

  // ── V6 data in company A ──
  const customer = await customerService.create(actx, { name: "A secret customer Oy", businessId: "1234567-8" });
  const contact = await customerService.addContact(actx, customer.id, { name: "A contact" });
  const opportunity = await opportunityService.create(actx, { customerId: customer.id, title: "A secret deal", stage: "TENDER", estimatedValue: "500000", probabilityPct: "40" });
  const quote = await quoteService.create(actx, { customerId: customer.id, opportunityId: opportunity.id, projectId: project.id, title: "A secret quote" });
  const quoteLine = await quoteService.addLine(actx, quote.id, { category: "LABOR", description: "A work", quantity: "10", unit: "h", unitCost: "50" });
  const contract = await contractService.create(actx, { projectId: project.id, customerId: customer.id, contractNumber: "A-SOP-1", title: "A contract", value: "100000" });
  await contractService.addMilestone(actx, contract.id, { title: "A milestone", amount: "25000", dueDate: "2026-10-01" });
  const variation = await variationService.create(actx, { projectId: project.id, contractId: contract.id, title: "A secret variation" });
  await forecastService.setEtc(actx, project.id, { category: "LABOR", etcAmount: "1000" });
  await invoiceService.generate(actx, { projectId: project.id, to: "2026-10-31" });
  const candidate = (await invoiceService.list(actx, { projectId: project.id })).find((c) => c.sourceType === "MILESTONE")!;
  const invoiceExport = await invoiceService.export(actx, { kind: "CUSTOMER", projectId: project.id });

  // ── V7 data in company A ──
  const observation = await hseObservationService.create(actx, { projectId: project.id, siteId: site.id, kind: "NEAR_MISS", title: "A secret near miss", occurredAt: "2026-10-01T08:00", liftPlanId: liftPlan.id });
  const photo = await hsePhotoService.add(actx, { recordType: "OBSERVATION", recordId: observation.id }, { fileName: "a.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) });
  const incident = await incidentService.report(actx, { projectId: project.id, siteId: site.id, type: "INJURY", severity: "SERIOUS", title: "A secret incident", occurredAt: "2026-10-01T09:00" });
  await incidentService.triage(actx, incident.id, { type: "INJURY", severity: "SERIOUS" });
  await incidentService.addPerson(actx, incident.id, { personName: "A injured person", employeeId: employee.id });
  const action = await hseActionService.create(actx, { sourceType: "INCIDENT", sourceId: incident.id, title: "A secret action", assigneeId: member.user.id });
  await toolboxTalkService.create(actx, { projectId: project.id, heldOn: "2026-10-01", topic: "A topic", attendeeCount: "5" });
  const risk = await riskAssessmentService.create(actx, { projectId: project.id, title: "A secret risk" });
  const riskItem = await riskAssessmentService.addItem(actx, risk.id, { hazard: "A hazard", likelihood: "3", consequence: "4" });
  const permit = await workPermitService.request(actx, { projectId: project.id, type: "HOT_WORK", description: "A welding", validFrom: "2026-11-02T07:00", validTo: "2026-11-02T15:00" });
  const inspection = await hseInspectionService.create(actx, { projectId: project.id, kind: "MVR", inspectedOn: "2026-10-01", correctCount: "45", incorrectCount: "5" });
  const portalVariation = await variationService.create(actx, { projectId: project.id, title: "A client variation" });
  await variationService.updateDraft(actx, portalVariation.id, { title: "A client variation", laborCost: "1000", markupPct: "10" });
  await variationService.submitForReview(actx, portalVariation.id);
  await variationService.approveInternal(await createMember(a, "PROJECT_DIRECTOR"), portalVariation.id, { decision: "APPROVE" });
  const approval = await db.variationClientApproval.findFirstOrThrow({ where: { variationId: portalVariation.id } });

  // ── V3 data in company B (for cross-references) ──
  const bBuilding = await taktStructureService.createBuilding(b.ownerCtx, { siteId: bSite.id, name: "B building" });
  const bArea = await taktStructureService.createArea(b.ownerCtx, { buildingId: bBuilding.id, code: "B1", name: "B area" });
  const bWp = await taktStructureService.createWorkPackage(b.ownerCtx, bProject.id, { code: "BW", name: "B wagon" });
  const bPlan = await taktPlanService.create(b.ownerCtx, { siteId: bSite.id, name: "B plan", startDate: "2026-11-02" });
  const bVersion = (await taktPlanService.board(b.ownerCtx, bPlan.id)).selected!;
  const bActivity = await taktActivityService.create(b.ownerCtx, bPlan.id, { workPackageId: bWp.id, taktAreaId: bArea.id });
  const bLift = await liftPlanService.create(b.ownerCtx, { siteId: bSite.id, title: "B lift", plannedStart: "2026-11-03T08:00", plannedEnd: "2026-11-03T09:00" });
  const bDrum = await cableDrumService.create(b.ownerCtx, { siteId: bSite.id, code: "B-CD1", cableType: "B cable", originalLengthM: "100" });
  const bBatch = await materialBatchService.create(b.ownerCtx, { siteId: bSite.id, code: "B-MB1", material: "B material", quantity: "1", unit: "pcs" });
  const bCustomer = await customerService.create(b.ownerCtx, { name: "B customer" });
  const bVariation = await variationService.create(b.ownerCtx, { projectId: bProject.id, title: "B variation" });
  const bIncident = await incidentService.report(b.ownerCtx, { projectId: bProject.id, type: "PROPERTY_DAMAGE", severity: "FIRST_AID", title: "B incident", occurredAt: "2026-10-01T08:00" });
  await incidentService.triage(b.ownerCtx, bIncident.id, { type: "PROPERTY_DAMAGE", severity: "FIRST_AID" });
  const bClientApprover = await createMember(b, "CLIENT_APPROVER", [{ projectId: bProject.id }]);

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
      gate: gate.id,
      logisticsRequest: logisticsRequest.id,
      delivery: delivery.id,
      booking: booking.id,
      storage: storage.id,
      accessory: accessory.id,
      liftPlan: liftPlan.id,
      batch: batch.id,
      drum: drum.id,
    },
    b5: { liftPlan: bLift.id, drum: bDrum.id, batch: bBatch.id },
    v6: { customer: customer.id, contact: contact.id, opportunity: opportunity.id, quote: quote.id, quoteLine: quoteLine.id, contract: contract.id, variation: variation.id, candidate: candidate.id, exportBatch: invoiceExport.id },
    b6: { customer: bCustomer.id, variation: bVariation.id },
    v7: {
      observation: observation.id,
      incident: incident.id,
      action: action.id,
      photo: photo.id,
      risk: risk.id,
      riskItem: riskItem.id,
      permit: permit.id,
      inspection: inspection.id,
      approval: approval.id,
      approvalHash: approval.contentSha256,
      variation: portalVariation.id,
    },
    b7: { incident: bIncident.id, clientApprover: bClientApprover },
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

  // ── V4 logistics ────────────────────────────────────────────────
  "booking.resourceOptions": async () => {
    await expectNotFound(bookingService.resourceOptions(w.bCtx, w.ids.project));
    // A's crane is shareable, but B is in another organization: never offered.
    const own = await bookingService.resourceOptions(w.bCtx, w.bProject);
    expect(JSON.stringify(own)).not.toContain(w.ids.equipment);
  },
  "booking.list": async () => {
    await expectNotFound(bookingService.list(w.bCtx, { projectId: w.ids.project }));
    expect((await bookingService.list(w.bCtx)).map((b) => b.id)).not.toContain(w.ids.booking);
  },
  "booking.incoming": async () => {
    expect((await bookingService.incoming(w.bCtx)).map((b) => b.id)).not.toContain(w.ids.booking);
  },
  "booking.get": () => expectNotFound(bookingService.get(w.bCtx, w.ids.booking)),
  "booking.create": async () => {
    await expectNotFound(bookingService.create(w.bCtx, { resources: [`EQUIPMENT:${w.ids.equipment}`], projectId: w.ids.project, startsAt: "2026-11-03T07:00", endsAt: "2026-11-03T15:00" }));
    await expectRejected(bookingService.create(w.bCtx, { resources: [`EQUIPMENT:${w.ids.equipment}`], projectId: w.bProject, startsAt: "2026-11-03T07:00", endsAt: "2026-11-03T15:00" }));
    await expectRejected(bookingService.create(w.bCtx, { resources: [`EMPLOYEE:${w.ids.employee}`], projectId: w.bProject, activityId: w.ids.activity, startsAt: "2026-11-03T07:00", endsAt: "2026-11-03T15:00" }));
  },
  "booking.decide": () => expectNotFound(bookingService.decide(w.bCtx, w.ids.booking, { decision: "REJECT" })),
  "booking.cancel": () => expectNotFound(bookingService.cancel(w.bCtx, w.ids.booking)),
  "logisticsLocation.list": () => expectNotFound(logisticsLocationService.list(w.bCtx, w.ids.site)),
  "logisticsLocation.create": () => expectNotFound(logisticsLocationService.create(w.bCtx, { siteId: w.ids.site, kind: "STORAGE", name: "Intruder" })),
  "logisticsLocation.archive": () => expectNotFound(logisticsLocationService.archive(w.bCtx, w.ids.gate)),
  "logisticsRequest.list": async () => {
    await expectNotFound(logisticsRequestService.list(w.bCtx, { siteId: w.ids.site }));
    expect((await logisticsRequestService.list(w.bCtx)).map((r) => r.id)).not.toContain(w.ids.logisticsRequest);
  },
  "logisticsRequest.get": () => expectNotFound(logisticsRequestService.get(w.bCtx, w.ids.logisticsRequest)),
  "logisticsRequest.create": async () => {
    await expectNotFound(logisticsRequestService.create(w.bCtx, { siteId: w.ids.site, serviceType: "OTHER", title: "x", requestedStart: "2026-11-02T07:00", requestedEnd: "2026-11-02T08:00" }));
    await expectRejected(logisticsRequestService.create(w.bCtx, { siteId: w.bSite, activityId: w.ids.activity, serviceType: "OTHER", title: "x", requestedStart: "2026-11-02T07:00", requestedEnd: "2026-11-02T08:00" }));
  },
  "logisticsRequest.transition": () => expectNotFound(logisticsRequestService.transition(w.bCtx, w.ids.logisticsRequest, { to: "CANCELLED" })),
  "delivery.get": () => expectNotFound(deliveryService.get(w.bCtx, w.ids.delivery)),
  "delivery.create": async () => {
    await expectNotFound(deliveryService.create(w.bCtx, { siteId: w.ids.site, gateId: w.ids.gate, supplier: "x", material: "x", date: "2026-11-02", startTime: "09:00" }));
    await expectRejected(deliveryService.create(w.bCtx, { siteId: w.bSite, gateId: w.ids.gate, supplier: "x", material: "x", date: "2026-11-02", startTime: "09:00" }));
  },
  "delivery.reschedule": () => expectNotFound(deliveryService.reschedule(w.bCtx, w.ids.delivery, { gateId: w.ids.gate, date: "2026-11-02", startTime: "10:00", slots: 1 })),
  "delivery.advance": () => expectNotFound(deliveryService.advance(w.bCtx, w.ids.delivery, { to: "CANCELLED" })),
  "logisticsBoard.sites": async () => {
    expect((await logisticsBoardService.sites(w.bCtx)).map((x) => x.id)).not.toContain(w.ids.site);
  },
  "logisticsBoard.day": () => expectNotFound(logisticsBoardService.day(w.bCtx, { siteId: w.ids.site, date: "2026-11-02" })),

  // ── V5 lifting and material flow ────────────────────────────────
  "liftingAccessory.list": async () => {
    expect((await liftingAccessoryService.list(w.bCtx, { includeArchived: true })).map((a) => a.id)).not.toContain(w.ids.accessory);
  },
  "liftingAccessory.get": () => expectNotFound(liftingAccessoryService.get(w.bCtx, w.ids.accessory)),
  "liftingAccessory.create": async () => {
    // Codes are unique per company: B may reuse A's code without touching A.
    const own = await liftingAccessoryService.create(w.bCtx, { code: "A-SL1", name: "B sling", kind: "SLING", wllKg: "1000" });
    expect(own.id).not.toBe(w.ids.accessory);
    expect(own.companyId).toBe(w.b.companyId);
  },
  "liftingAccessory.update": () => expectNotFound(liftingAccessoryService.update(w.bCtx, w.ids.accessory, { name: "x", kind: "SLING", wllKg: "1" })),
  "liftingAccessory.archive": () => expectNotFound(liftingAccessoryService.archive(w.bCtx, w.ids.accessory)),
  "liftPlan.options": () => expectNotFound(liftPlanService.options(w.bCtx, w.ids.site)),
  "liftPlan.sites": async () => {
    expect((await liftPlanService.sites(w.bCtx)).map((x) => x.id)).not.toContain(w.ids.site);
  },
  "liftPlan.list": async () => {
    await expectNotFound(liftPlanService.list(w.bCtx, { siteId: w.ids.site }));
    expect((await liftPlanService.list(w.bCtx)).map((p) => p.id)).not.toContain(w.ids.liftPlan);
  },
  "liftPlan.get": () => expectNotFound(liftPlanService.get(w.bCtx, w.ids.liftPlan)),
  "liftPlan.create": async () => {
    await expectNotFound(liftPlanService.create(w.bCtx, { siteId: w.ids.site, title: "x", plannedStart: "2026-11-03T08:00", plannedEnd: "2026-11-03T09:00" }));
    await expectRejected(liftPlanService.create(w.bCtx, { siteId: w.bSite, activityId: w.ids.activity, title: "x", plannedStart: "2026-11-03T08:00", plannedEnd: "2026-11-03T09:00" }));
    await expectRejected(liftPlanService.create(w.bCtx, { siteId: w.bSite, requestId: w.ids.logisticsRequest, title: "x", plannedStart: "2026-11-03T08:00", plannedEnd: "2026-11-03T09:00" }));
  },
  "liftPlan.updateDraft": async () => {
    await expectNotFound(liftPlanService.updateDraft(w.bCtx, w.ids.liftPlan, { loadWeightKg: "1" }));
    await expectRejected(liftPlanService.updateDraft(w.bCtx, w.b5.liftPlan, { craneId: w.ids.equipment }));
    await expectRejected(liftPlanService.updateDraft(w.bCtx, w.b5.liftPlan, { riskDocumentId: w.ids.document }));
  },
  "liftPlan.addAccessory": async () => {
    await expectNotFound(liftPlanService.addAccessory(w.bCtx, w.ids.liftPlan, { accessoryId: w.ids.accessory }));
    await expectRejected(liftPlanService.addAccessory(w.bCtx, w.b5.liftPlan, { accessoryId: w.ids.accessory }));
  },
  "liftPlan.removeAccessory": () => expectNotFound(liftPlanService.removeAccessory(w.bCtx, w.ids.liftPlan, w.ids.accessory)),
  "liftPlan.submit": () => expectNotFound(liftPlanService.submit(w.bCtx, w.ids.liftPlan)),
  "liftPlan.returnToDraft": () => expectNotFound(liftPlanService.returnToDraft(w.bCtx, w.ids.liftPlan)),
  "liftPlan.decide": () => expectNotFound(liftPlanService.decide(w.bCtx, w.ids.liftPlan, { decision: "APPROVE" })),
  "liftPlan.revise": () => expectNotFound(liftPlanService.revise(w.bCtx, w.ids.liftPlan, { reason: "x" })),
  "liftPlan.complete": () => expectNotFound(liftPlanService.complete(w.bCtx, w.ids.liftPlan)),
  "liftPlan.cancel": () => expectNotFound(liftPlanService.cancel(w.bCtx, w.ids.liftPlan)),
  "materialBatch.options": () => expectNotFound(materialBatchService.options(w.bCtx, w.ids.site)),
  "materialBatch.sites": async () => {
    expect((await materialBatchService.sites(w.bCtx)).map((x) => x.id)).not.toContain(w.ids.site);
  },
  "materialBatch.list": async () => {
    await expectNotFound(materialBatchService.list(w.bCtx, { siteId: w.ids.site }));
    expect((await materialBatchService.list(w.bCtx)).map((b) => b.id)).not.toContain(w.ids.batch);
  },
  "materialBatch.get": () => expectNotFound(materialBatchService.get(w.bCtx, w.ids.batch)),
  "materialBatch.create": async () => {
    await expectNotFound(materialBatchService.create(w.bCtx, { siteId: w.ids.site, code: "X1", material: "x", quantity: "1", unit: "pcs" }));
    await expectRejected(materialBatchService.create(w.bCtx, { siteId: w.bSite, code: "X2", material: "x", quantity: "1", unit: "pcs", deliveryId: w.ids.delivery }));
    await expectRejected(materialBatchService.create(w.bCtx, { siteId: w.bSite, code: "X3", material: "x", quantity: "1", unit: "pcs", activityId: w.ids.activity }));
    await expectRejected(materialBatchService.create(w.bCtx, { siteId: w.bSite, code: "X4", material: "x", quantity: "1", unit: "pcs", locationId: w.ids.storage }));
  },
  "materialBatch.move": async () => {
    await expectNotFound(materialBatchService.move(w.bCtx, w.ids.batch, { to: "RETURNED" }));
    await expectRejected(materialBatchService.move(w.bCtx, w.b5.batch, { to: "STORED", locationId: w.ids.storage }));
  },
  "cableDrum.list": async () => {
    await expectNotFound(cableDrumService.list(w.bCtx, { siteId: w.ids.site }));
    expect((await cableDrumService.list(w.bCtx)).map((d) => d.id)).not.toContain(w.ids.drum);
  },
  "cableDrum.get": () => expectNotFound(cableDrumService.get(w.bCtx, w.ids.drum)),
  "cableDrum.create": async () => {
    await expectNotFound(cableDrumService.create(w.bCtx, { siteId: w.ids.site, code: "X1", cableType: "x", originalLengthM: "1" }));
    await expectRejected(cableDrumService.create(w.bCtx, { siteId: w.bSite, code: "X2", cableType: "x", originalLengthM: "1", locationId: w.ids.storage }));
  },
  "cableDrum.update": async () => {
    await expectNotFound(cableDrumService.update(w.bCtx, w.ids.drum, { returned: "on" }));
    await expectRejected(cableDrumService.update(w.bCtx, w.b5.drum, { reservedActivityId: w.ids.activity }));
  },
  "cableDrum.pull": async () => {
    await expectNotFound(cableDrumService.pull(w.bCtx, w.ids.drum, { lengthM: "1", pulledOn: "2026-11-03" }));
    await expectRejected(cableDrumService.pull(w.bCtx, w.b5.drum, { lengthM: "1", pulledOn: "2026-11-03", activityId: w.ids.activity }));
  },
  "materialTrace.activity": () => expectNotFound(materialTraceService.activity(w.bCtx, w.ids.activity)),
  "materialLabel.pdf": async () => {
    const strings = { title: "x", footer: "x" };
    await expectNotFound(materialLabelService.pdf(w.bCtx, { kind: "drum", siteId: w.ids.site }, "http://x", strings));
    await expectNotFound(materialLabelService.pdf(w.bCtx, { kind: "drum", ids: [w.ids.drum] }, "http://x", strings));
    await expectNotFound(materialLabelService.pdf(w.bCtx, { kind: "batch", ids: [w.ids.batch] }, "http://x", strings));
    await expectNotFound(materialLabelService.pdf(w.bCtx, { kind: "accessory", ids: [w.ids.accessory] }, "http://x", strings));
  },
  "scan.resolve": async () => {
    await expectNotFound(scanService.resolve(w.bCtx, { code: `http://x/c/${w.a.slug}/scan/${w.ids.drum}` }));
    await expectNotFound(scanService.resolve(w.bCtx, { code: w.ids.batch }));
    await expectNotFound(scanService.resolve(w.bCtx, { code: w.ids.accessory }));
    await expectNotFound(scanService.resolve(w.bCtx, { code: "A-CD1" }));
  },

  // ── V6 commercial ───────────────────────────────────────────────
  "customer.list": async () => {
    expect((await customerService.list(w.bCtx, { includeArchived: true })).map((c) => c.id)).not.toContain(w.v6.customer);
  },
  "customer.get": () => expectNotFound(customerService.get(w.bCtx, w.v6.customer)),
  "customer.create": async () => {
    // Names are unique per company only.
    const own = await customerService.create(w.bCtx, { name: "A secret customer Oy" });
    expect(own.companyId).toBe(w.b.companyId);
  },
  "customer.update": () => expectNotFound(customerService.update(w.bCtx, w.v6.customer, { name: "x" })),
  "customer.archive": () => expectNotFound(customerService.archive(w.bCtx, w.v6.customer)),
  "customer.addContact": () => expectNotFound(customerService.addContact(w.bCtx, w.v6.customer, { name: "x" })),
  "customer.archiveContact": () => expectNotFound(customerService.archiveContact(w.bCtx, w.v6.contact)),
  "opportunity.list": async () => {
    expect((await opportunityService.list(w.bCtx)).rows.map((o) => o.id)).not.toContain(w.v6.opportunity);
  },
  "opportunity.get": () => expectNotFound(opportunityService.get(w.bCtx, w.v6.opportunity)),
  "opportunity.create": () => expectRejected(opportunityService.create(w.bCtx, { customerId: w.v6.customer, title: "x" })),
  "opportunity.update": () => expectNotFound(opportunityService.update(w.bCtx, w.v6.opportunity, { customerId: w.b6.customer, title: "x" })),
  "commercialDashboard.summary": async () => {
    const s = await commercialDashboardService.summary(w.bCtx);
    expect(s.openOpportunities).toBe(0);
    expect(s.uninvoicedVariations?.count ?? 0).toBe(0);
  },
  "quote.list": async () => {
    expect((await quoteService.list(w.bCtx)).map((q) => q.id)).not.toContain(w.v6.quote);
  },
  "quote.get": () => expectNotFound(quoteService.get(w.bCtx, w.v6.quote)),
  "quote.create": async () => {
    await expectRejected(quoteService.create(w.bCtx, { customerId: w.v6.customer, title: "x" }));
    await expectRejected(quoteService.create(w.bCtx, { customerId: w.b6.customer, projectId: w.ids.project, title: "x" }));
    await expectRejected(quoteService.create(w.bCtx, { customerId: w.b6.customer, opportunityId: w.v6.opportunity, title: "x" }));
  },
  "quote.updateDraft": () => expectNotFound(quoteService.updateDraft(w.bCtx, w.v6.quote, { marginPct: "50" })),
  "quote.addLine": () => expectNotFound(quoteService.addLine(w.bCtx, w.v6.quote, { category: "OTHER", description: "x", quantity: "1", unit: "kpl", unitCost: "1" })),
  "quote.removeLine": () => expectNotFound(quoteService.removeLine(w.bCtx, w.v6.quote, w.v6.quoteLine)),
  "quote.submit": () => expectNotFound(quoteService.submit(w.bCtx, w.v6.quote)),
  "quote.returnToDraft": () => expectNotFound(quoteService.returnToDraft(w.bCtx, w.v6.quote)),
  "quote.decide": () => expectNotFound(quoteService.decide(w.bCtx, w.v6.quote, { decision: "APPROVE" })),
  "quote.markSent": () => expectNotFound(quoteService.markSent(w.bCtx, w.v6.quote)),
  "quote.recordOutcome": () => expectNotFound(quoteService.recordOutcome(w.bCtx, w.v6.quote, { outcome: "LOST", note: "x" })),
  "quote.revise": () => expectNotFound(quoteService.revise(w.bCtx, w.v6.quote, { reason: "x" })),
  "contract.list": () => expectNotFound(contractService.list(w.bCtx, w.ids.project)),
  "contract.create": async () => {
    await expectNotFound(contractService.create(w.bCtx, { projectId: w.ids.project, customerId: w.b6.customer, contractNumber: "X", title: "x", value: "1" }));
    await expectRejected(contractService.create(w.bCtx, { projectId: w.bProject, customerId: w.v6.customer, contractNumber: "X", title: "x", value: "1" }));
  },
  "contract.update": () => expectNotFound(contractService.update(w.bCtx, w.v6.contract, { title: "x", closed: "on" })),
  "contract.addMilestone": () => expectNotFound(contractService.addMilestone(w.bCtx, w.v6.contract, { title: "x", amount: "1", dueDate: "2026-10-01" })),
  "variation.list": () => expectNotFound(variationService.list(w.bCtx, w.ids.project)),
  "variation.get": () => expectNotFound(variationService.get(w.bCtx, w.v6.variation)),
  "variation.create": async () => {
    await expectNotFound(variationService.create(w.bCtx, { projectId: w.ids.project, title: "x" }));
    await expectRejected(variationService.create(w.bCtx, { projectId: w.bProject, contractId: w.v6.contract, title: "x" }));
  },
  "variation.updateDraft": async () => {
    await expectNotFound(variationService.updateDraft(w.bCtx, w.v6.variation, { title: "x", laborCost: "1" }));
    await expectRejected(variationService.updateDraft(w.bCtx, w.b6.variation, { title: "x", laborCost: "1", evidenceDocumentId: w.ids.document }));
  },
  "variation.submitForReview": () => expectNotFound(variationService.submitForReview(w.bCtx, w.v6.variation)),
  "variation.returnToDraft": () => expectNotFound(variationService.returnToDraft(w.bCtx, w.v6.variation)),
  "variation.approveInternal": () => expectNotFound(variationService.approveInternal(w.bCtx, w.v6.variation, { decision: "APPROVE" })),
  "variation.recordClientDecision": () => expectNotFound(variationService.recordClientDecision(w.bCtx, w.v6.variation, { decision: "REJECTED" })),
  "variation.markExecuted": () => expectNotFound(variationService.markExecuted(w.bCtx, w.v6.variation)),
  "variation.markReadyToInvoice": () => expectNotFound(variationService.markReadyToInvoice(w.bCtx, w.v6.variation)),
  "forecast.get": () => expectNotFound(forecastService.get(w.bCtx, w.ids.project)),
  "forecast.setEtc": () => expectNotFound(forecastService.setEtc(w.bCtx, w.ids.project, { category: "LABOR", etcAmount: "1" })),
  "invoice.list": async () => {
    await expectNotFound(invoiceService.list(w.bCtx, { projectId: w.ids.project }));
    expect((await invoiceService.list(w.bCtx)).map((c) => c.id)).not.toContain(w.v6.candidate);
    expect((await invoiceService.list(w.bCtx, { kind: "INTERNAL" })).map((c) => c.id)).not.toContain(w.v6.candidate);
  },
  "invoice.generate": () => expectNotFound(invoiceService.generate(w.bCtx, { projectId: w.ids.project, to: "2026-12-31" })),
  "invoice.generateInternal": async () => {
    expect((await invoiceService.generateInternal(w.bCtx, { to: "2026-12-31" })).created).toBe(0);
  },
  "invoice.incomingInternal": async () => {
    expect((await invoiceService.incomingInternal(w.bCtx)).map((c) => c.id)).not.toContain(w.v6.candidate);
  },
  "invoice.void": () => expectNotFound(invoiceService.void(w.bCtx, w.v6.candidate)),
  "invoice.export": () => expectNotFound(invoiceService.export(w.bCtx, { kind: "CUSTOMER", projectId: w.ids.project })),
  "invoice.listExports": async () => {
    expect((await invoiceService.listExports(w.bCtx)).map((b) => b.id)).not.toContain(w.v6.exportBatch);
  },
  "invoice.download": () => expectNotFound(invoiceService.download(w.bCtx, w.v6.exportBatch)),
  "invoice.markInvoiced": () => expectNotFound(invoiceService.markInvoiced(w.bCtx, { ids: [w.v6.candidate], invoiceReference: "X" })),

  // ── V7 HSE and portals ──────────────────────────────────────────
  "document.setSharing": () => expectNotFound(documentService.setSharing(w.bCtx, w.ids.document, { sharedWithClient: "on" })),
  "variation.publishToClient": () => expectNotFound(variationService.publishToClient(w.bCtx, w.v7.variation)),
  "hseOverview.projects": async () => {
    expect((await hseOverviewService.projects(w.bCtx)).map((p) => p.id)).not.toContain(w.ids.project);
  },
  "hseOverview.register": () => expectNotFound(hseOverviewService.register(w.bCtx, w.ids.project)),
  "hseOverview.metrics": () => expectNotFound(hseOverviewService.metrics(w.bCtx, w.ids.project)),
  "hseOverview.portalFigures": async () => {
    await expectNotFound(hseOverviewService.portalFigures(w.bCtx, w.ids.project));
    await expectNotFound(hseOverviewService.portalFigures(w.b7.clientApprover, w.ids.project));
  },
  "hseOverview.urgent": async () => {
    expect((await hseOverviewService.urgent(w.bCtx)).map((i) => i.id)).not.toContain(w.v7.incident);
  },
  "hseObservation.create": async () => {
    await expectNotFound(hseObservationService.create(w.bCtx, { projectId: w.ids.project, kind: "SAFETY_OBSERVATION", title: "x", occurredAt: "2026-10-01T08:00" }));
    await expectRejected(hseObservationService.create(w.bCtx, { projectId: w.bProject, siteId: w.ids.site, kind: "SAFETY_OBSERVATION", title: "x", occurredAt: "2026-10-01T08:00" }));
    await expectRejected(hseObservationService.create(w.bCtx, { projectId: w.bProject, liftPlanId: w.ids.liftPlan, kind: "SAFETY_OBSERVATION", title: "x", occurredAt: "2026-10-01T08:00" }));
  },
  "hseObservation.get": () => expectNotFound(hseObservationService.get(w.bCtx, w.v7.observation)),
  "hseObservation.triage": () => expectNotFound(hseObservationService.triage(w.bCtx, w.v7.observation, { category: "PPE", severity: "HIGH" })),
  "hseObservation.close": () => expectNotFound(hseObservationService.close(w.bCtx, w.v7.observation, {})),
  "incident.report": async () => {
    await expectNotFound(incidentService.report(w.bCtx, { projectId: w.ids.project, type: "INJURY", severity: "FIRST_AID", title: "x", occurredAt: "2026-10-01T08:00" }));
    await expectRejected(incidentService.report(w.bCtx, { projectId: w.bProject, siteId: w.ids.site, type: "INJURY", severity: "FIRST_AID", title: "x", occurredAt: "2026-10-01T08:00" }));
  },
  "incident.get": () => expectNotFound(incidentService.get(w.bCtx, w.v7.incident)),
  "incident.triage": () => expectNotFound(incidentService.triage(w.bCtx, w.v7.incident, { type: "INJURY", severity: "FIRST_AID" })),
  "incident.startInvestigation": () => expectNotFound(incidentService.startInvestigation(w.bCtx, w.v7.incident)),
  "incident.recordInvestigation": () => expectNotFound(incidentService.recordInvestigation(w.bCtx, w.v7.incident, { rootCause: "x" })),
  "incident.close": () => expectNotFound(incidentService.close(w.bCtx, w.v7.incident, {})),
  "incident.addPerson": async () => {
    await expectNotFound(incidentService.addPerson(w.bCtx, w.v7.incident, { personName: "x" }));
    await expectRejected(incidentService.addPerson(w.bCtx, w.b7.incident, { personName: "x", employeeId: w.ids.employee }));
  },
  "hseAction.create": async () => {
    await expectRejected(hseActionService.create(w.bCtx, { sourceType: "INCIDENT", sourceId: w.v7.incident, title: "x" }));
    await expectRejected(hseActionService.create(w.bCtx, { sourceType: "INCIDENT", sourceId: w.b7.incident, title: "x", assigneeId: w.ids.memberUserId }));
  },
  "hseAction.markDone": () => expectNotFound(hseActionService.markDone(w.bCtx, w.v7.action, {})),
  "hseAction.reopen": () => expectNotFound(hseActionService.reopen(w.bCtx, w.v7.action, {})),
  "hseAction.verify": () => expectNotFound(hseActionService.verify(w.bCtx, w.v7.action)),
  "hsePhoto.add": () => expectNotFound(hsePhotoService.add(w.bCtx, { recordType: "OBSERVATION", recordId: w.v7.observation }, { fileName: "x.jpg", bytes: new Uint8Array([1]) })),
  "hsePhoto.download": () => expectNotFound(hsePhotoService.download(w.bCtx, w.v7.photo)),
  "toolboxTalk.create": async () => {
    await expectNotFound(toolboxTalkService.create(w.bCtx, { projectId: w.ids.project, heldOn: "2026-10-01", topic: "x", attendeeCount: "1" }));
    await expectRejected(toolboxTalkService.create(w.bCtx, { projectId: w.bProject, siteId: w.ids.site, heldOn: "2026-10-01", topic: "x", attendeeCount: "1" }));
  },
  "riskAssessment.create": async () => {
    await expectNotFound(riskAssessmentService.create(w.bCtx, { projectId: w.ids.project, title: "x" }));
    await expectRejected(riskAssessmentService.create(w.bCtx, { projectId: w.bProject, title: "x", liftPlanId: w.ids.liftPlan }));
  },
  "riskAssessment.get": () => expectNotFound(riskAssessmentService.get(w.bCtx, w.v7.risk)),
  "riskAssessment.update": () => expectNotFound(riskAssessmentService.update(w.bCtx, w.v7.risk, { title: "x" })),
  "riskAssessment.addItem": () => expectNotFound(riskAssessmentService.addItem(w.bCtx, w.v7.risk, { hazard: "x", likelihood: "1", consequence: "1" })),
  "riskAssessment.removeItem": () => expectNotFound(riskAssessmentService.removeItem(w.bCtx, w.v7.riskItem)),
  "riskAssessment.approve": () => expectNotFound(riskAssessmentService.approve(w.bCtx, w.v7.risk)),
  "riskAssessment.archive": () => expectNotFound(riskAssessmentService.archive(w.bCtx, w.v7.risk)),
  "workPermit.request": async () => {
    await expectNotFound(workPermitService.request(w.bCtx, { projectId: w.ids.project, type: "OTHER", description: "x", validFrom: "2026-11-02T07:00", validTo: "2026-11-02T08:00" }));
    await expectRejected(workPermitService.request(w.bCtx, { projectId: w.bProject, liftPlanId: w.ids.liftPlan, type: "LIFTING", description: "x", validFrom: "2026-11-02T07:00", validTo: "2026-11-02T08:00" }));
  },
  "workPermit.get": () => expectNotFound(workPermitService.get(w.bCtx, w.v7.permit)),
  "workPermit.decide": () => expectNotFound(workPermitService.decide(w.bCtx, w.v7.permit, { decision: "APPROVE" })),
  "workPermit.close": () => expectNotFound(workPermitService.close(w.bCtx, w.v7.permit)),
  "hseInspection.create": () => expectNotFound(hseInspectionService.create(w.bCtx, { projectId: w.ids.project, kind: "MVR", inspectedOn: "2026-10-01", correctCount: "1", incorrectCount: "0" })),
  "hseInspection.get": () => expectNotFound(hseInspectionService.get(w.bCtx, w.v7.inspection)),
  "clientApproval.list": async () => {
    await expectNotFound(clientApprovalService.list(w.bCtx, w.ids.project));
    await expectNotFound(clientApprovalService.list(w.b7.clientApprover, w.ids.project));
  },
  "clientApproval.get": () => expectNotFound(clientApprovalService.get(w.b7.clientApprover, w.v7.approval)),
  "clientApproval.decide": () => expectNotFound(clientApprovalService.decide(w.b7.clientApprover, w.v7.approval, { decision: "APPROVED", contentSha256: w.v7.approvalHash })),
  "scheduleSummary.project": async () => {
    await expectNotFound(scheduleSummaryService.project(w.bCtx, w.ids.project));
    await expectNotFound(scheduleSummaryService.project(w.b7.clientApprover, w.ids.project));
  },
  "portal.projects": async () => {
    expect((await portalService.projects(w.b7.clientApprover)).map((p) => p.id)).toEqual([w.bProject]);
  },
  "portal.project": () => expectNotFound(portalService.project(w.b7.clientApprover, w.ids.project)),

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
    expect((await db.delivery.findUniqueOrThrow({ where: { id: w.ids.delivery } })).status).toBe("PLANNED");
    expect((await db.resourceBooking.findUniqueOrThrow({ where: { id: w.ids.booking } })).status).toBe("APPROVED");
    expect((await db.logisticsRequest.findUniqueOrThrow({ where: { id: w.ids.logisticsRequest } })).status).toBe("REQUESTED");
    expect(await db.resourceBooking.count({ where: { equipmentId: w.ids.equipment } })).toBe(1);
    expect((await db.liftPlanVersion.findFirstOrThrow({ where: { planId: w.ids.liftPlan } })).status).toBe("DRAFT");
    expect((await db.liftPlan.findUniqueOrThrow({ where: { id: w.ids.liftPlan } })).status).toBe("OPEN");
    expect((await db.liftingAccessory.findUniqueOrThrow({ where: { id: w.ids.accessory } })).archivedAt).toBeNull();
    expect((await db.materialBatch.findUniqueOrThrow({ where: { id: w.ids.batch } })).status).toBe("RECEIVED");
    expect((await db.cableDrum.findUniqueOrThrow({ where: { id: w.ids.drum } })).remainingM.toString()).toBe("480");
    expect(await db.cablePull.count({ where: { drumId: w.ids.drum } })).toBe(1);
    expect((await db.customer.findUniqueOrThrow({ where: { id: w.v6.customer } })).archivedAt).toBeNull();
    expect((await db.quoteVersion.findFirstOrThrow({ where: { quoteId: w.v6.quote } })).status).toBe("DRAFT");
    expect(await db.quoteLine.count({ where: { id: w.v6.quoteLine } })).toBe(1);
    expect((await db.contract.findUniqueOrThrow({ where: { id: w.v6.contract } })).status).toBe("ACTIVE");
    expect((await db.variation.findUniqueOrThrow({ where: { id: w.v6.variation } })).status).toBe("DRAFT");
    expect((await db.invoiceCandidate.findUniqueOrThrow({ where: { id: w.v6.candidate } })).status).toBe("EXPORTED");
    expect((await db.hseObservation.findUniqueOrThrow({ where: { id: w.v7.observation } })).status).toBe("OPEN");
    expect((await db.incident.findUniqueOrThrow({ where: { id: w.v7.incident } })).status).toBe("TRIAGED");
    expect((await db.hseAction.findUniqueOrThrow({ where: { id: w.v7.action } })).status).toBe("OPEN");
    expect((await db.riskAssessment.findUniqueOrThrow({ where: { id: w.v7.risk } })).status).toBe("DRAFT");
    expect(await db.riskAssessmentItem.count({ where: { riskAssessmentId: w.v7.risk } })).toBe(1);
    expect((await db.workPermit.findUniqueOrThrow({ where: { id: w.v7.permit } })).status).toBe("REQUESTED");
    expect((await db.variationClientApproval.findUniqueOrThrow({ where: { id: w.v7.approval } })).decision).toBe("PENDING");
    expect((await db.document.findUniqueOrThrow({ where: { id: w.ids.document } })).sharedWithClient).toBe(false);
  });
});
