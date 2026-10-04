import { readClient } from "@/platform/db";
import { hasPermission, projectIdsWithPermission, type RequestContext } from "@/platform/authz";

const DAY_MS = 86_400_000;

/** Dashboard shell figures, each gated by the matching permission. */
export const dashboardService = {
  async summary(ctx: RequestContext) {
    const db = readClient();
    const companyId = ctx.company.id;
    const projectIds = projectIdsWithPermission(ctx, "project.view");
    const projectScope = projectIds ? { id: { in: projectIds } } : {};
    const soon = new Date(Date.now() + 30 * DAY_MS);

    const [projects, sites, employees, equipment, inspectionsDue, pendingApprovals, recentAudit] = await Promise.all([
      db.project.count({ where: { companyId, archivedAt: null, ...projectScope } }),
      db.site.count({ where: { companyId, archivedAt: null, ...(projectIds ? { projectId: { in: projectIds } } : {}) } }),
      hasPermission(ctx, "employee.view") ? db.employee.count({ where: { companyId, archivedAt: null } }) : Promise.resolve(null),
      hasPermission(ctx, "equipment.view") ? db.equipment.count({ where: { companyId, archivedAt: null } }) : Promise.resolve(null),
      hasPermission(ctx, "equipment.view")
        ? db.equipment.findMany({
            where: { companyId, archivedAt: null, nextInspectionDate: { lte: soon } },
            orderBy: { nextInspectionDate: "asc" },
            take: 5,
            select: { id: true, assetNumber: true, name: true, nextInspectionDate: true },
          })
        : Promise.resolve(null),
      (() => {
        const docProjects = projectIdsWithPermission(ctx, "documents.approve");
        const companyLevel = hasPermission(ctx, "documents.approve") && !ctx.external;
        if (!companyLevel && docProjects && docProjects.length === 0) return Promise.resolve(null);
        return db.documentVersion.count({
          where: {
            companyId,
            status: "CURRENT",
            approvalState: "PENDING_APPROVAL",
            document: {
              archivedAt: null,
              OR: [...(companyLevel ? [{ projectId: null }] : []), docProjects ? { projectId: { in: docProjects } } : { projectId: { not: null } }],
            },
          },
        });
      })(),
      hasPermission(ctx, "audit.view")
        ? db.auditEvent.findMany({ where: { companyId }, orderBy: { occurredAt: "desc" }, take: 8 })
        : Promise.resolve(null),
    ]);

    return { projects, sites, employees, equipment, inspectionsDue, pendingApprovals, recentAudit };
  },
};
