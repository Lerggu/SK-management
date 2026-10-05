import type { RequestContext } from "@/platform/authz";

export type NavKey = "dashboard" | "projects" | "time" | "takt" | "logistics" | "workforce" | "equipment" | "documents" | "settings";

export interface NavItem {
  key: NavKey;
  href: string;
}

/** Navigation filtered by capability. */
export function navItems(ctx: RequestContext): NavItem[] {
  const base = `/c/${ctx.company.slug}`;
  const has = (p: Parameters<RequestContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const anyProjectGrant = ctx.projectGrants.size > 0;
  const items: NavItem[] = [{ key: "dashboard", href: `${base}/dashboard` }];
  if (has("project.view") || anyProjectGrant) items.push({ key: "projects", href: `${base}/projects` });
  if (hasTimeAccess(ctx)) items.push({ key: "time", href: `${base}/time` });
  if (hasTaktAccess(ctx)) items.push({ key: "takt", href: `${base}/takt` });
  if (hasLogisticsAccess(ctx)) items.push({ key: "logistics", href: `${base}/logistics` });
  if (has("employee.view")) items.push({ key: "workforce", href: `${base}/workforce` });
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
