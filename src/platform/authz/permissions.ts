/**
 * Capability permission catalogue (V1–V8, HR). Code checks these keys — never role
 * names. Roles are company-scoped records instantiated from ROLE_TEMPLATES.
 *
 * Changing this file changes authorization. Any change must ship with a
 * migration/seed update and an updated role × permission matrix test.
 */

export const PERMISSIONS = {
  "company.manage": { category: "company", sensitive: false, description: "Edit company settings" },
  "company.members.manage": { category: "company", sensitive: false, description: "Invite, disable and assign roles to members" },
  "company.roles.manage": { category: "company", sensitive: false, description: "Edit role permissions" },
  "audit.view": { category: "company", sensitive: false, description: "View the audit log" },

  "project.view": { category: "projects", sensitive: false, description: "View projects and sites" },
  "project.manage": { category: "projects", sensitive: false, description: "Create, edit and archive projects and sites" },
  "project.members.manage": { category: "projects", sensitive: false, description: "Assign people to projects" },

  "employee.view": { category: "workforce", sensitive: false, description: "View employees" },
  "employee.manage": { category: "workforce", sensitive: false, description: "Create, edit and archive employees" },
  "employee.rates.view": { category: "workforce", sensitive: true, description: "View employee cost and billing rates" },
  "employee.rates.manage": { category: "workforce", sensitive: true, description: "Change employee cost and billing rates" },
  // HR card and competence (ADR 0025). The supervisor chain and the employee
  // themselves get access through the employee records, not a permission.
  "hr.view": { category: "workforce", sensitive: true, description: "View work-related HR data: competence matrix, published assessments, trainings, cards, orientations, permits and languages" },
  "hr.manage": { category: "workforce", sensitive: true, description: "Manage all HR data: competence areas, card types, requirements, assessments, attachments, clothing and company items" },

  "equipment.view": { category: "equipment", sensitive: false, description: "View equipment" },
  "equipment.manage": { category: "equipment", sensitive: false, description: "Create, edit and archive equipment and types" },
  "equipment.rates.view": { category: "equipment", sensitive: true, description: "View equipment cost and billing rates" },
  "equipment.rates.manage": { category: "equipment", sensitive: true, description: "Change equipment cost and billing rates" },

  "documents.view": { category: "documents", sensitive: false, description: "View documents" },
  "documents.manage": { category: "documents", sensitive: false, description: "Create documents and upload versions" },
  "documents.approve": { category: "documents", sensitive: false, description: "Approve or reject document versions" },

  // V2 — site execution and project finance
  "timesheet.submit": { category: "time", sensitive: false, description: "Enter and submit own hours" },
  "timesheet.manage": { category: "time", sensitive: false, description: "Enter and submit hours for crew members" },
  "timesheet.approve": { category: "time", sensitive: false, description: "Approve or reject submitted hours" },
  "timesheet.export": { category: "time", sensitive: false, description: "Export approved hours for payroll" },
  "diary.view": { category: "diary", sensitive: false, description: "View site diaries" },
  "diary.manage": { category: "diary", sensitive: false, description: "Write site diaries" },
  "diary.sign": { category: "diary", sensitive: false, description: "Sign (finalize) site diaries" },
  "finance.view": { category: "finance", sensitive: true, description: "View project budgets, costs and margins" },
  "finance.manage": { category: "finance", sensitive: true, description: "Edit budgets and record project costs" },

  // V3 — takt planning and look-ahead
  "takt.view": { category: "takt", sensitive: false, description: "View takt plans, the takt board and the look-ahead" },
  "takt.manage": { category: "takt", sensitive: false, description: "Edit takt structure and draft plan versions, import schedules" },
  "takt.progress.update": { category: "takt", sensitive: false, description: "Record activity progress, constraints and delays" },
  "takt.baseline.approve": { category: "takt", sensitive: false, description: "Approve a proposed plan version as the baseline" },

  // V4 — logistics and resource bookings
  "logistics.view": { category: "logistics", sensitive: false, description: "View the logistics board, deliveries, requests and bookings" },
  "logistics.request": { category: "logistics", sensitive: false, description: "Create logistics requests" },
  "logistics.approve": { category: "logistics", sensitive: false, description: "Review and approve logistics requests, manage gates and storage" },
  "booking.manage": { category: "logistics", sensitive: false, description: "Book resources and decide booking requests for own resources" },
  "delivery.manage": { category: "logistics", sensitive: false, description: "Schedule deliveries and record gate check-in and unloading" },

  // V5 — lifting and material flow
  "lift.request": { category: "lifting", sensitive: false, description: "Create lift plans and edit drafts for own lifts" },
  "lift.plan.manage": { category: "lifting", sensitive: false, description: "Edit and submit lift plans, manage lifting accessories, record lift completion" },
  "lift.plan.approve": { category: "lifting", sensitive: false, description: "Approve or reject lift plans (person responsible for lifting)" },
  "material.view": { category: "material", sensitive: false, description: "View material batches, cable drums and QR labels" },
  "material.manage": { category: "material", sensitive: false, description: "Register and move material batches, cable drums and record cable pulls" },

  // V6 — commercial (prices, margins and billing are sensitive)
  "crm.view": { category: "commercial", sensitive: false, description: "View customers, contacts and the sales pipeline" },
  "crm.manage": { category: "commercial", sensitive: false, description: "Manage customers, contacts and opportunities" },
  "commercial.view": { category: "commercial", sensitive: true, description: "View quotes, contracts, variations and project forecasts" },
  "commercial.manage": { category: "commercial", sensitive: true, description: "Prepare quotes, contracts, variations and forecasts" },
  "commercial.approve": { category: "commercial", sensitive: true, description: "Approve quotes and variations" },
  "invoice.manage": { category: "commercial", sensitive: true, description: "Generate, export and mark invoice candidates" },

  // V7 — HSE (injured-person data is sensitive) and portals
  "hse.view": { category: "hse", sensitive: false, description: "View HSE records, actions and key figures" },
  "hse.create": { category: "hse", sensitive: false, description: "Report observations, near misses and incidents, record toolbox talks, request permits" },
  "hse.manage": { category: "hse", sensitive: false, description: "Triage HSE reports, assign actions, manage risk assessments and inspections" },
  "hse.investigate": { category: "hse", sensitive: false, description: "Investigate and close serious and lost-time incidents" },
  "hse.action.approve": { category: "hse", sensitive: false, description: "Approve corrective actions of incidents" },
  "hse.serious.notify": { category: "hse", sensitive: false, description: "Receive immediate notifications of serious incidents" },
  "hse.personal.view": { category: "hse", sensitive: true, description: "View injured-person details of incidents" },
  "permit.approve": { category: "hse", sensitive: false, description: "Approve or reject permits to work" },
  "portal.client": { category: "portal", sensitive: false, description: "Use the client portal" },
  "portal.subcontractor": { category: "portal", sensitive: false, description: "Use the subcontractor portal" },
  "variation.client_approve": { category: "portal", sensitive: false, description: "Approve or reject variations on behalf of the client" },

  // V8 — AI project controller (sends project data the user can see to the AI provider)
  "ai.use": { category: "ai", sensitive: true, description: "Use the AI project controller (sends project data the user can see to the AI provider)" },
} as const satisfies Record<string, { category: string; sensitive: boolean; description: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export const SENSITIVE_PERMISSIONS: ReadonlySet<PermissionKey> = new Set(
  ALL_PERMISSIONS.filter((k) => PERMISSIONS[k].sensitive),
);

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/**
 * Permissions that belong to external parties only (V7). They are never
 * granted to internal roles — an internal user must not approve a variation
 * on the client's behalf — and permission resolution drops them for members
 * without an external role.
 */
export const EXTERNAL_ONLY_PERMISSIONS: ReadonlySet<PermissionKey> = new Set(["portal.client", "portal.subcontractor", "variation.client_approve"]);

/** Permissions that only make sense company-wide (never granted via a project role). */
export const COMPANY_ONLY_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  "company.manage",
  "company.members.manage",
  "company.roles.manage",
  "audit.view",
  "employee.view",
  "employee.manage",
  "employee.rates.view",
  "employee.rates.manage",
  "hr.view",
  "hr.manage",
  "equipment.view",
  "equipment.manage",
  "equipment.rates.view",
  "equipment.rates.manage",
  "timesheet.export",
  "crm.view",
  "crm.manage",
]);

