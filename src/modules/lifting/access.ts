import { ForbiddenError, NotFoundError } from "@/platform/errors";
import { canAccessProject, projectIdsWithPermission, projectPermissions, type PermissionKey, type RequestContext } from "@/platform/authz";

/** Lift plans are visible with logistics.view: not visible → 404, no capability → 403. */
export function requireLift(ctx: RequestContext, projectId: string, permission: PermissionKey) {
  if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
  const perms = projectPermissions(ctx, projectId);
  if (!perms.has("logistics.view")) throw new NotFoundError();
  if (!perms.has(permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

/** Material batches and cable drums are visible with material.view. */
export function requireMaterial(ctx: RequestContext, projectId: string, permission: PermissionKey) {
  if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
  const perms = projectPermissions(ctx, projectId);
  if (!perms.has("material.view")) throw new NotFoundError();
  if (!perms.has(permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

/** Whether the member holds the permission in at least one project (or company-wide). */
export function holdsAnywhere(ctx: RequestContext, permission: PermissionKey): boolean {
  const ids = projectIdsWithPermission(ctx, permission);
  return ids === undefined || ids.length > 0;
}

/**
 * The lifting accessory register is company-wide (like equipment): visible to
 * anyone who plans lifts somewhere, managed by lift.plan.manage holders.
 */
export function requireAccessoryRegister(ctx: RequestContext, manage = false) {
  if (manage) {
    if (!holdsAnywhere(ctx, "lift.plan.manage")) throw new ForbiddenError("Missing permission lift.plan.manage");
    return;
  }
  if (!holdsAnywhere(ctx, "lift.request") && !holdsAnywhere(ctx, "lift.plan.manage") && !holdsAnywhere(ctx, "lift.plan.approve")) throw new ForbiddenError("Missing permission lift.request");
}

export function liftPermissions(ctx: RequestContext, projectId: string) {
  const p = projectPermissions(ctx, projectId);
  return { view: p.has("logistics.view"), request: p.has("lift.request"), manage: p.has("lift.plan.manage"), approve: p.has("lift.plan.approve"), book: p.has("booking.manage") };
}

export function materialPermissions(ctx: RequestContext, projectId: string) {
  const p = projectPermissions(ctx, projectId);
  return { view: p.has("material.view"), manage: p.has("material.manage") };
}

export const visibleLiftProjects = (ctx: RequestContext) => projectIdsWithPermission(ctx, "logistics.view");
export const visibleMaterialProjects = (ctx: RequestContext) => projectIdsWithPermission(ctx, "material.view");
