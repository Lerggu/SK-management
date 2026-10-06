/**
 * V7 dedicated security test: external permission boundaries.
 *
 * Company A holds a full set of internal data; every internal name contains
 * "SECRET". Client, Client approver and Subcontractor members (assigned to
 * the project) call every registered service. For every call:
 *   - no successful result may contain "SECRET" or a non-null cost, price,
 *     rate, margin or personal field (the client's approval snapshot may show
 *     the sales price — that is what the client approves);
 *   - writes must be refused (403/404) unless explicitly allowed below.
 * A meta-test fails if a service in SERVICE_REGISTRY is not exercised.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import type { RequestContext } from "@/platform/authz";
import { SERVICE_REGISTRY } from "@/modules/registry";
import { companyAdminService } from "@/modules/companies/service";
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
import { scheduleSummaryService } from "@/modules/takt/summary.service";
import { aiProjectControllerService } from "@/modules/ai/service";
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
import { portalService } from "@/modules/portal/service";
import { competenceAreaService, hrSettingsService, jobProfileService, qualificationTypeService } from "@/modules/hr/settings.service";
import {
  assessmentService,
  authorizationService,
  clothingService,
  companyItemService,
  hrCardService,
  languageService,
  orientationService,
  qualificationService,
  trainingService,
} from "@/modules/hr/card.service";
import { employeeFileService } from "@/modules/hr/files.service";
import { hrOverviewService } from "@/modules/hr/overview.service";
import { createMember, createTenant, textFile, uniq, type Tenant } from "../helpers/fixtures";

type Role = "CLIENT" | "CLIENT_APPROVER" | "SUBCONTRACTOR";
const ROLES: Role[] = ["CLIENT", "CLIENT_APPROVER", "SUBCONTRACTOR"];

interface F {
  t: Tenant;
  project: string;
  other: string;
  site: string;
  employee: string;
  equipment: string;
  equipmentType: string;
  doc: string;
  docVersion: string;
  sharedDoc: string;
  sharedVersion: string;
  timeEntry: string;
  report: string;
  budget: string;
  plan: string;
  building: string;
  activity: string;
  gate: string;
  request: string;
  delivery: string;
  liftPlan: string;
  accessory: string;
  batch: string;
  drum: string;
  customer: string;
  opportunity: string;
  quote: string;
  contract: string;
  variation: string;
  candidate: string;
  observation: string;
  incident: string;
  action: string;
  photo: string;
  risk: string;
  permit: string;
  inspection: string;
  approval: { id: string; hash: string };
  aiRecommendation: string;
  ownIncident: Map<Role, string>;
  ownPermit: Map<Role, string>;
}

let f: F;
const ctxs = new Map<Role, RequestContext>();

type Call = { service: keyof typeof SERVICE_REGISTRY; write: boolean; run: (c: RequestContext, role: Role) => Promise<unknown> };
const r = (service: keyof typeof SERVICE_REGISTRY, run: Call["run"]): Call => ({ service, write: false, run });
const w = (service: keyof typeof SERVICE_REGISTRY, run: Call["run"]): Call => ({ service, write: true, run });

/** Calls that external roles are allowed to make successfully. */
const ALLOWED_WRITES: Record<string, Role[]> = {
  "observation.create": ["SUBCONTRACTOR"],
  "incident.report": ["SUBCONTRACTOR"],
  "permit.request": ["SUBCONTRACTOR"],
  "photo.add own": ["SUBCONTRACTOR"],
  "permit.close own approved": ["SUBCONTRACTOR"],
  "clientApproval.decide": ["CLIENT_APPROVER"],
  "company.rememberCompany": ["CLIENT", "CLIENT_APPROVER", "SUBCONTRACTOR"],
};

// HR fixtures (ADR 0025): created after the main fixture.
const hr = { area: "", qualification: "", training: "", orientation: "", authorization: "", language: "", clothing: "", item: "", file: "", draft: "", published: "", type: "", profile: "", requirement: "" };


const hrPdf = () => ({ fileName: "x.pdf", bytes: new TextEncoder().encode("%PDF-1.4 x") });