export type RoleTemplateKey =
  | "CEO"
  | "PROJECT_DIRECTOR"
  | "PROJECT_MANAGER"
  | "SITE_MANAGER"
  | "SUPERVISOR"
  | "LOGISTICS_COORDINATOR"
  | "HSE"
  | "EMPLOYEE"
  | "SUBCONTRACTOR"
  | "CLIENT"
  | "LIFTING_SUPERVISOR"
  | "CLIENT_APPROVER"
  | "HR_ADMIN";

export interface RoleTemplate {
  key: RoleTemplateKey;
  name: { fi: string; en: string };
  projectAccess: "ALL" | "ASSIGNED";
  /** External parties: never receive sensitive (cost/rate) permissions. */
  external: boolean;
  permissions: PermissionKey[];
}

const P = (...keys: PermissionKey[]) => keys;

/**
 * The 10 role templates from Build Master §5, plus the V5 Lifting Supervisor
 * (owner decision: the person responsible for lifting approves lift plans)
 * and the V7 Client approver (owner decision: named client person approves
 * variations in the portal). CEO and Project Director see all
 * projects; all other roles see only projects they are assigned to.
 */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: "CEO",
    name: { fi: "Toimitusjohtaja", en: "CEO" },
    projectAccess: "ALL",
    external: false,
    permissions: ALL_PERMISSIONS.filter((k) => !EXTERNAL_ONLY_PERMISSIONS.has(k)),
  },
  {
    key: "PROJECT_DIRECTOR",
    name: { fi: "Projektijohtaja", en: "Project Director" },
    projectAccess: "ALL",
    external: false,
    permissions: P(
      "audit.view",
      "project.view",
      "project.manage",
      "project.members.manage",
      "employee.view",
      "employee.manage",
      "employee.rates.view",
      "employee.rates.manage",
      "hr.view",
      "equipment.view",
      "equipment.manage",
      "equipment.rates.view",
      "equipment.rates.manage",
      "documents.view",
      "documents.manage",
      "documents.approve",
      "timesheet.submit",
      "timesheet.manage",
      "timesheet.approve",
      "timesheet.export",
      "diary.view",
      "diary.manage",
      "diary.sign",
      "finance.view",
      "finance.manage",
      "takt.view",
      "takt.manage",
      "takt.progress.update",
      "takt.baseline.approve",
      "logistics.view",
      "logistics.request",
      "logistics.approve",
      "booking.manage",
      "delivery.manage",
      "lift.request",
      "lift.plan.manage",
      "lift.plan.approve",
      "material.view",
      "material.manage",
      "crm.view",
      "crm.manage",
      "commercial.view",
      "commercial.manage",
      "commercial.approve",
      "invoice.manage",
      "hse.view",
      "hse.create",
      "hse.manage",
      "hse.action.approve",
      "hse.serious.notify",
      "permit.approve",
      "ai.use",
    ),
  },
  {
    key: "PROJECT_MANAGER",
    name: { fi: "Projektipäällikkö", en: "Project Manager" },
    projectAccess: "ASSIGNED",
    external: false,
    permissions: P(
      "project.view",
      "project.manage",
      "project.members.manage",
      "employee.view",
      "employee.manage",
      "employee.rates.view",
      "hr.view",
      "equipment.view",
      "equipment.rates.view",
      "documents.view",
      "documents.manage",
      "documents.approve",
      "timesheet.submit",
      "timesheet.manage",
      "timesheet.approve",
      "diary.view",
      "diary.manage",
      "diary.sign",
      "finance.view",
      "finance.manage",
      "takt.view",
      "takt.manage",
      "takt.progress.update",
      "takt.baseline.approve",
      "logistics.view",
      "logistics.request",
      "booking.manage",
      "lift.request",
      "material.view",
      "crm.view",
      "crm.manage",
      "commercial.view",
      "commercial.manage",
      "invoice.manage",
      "hse.view",
      "hse.create",
      "hse.manage",
      "hse.action.approve",
      "ai.use",
    ),
  },
  {
    key: "SITE_MANAGER",
    name: { fi: "Työmaapäällikkö", en: "Site Manager" },
    projectAccess: "ASSIGNED",
    external: false,
    permissions: P(
      "project.view",
      "employee.view",
      "hr.view",
      "equipment.view",
      "equipment.manage",
      "documents.view",
      "documents.manage",
      "timesheet.submit",
      "timesheet.manage",
      "timesheet.approve",
      "diary.view",
      "diary.manage",
      "diary.sign",
      "takt.view",
      "takt.manage",
      "takt.progress.update",
      "logistics.view",
      "logistics.request",
      "logistics.approve",
      "booking.manage",
      "delivery.manage",
      "lift.request",
      "lift.plan.manage",
      "material.view",
      "material.manage",
      "hse.view",
      "hse.create",
      "hse.manage",
      "permit.approve",
    ),
  },
  {
    key: "SUPERVISOR",
    name: { fi: "Työnjohtaja", en: "Supervisor" },
    projectAccess: "ASSIGNED",
    external: false,
    permissions: P("project.view", "employee.view", "equipment.view", "documents.view", "documents.manage", "timesheet.submit", "timesheet.manage", "diary.view", "diary.manage", "diary.sign", "takt.view", "takt.progress.update", "logistics.view", "logistics.request", "delivery.manage", "lift.request", "material.view", "material.manage", "hse.view", "hse.create"),
  },
  {
    key: "LOGISTICS_COORDINATOR",
    name: { fi: "Logistiikkakoordinaattori", en: "Logistics Coordinator" },
    projectAccess: "ASSIGNED",
    external: false,
    permissions: P("project.view", "employee.view", "equipment.view", "equipment.manage", "documents.view", "timesheet.submit", "diary.view", "takt.view", "logistics.view", "logistics.request", "logistics.approve", "booking.manage", "delivery.manage", "lift.request", "lift.plan.manage", "material.view", "material.manage", "hse.view", "hse.create"),
  },
  {
    key: "HSE",
    name: { fi: "HSE-asiantuntija", en: "HSE" },
    projectAccess: "ASSIGNED",
    external: false,
    permissions: P("project.view", "employee.view", "hr.view", "equipment.view", "documents.view", "documents.manage", "timesheet.submit", "diary.view", "takt.view", "logistics.view", "material.view", "hse.view", "hse.create", "hse.manage", "hse.investigate", "hse.serious.notify", "hse.personal.view", "permit.approve"),
  },
  {
    key: "EMPLOYEE",
    name: { fi: "Työntekijä", en: "Employee" },
    projectAccess: "ASSIGNED",
    external: false,
    permissions: P("project.view", "documents.view", "timesheet.submit", "diary.view", "takt.view", "logistics.view", "material.view", "hse.view", "hse.create"),
  },
  {
    key: "SUBCONTRACTOR",
    name: { fi: "Aliurakoitsija", en: "Subcontractor" },
    projectAccess: "ASSIGNED",
    external: true,
    permissions: P("project.view", "documents.view", "hse.create", "portal.subcontractor"),
  },
  {
    key: "CLIENT",
    name: { fi: "Asiakas", en: "Client" },
    projectAccess: "ASSIGNED",
    external: true,
    permissions: P("project.view", "documents.view", "portal.client"),
  },
  {
    key: "LIFTING_SUPERVISOR",
    name: { fi: "Nostovastaava", en: "Lifting Supervisor" },
    projectAccess: "ASSIGNED",
    external: false,
    permissions: P("project.view", "employee.view", "equipment.view", "documents.view", "timesheet.submit", "diary.view", "takt.view", "logistics.view", "logistics.request", "lift.request", "lift.plan.manage", "lift.plan.approve", "material.view", "hse.view", "hse.create"),
  },
  {
    // V7 owner decision 2: the named client person approves variations in the
    // portal. Assigned as a project role, never company-wide by default.
    key: "CLIENT_APPROVER",
    name: { fi: "Asiakkaan hyväksyjä", en: "Client approver" },
    projectAccess: "ASSIGNED",
    external: true,
    permissions: P("project.view", "documents.view", "portal.client", "variation.client_approve"),
  },
  {
    // HR owner decision: an HR administrator manages all personnel-card data
    // without access to projects, finance or rates.
    key: "HR_ADMIN",
    name: { fi: "Henkilöstöhallinto", en: "HR administrator" },
    projectAccess: "ASSIGNED",
    external: false,
    permissions: P("employee.view", "employee.manage", "hr.view", "hr.manage", "equipment.view"),
  },
];

export const EXTERNAL_TEMPLATE_KEYS: ReadonlySet<string> = new Set(
  ROLE_TEMPLATES.filter((t) => t.external).map((t) => t.key),
);

export function getRoleTemplate(key: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((t) => t.key === key);
}
