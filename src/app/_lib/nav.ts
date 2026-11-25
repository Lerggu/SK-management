import type { RequestContext } from "@/platform/authz";

export type NavKey =
  | "dashboard"
  | "portal"
  | "projects"
  | "time"
  | "documents"
  | "takt"
  | "logistics"
  | "lifting"
  | "materials"
  | "hse"
  | "workforce"
  | "myCard"
  | "teams"
  | "rotation"
  | "matrix"
  | "qualifications"
  | "hrOverview"
  | "hrSettings"
  | "equipment"
  | "sales"
  | "quotes"
  | "marketing"
  | "invoicing"
  | "billing"
  | "settings";

export type NavGroupKey = "home" | "projectsGroup" | "productionGroup" | "hseGroup" | "peopleGroup" | "equipmentGroup" | "salesGroup" | "settingsGroup" | "portalGroup";

export interface NavItem {
  key: NavKey;
  href: string;
  /** Other path prefixes that belong to this item. */
  match?: string[];
}

/** A top-level menu entry; with one visible item it is shown as a plain link. */
export interface NavGroup {
  key: NavGroupKey;
  items: NavItem[];
}

/**
 * V7: external members (Client, Subcontractor) use the portal only. Internal
 * pages redirect them there (company layout); services still enforce access.
 */
export const EXTERNAL_PATHS = ["portal", "hse", "documents"] as const;

/** True when `/c/<slug>/<section>/…` is a section external members may use. */
export function isExternalPath(pathname: string | null): boolean {
  const rest = (pathname ?? "").split("/").slice(3);
  return rest.length > 0 && (EXTERNAL_PATHS as readonly string[]).includes(rest[0]);
}

/**
 * Navigation grouped by area and filtered by capability: related pages sit
 * under one heading (e.g. everything about people under "Henkilöstö").
 * `myEmployeeId` (HR, ADR 0025) adds the own personnel card for users whose
 * account is linked to an employee. Services still enforce access.
 */
