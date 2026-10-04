import { ForbiddenError, NotFoundError } from "@/platform/errors";
import type { RequestContext } from "./context";
import type { PermissionKey } from "./permissions";

/** Company-level permission check. */
export function hasPermission(ctx: RequestContext, permission: PermissionKey): boolean {
  return ctx.permissions.has(permission);
}

export function requirePermission(ctx: RequestContext, permission: PermissionKey): void {
  if (!hasPermission(ctx, permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

/** Whether the project is visible to the member at all (ALL access or assignment). */
export function canAccessProject(ctx: RequestContext, projectId: string): boolean {
  return ctx.projectAccess === "ALL" || ctx.projectGrants.has(projectId);
}

/** Effective permissions within a project = company roles ∪ project role. */
export function projectPermissions(ctx: RequestContext, projectId: string): ReadonlySet<PermissionKey> {
  if (!canAccessProject(ctx, projectId)) return new Set();
  const grant = ctx.projectGrants.get(projectId);
  if (!grant || grant.size === 0) return ctx.permissions;
  return new Set([...ctx.permissions, ...grant]);
}

export function hasProjectPermission(ctx: RequestContext, projectId: string, permission: PermissionKey): boolean {
  return projectPermissions(ctx, projectId).has(permission);
}

/**
 * Project-scoped check. A project the member cannot access is reported as
 * 404 (it does not exist for them); a visible project without the required
 * capability is 403.
 */
export function requireProjectPermission(ctx: RequestContext, projectId: string, permission: PermissionKey): void {
  if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
  const perms = projectPermissions(ctx, projectId);
  if (!perms.has("project.view") && !perms.has(permission)) throw new NotFoundError();
  if (!perms.has(permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

/** Projects in which the member holds `permission` (undefined = all projects). */
export function projectIdsWithPermission(ctx: RequestContext, permission: PermissionKey): string[] | undefined {
  if (ctx.projectAccess === "ALL" && ctx.permissions.has(permission)) return undefined;
  const ids: string[] = [];
  for (const [projectId, grant] of ctx.projectGrants) {
    if (ctx.permissions.has(permission) || grant.has(permission)) ids.push(projectId);
  }
  return ids;
}
