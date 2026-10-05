import { ForbiddenError, NotFoundError } from "@/platform/errors";
import { canAccessProject, projectIdsWithPermission, projectPermissions, type PermissionKey, type RequestContext } from "@/platform/authz";

/**
 * HSE visibility is project-scoped. A member sees a project's HSE register
 * with `hse.view`; a member who may only report (`hse.create` without
 * `hse.view`, e.g. a subcontractor) sees their own reports and permits only.
 * Not visible → 404, missing capability → 403.
 */
export function hseCan(ctx: RequestContext, projectId: string) {
  const p = projectPermissions(ctx, projectId);
  const view = p.has("hse.view");
  return {
    visible: canAccessProject(ctx, projectId) && (view || p.has("hse.create")),
    view,
    ownOnly: !view,
    create: p.has("hse.create"),
    manage: view && p.has("hse.manage"),
    investigate: view && p.has("hse.investigate"),
    approveActions: view && p.has("hse.action.approve"),
    personal: view && p.has("hse.personal.view") && !ctx.external,
    permitApprove: view && p.has("permit.approve"),
    notify: view && p.has("hse.serious.notify"),
  };
}

export type HseCan = ReturnType<typeof hseCan>;

export function requireHseVisible(ctx: RequestContext, projectId: string): HseCan {
  const can = hseCan(ctx, projectId);
  if (!can.visible) throw new NotFoundError();
  return can;
}

export function requireHse(ctx: RequestContext, projectId: string, permission: PermissionKey): HseCan {
  const can = requireHseVisible(ctx, projectId);
  const p = projectPermissions(ctx, projectId);
  // Anything beyond reporting requires the register view as well.
  if (permission !== "hse.create" && !can.view) throw new ForbiddenError(`Missing permission hse.view`);
  if (!p.has(permission)) throw new ForbiddenError(`Missing permission ${permission}`);
  return can;
}

/** Own-only members never learn about other people's records (404). */
export function requireRecordVisible(ctx: RequestContext, record: { projectId: string; createdById: string | null }): HseCan {
  const can = requireHseVisible(ctx, record.projectId);
  if (can.ownOnly && record.createdById !== ctx.user.id) throw new NotFoundError();
  return can;
}

/** Projects where the member can use HSE at all (view or report). */
export function hseProjectIds(ctx: RequestContext): string[] | undefined {
  const view = projectIdsWithPermission(ctx, "hse.view");
  const create = projectIdsWithPermission(ctx, "hse.create");
  if (view === undefined || create === undefined) return undefined;
  return [...new Set([...view, ...create])];
}
