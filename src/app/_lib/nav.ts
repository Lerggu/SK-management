import type { RequestContext } from "@/platform/authz";

export type NavKey = "dashboard" | "portal" | "projects" | "time" | "takt" | "logistics" | "lifting" | "materials" | "hse" | "sales" | "billing" | "workforce" | "myCard" | "equipment" | "documents" | "settings";

export interface NavItem {
  key: NavKey;
  href: string;
}

/**
 * V7: external members (Client, Subcontractor) use the portal only. Internal
 * pages redirect them there (company layout); services still enforce access.
 */
export const EXTERNAL_PATHS = ["portal", "hse", "documents"] as const;

export function externalPathAllowed(ctx: RequestContext, pathname: string | null): boolean {
  if (!ctx.external) return true;
  const rest = (pathname ?? "").split("/").slice(3);
  return rest.length > 0 && (EXTERNAL_PATHS as readonly string[]).includes(rest[0]);
}

/**
 * Navigation filtered by capability. `myEmployeeId` (HR, ADR 0025) adds the
 * own personnel card for users whose account is linked to an employee.
 */
export function navItems(ctx: RequestContext, opts: { myEmployeeId?: string | null } = {}): NavItem[] {
  const base = `/c/${ctx.company.slug}`;
  if (ctx.external) return [{ key: "portal", href: `${base}/portal` }];
  const has = (p: Parameters<RequestContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const anyProjectGrant = ctx.projectGrants.size > 0;
  const items: NavItem[] = [{ key: "dashboard", href: `${base}/dashboard` }];
  if (has("project.view") || anyProjectGrant) items.push({ key: "projects", href: `${base}/projects` });
  if (hasTimeAccess(ctx)) items.push({ key: "time", href: `${base}/time` });
  if (hasTaktAccess(ctx)) items.push({ key: "takt", href: `${base}/takt` });
  if (hasLogisticsAccess(ctx)) items.push({ key: "logistics", href: `${base}/logistics` });
  if (hasLogisticsAccess(ctx)) items.push({ key: "lifting", href: `${base}/lifting` });
  if (hasMaterialAccess(ctx)) items.push({ key: "materials", href: `${base}/materials` });
  if (hasHseAccess(ctx)) items.push({ key: "hse", href: `${base}/hse` });
  if (has("crm.view")) items.push({ key: "sales", href: `${base}/sales` });
  if (has("invoice.manage") || [...ctx.projectGrants.values()].some((g) => g.has("invoice.manage"))) items.push({ key: "billing", href: `${base}/billing` });
  if (has("employee.view")) items.push({ key: "workforce", href: `${base}/workforce` });
  if (opts.myEmployeeId) items.push({ key: "myCard", href: `${base}/workforce/${opts.myEmployeeId}` });
  if (has("equipment.view")) items.push({ key: "equipment", href: `${base}/equipment` });
  if (has("documents.view") || anyProjectGrant) items.push({ key: "documents", href: `${base}/documents` });
  if (has("company.manage") || has("company.members.manage") || has("company.roles.manage") || has("audit.view")) {
    items.push({ key: "settings", href: `${base}/settings` });
  }
  return items;
}

/** Any time-tracking capability, company-wide or through a project role. */
export function hasTimeAccess(ctx: RequestContext): boolean {
  const keys = ["timesheet.submit", "timesheet.manage", "timesheet.approve", "timesheet.export"] as const;
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
