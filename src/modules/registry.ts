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
} as const;