export function navGroups(ctx: RequestContext, opts: { myEmployeeId?: string | null } = {}): NavGroup[] {
  const base = `/c/${ctx.company.slug}`;
  if (ctx.external) {
    // One project: open it directly instead of going through the redirecting portal list.
    const projects = [...ctx.projectGrants.keys()];
    const href = projects.length === 1 ? `${base}/portal/${projects[0]}` : `${base}/portal`;
    return [{ key: "portalGroup", items: [{ key: "portal", href, match: [`${base}/portal`, `${base}/hse`, `${base}/documents`] }] }];
  }
  const has = (p: Parameters<RequestContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const grants = [...ctx.projectGrants.values()];
  const anyProjectGrant = grants.length > 0;
  const groups: NavGroup[] = [];
  const add = (key: NavGroupKey, items: (NavItem | false)[]) => {
    const visible = items.filter((i): i is NavItem => !!i);
    if (visible.length) groups.push({ key, items: visible });
  };

  add("home", [{ key: "dashboard", href: `${base}/dashboard` }]);
  add("projectsGroup", [
    (has("project.view") || anyProjectGrant) && { key: "projects", href: `${base}/projects`, match: [`${base}/diary`] },
    hasTimeAccess(ctx) && { key: "time", href: `${base}/time` },
    (has("documents.view") || anyProjectGrant) && { key: "documents", href: `${base}/documents` },
  ]);
  // Production control ("Tuotannonohjaus"): takt, logistics, lifting and materials.
  const logistics = hasLogisticsAccess(ctx);
  add("productionGroup", [
    hasTaktAccess(ctx) && { key: "takt", href: `${base}/takt` },
    logistics && { key: "logistics", href: `${base}/logistics` },
    logistics && { key: "lifting", href: `${base}/lifting` },
    hasMaterialAccess(ctx) && { key: "materials", href: `${base}/materials`, match: [`${base}/scan`] },
  ]);
  add("hseGroup", [hasHseAccess(ctx) && { key: "hse", href: `${base}/hse` }]);
  // People: the same visibility as the workforce tabs (workforce/_components/hr/access.ts).
  const hrCompanyWide = has("hr.view") || has("hr.manage");
  const hrLists = hrCompanyWide || !!opts.myEmployeeId;
  const w = `${base}/workforce`;
  add("peopleGroup", [
    has("employee.view") && { key: "workforce", href: w },
    !!opts.myEmployeeId && { key: "myCard", href: `${w}/${opts.myEmployeeId}` },
    (has("employee.view") || has("hr.view")) && { key: "teams", href: `${w}/teams` },
    (has("rotation.view") || has("rotation.manage")) && { key: "rotation", href: `${w}/rotation` },
    hrLists && { key: "matrix", href: `${w}/matrix` },
    hrLists && { key: "qualifications", href: `${w}/qualifications` },
    hrLists && { key: "hrOverview", href: `${w}/overview` },
    has("hr.manage") && { key: "hrSettings", href: `${w}/settings` },
  ]);
  add("equipmentGroup", [has("equipment.view") && { key: "equipment", href: `${base}/equipment` }]);
  add("salesGroup", [
    has("crm.view") && { key: "sales", href: `${base}/sales` },
    has("crm.view") && has("commercial.view") && { key: "quotes", href: `${base}/sales/quotes` },
    has("marketing.view") && { key: "marketing", href: `${base}/marketing` },
    // Order confirmations and invoices (ADR 0033): company-wide invoicing.
    has("invoice.manage") && { key: "invoicing", href: `${base}/invoicing` },
    (has("invoice.manage") || grants.some((g) => g.has("invoice.manage"))) && { key: "billing", href: `${base}/billing` },
  ]);
  add("settingsGroup", [
    (has("company.manage") || has("company.members.manage") || has("company.roles.manage") || has("audit.view")) && { key: "settings", href: `${base}/settings` },
  ]);
  return groups;
}

export type MobilePick = { item: NavKey } | { group: NavGroupKey };

/**
 * Phone bottom bar by role (role journeys 2026-11-26): the page a role uses
 * most comes first. Decided by capabilities, never by role names; the shell
 * fills the remaining slots in its default order.
 */
export function mobilePrimary(ctx: RequestContext): MobilePick[] {
  if (ctx.external) return [];
  const has = (p: Parameters<RequestContext["permissions"]["has"]>[0]) => ctx.permissions.has(p) || [...ctx.projectGrants.values()].some((g) => g.has(p));
  const picks: MobilePick[] = [{ item: "dashboard" }];
  // Lifting supervisor: lift plans, not takt.
  if (has("lift.plan.approve") && !has("takt.manage")) picks.push({ item: "lifting" });
  // Logistics coordinator: the logistics board, not takt.
  if (has("logistics.approve") && !has("takt.manage")) picks.push({ item: "logistics" });
  // HSE specialist: the HSE register before projects and hours.
  if (has("hse.investigate") && !has("project.manage")) picks.push({ group: "hseGroup" });
  // Worker without crew or logistics duties: hours, safety reporting and the own card.
  if (!has("timesheet.manage") && !has("logistics.request") && !has("takt.manage")) picks.push({ item: "time" }, { group: "hseGroup" }, { item: "myCard" });
  return picks;
}

/** Any time-tracking capability, company-wide or through a project role. */
export function hasTimeAccess(ctx: RequestContext): boolean {
  const keys = ["timesheet.submit", "timesheet.manage", "timesheet.approve", "timesheet.export"] as const;
  if (keys.some((k) => ctx.permissions.has(k))) return true;
  return [...ctx.projectGrants.values()].some((g) => keys.some((k) => g.has(k)));
}

/** Entering, managing or approving hours (anything beyond the payroll export). */
export function hasTimeEntryAccess(ctx: RequestContext): boolean {
  const keys = ["timesheet.submit", "timesheet.manage", "timesheet.approve"] as const;
  if (keys.some((k) => ctx.permissions.has(k))) return true;
  return [...ctx.projectGrants.values()].some((g) => keys.some((k) => g.has(k)));
}

/** Takt visibility, company-wide or through a project role. */
export function hasTaktAccess(ctx: RequestContext): boolean {
  return ctx.permissions.has("takt.view") || [...ctx.projectGrants.values()].some((g) => g.has("takt.view"));
}

/** Logistics visibility, company-wide or through a project role. */
export function hasLogisticsAccess(ctx: RequestContext): boolean {
  return ctx.permissions.has("logistics.view") || [...ctx.projectGrants.values()].some((g) => g.has("logistics.view"));
}

/** Material and cable drum visibility, company-wide or through a project role. */
export function hasMaterialAccess(ctx: RequestContext): boolean {
  return ctx.permissions.has("material.view") || [...ctx.projectGrants.values()].some((g) => g.has("material.view"));
}

/** HSE register or reporting, company-wide or through a project role. */
export function hasHseAccess(ctx: RequestContext): boolean {
  const keys = ["hse.view", "hse.create"] as const;
  if (keys.some((k) => ctx.permissions.has(k))) return true;
  return [...ctx.projectGrants.values()].some((g) => keys.some((k) => g.has(k)));
}
