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

  /**
   * "Odottaa päätöstäsi": items waiting for a decision the user is allowed to
   * make, newest first. Each kind is gated by its approval permission and the
   * user's project scope; own proposals are left out where self-approval is
   * blocked (takt baselines, lift plans, permits).
   */
  async decisions(ctx: RequestContext): Promise<DecisionItem[]> {
    if (ctx.external) return [];
    const db = readClient();
    const companyId = ctx.company.id;
    const me = ctx.user.id;
    const scope = (perm: Parameters<typeof projectIdsWithPermission>[1]) => {
      const ids = projectIdsWithPermission(ctx, perm);
      if (ids === undefined) return {};
      return ids.length ? { projectId: { in: ids } } : null;
    };
    const take = 5;
    const out: DecisionItem[] = [];
    const jobs: Promise<void>[] = [];

    if (hasPermission(ctx, "commercial.approve")) {
      jobs.push(
        db.quoteVersion
          .findMany({ where: { companyId, status: "SUBMITTED", quote: { archivedAt: null } }, orderBy: { updatedAt: "desc" }, take, select: { id: true, updatedAt: true, quote: { select: { id: true, quoteNumber: true, title: true } } } })
          .then((rows) => {
            for (const r of rows) out.push({ kind: "quote", id: r.id, title: `${r.quote.quoteNumber} · ${r.quote.title}`, path: `sales/quotes/${r.quote.id}`, at: r.updatedAt });
          }),
      );
    }
    const variationScope = scope("commercial.approve");
    if (variationScope) {
      jobs.push(
        db.variation
          .findMany({ where: { companyId, status: "INTERNAL_REVIEW", ...variationScope }, orderBy: { updatedAt: "desc" }, take, select: { id: true, projectId: true, number: true, title: true, updatedAt: true } })
          .then((rows) => {
            for (const r of rows) out.push({ kind: "variation", id: r.id, title: `#${r.number} · ${r.title}`, path: `projects/${r.projectId}/commercial/variations/${r.id}`, at: r.updatedAt });
          }),
      );
    }
    const taktScope = scope("takt.baseline.approve");
    if (taktScope) {
      jobs.push(
        db.taktPlanVersion
          .findMany({
            where: { companyId, status: "PROPOSED", OR: [{ proposedById: null }, { proposedById: { not: me } }], plan: { archivedAt: null, ...taktScope } },
            orderBy: { updatedAt: "desc" },
            take,
            select: { id: true, versionNumber: true, updatedAt: true, plan: { select: { id: true, name: true } } },
          })
          .then((rows) => {
            for (const r of rows) out.push({ kind: "takt", id: r.id, title: `${r.plan.name} · v${r.versionNumber}`, path: `takt/${r.plan.id}`, at: r.updatedAt });
          }),
      );
    }
    const liftScope = scope("lift.plan.approve");
    if (liftScope) {
      jobs.push(
        db.liftPlanVersion
          .findMany({
            where: { companyId, status: "SUBMITTED", OR: [{ submittedById: null }, { submittedById: { not: me } }], plan: { status: "OPEN", ...liftScope } },
            orderBy: { updatedAt: "desc" },
            take,
            select: { id: true, versionNumber: true, updatedAt: true, plan: { select: { id: true, title: true } } },
          })
          .then((rows) => {
            for (const r of rows) out.push({ kind: "lift", id: r.id, title: `${r.plan.title} · v${r.versionNumber}`, path: `lifting/${r.plan.id}`, at: r.updatedAt });
          }),
      );
    }
    const permitScope = scope("permit.approve");
    if (permitScope) {
      jobs.push(
        db.workPermit
          .findMany({ where: { companyId, status: "REQUESTED", OR: [{ createdById: null }, { createdById: { not: me } }], ...permitScope }, orderBy: { updatedAt: "desc" }, take, select: { id: true, number: true, description: true, updatedAt: true } })
          .then((rows) => {
            for (const r of rows) out.push({ kind: "permit", id: r.id, title: `#${r.number} · ${r.description}`, path: `hse/permits/${r.id}`, at: r.updatedAt });
          }),
      );
    }
    const logisticsScope = scope("logistics.approve");
    if (logisticsScope) {
      jobs.push(
        db.logisticsRequest
          .findMany({ where: { companyId, status: { in: ["REQUESTED", "REVIEW"] }, ...logisticsScope }, orderBy: { updatedAt: "desc" }, take, select: { id: true, title: true, updatedAt: true } })
          .then((rows) => {
            for (const r of rows) out.push({ kind: "logistics", id: r.id, title: r.title, path: `logistics/requests/${r.id}`, at: r.updatedAt });
          }),
      );
    }
    await Promise.all(jobs);
    return out.sort((a, b) => b.at.getTime() - a.at.getTime());
  },
};

export interface DecisionItem {
  kind: "quote" | "variation" | "takt" | "lift" | "permit" | "logistics";
  id: string;
  title: string;
  /** Path below `/c/<slug>/`. */
  path: string;
  at: Date;
}
