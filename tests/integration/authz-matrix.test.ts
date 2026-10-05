/**
 * Authorization matrix: role template × action, table-driven, against the
 * real services and database. ASSIGNED roles are assigned to the project
 * with the same role as their project role.
 *
 *   ✓ = allowed   F = 403 Forbidden   N = 404 Not Found
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/platform/errors";
import type { RequestContext, RoleTemplateKey } from "@/platform/authz";
import { companyAdminService } from "@/modules/companies/service";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { documentService } from "@/modules/documents/service";
import { db } from "@/platform/db";
import { siteService as sites } from "@/modules/projects/service";
import { timesheetService } from "@/modules/timesheets/service";
import { diaryService } from "@/modules/diary/service";
import { costService, projectFinanceService } from "@/modules/finance/service";
import { workCalendarService } from "@/modules/takt/calendar.service";
import { taktStructureService } from "@/modules/takt/structure.service";
import { taktPlanService } from "@/modules/takt/plan.service";
import { taktActivityService } from "@/modules/takt/activity.service";
import { lookaheadService } from "@/modules/takt/lookahead.service";
import { scheduleImportService } from "@/modules/takt/import.service";
import { bookingService } from "@/modules/logistics/booking.service";
import { deliveryService, logisticsBoardService, logisticsLocationService, logisticsRequestService } from "@/modules/logistics/logistics.service";
import { liftingAccessoryService, liftPlanService } from "@/modules/lifting/lift.service";
import { cableDrumService, materialBatchService, materialLabelService } from "@/modules/lifting/material.service";
import { customerService } from "@/modules/commercial/crm.service";
import { quoteService } from "@/modules/commercial/quote.service";
import { contractService, forecastService, variationService } from "@/modules/commercial/project.service";
import { invoiceService } from "@/modules/commercial/invoice.service";
import { clientApprovalService } from "@/modules/commercial/client-approval.service";
import { hseActionService, hseObservationService, hseOverviewService, incidentService } from "@/modules/hse/hse.service";
import { hseInspectionService, riskAssessmentService, toolboxTalkService, workPermitService } from "@/modules/hse/planning.service";
import { scheduleSummaryService } from "@/modules/takt/summary.service";
import { portalService } from "@/modules/portal/service";
import { createMember, createTenant, textFile, uniq, type Tenant } from "../helpers/fixtures";

type Outcome = "✓" | "F" | "N";
const ROLES: RoleTemplateKey[] = [
  "CEO",
  "PROJECT_DIRECTOR",
  "PROJECT_MANAGER",
  "SITE_MANAGER",
  "SUPERVISOR",
  "LOGISTICS_COORDINATOR",
  "HSE",
  "EMPLOYEE",
  "SUBCONTRACTOR",
  "CLIENT",
  "LIFTING_SUPERVISOR",
  "CLIENT_APPROVER",
];

interface Fixture {
  t: Tenant;
  projectId: string;
  unassignedProjectId: string;
  employeeId: string;
  equipmentId: string;
  equipmentTypeId: string;
  pendingVersionId: () => Promise<string>;
  employeeRoleId: string;
  siteId: string;
  submittedEntryId: () => Promise<string>;
  draftReportId: () => Promise<string>;
  reportId: string;
  takt: { planId: string; draftId: string; activityId: string; buildingId: string; proposedVersionId: () => Promise<string> };
  logistics: { gateId: string; requestedId: () => Promise<string>; slot: () => string };
  lift: { draftPlanId: string; submittedPlanId: () => Promise<string>; approvedPlanId: () => Promise<string> };
  material: { drumId: string };
  v6: { customerId: string; submittedQuoteId: () => Promise<string>; reviewVariationId: () => Promise<string> };
  v7: {
    documentId: () => Promise<string>;
    observationId: () => Promise<string>;
    triagedIncidentId: () => Promise<string>;
    doneIncidentActionId: () => Promise<string>;
    requestedPermitId: () => Promise<string>;
    pendingApproval: () => Promise<{ id: string; contentSha256: string }>;
  };
}

let dayCounter = 0;
const nextDate = () => {
  dayCounter += 1;
  return new Date(Date.UTC(2026, 0, 1 + dayCounter)).toISOString().slice(0, 10);
};

type Action = (ctx: RequestContext, f: Fixture) => Promise<unknown>;

const ACTIONS: Record<string, Action> = {
  "view project": (c, f) => projectService.get(c, f.projectId),
  "view unassigned project": (c, f) => projectService.get(c, f.unassignedProjectId),
  "create project": (c) => projectService.create(c, { code: uniq("P"), name: "New" }),
  "update project": (c, f) => projectService.update(c, f.projectId, { code: "MATRIX", name: "Matrix project" }),
  "create site": (c, f) => siteService.create(c, f.projectId, { name: uniq("Site") }),
  "assign project member": async (c, f) => {
    const other = await createMember(f.t, "EMPLOYEE");
    return projectService.assignMember(c, f.projectId, { userId: other.user.id, roleId: f.employeeRoleId });
  },
  "list employees": (c) => employeeService.list(c),
  "create employee": (c) => employeeService.create(c, { employeeNumber: uniq("E"), firstName: "A", lastName: "B" }),
  "view employee rates": (c, f) => employeeService.listRates(c, f.employeeId),
  "change employee rates": (c, f) => employeeService.addRate(c, f.employeeId, { rateType: "BILLING", amount: "1", validFrom: "2030-01-01" }).then((r) => employeeService.archiveRate(c, r.id)),
  "list equipment": (c) => equipmentService.list(c),
  "create equipment": (c, f) => equipmentService.create(c, { equipmentTypeId: f.equipmentTypeId, assetNumber: uniq("Q"), name: "Q" }),
  "view equipment rates": (c, f) => equipmentService.listRates(c, f.equipmentId),
  "change equipment rates": (c, f) => equipmentService.addRate(c, f.equipmentId, { rateType: "BILLING", amount: "1", validFrom: "2030-01-01" }).then((r) => equipmentService.archiveRate(c, r.id)),
  "create project document": (c, f) => documentService.create(c, { title: "Doc", projectId: f.projectId }, textFile("d.pdf")),
  "approve document": async (c, f) => documentService.setVersionApproval(c, await f.pendingVersionId(), { state: "APPROVED" }),
  "manage members": (c) => companyAdminService.listMembers(c),
  "edit role permissions": async (c, f) => companyAdminService.updateRolePermissions(c, f.employeeRoleId, { permissionKeys: ["project.view", "documents.view"] }),
  "view audit log": (c) => companyAdminService.listAuditEvents(c),
  // V2
  "enter own hours": (c, f) => timesheetService.create(c, { projectId: f.projectId, workDate: nextDate(), hours: "8" }),
  "enter crew hours": (c, f) => timesheetService.createCrew(c, { employeeIds: [f.employeeId], projectId: f.projectId, workDate: nextDate(), hours: "8" }),
  "approve hours": async (c, f) => timesheetService.decide(c, { entryIds: [await f.submittedEntryId()], decision: "APPROVE" }),
  "export hours": (c) => timesheetService.exportApproved(c, { from: "2020-01-01", to: "2030-12-31" }).catch((e) => {
    if (e?.fieldErrors?._form?.[0] === "validation.nothingToExport") return null; // allowed, nothing left to export
    throw e;
  }),
  "view site diary": (c, f) => diaryService.get(c, f.reportId),
  "write site diary": (c, f) => diaryService.addEntry(c, f.reportId, { kind: "WORK", description: "Matrix" }),
  "sign site diary": async (c, f) => diaryService.sign(c, await f.draftReportId()),
  "view project finance": (c, f) => projectFinanceService.summary(c, f.projectId),
  "record project cost": (c, f) => costService.create(c, f.projectId, { category: "OTHER", entryDate: "2026-03-01", description: "Matrix", amount: "1" }),
  // V3
  "view takt board": (c, f) => taktPlanService.board(c, f.takt.planId),
  "edit takt draft": (c, f) => taktPlanService.updateDraft(c, f.takt.draftId, { startDate: "2026-09-07", reason: "Matrix" }),
  "record takt progress": (c, f) => taktActivityService.recordProgress(c, f.takt.activityId, { progressPct: "10", reportDate: "2026-09-01" }),
  "approve takt baseline": async (c, f) => taktPlanService.approve(c, await f.takt.proposedVersionId()),
  "import schedule": (c, f) =>
    scheduleImportService.preview(c, f.takt.planId, { buildingId: f.takt.buildingId }, {
      fileName: "m.xml",
      bytes: new TextEncoder().encode(`<Project><Tasks><Task><UID>1</UID><Name>Z</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task><Task><UID>2</UID><Name>T</Name><OutlineLevel>2</OutlineLevel><Start>2026-11-02T08:00:00</Start><Finish>2026-11-02T16:00:00</Finish></Task></Tasks></Project>`),
    }),
  "view look-ahead": (c, f) => lookaheadService.compute(c, { weeks: 6, projectId: f.projectId }),
  "edit work calendar": (c) => workCalendarService.addHoliday(c, { date: nextDate(), name: "Matrix" }),
  // V4
  "view logistics board": (c, f) => logisticsBoardService.day(c, { siteId: f.siteId, date: "2026-11-02" }),
  "create logistics request": (c, f) => logisticsRequestService.create(c, { siteId: f.siteId, serviceType: "DELIVERY", title: "Matrix", requestedStart: "2026-11-02T07:00", requestedEnd: "2026-11-02T08:00", submit: "on" }),
  "approve logistics request": async (c, f) => logisticsRequestService.transition(c, await f.logistics.requestedId(), { to: "APPROVED" }),
  "manage gates": (c, f) => logisticsLocationService.create(c, { siteId: f.siteId, kind: "STORAGE", name: uniq("Varasto") }),
  "book resource": (c, f) => bookingService.create(c, { resources: [`EQUIPMENT:${f.equipmentId}`], projectId: f.projectId, startsAt: "2026-12-01T07:00", endsAt: "2026-12-01T08:00" }),
  "schedule delivery": (c, f) => deliveryService.create(c, { siteId: f.siteId, gateId: f.logistics.gateId, supplier: "Matrix", material: "Matrix", date: f.logistics.slot(), startTime: "07:00" }),
  // V5
  "view lift plan": (c, f) => liftPlanService.get(c, f.lift.draftPlanId),
  "create lift plan": (c, f) => liftPlanService.create(c, { siteId: f.siteId, title: uniq("Lift"), plannedStart: "2027-03-01T08:00", plannedEnd: "2027-03-01T09:00" }),
  "edit lift plan draft": (c, f) => liftPlanService.updateDraft(c, f.lift.draftPlanId, { loadDescription: "Matrix load", loadWeightKg: "500" }),
  "approve lift plan": async (c, f) => liftPlanService.decide(c, await f.lift.submittedPlanId(), { decision: "APPROVE", acknowledgeWarnings: "on" }),
  "complete lift": async (c, f) => liftPlanService.complete(c, await f.lift.approvedPlanId()),
  "view accessory register": (c) => liftingAccessoryService.list(c),
  "manage lifting accessories": (c) => liftingAccessoryService.create(c, { code: uniq("ACC"), name: "Matrix sling", kind: "SLING", wllKg: "1000" }),
  "view materials": (c, f) => materialBatchService.list(c, { siteId: f.siteId }),
  "register material batch": (c, f) => materialBatchService.create(c, { siteId: f.siteId, code: uniq("MB"), material: "Matrix", quantity: "1", unit: "pcs" }),
  "record cable pull": (c, f) => cableDrumService.pull(c, f.material.drumId, { lengthM: "1", pulledOn: "2027-03-01" }),
  "print QR labels": (c, f) => materialLabelService.pdf(c, { kind: "drum", siteId: f.siteId }, "http://localhost", { title: "Matrix", footer: "Matrix" }),
  // V6
  "view customers": (c) => customerService.list(c),
  "manage customers": (c) => customerService.create(c, { name: uniq("Asiakas") }),
  "view quotes": (c) => quoteService.list(c),
  "prepare quote": (c, f) => quoteService.create(c, { customerId: f.v6.customerId, title: uniq("Tarjous") }),
  "approve quote": async (c, f) => quoteService.decide(c, await f.v6.submittedQuoteId(), { decision: "APPROVE" }),
  "view project commercial": (c, f) => forecastService.get(c, f.projectId),
  "view unassigned project commercial": (c, f) => forecastService.get(c, f.unassignedProjectId),
  "create variation": (c, f) => variationService.create(c, { projectId: f.projectId, title: uniq("Lisätyö") }),
  "approve variation": async (c, f) => variationService.approveInternal(c, await f.v6.reviewVariationId(), { decision: "APPROVE" }),
  "generate invoice candidates": (c, f) => invoiceService.generate(c, { projectId: f.projectId, to: "2026-12-31" }),
  "export invoices": (c, f) => invoiceService.export(c, { kind: "CUSTOMER", projectId: f.projectId, includeExported: "on" }),
  "internal invoicing": (c) => invoiceService.generateInternal(c, { to: "2026-12-31" }),
  // V7 — HSE and portals
  "view HSE register": (c, f) => hseOverviewService.register(c, f.projectId),
  "view HSE key figures": (c, f) => hseOverviewService.metrics(c, f.projectId),
  "report observation": (c, f) => hseObservationService.create(c, { projectId: f.projectId, kind: "SAFETY_OBSERVATION", title: uniq("Havainto"), occurredAt: "2026-09-01T08:00" }),
  "triage observation": async (c, f) => hseObservationService.triage(c, await f.v7.observationId(), { category: "PPE", severity: "LOW" }),
  "report incident": (c, f) => incidentService.report(c, { projectId: f.projectId, type: "PROPERTY_DAMAGE", severity: "FIRST_AID", title: uniq("Vahinko"), occurredAt: "2026-09-01T08:00" }),
  "investigate incident": async (c, f) => incidentService.startInvestigation(c, await f.v7.triagedIncidentId()),
  "record injured person": async (c, f) => incidentService.addPerson(c, await f.v7.triagedIncidentId(), { personName: "Testi Henkilö" }),
  "approve incident action": async (c, f) => hseActionService.verify(c, await f.v7.doneIncidentActionId()),
  "request permit": (c, f) => workPermitService.request(c, { projectId: f.projectId, type: "HOT_WORK", description: "Hitsaus", validFrom: "2026-11-02T07:00", validTo: "2026-11-02T15:00" }),
  "approve permit": async (c, f) => workPermitService.decide(c, await f.v7.requestedPermitId(), { decision: "APPROVE" }),
  "create risk assessment": (c, f) => riskAssessmentService.create(c, { projectId: f.projectId, title: uniq("Riskiarvio") }),
  "record toolbox talk": (c, f) => toolboxTalkService.create(c, { projectId: f.projectId, heldOn: "2026-09-01", topic: "Putoamissuojaus", attendeeCount: "8" }),
  "record MVR inspection": (c, f) => hseInspectionService.create(c, { projectId: f.projectId, kind: "MVR", inspectedOn: "2026-09-01", correctCount: "90", incorrectCount: "10" }),
  "share document": async (c, f) => documentService.setSharing(c, await f.v7.documentId(), { sharedWithClient: "on" }),
  "open portal": (c, f) => portalService.project(c, f.projectId),
  "portal schedule": (c, f) => scheduleSummaryService.project(c, f.projectId),
  "portal HSE figures": (c, f) => hseOverviewService.portalFigures(c, f.projectId),
  "approve variation in portal": async (c, f) => {
    const a = await f.v7.pendingApproval();
    return clientApprovalService.decide(c, a.id, { decision: "APPROVED", contentSha256: a.contentSha256 });
  },
};

// Columns follow ROLES order: CEO PD PM SM SUP LOG HSE EMP SUB CLI LIFT CA
const MATRIX: Record<keyof typeof ACTIONS, Outcome[]> = {
  "view project":            ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓"],
  "view unassigned project": ["✓", "✓", "N", "N", "N", "N", "N", "N", "N", "N", "N", "N"],
  "create project":          ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "update project":          ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "create site":             ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "assign project member":   ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "list employees":          ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "F", "F", "F", "✓", "F"],
  "create employee":         ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "view employee rates":     ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "change employee rates":   ["✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "list equipment":          ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "F", "F", "F", "✓", "F"],
  "create equipment":        ["✓", "✓", "F", "✓", "F", "✓", "F", "F", "F", "F", "F", "F"],
  "view equipment rates":    ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "change equipment rates":  ["✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "create project document": ["✓", "✓", "✓", "✓", "✓", "F", "✓", "F", "F", "F", "F", "F"],
  // V7: unshared documents do not exist for external members.
  "approve document":        ["✓", "✓", "✓", "F", "F", "F", "F", "F", "N", "N", "F", "N"],
  "manage members":          ["✓", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "edit role permissions":   ["✓", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "view audit log":          ["✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "enter own hours":         ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "F", "F", "✓", "F"],
  "enter crew hours":        ["✓", "✓", "✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F"],
  "approve hours":           ["✓", "✓", "✓", "✓", "F", "N", "N", "N", "N", "N", "N", "N"],
  "export hours":            ["✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "view site diary":         ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "N", "✓", "N"],
  "write site diary":        ["✓", "✓", "✓", "✓", "✓", "F", "F", "F", "N", "N", "F", "N"],
  "sign site diary":         ["✓", "✓", "✓", "✓", "✓", "F", "F", "F", "N", "N", "F", "N"],
  "view project finance":    ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "record project cost":     ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "view takt board":         ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "N", "✓", "N"],
  "edit takt draft":         ["✓", "✓", "✓", "✓", "F", "F", "F", "F", "N", "N", "F", "N"],
  "record takt progress":    ["✓", "✓", "✓", "✓", "✓", "F", "F", "F", "N", "N", "F", "N"],
  "approve takt baseline":   ["✓", "✓", "✓", "F", "F", "F", "F", "F", "N", "N", "F", "N"],
  "import schedule":         ["✓", "✓", "✓", "✓", "F", "F", "F", "F", "N", "N", "F", "N"],
  "view look-ahead":         ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "N", "✓", "N"],
  "edit work calendar":      ["✓", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "view logistics board":    ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "N", "✓", "N"],
  "create logistics request":["✓", "✓", "✓", "✓", "✓", "✓", "F", "F", "N", "N", "✓", "N"],
  "approve logistics request":["✓", "✓", "F", "✓", "F", "✓", "F", "F", "N", "N", "F", "N"],
  "manage gates":            ["✓", "✓", "F", "✓", "F", "✓", "F", "F", "N", "N", "F", "N"],
  "book resource":           ["✓", "✓", "✓", "✓", "F", "✓", "F", "F", "N", "N", "F", "N"],
  "schedule delivery":       ["✓", "✓", "F", "✓", "✓", "✓", "F", "F", "N", "N", "F", "N"],
  // V5 (LIFT = Lifting Supervisor, the person responsible for lifting)
  "view lift plan":          ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "N", "✓", "N"],
  "create lift plan":        ["✓", "✓", "✓", "✓", "✓", "✓", "F", "F", "N", "N", "✓", "N"],
  "edit lift plan draft":    ["✓", "✓", "F", "✓", "F", "✓", "F", "F", "N", "N", "✓", "N"],
  "approve lift plan":       ["✓", "✓", "F", "F", "F", "F", "F", "F", "N", "N", "✓", "N"],
  "complete lift":           ["✓", "✓", "F", "✓", "F", "✓", "F", "F", "N", "N", "✓", "N"],
  "view accessory register": ["✓", "✓", "✓", "✓", "✓", "✓", "F", "F", "F", "F", "✓", "F"],
  "manage lifting accessories":["✓", "✓", "F", "✓", "F", "✓", "F", "F", "F", "F", "✓", "F"],
  "view materials":          ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "N", "✓", "N"],
  "register material batch": ["✓", "✓", "F", "✓", "✓", "✓", "F", "F", "N", "N", "F", "N"],
  "record cable pull":       ["✓", "✓", "F", "✓", "✓", "✓", "F", "F", "N", "N", "F", "N"],
  "print QR labels":         ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "N", "✓", "N"],
  // V6 — prices, margins and billing never reach external roles
  "view customers":          ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "manage customers":        ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "view quotes":             ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "prepare quote":           ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "approve quote":           ["✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "view project commercial": ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "view unassigned project commercial":["✓", "✓", "N", "N", "N", "N", "N", "N", "N", "N", "N", "N"],
  "create variation":        ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "approve variation":       ["✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "generate invoice candidates":["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "export invoices":         ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  "internal invoicing":      ["✓", "✓", "✓", "F", "F", "F", "F", "F", "F", "F", "F", "F"],
  // V7 — HSE (subcontractors report and see only their own records) and portals
  "view HSE register":       ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "✓", "N"],
  "view HSE key figures":    ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "F", "N", "✓", "N"],
  "report observation":      ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "✓", "N"],
  "triage observation":      ["✓", "✓", "✓", "✓", "F", "F", "✓", "F", "N", "N", "F", "N"],
  "report incident":         ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "✓", "N"],
  "investigate incident":    ["✓", "F", "F", "F", "F", "F", "✓", "F", "N", "N", "F", "N"],
  "record injured person":   ["✓", "F", "F", "F", "F", "F", "✓", "F", "N", "N", "F", "N"],
  "approve incident action": ["✓", "✓", "✓", "F", "F", "F", "F", "F", "N", "N", "F", "N"],
  "request permit":          ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "✓", "N"],
  "approve permit":          ["✓", "✓", "F", "✓", "F", "F", "✓", "F", "N", "N", "F", "N"],
  "create risk assessment":  ["✓", "✓", "✓", "✓", "F", "F", "✓", "F", "F", "N", "F", "N"],
  "record toolbox talk":     ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "F", "N", "✓", "N"],
  "record MVR inspection":   ["✓", "✓", "✓", "✓", "F", "F", "✓", "F", "F", "N", "F", "N"],
  "share document":          ["✓", "✓", "✓", "F", "F", "F", "F", "F", "N", "N", "F", "N"],
  "open portal":             ["N", "N", "N", "N", "N", "N", "N", "N", "✓", "✓", "N", "✓"],
  "portal schedule":         ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "✓", "✓", "✓"],
  "portal HSE figures":      ["✓", "✓", "✓", "✓", "✓", "✓", "✓", "✓", "N", "✓", "✓", "✓"],
  "approve variation in portal":["N", "N", "N", "N", "N", "N", "N", "N", "N", "F", "N", "✓"],
};

let f: Fixture;
const ctxByRole = new Map<RoleTemplateKey, RequestContext>();

beforeAll(async () => {
  const t = await createTenant("Matrix");
  const project = await projectService.create(t.ownerCtx, { code: "MATRIX", name: "Matrix project" });
  const unassigned = await projectService.create(t.ownerCtx, { code: "OTHER", name: "Unassigned" });
  const employee = await employeeService.create(t.ownerCtx, { employeeNumber: "M-1", firstName: "M", lastName: "One" });
  await employeeService.addRate(t.ownerCtx, employee.id, { rateType: "COST", amount: "40", validFrom: "2026-01-01" });
  const type = await equipmentTypeService.create(t.ownerCtx, { name: "Matrix type" });
  const equipment = await equipmentService.create(t.ownerCtx, { equipmentTypeId: type.id, assetNumber: "M-EQ", name: "Matrix eq" });
  f = {
    t,
    projectId: project.id,
    unassignedProjectId: unassigned.id,
    employeeId: employee.id,
    equipmentId: equipment.id,
    equipmentTypeId: type.id,
    employeeRoleId: await t.roleId("EMPLOYEE"),
    pendingVersionId: async () => {
      const doc = await documentService.create(t.ownerCtx, { title: uniq("ToApprove"), projectId: project.id }, textFile("a.pdf"));
      await documentService.setVersionApproval(t.ownerCtx, doc.currentVersion.id, { state: "PENDING_APPROVAL" });
      return doc.currentVersion.id;
    },
    // Filled in below, once the V2 fixtures exist.
    siteId: "",
    reportId: "",
    submittedEntryId: async () => "",
    draftReportId: async () => "",
    takt: { planId: "", draftId: "", activityId: "", buildingId: "", proposedVersionId: async () => "" },
    logistics: { gateId: "", requestedId: async () => "", slot: () => "" },
    lift: { draftPlanId: "", submittedPlanId: async () => "", approvedPlanId: async () => "" },
    material: { drumId: "" },
    v6: { customerId: "", submittedQuoteId: async () => "", reviewVariationId: async () => "" },
    v7: {
      documentId: async () => "",
      observationId: async () => "",
      triagedIncidentId: async () => "",
      doneIncidentActionId: async () => "",
      requestedPermitId: async () => "",
      pendingApproval: async () => ({ id: "", contentSha256: "" }),
    },
  };
  const site = await sites.create(t.ownerCtx, project.id, { name: "Matrix site" });
  const report = await diaryService.open(t.ownerCtx, { siteId: site.id, date: "2026-02-01" });
  f.siteId = site.id;
  f.reportId = report.id;
  f.submittedEntryId = async () => {
    const date = nextDate();
    const [e] = await timesheetService.createCrew(t.ownerCtx, { employeeIds: [employee.id], projectId: project.id, workDate: date, hours: "8" });
    await timesheetService.submitWeek(t.ownerCtx, { employeeId: employee.id, date });
    return e.id;
  };
  f.draftReportId = async () => (await diaryService.open(t.ownerCtx, { siteId: site.id, date: nextDate() })).id;

  // V3 fixtures: a baselined plan with an open draft, and fresh proposed versions on demand.
  const building = await taktStructureService.createBuilding(t.ownerCtx, { siteId: site.id, name: "Matrix building" });
  const area = await taktStructureService.createArea(t.ownerCtx, { buildingId: building.id, code: "M1", name: "Matrix area" });
  const wp = await taktStructureService.createWorkPackage(t.ownerCtx, project.id, { code: "MW", name: "Matrix wagon", trade: "Matrix trade" });
  const plan = await taktPlanService.create(t.ownerCtx, { siteId: site.id, name: "Matrix plan", startDate: "2026-09-01" });
  const v1 = (await taktPlanService.board(t.ownerCtx, plan.id)).selected!;
  await taktPlanService.generateTrain(t.ownerCtx, v1.id, {});
  await taktPlanService.propose(t.ownerCtx, v1.id);
  await taktPlanService.approve(t.ownerCtx, v1.id);
  const draft = await taktPlanService.createDraft(t.ownerCtx, plan.id, {});
  const gate = await logisticsLocationService.create(t.ownerCtx, { siteId: site.id, kind: "GATE", name: "Matrix gate", opens: "06:00", closes: "18:00" });
  let deliveryDay = 0;
  f.logistics = {
    gateId: gate.id,
    requestedId: async () => (await logisticsRequestService.create(t.ownerCtx, { siteId: site.id, serviceType: "DELIVERY", title: uniq("R"), requestedStart: "2026-11-02T07:00", requestedEnd: "2026-11-02T08:00", submit: "on" })).id,
    // A fresh day per call keeps gate slots free.
    slot: () => new Date(Date.UTC(2027, 0, 1 + deliveryDay++)).toISOString().slice(0, 10),
  };
  f.takt = {
    planId: plan.id,
    draftId: draft.id,
    activityId: (await taktPlanService.board(t.ownerCtx, plan.id)).activities[0].id,
    buildingId: building.id,
    proposedVersionId: async () => {
      const p = await taktPlanService.create(t.ownerCtx, { siteId: site.id, name: uniq("Plan"), startDate: "2026-11-02" });
      const v = (await taktPlanService.board(t.ownerCtx, p.id)).selected!;
      const a = await taktActivityService.create(t.ownerCtx, p.id, { workPackageId: wp.id, taktAreaId: area.id });
      await taktPlanService.setAssignment(t.ownerCtx, v.id, a.id, { startCycle: 0, durationCycles: 1 });
      await taktPlanService.propose(t.ownerCtx, v.id);
      return v.id;
    },
  };
  // V5 fixtures: lift plans by the owner; a separate approver (never the author).
  const approver = await createMember(t, "PROJECT_DIRECTOR");
  const submitted = async () => {
    const lp = await liftPlanService.create(t.ownerCtx, { siteId: site.id, title: uniq("Lift"), plannedStart: "2027-03-01T08:00", plannedEnd: "2027-03-01T09:00" });
    await liftPlanService.updateDraft(t.ownerCtx, lp.id, { loadDescription: "Beam", loadWeightKg: "1000", craneId: equipment.id, radiusM: "12", craneCapacityKg: "5000" });
    await liftPlanService.submit(t.ownerCtx, lp.id);
    return lp.id;
  };
  f.lift = {
    draftPlanId: (await liftPlanService.create(t.ownerCtx, { siteId: site.id, title: "Matrix lift", plannedStart: "2027-03-01T08:00", plannedEnd: "2027-03-01T09:00" })).id,
    submittedPlanId: submitted,
    approvedPlanId: async () => {
      const id = await submitted();
      await liftPlanService.decide(approver, id, { decision: "APPROVE", acknowledgeWarnings: "on" });
      return id;
    },
  };
  f.material = { drumId: (await cableDrumService.create(t.ownerCtx, { siteId: site.id, code: "M-CD1", cableType: "Matrix cable", originalLengthM: "100000" })).id };
  // V6 fixtures: owner-prepared quotes and variations awaiting approval; a billable milestone.
  const customer = await customerService.create(t.ownerCtx, { name: "Matrix Asiakas Oy" });
  const contract = await contractService.create(t.ownerCtx, { projectId: project.id, customerId: customer.id, contractNumber: "M-SOP", title: "Matrix", value: "100000" });
  await contractService.addMilestone(t.ownerCtx, contract.id, { title: "Ennakko", amount: "10000", dueDate: "2026-09-01" });
  await invoiceService.generate(t.ownerCtx, { projectId: project.id, to: "2026-12-31" });
  f.v6 = {
    customerId: customer.id,
    submittedQuoteId: async () => {
      const q = await quoteService.create(t.ownerCtx, { customerId: customer.id, title: uniq("Q") });
      await quoteService.addLine(t.ownerCtx, q.id, { category: "LABOR", description: "Työ", quantity: "10", unit: "h", unitCost: "50" });
      await quoteService.submit(t.ownerCtx, q.id);
      return q.id;
    },
    reviewVariationId: async () => {
      const v = await variationService.create(t.ownerCtx, { projectId: project.id, title: uniq("V") });
      await variationService.updateDraft(t.ownerCtx, v.id, { title: v.title, laborCost: "1000", markupPct: "10" });
      await variationService.submitForReview(t.ownerCtx, v.id);
      return v.id;
    },
  };
  // V7 fixtures: owner-reported HSE records; a variation the PD approved internally.
  const triaged = async () => {
    const i = await incidentService.report(t.ownerCtx, { projectId: project.id, type: "INJURY", severity: "MEDICAL_TREATMENT", title: uniq("Tapaturma"), occurredAt: "2026-09-01T08:00" });
    await incidentService.triage(t.ownerCtx, i.id, { type: "INJURY", severity: "MEDICAL_TREATMENT" });
    return i.id;
  };
  f.v7 = {
    // A fresh, unshared project document per call.
    documentId: async () => (await documentService.create(t.ownerCtx, { title: uniq("Matrix share"), projectId: project.id }, textFile("s.pdf"))).id,
    observationId: async () => (await hseObservationService.create(t.ownerCtx, { projectId: project.id, kind: "NEAR_MISS", title: uniq("LP"), occurredAt: "2026-09-01T08:00" })).id,
    triagedIncidentId: triaged,
    doneIncidentActionId: async () => {
      const a = await hseActionService.create(t.ownerCtx, { sourceType: "INCIDENT", sourceId: await triaged(), title: "Korjaus" });
      await hseActionService.markDone(t.ownerCtx, a.id, {});
      return a.id;
    },
    requestedPermitId: async () => (await workPermitService.request(t.ownerCtx, { projectId: project.id, type: "WORK_AT_HEIGHT", description: "Nostin", validFrom: "2026-11-03T07:00", validTo: "2026-11-03T15:00" })).id,
    pendingApproval: async () => {
      const id = await f.v6.reviewVariationId();
      await variationService.approveInternal(approver, id, { decision: "APPROVE" });
      return db.variationClientApproval.findFirstOrThrow({ where: { variationId: id, decision: "PENDING" }, select: { id: true, contentSha256: true } });
    },
  };
  for (const role of ROLES) {
    const assigned = role === "CEO" || role === "PROJECT_DIRECTOR" ? [] : [{ projectId: project.id }];
    const ctx = await createMember(t, role, assigned);
    // Every member has an employee record so "own hours" is meaningful.
    await employeeService.create(t.ownerCtx, { employeeNumber: `R-${role}`, firstName: role, lastName: "Matrix", userId: ctx.user.id });
    ctxByRole.set(role, ctx);
  }
});

async function outcome(p: Promise<unknown>): Promise<Outcome> {
  try {
    await p;
    return "✓";
  } catch (e) {
    if (e instanceof ForbiddenError) return "F";
    if (e instanceof NotFoundError) return "N";
    throw e;
  }
}

describe("authorization matrix (role × action)", () => {
  const rows = Object.keys(ACTIONS).flatMap((action) => ROLES.map((role, i) => ({ action, role, expected: MATRIX[action][i] })));

  it.each(rows)("$role → $action = $expected", async ({ action, role, expected }) => {
    const ctx = ctxByRole.get(role)!;
    expect(await outcome(ACTIONS[action](ctx, f))).toBe(expected);
  });
});

describe("Client cannot see rates", () => {
  it("client has no rate permissions and cannot read employees or rates", async () => {
    const client = ctxByRole.get("CLIENT")!;
    expect(client.permissions.has("employee.rates.view")).toBe(false);
    expect(client.permissions.has("equipment.rates.view")).toBe(false);
    await expect(employeeService.get(client, f.employeeId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(employeeService.listRates(client, f.employeeId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(equipmentService.listRates(client, f.equipmentId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("even a database-level misconfiguration of the Client role does not expose rates", async () => {
    const clientRoleId = await f.t.roleId("CLIENT");
    // Bypass the service guard on purpose to simulate a bad manual change.
    await db.rolePermission.createMany({
      data: ["employee.view", "employee.rates.view", "equipment.view", "equipment.rates.view"].map((permissionKey) => ({
        companyId: f.t.companyId,
        roleId: clientRoleId,
        permissionKey,
      })),
      skipDuplicates: true,
    });
    const client = await createMember(f.t, "CLIENT", [{ projectId: f.projectId }]);
    expect(client.permissions.has("employee.view")).toBe(true);
    expect(client.permissions.has("employee.rates.view")).toBe(false);
    const employee = await employeeService.get(client, f.employeeId);
    expect(employee).not.toHaveProperty("rates");
    expect(employee).not.toHaveProperty("currentRates");
    const equipment = await equipmentService.get(client, f.equipmentId);
    expect(equipment).not.toHaveProperty("rates");
    await expect(employeeService.listRates(client, f.employeeId)).rejects.toBeInstanceOf(ForbiddenError);
    await db.rolePermission.deleteMany({
      where: { roleId: clientRoleId, permissionKey: { in: ["employee.view", "employee.rates.view", "equipment.view", "equipment.rates.view"] } },
    });
  });

  it("subcontractor project role cannot carry rate permissions into a project", async () => {
    const sub = ctxByRole.get("SUBCONTRACTOR")!;
    for (const perms of sub.projectGrants.values()) {
      expect([...perms].some((p) => p.includes("rates"))).toBe(false);
    }
  });
});
