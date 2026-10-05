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
} as const;
