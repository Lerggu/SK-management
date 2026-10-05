import { ForbiddenError, NotFoundError } from "@/platform/errors";
import { canAccessProject, hasPermission, projectIdsWithPermission, projectPermissions, type PermissionKey, type RequestContext } from "@/platform/authz";

/** CRM and quotes are company-level registers (403 without the capability). */
export function requireCompanyPermission(ctx: RequestContext, permission: PermissionKey) {
  if (!hasPermission(ctx, permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

/**
 * Project commercial data (contracts, variations, invoicing, forecast) is
 * sensitive and project-scoped: not visible → 404, no capability → 403.
 */
export function requireProjectCommercial(ctx: RequestContext, projectId: string, permission: PermissionKey) {
  if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
  const perms = projectPermissions(ctx, projectId);
  if (!perms.has("project.view") && !perms.has("commercial.view")) throw new NotFoundError();
  if (!perms.has("commercial.view") || !perms.has(permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

export function commercialPermissions(ctx: RequestContext, projectId?: string) {
  const p = projectId ? projectPermissions(ctx, projectId) : ctx.permissions;
  return {
    crmView: ctx.permissions.has("crm.view"),
    crmManage: ctx.permissions.has("crm.manage"),
    view: p.has("commercial.view"),
    manage: p.has("commercial.manage"),
    approve: p.has("commercial.approve"),
    invoice: p.has("invoice.manage"),
  };
}

export const projectsWith = (ctx: RequestContext, permission: PermissionKey) => projectIdsWithPermission(ctx, permission);