const CALLS: Record<string, Call> = {
  // HR (ADR 0025): external parties never get HR access.
  "hr.settings.get": r("hrSettings", (c) => hrSettingsService.get(c)),
  "hr.settings.update": w("hrSettings", (c) => hrSettingsService.update(c, { reminderEmail: "x@example.test" })),
  "hr.settings.runReminders": w("hrSettings", (c) => hrSettingsService.runReminders(c)),
  "hr.area.list": r("competenceArea", (c) => competenceAreaService.list(c)),
  "hr.area.create": w("competenceArea", (c) => competenceAreaService.create(c, { category: "X", name: uniq("x") })),
  "hr.area.archive": w("competenceArea", (c) => competenceAreaService.archive(c, hr.area)),
  "hr.type.list": r("qualificationType", (c) => qualificationTypeService.list(c)),
  "hr.type.create": w("qualificationType", (c) => qualificationTypeService.create(c, { name: uniq("x") })),
  "hr.profile.list": r("jobProfile", (c) => jobProfileService.list(c)),
  "hr.profile.addRequirement": w("jobProfile", (c) => jobProfileService.addRequirement(c, hr.profile, { kind: "QUALIFICATION", qualificationTypeId: hr.type })),
  "hr.card.get": r("hrCard", (c) => hrCardService.get(c, f.employee)),
  "hr.card.myEmployeeId": r("hrCard", (c) => hrCardService.myEmployeeId(c)),
  "hr.card.linkableUsers": r("hrCard", (c) => hrCardService.linkableUsers(c)),
  "hr.card.updatePersonal": w("hrCard", (c) => hrCardService.updatePersonal(c, f.employee, { phone: "1" })),
  "hr.card.updateEmployment": w("hrCard", (c) => hrCardService.updateEmployment(c, f.employee, { team: "x" })),
  "hr.assessment.create": w("competenceAssessment", (c) => assessmentService.create(c, f.employee, { areaId: hr.area, assessedOn: "2026-10-01" })),
  "hr.assessment.publish": w("competenceAssessment", (c) => assessmentService.publish(c, hr.draft)),
  "hr.assessment.comment": w("competenceAssessment", (c) => assessmentService.comment(c, hr.published, { comment: "x" })),
  "hr.training.add": w("training", (c) => trainingService.add(c, f.employee, { name: "x", completedOn: "2026-01-01" })),
  "hr.training.verify": w("training", (c) => trainingService.verify(c, hr.training)),
  "hr.qualification.add": w("qualification", (c) => qualificationService.add(c, f.employee, { name: "x", noExpiry: "on" })),
  "hr.qualification.renew": w("qualification", (c) => qualificationService.renew(c, hr.qualification, { name: "x", noExpiry: "on" })),
  "hr.orientation.acknowledge": w("orientation", (c) => orientationService.acknowledge(c, hr.orientation)),
  "hr.authorization.add": w("equipmentAuthorization", (c) => authorizationService.add(c, f.employee, { target: "x", grantedOn: "2026-01-01" })),
  "hr.language.save": w("employeeLanguage", (c) => languageService.save(c, f.employee, { language: "en", source: "SELF" })),
  "hr.clothing.cancel": w("clothing", (c) => clothingService.cancel(c, hr.clothing)),
  "hr.item.acknowledge": w("companyItem", (c) => companyItemService.acknowledge(c, hr.item)),
  "hr.file.list": r("employeeFile", (c) => employeeFileService.list(c, f.employee)),
  "hr.file.download": r("employeeFile", (c) => employeeFileService.download(c, hr.file)),
  "hr.file.upload": w("employeeFile", (c) => employeeFileService.upload(c, f.employee, { kind: "OTHER" }, hrPdf())),
  "hr.overview.matrix": r("hrOverview", (c) => hrOverviewService.matrix(c)),
  "hr.overview.qualifications": r("hrOverview", (c) => hrOverviewService.qualifications(c)),
  "hr.overview.overview": r("hrOverview", (c) => hrOverviewService.overview(c)),
  "hr.overview.search": r("hrOverview", (c) => hrOverviewService.search(c, { q: "SECRET" })),
  "company.getSettings": r("companyAdmin", (c) => companyAdminService.getSettings(c)),
  "company.listMembers": r("companyAdmin", (c) => companyAdminService.listMembers(c)),
  "company.listRoles": r("companyAdmin", (c) => companyAdminService.listRoles(c)),
  "company.audit": r("companyAdmin", (c) => companyAdminService.listAuditEvents(c, {})),
  "company.rememberCompany": w("companyAdmin", (c) => companyAdminService.rememberCompany(c)),
  "company.invite": w("companyAdmin", (c) => companyAdminService.inviteMember(c, { email: `${uniq("x")}@example.test`, roleIds: [] })),
  "dashboard.summary": r("dashboard", (c) => dashboardService.summary(c)),
  "project.list": r("project", (c) => projectService.list(c)),
  "project.get": r("project", (c) => projectService.get(c, f.project)),
  "project.get other": r("project", (c) => projectService.get(c, f.other)),
  "project.listMembers": r("project", (c) => projectService.listMembers(c, f.project)),
  "project.listAssignable": r("project", (c) => projectService.listAssignable(c, f.project)),
  "project.update": w("project", (c) => projectService.update(c, f.project, { code: "P", name: "x" })),
  "site.list": r("site", (c) => siteService.list(c, f.project)),
  "site.get": r("site", (c) => siteService.get(c, f.site)),
  "site.create": w("site", (c) => siteService.create(c, f.project, { name: "x" })),
  "employee.list": r("employee", (c) => employeeService.list(c)),
  "employee.get": r("employee", (c) => employeeService.get(c, f.employee)),
  "employee.listRates": r("employee", (c) => employeeService.listRates(c, f.employee)),
  "equipmentType.list": r("equipmentType", (c) => equipmentTypeService.list(c)),
  "equipment.list": r("equipment", (c) => equipmentService.list(c)),
  "equipment.get": r("equipment", (c) => equipmentService.get(c, f.equipment)),
  "equipment.listRates": r("equipment", (c) => equipmentService.listRates(c, f.equipment)),
  "document.list": r("document", (c) => documentService.list(c)),
  "document.get internal": r("document", (c) => documentService.get(c, f.doc)),
  "document.get shared": r("document", (c) => documentService.get(c, f.sharedDoc)),
  "document.download internal": r("document", (c) => documentService.downloadVersion(c, f.docVersion)),
  "document.listLinkedTo": r("document", (c) => documentService.listLinkedTo(c, { entityType: "PROJECT", entityId: f.project })),
  "document.create": w("document", (c) => documentService.create(c, { title: "x", projectId: f.project }, textFile("x.pdf"))),
  "document.approve": w("document", (c) => documentService.setVersionApproval(c, f.sharedVersion, { state: "REJECTED" })),
  "document.setSharing": w("document", (c) => documentService.setSharing(c, f.sharedDoc, { sharedWithSubcontractors: "on" })),
  "profile.getProfile": r("profile", (c) => profileService.getProfile({ kind: "user", user: c.user, meta: c.meta, locale: "fi" })),
  "timesheet.entryOptions": r("timesheet", (c) => timesheetService.entryOptions(c)),
  "timesheet.listForApproval": r("timesheet", (c) => timesheetService.listForApproval(c, {})),
  "timesheet.create": w("timesheet", (c) => timesheetService.create(c, { employeeId: f.employee, projectId: f.project, workDate: "2026-03-03", hours: "1" })),
  "diary.list": r("diary", (c) => diaryService.list(c, { projectId: f.project })),
  "diary.get": r("diary", (c) => diaryService.get(c, f.report)),
  "budget.listVersions": r("budget", (c) => budgetService.listVersions(c, f.project)),
  "cost.list": r("cost", (c) => costService.list(c, f.project)),
  "projectFinance.summary": r("projectFinance", (c) => projectFinanceService.summary(c, f.project)),
  "workCalendar.get": r("workCalendar", (c) => workCalendarService.get(c)),
  "taktStructure.overview": r("taktStructure", (c) => taktStructureService.overview(c, f.project)),
  "taktPlan.list": r("taktPlan", (c) => taktPlanService.list(c)),
  "taktPlan.board": r("taktPlan", (c) => taktPlanService.board(c, f.plan)),
  "taktActivity.get": r("taktActivity", (c) => taktActivityService.get(c, f.activity)),
  "taktActivity.recordProgress": w("taktActivity", (c) => taktActivityService.recordProgress(c, f.activity, { progressPct: "50", reportDate: "2026-10-01" })),
  "lookahead.compute": r("lookahead", (c) => lookaheadService.compute(c, { projectId: f.project, weeks: "2" })),
  "scheduleImport.preview": w("scheduleImport", (c) => scheduleImportService.preview(c, f.plan, { buildingId: f.building, areaLevel: "1" }, { fileName: "a.xml", bytes: new TextEncoder().encode("<Project/>") })),
  "scheduleSummary.project": r("scheduleSummary", (c) => scheduleSummaryService.project(c, f.project)),
  "booking.list": r("booking", (c) => bookingService.list(c, {})),
  "booking.resourceOptions": r("booking", (c) => bookingService.resourceOptions(c, f.project)),
  "logisticsLocation.list": r("logisticsLocation", (c) => logisticsLocationService.list(c, f.site)),
  "logisticsRequest.list": r("logisticsRequest", (c) => logisticsRequestService.list(c, {})),
  "logisticsRequest.get": r("logisticsRequest", (c) => logisticsRequestService.get(c, f.request)),
  "delivery.get": r("delivery", (c) => deliveryService.get(c, f.delivery)),
  "logisticsBoard.sites": r("logisticsBoard", (c) => logisticsBoardService.sites(c)),
  "logisticsBoard.day": r("logisticsBoard", (c) => logisticsBoardService.day(c, { siteId: f.site, date: "2026-11-03" })),
  "liftingAccessory.list": r("liftingAccessory", (c) => liftingAccessoryService.list(c)),
  "liftPlan.list": r("liftPlan", (c) => liftPlanService.list(c, {})),
  "liftPlan.get": r("liftPlan", (c) => liftPlanService.get(c, f.liftPlan)),
  "materialBatch.list": r("materialBatch", (c) => materialBatchService.list(c, {})),
  "materialBatch.get": r("materialBatch", (c) => materialBatchService.get(c, f.batch)),
  "cableDrum.get": r("cableDrum", (c) => cableDrumService.get(c, f.drum)),
  "materialTrace.activity": r("materialTrace", (c) => materialTraceService.activity(c, f.activity)),
  "materialLabel.pdf": r("materialLabel", (c) => materialLabelService.pdf(c, { kind: "drum", ids: [f.drum] }, "http://x", { title: "t", footer: "f" })),
  "scan.resolve": r("scan", (c) => scanService.resolve(c, { code: f.drum })),
  "customer.list": r("customer", (c) => customerService.list(c, {})),
  "customer.get": r("customer", (c) => customerService.get(c, f.customer)),
  "opportunity.get": r("opportunity", (c) => opportunityService.get(c, f.opportunity)),
  "commercialDashboard.summary": r("commercialDashboard", (c) => commercialDashboardService.summary(c)),
  "quote.get": r("quote", (c) => quoteService.get(c, f.quote)),
  "contract.list": r("contract", (c) => contractService.list(c, f.project)),
  "variation.list": r("variation", (c) => variationService.list(c, f.project)),
  "variation.get": r("variation", (c) => variationService.get(c, f.variation)),
  "variation.recordClientDecision": w("variation", (c) => variationService.recordClientDecision(c, f.variation, { decision: "REJECTED", note: "x" })),
  "forecast.get": r("forecast", (c) => forecastService.get(c, f.project)),
  "invoice.list": r("invoice", (c) => invoiceService.list(c, {})),
  "hseOverview.projects": r("hseOverview", (c) => hseOverviewService.projects(c)),
  "hseOverview.register": r("hseOverview", (c) => hseOverviewService.register(c, f.project)),
  "hseOverview.metrics": r("hseOverview", (c) => hseOverviewService.metrics(c, f.project)),
  "hseOverview.portalFigures": r("hseOverview", (c) => hseOverviewService.portalFigures(c, f.project)),
  "hseOverview.urgent": r("hseOverview", (c) => hseOverviewService.urgent(c)),
  "observation.get": r("hseObservation", (c) => hseObservationService.get(c, f.observation)),
  "observation.create": w("hseObservation", (c) => hseObservationService.create(c, { projectId: f.project, kind: "SAFETY_OBSERVATION", title: "own report", occurredAt: "2026-10-01T08:00" })),
  "observation.triage": w("hseObservation", (c) => hseObservationService.triage(c, f.observation, { category: "PPE", severity: "LOW" })),
  "incident.get": r("incident", (c) => incidentService.get(c, f.incident)),
  "incident.get own": r("incident", (c, role) => incidentService.get(c, f.ownIncident.get(role) ?? f.incident)),
  "incident.report": w("incident", (c) => incidentService.report(c, { projectId: f.project, type: "PROPERTY_DAMAGE", severity: "FIRST_AID", title: "own incident", occurredAt: "2026-10-01T08:00" })),
  "incident.triage own": w("incident", (c, role) => incidentService.triage(c, f.ownIncident.get(role) ?? f.incident, { type: "INJURY", severity: "FIRST_AID" })),
  "incident.addPerson": w("incident", (c) => incidentService.addPerson(c, f.incident, { personName: "x" })),
  "action.markDone": w("hseAction", (c) => hseActionService.markDone(c, f.action, {})),
  "photo.download": r("hsePhoto", (c) => hsePhotoService.download(c, f.photo)),
  "photo.add own": w("hsePhoto", (c, role) => hsePhotoService.add(c, { recordType: "INCIDENT", recordId: f.ownIncident.get(role) ?? f.incident }, { fileName: "o.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]) })),
  "toolbox.create": w("toolboxTalk", (c) => toolboxTalkService.create(c, { projectId: f.project, heldOn: "2026-10-01", topic: "x", attendeeCount: "1" })),
  "risk.get": r("riskAssessment", (c) => riskAssessmentService.get(c, f.risk)),
  "risk.create": w("riskAssessment", (c) => riskAssessmentService.create(c, { projectId: f.project, title: "x" })),
  "permit.get": r("workPermit", (c) => workPermitService.get(c, f.permit)),
  "permit.request": w("workPermit", (c) => workPermitService.request(c, { projectId: f.project, type: "HOT_WORK", description: "own permit", validFrom: "2026-11-02T07:00", validTo: "2026-11-02T08:00" })),
  "permit.decide": w("workPermit", (c) => workPermitService.decide(c, f.permit, { decision: "APPROVE" })),
  "permit.close own approved": w("workPermit", (c, role) => workPermitService.close(c, f.ownPermit.get(role) ?? f.permit)),
  "inspection.get": r("hseInspection", (c) => hseInspectionService.get(c, f.inspection)),
  "clientApproval.list": r("clientApproval", (c) => clientApprovalService.list(c, f.project)),
  "clientApproval.get": r("clientApproval", (c) => clientApprovalService.get(c, f.approval.id)),
  "clientApproval.decide": w("clientApproval", (c) => clientApprovalService.decide(c, f.approval.id, { decision: "APPROVED", contentSha256: f.approval.hash })),
  "portal.projects": r("portal", (c) => portalService.projects(c)),
  "portal.project": r("portal", (c) => portalService.project(c, f.project)),
  "portal.project other": r("portal", (c) => portalService.project(c, f.other)),
  "ai.overview": r("aiProjectController", (c) => aiProjectControllerService.overview(c, f.project)),
  "ai.review": w("aiProjectController", (c) => aiProjectControllerService.review(c, f.project)),
  "ai.ask": w("aiProjectController", (c) => aiProjectControllerService.ask(c, f.project, { question: "What is the SECRET margin?" })),
  "ai.decideRecommendation": w("aiProjectController", (c) => aiProjectControllerService.decideRecommendation(c, f.aiRecommendation, { decision: "ACCEPTED" })),
  "ai.setBudget": w("aiProjectController", (c) => aiProjectControllerService.setBudget(c, { monthlyBudgetEur: "100" })),
};

const FORBIDDEN_KEYS = new Set([
  "amount",
  "unitCost",
  "unitPrice",
  "laborCost",
  "equipmentCost",
  "materialsCost",
  "subcontractCost",
  "otherCost",
  "markupPct",
  "marginPct",
  "margin",
  "cost",
  "salesPrice",
  "value",
  "rates",
  "currentRates",
  "personName",
  "injuryDescription",
  "bodyPart",
  "phone",
  "rootCause",
  "emergencyContactName",
  "emergencyContactPhone",
  "employeeComment",
]);

/** Paths of forbidden, non-null fields in a JSON-able value. */
function leaks(value: unknown, path = "$"): string[] {
  if (value === null || value === undefined || typeof value !== "object") return [];
  if (value instanceof Uint8Array || value instanceof Date) return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaks(v, `${path}[${i}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
    const p = `${path}.${k}`;
    // The frozen approval snapshot shows the sales price the client approves.
    if (k === "snapshot") return [];
    const own = FORBIDDEN_KEYS.has(k) && v !== null && v !== undefined ? [p] : [];
    return [...own, ...leaks(v, p)];
  });
}

function text(value: unknown): string {
  if (value === undefined) return "";
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? new TextDecoder().decode(v) : v));
}

beforeAll(async () => {
  const t = await createTenant("Ext");
  const o = t.ownerCtx;
  const project = await projectService.create(o, { code: "EXT-1", name: "Portal project" });
  const other = await projectService.create(o, { code: "EXT-2", name: "SECRET other project" });
  const site = await siteService.create(o, project.id, { name: "Portal site" });
  const employee = await employeeService.create(o, { employeeNumber: "S-1", firstName: "SECRET", lastName: "Employee", email: "secret.employee@example.test", phone: "+358401234567" });
  await employeeService.addRate(o, employee.id, { rateType: "COST", amount: "48", validFrom: "2026-01-01" });
  const type = await equipmentTypeService.create(o, { name: "SECRET crane type" });
  const equipment = await equipmentService.create(o, { equipmentTypeId: type.id, assetNumber: "S-EQ", name: "SECRET crane", currentProjectId: project.id });
  await equipmentService.addRate(o, equipment.id, { rateType: "BILLING", amount: "150", validFrom: "2026-01-01" });
  const doc = await documentService.create(o, { title: "SECRET internal drawing", projectId: project.id }, textFile("secret.pdf", "SECRET content"));
  await documentService.addLink(o, doc.id, { entityType: "PROJECT", entityId: project.id });
  const shared = await documentService.create(o, { title: "Shared drawing", projectId: project.id }, textFile("shared.pdf", "public"));
  await documentService.setVersionApproval(o, shared.currentVersion.id, { state: "APPROVED" });
  await documentService.setSharing(o, shared.id, { sharedWithClient: "on", sharedWithSubcontractors: "on" });
  const te = await timesheetService.create(o, { employeeId: employee.id, projectId: project.id, siteId: site.id, workDate: "2026-03-02", hours: "8", note: "SECRET note" });
  const report = await diaryService.open(o, { siteId: site.id, date: "2026-03-02" });
  await diaryService.addEntry(o, report.id, { kind: "WORK", description: "SECRET diary work" });
  const budget = await budgetService.createVersion(o, project.id, {});
  await budgetService.addLine(o, budget.id, { category: "LABOR", description: "SECRET budget line", amount: "1000" });
  await costService.create(o, project.id, { category: "MATERIALS", entryDate: "2026-03-02", description: "SECRET cost", amount: "500" });
  const building = await taktStructureService.createBuilding(o, { siteId: site.id, name: "SECRET building" });
  const area = await taktStructureService.createArea(o, { buildingId: building.id, code: "S1", name: "SECRET area" });
  await taktStructureService.createWorkPackage(o, project.id, { code: "SW", name: "SECRET wagon", trade: "SECRET trade", defaultCrewSize: "2", defaultDurationCycles: "1" });
  void area;
  const plan = await taktPlanService.create(o, { siteId: site.id, name: "Portal plan", startDate: "2026-11-02" });
  const v1 = (await taktPlanService.board(o, plan.id)).selected!;
  await taktPlanService.generateTrain(o, v1.id, {});
  await taktPlanService.propose(o, v1.id);
  await taktPlanService.approve(o, v1.id);
  const activity = (await taktPlanService.board(o, plan.id)).activities[0];
  await taktActivityService.addConstraint(o, activity.id, { type: "PERMIT", description: "SECRET constraint" });
  const gate = await logisticsLocationService.create(o, { siteId: site.id, kind: "GATE", name: "SECRET gate", opens: "06:00", closes: "18:00" });
  const request = await logisticsRequestService.create(o, { siteId: site.id, serviceType: "DELIVERY", title: "SECRET request", requestedStart: "2026-11-03T07:00", requestedEnd: "2026-11-03T08:00", submit: "on" });
  const delivery = await deliveryService.create(o, { siteId: site.id, gateId: gate.id, supplier: "SECRET supplier", material: "SECRET material", date: "2026-11-03", startTime: "08:00" });
  const accessory = await liftingAccessoryService.create(o, { code: "S-SL", name: "SECRET sling", kind: "SLING", wllKg: "2000", nextInspectionDate: "2027-06-01" });
  const liftPlan = await liftPlanService.create(o, { siteId: site.id, title: "SECRET lift", plannedStart: "2026-11-03T08:00", plannedEnd: "2026-11-03T09:00" });
  const batch = await materialBatchService.create(o, { siteId: site.id, code: "S-MB", material: "SECRET trays", quantity: "4", unit: "pcs", activityId: activity.id });
  const drum = await cableDrumService.create(o, { siteId: site.id, code: "S-CD", cableType: "SECRET cable", originalLengthM: "500" });
  const customer = await customerService.create(o, { name: "SECRET customer" });
  const opportunity = await opportunityService.create(o, { customerId: customer.id, title: "SECRET deal", estimatedValue: "1000" });
  const quote = await quoteService.create(o, { customerId: customer.id, title: "SECRET quote" });
  const contract = await contractService.create(o, { projectId: project.id, customerId: customer.id, contractNumber: "S-1", title: "SECRET contract", value: "100000" });
  await contractService.addMilestone(o, contract.id, { title: "SECRET milestone", amount: "1000", dueDate: "2026-10-01" });
  await invoiceService.generate(o, { projectId: project.id, to: "2026-12-31" });
  const candidate = (await invoiceService.list(o, { projectId: project.id }))[0];
  // Variation for the client: title visible to the approver, costs never.
  const variation = await variationService.create(o, { projectId: project.id, title: "Extra cable route", description: "Client requested" });
  await variationService.updateDraft(o, variation.id, { title: "Extra cable route", description: "Client requested", laborCost: "1000", materialsCost: "500", markupPct: "20", cause: "Client change" });
  await variationService.submitForReview(o, variation.id);
  await variationService.approveInternal(await createMember(t, "PROJECT_DIRECTOR"), variation.id, { decision: "APPROVE" });
  const approval = await db.variationClientApproval.findFirstOrThrow({ where: { variationId: variation.id } });
  // HSE records by internal staff.
  const observation = await hseObservationService.create(o, { projectId: project.id, kind: "NEAR_MISS", title: "SECRET near miss", occurredAt: "2026-10-01T08:00" });
  const photo = await hsePhotoService.add(o, { recordType: "OBSERVATION", recordId: observation.id }, { fileName: "s.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 9]) });
  const incident = await incidentService.report(o, { projectId: project.id, type: "INJURY", severity: "MEDICAL_TREATMENT", title: "SECRET incident", occurredAt: "2026-10-01T09:00" });
  await incidentService.triage(o, incident.id, { type: "INJURY", severity: "MEDICAL_TREATMENT" });
  await incidentService.addPerson(o, incident.id, { personName: "SECRET Person", injuryDescription: "SECRET injury" });
  const action = await hseActionService.create(o, { sourceType: "INCIDENT", sourceId: incident.id, title: "SECRET action" });
  const risk = await riskAssessmentService.create(o, { projectId: project.id, title: "SECRET risk" });
  const permit = await workPermitService.request(o, { projectId: project.id, type: "HOT_WORK", description: "SECRET permit", validFrom: "2026-11-02T07:00", validTo: "2026-11-02T15:00" });
  const inspection = await hseInspectionService.create(o, { projectId: project.id, kind: "MVR", inspectedOn: "2026-10-01", correctCount: "9", incorrectCount: "1", notes: "SECRET notes" });
  await toolboxTalkService.create(o, { projectId: project.id, heldOn: "2026-10-01", topic: "SECRET topic", attendeeCount: "4" });

  f = {
    t,
    project: project.id,
    other: other.id,
    site: site.id,
    employee: employee.id,
    equipment: equipment.id,
    equipmentType: type.id,
    doc: doc.id,
    docVersion: doc.currentVersion.id,
    sharedDoc: shared.id,
    sharedVersion: shared.currentVersion.id,
    timeEntry: te.id,
    report: report.id,
    budget: budget.id,
    plan: plan.id,
    building: building.id,
    activity: activity.id,
    gate: gate.id,
    request: request.id,
    delivery: delivery.id,
    liftPlan: liftPlan.id,
    accessory: accessory.id,
    batch: batch.id,
    drum: drum.id,
    customer: customer.id,
    opportunity: opportunity.id,
    quote: quote.id,
    contract: contract.id,
    variation: variation.id,
    candidate: candidate.id,
    observation: observation.id,
    incident: incident.id,
    action: action.id,
    photo: photo.id,
    risk: risk.id,
    permit: permit.id,
    inspection: inspection.id,
    approval: { id: approval.id, hash: approval.contentSha256 },
    aiRecommendation: (await db.aiRecommendation.findFirstOrThrow({ where: { runId: (await aiProjectControllerService.review(t.ownerCtx, project.id)).id } })).id,
    ownIncident: new Map(),
    ownPermit: new Map(),
  };
  const sm = await createMember(t, "SITE_MANAGER", [{ projectId: project.id }]);
  for (const role of ROLES) {
    const ctx = await createMember(t, role === "CLIENT_APPROVER" ? "CLIENT" : role, [{ projectId: project.id, role }]);
    ctxs.set(role, ctx);
    if (role === "SUBCONTRACTOR") {
      f.ownIncident.set(role, (await incidentService.report(ctx, { projectId: project.id, type: "PROPERTY_DAMAGE", severity: "FIRST_AID", title: "own damage", occurredAt: "2026-10-01T10:00" })).id);
      const p = await workPermitService.request(ctx, { projectId: project.id, type: "WORK_AT_HEIGHT", description: "own lift", validFrom: "2026-11-04T07:00", validTo: "2026-11-04T09:00" });
      await workPermitService.decide(sm, p.id, { decision: "APPROVE" });
      f.ownPermit.set(role, p.id);
    }
  }
});

type Outcome = { kind: "ok"; value: unknown } | { kind: "F" | "N" | "V"; error: unknown };

async function attempt(p: Promise<unknown>): Promise<Outcome> {
  try {
    return { kind: "ok", value: await p };
  } catch (e) {
    if (e instanceof ForbiddenError) return { kind: "F", error: e };
    if (e instanceof NotFoundError) return { kind: "N", error: e };
    if (e instanceof ValidationError) return { kind: "V", error: e };
    throw e;
  }
}

// Registered after the main fixture so `f` exists.
beforeAll(async () => {
  const o = f.t.ownerCtx;
  hr.area = (await competenceAreaService.create(o, { category: "SECRET", name: "SECRET area" })).id;
  hr.type = (await qualificationTypeService.create(o, { name: "SECRET card" })).id;
  hr.profile = (await jobProfileService.create(o, { name: "SECRET job" })).id;
  hr.requirement = (await jobProfileService.addRequirement(o, hr.profile, { kind: "QUALIFICATION", qualificationTypeId: hr.type })).id;
  hr.draft = (await assessmentService.create(o, f.employee, { areaId: hr.area, assessedOn: "2026-09-01" })).id;
  hr.published = (await assessmentService.create(o, f.employee, { areaId: hr.area, level: "2", agreedActions: "SECRET", assessedOn: "2026-09-02", publish: "on" })).id;
  hr.qualification = (await qualificationService.add(o, f.employee, { name: "SECRET card", noExpiry: "on" })).id;
  hr.training = (await trainingService.add(o, f.employee, { name: "SECRET training", completedOn: "2026-01-01" })).id;
  hr.orientation = (await orientationService.add(o, f.employee, { scope: "SITE", topic: "SECRET", instructorName: "SECRET" })).id;
  hr.authorization = (await authorizationService.add(o, f.employee, { target: "SECRET", grantedOn: "2026-01-01" })).id;
  hr.language = (await languageService.save(o, f.employee, { language: "fi", source: "SUPERVISOR" })).id;
  hr.clothing = (await clothingService.issue(o, f.employee, { product: "SECRET", issuedOn: "2026-01-01" })).id;
  hr.item = (await companyItemService.add(o, f.employee, { name: "SECRET", itemType: "OTHER", issuedOn: "2026-01-01" })).id;
  hr.file = (await employeeFileService.upload(o, f.employee, { kind: "OTHER" }, { fileName: "s.pdf", bytes: new TextEncoder().encode("%PDF-1.4 SECRET") })).id;
});

describe("external boundary: every service is exercised", () => {
  it.each(Object.keys(SERVICE_REGISTRY).filter((s) => s !== "companyDirectory"))("%s has at least one external boundary call", (service) => {
    expect(Object.values(CALLS).some((c) => c.service === service), `add a call for ${service} to tests/integration/external-boundary.test.ts`).toBe(true);
  });
});

describe("external boundary: Client, Client approver and Subcontractor", () => {
  const rows = Object.keys(CALLS).flatMap((name) => ROLES.map((role) => ({ name, role })));

  it.each(rows)("$role → $name", async ({ name, role }) => {
    const call = CALLS[name];
    const out = await attempt(call.run(ctxs.get(role)!, role));
    const allowed = ALLOWED_WRITES[name]?.includes(role) ?? false;
    if (call.write && !allowed) {
      expect(out.kind === "F" || out.kind === "N", `${role} must not be able to ${name} (got ${out.kind})`).toBe(true);
      return;
    }
    if (call.write && allowed) expect(out.kind, `${role} should be able to ${name}`).toBe("ok");
    if (out.kind === "ok") {
      expect(text(out.value), `${name} leaks internal data to ${role}`).not.toContain("SECRET");
      expect(leaks(out.value), `${name} leaks sensitive fields to ${role}`).toEqual([]);
    } else {
      expect(out.kind === "F" || out.kind === "N", `${name}: unexpected ${out.kind}`).toBe(true);
    }
  });
});
