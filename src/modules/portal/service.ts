import { readClient } from "@/platform/db";
import { NotFoundError } from "@/platform/errors";
import { canAccessProject, projectIdsWithPermission, projectPermissions, type RequestContext } from "@/platform/authz";

/**
 * V7 portals (Build Master §41): the entry point for external members.
 * Each portal page composes services that enforce their own permissions;
 * this service decides which projects and sections a member gets.
 */
function sections(ctx: RequestContext, projectId: string) {
  const p = projectPermissions(ctx, projectId);
  return {
    client: p.has("portal.client"),
    subcontractor: p.has("portal.subcontractor"),
    approveVariations: p.has("portal.client") && p.has("variation.client_approve"),
    reportHse: p.has("hse.create"),
    documents: p.has("documents.view"),
  };
}

export const portalService = {
  /** Projects in which the member has a portal. */
  async projects(ctx: RequestContext) {
    const client = projectIdsWithPermission(ctx, "portal.client");
    const sub = projectIdsWithPermission(ctx, "portal.subcontractor");
    const ids = client === undefined || sub === undefined ? undefined : [...new Set([...client, ...sub])];
    if (ids && ids.length === 0) return [];
    const rows = await readClient().project.findMany({
      where: { companyId: ctx.company.id, archivedAt: null, ...(ids ? { id: { in: ids } } : {}) },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, status: true, startDate: true, endDate: true },
    });
    return rows.map((p) => ({ ...p, sections: sections(ctx, p.id) })).filter((p) => p.sections.client || p.sections.subcontractor);
  },

  /** Project header and the sections the member may use. */
  async project(ctx: RequestContext, projectId: string) {
    if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
    const s = sections(ctx, projectId);
    if (!s.client && !s.subcontractor) throw new NotFoundError();
    const project = await readClient().project.findFirst({
      where: { id: projectId, companyId: ctx.company.id, archivedAt: null },
      select: { id: true, code: true, name: true, status: true, startDate: true, endDate: true, sites: { where: { archivedAt: null }, select: { id: true, name: true, city: true }, orderBy: { name: "asc" } } },
    });
    if (!project) throw new NotFoundError();
    return { ...project, sections: s };
  },
};
