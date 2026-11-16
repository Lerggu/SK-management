import { hasPermission, type RequestContext } from "@/platform/authz";

/**
 * HR access to one employee's card (ADR 0025). Capability permissions decide
 * company-wide access (hr.manage = admin, hr.view = work-related data); the
 * supervisor chain and the employee themselves get access through the
 * employee records:
 *
 *   section        admin  viewer  supervisor  self
 *   basics           ✓       ✓        ✓         ✓   (also employee.view)
 *   work data        ✓       ✓        ✓         ✓   competence, cards, trainings, orientations, permits, languages
 *   drafts           ✓       –        ✓         own self-assessments only
 *   emergency        ✓       –        ✓         ✓
 *   equipment        ✓       –        –         ✓   clothing sizes and hand-outs, company items
 *   other files      ✓       –        –         ✓
 *
 * External members (client, subcontractor) never get HR access.
 */
export interface HrAccess {
  admin: boolean;
  viewer: boolean;
  supervisor: boolean;
  self: boolean;
  basics: boolean;
  work: boolean;
  drafts: boolean;
  emergency: boolean;
  equipment: boolean;
  otherFiles: boolean;
  /** Employment fields: supervisor, team, location, job profile. */
  editEmployment: boolean;
  /** Phone, emergency contact, sizes, preferred language. */
  editPersonal: boolean;
  /** Supervisor assessments, orientations, permits, verification. */
  supervise: boolean;
}

export function hrAccess(ctx: RequestContext, rel: { self: boolean; supervisor: boolean }): HrAccess {
  const internal = !ctx.external;
  const admin = internal && hasPermission(ctx, "hr.manage");
  const viewer = internal && (admin || hasPermission(ctx, "hr.view"));
  const self = internal && rel.self;
  const supervisor = internal && rel.supervisor && !rel.self;
  const employeeView = internal && hasPermission(ctx, "employee.view");
  return {
    admin,
    viewer,
    supervisor,
    self,
    basics: employeeView || viewer || supervisor || self,
    work: viewer || supervisor || self,
    drafts: admin || supervisor,
    emergency: admin || supervisor || self,
    equipment: admin || self,
    otherFiles: admin || self,
    editEmployment: admin || (internal && hasPermission(ctx, "employee.manage")),
    editPersonal: admin || self,
    supervise: admin || supervisor,
  };
}

/** Company-wide HR lists (matrix, cards, overview): admin and viewer see everyone. */
export function companyWideHr(ctx: RequestContext): boolean {
  return !ctx.external && (hasPermission(ctx, "hr.manage") || hasPermission(ctx, "hr.view"));
}
