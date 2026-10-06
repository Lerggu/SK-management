import { withTenantScope } from "@/platform/db";
import { companyAdminService, companyDirectoryService } from "./companies/service";
import { dashboardService } from "./companies/dashboard";
import { projectService, siteService } from "./projects/service";
import { employeeService } from "./workforce/service";
import { equipmentService, equipmentTypeService } from "./equipment/service";
import { documentService } from "./documents/service";
import { profileService } from "./identity/service";
import { timesheetService } from "./timesheets/service";
import { diaryService } from "./diary/service";
import { budgetService, costService, projectFinanceService } from "./finance/service";
import { workCalendarService } from "./takt/calendar.service";
import { taktStructureService } from "./takt/structure.service";
import { taktPlanService } from "./takt/plan.service";
import { taktActivityService } from "./takt/activity.service";
import { lookaheadService } from "./takt/lookahead.service";
import { scheduleImportService } from "./takt/import.service";
import { bookingService } from "./logistics/booking.service";
import { deliveryService, logisticsBoardService, logisticsLocationService, logisticsRequestService } from "./logistics/logistics.service";
import { liftingAccessoryService, liftPlanService } from "./lifting/lift.service";
import { cableDrumService, materialBatchService, materialLabelService, materialTraceService, scanService } from "./lifting/material.service";
import { commercialDashboardService, customerService, opportunityService } from "./commercial/crm.service";
import { quoteService } from "./commercial/quote.service";
import { contractService, forecastService, variationService } from "./commercial/project.service";
import { invoiceService } from "./commercial/invoice.service";
import { clientApprovalService } from "./commercial/client-approval.service";
import { hseActionService, hseObservationService, hseOverviewService, hsePhotoService, incidentService } from "./hse/hse.service";
import { hseInspectionService, riskAssessmentService, toolboxTalkService, workPermitService } from "./hse/planning.service";
import { scheduleSummaryService } from "./takt/summary.service";
import { portalService } from "./portal/service";
import { aiProjectControllerService } from "./ai/service";
import { competenceAreaService, hrSettingsService, jobProfileService, qualificationTypeService } from "./hr/settings.service";
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
} from "./hr/card.service";
import { employeeFileService } from "./hr/files.service";
import { hrOverviewService } from "./hr/overview.service";

/**
 * Every service object whose methods take a RequestContext/UserContext.
 * tests/isolation/registry.test.ts fails if any method here lacks a tenant
 * isolation case.
 */
export const SERVICE_REGISTRY = {
  companyDirectory: companyDirectoryService,
  companyAdmin: companyAdminService,
  dashboard: dashboardService,
  project: projectService,
  site: siteService,
  employee: employeeService,
  equipmentType: equipmentTypeService,
  equipment: equipmentService,
  document: documentService,
  profile: profileService,
  // V2
  timesheet: timesheetService,
  diary: diaryService,
  budget: budgetService,
  cost: costService,
  projectFinance: projectFinanceService,
  // V3
  workCalendar: workCalendarService,
  taktStructure: taktStructureService,
  taktPlan: taktPlanService,
  taktActivity: taktActivityService,
  lookahead: lookaheadService,
  scheduleImport: scheduleImportService,
  // V4
  booking: bookingService,
  logisticsLocation: logisticsLocationService,
  logisticsRequest: logisticsRequestService,
  delivery: deliveryService,
  logisticsBoard: logisticsBoardService,
  // V5
  liftingAccessory: liftingAccessoryService,
  liftPlan: liftPlanService,
  materialBatch: materialBatchService,
  cableDrum: cableDrumService,
  materialTrace: materialTraceService,
  materialLabel: materialLabelService,
  scan: scanService,
  // V6
  customer: customerService,
  opportunity: opportunityService,
  commercialDashboard: commercialDashboardService,
  quote: quoteService,
  contract: contractService,
  variation: variationService,
  forecast: forecastService,
  invoice: invoiceService,
  // V7
  hseOverview: hseOverviewService,
  hseObservation: hseObservationService,
  incident: incidentService,
  hseAction: hseActionService,
  hsePhoto: hsePhotoService,
  toolboxTalk: toolboxTalkService,
  riskAssessment: riskAssessmentService,
  workPermit: workPermitService,
  hseInspection: hseInspectionService,
  clientApproval: clientApprovalService,
  scheduleSummary: scheduleSummaryService,
  portal: portalService,
  // V8
  aiProjectController: aiProjectControllerService,
  // HR: personnel card and competence (ADR 0025)
  hrSettings: hrSettingsService,
  competenceArea: competenceAreaService,
  qualificationType: qualificationTypeService,
  jobProfile: jobProfileService,
  hrCard: hrCardService,
  competenceAssessment: assessmentService,
  training: trainingService,
  qualification: qualificationService,
  orientation: orientationService,
  equipmentAuthorization: authorizationService,
  employeeLanguage: languageService,
  clothing: clothingService,
  companyItem: companyItemService,
  employeeFile: employeeFileService,
  hrOverview: hrOverviewService,
} as const;

// ── V8: tenant scope for row-level security ──────────────────────────
const SCOPED = Symbol.for("sk.tenantScoped");
type AnyFn = ((...args: unknown[]) => unknown) & { [SCOPED]?: true };

/**
 * Wraps every registered service method once: a call made with a company
 * RequestContext runs inside that company's tenant scope, so its queries run
 * under PostgreSQL row-level security (docs/adr/0022). UserContext calls
 * (company selection, profile) stay unscoped. The objects are the same ones
 * the app imports, so the wrapper applies everywhere once this module loads.
 */
for (const service of Object.values(SERVICE_REGISTRY) as Record<string, AnyFn>[]) {
  for (const [name, fn] of Object.entries(service)) {
    if (typeof fn !== "function" || fn[SCOPED]) continue;
    const wrapped: AnyFn = function (this: unknown, ...args: unknown[]) {
      const ctx = args[0] as { kind?: string; company?: { id: string; organizationId: string } } | undefined;
      if (ctx?.kind === "company" && ctx.company) {
        return withTenantScope({ companyId: ctx.company.id, organizationId: ctx.company.organizationId }, () => fn.apply(service, args));
      }
      return fn.apply(service, args);
    };
    wrapped[SCOPED] = true;
    service[name] = wrapped;
  }
}

/** Whether a service method runs inside the tenant scope wrapper. */
export function isTenantScoped(fn: unknown): boolean {
  return typeof fn === "function" && (fn as AnyFn)[SCOPED] === true;
}
