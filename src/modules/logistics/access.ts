import { ForbiddenError, NotFoundError } from "@/platform/errors";
import { canAccessProject, projectIdsWithPermission, projectPermissions, type PermissionKey, type RequestContext } from "@/platform/authz";

/** Logistics visibility is project-scoped: not visible → 404, no capability → 403. */
export function requireLogistics(ctx: RequestContext, projectId: string, permission: PermissionKey) {
  if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
  const perms = projectPermissions(ctx, projectId);
  if (!perms.has("logistics.view")) throw new NotFoundError();
  if (!perms.has(permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

export function logisticsPermissions(ctx: RequestContext, projectId: string) {
  const p = projectPermissions(ctx, projectId);
  return {
    view: p.has("logistics.view"),
    request: p.has("logistics.request"),
    approve: p.has("logistics.approve"),
    book: p.has("booking.manage"),
    deliver: p.has("delivery.manage"),
  };
}

export function visibleLogisticsProjects(ctx: RequestContext): string[] | undefined {
  return projectIdsWithPermission(ctx, "logistics.view");
}
