import { companyAdminService, companyDirectoryService } from "./companies/service";
import { dashboardService } from "./companies/dashboard";
import { projectService, siteService } from "./projects/service";
import { employeeService } from "./workforce/service";
import { equipmentService, equipmentTypeService } from "./equipment/service";
import { documentService } from "./documents/service";
import { profileService } from "./identity/service";

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
} as const;
