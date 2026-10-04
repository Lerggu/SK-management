import type { RequestContext } from "@/platform/authz";

export type NavKey = "dashboard" | "projects" | "workforce" | "equipment" | "documents" | "settings";

export interface NavItem {
  key: NavKey;
  href: string;
}

/** Navigation filtered by capability (V1 modules only). */
export function navItems(ctx: RequestContext): NavItem[] {
  const base = `/c/${ctx.company.slug}`;
  const has = (p: Parameters<RequestContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const anyProjectGrant = ctx.projectGrants.size > 0;
  const items: NavItem[] = [{ key: "dashboard", href: `${base}/dashboard` }];
  if (has("project.view") || anyProjectGrant) items.push({ key: "projects", href: `${base}/projects` });
  if (has("employee.view")) items.push({ key: "workforce", href: `${base}/workforce` });
  if (has("equipment.view")) items.push({ key: "equipment", href: `${base}/equipment` });
  if (has("documents.view") || anyProjectGrant) items.push({ key: "documents", href: `${base}/documents` });
  if (has("company.manage") || has("company.members.manage") || has("company.roles.manage") || has("audit.view")) {
    items.push({ key: "settings", href: `${base}/settings` });
  }
  return items;
}
