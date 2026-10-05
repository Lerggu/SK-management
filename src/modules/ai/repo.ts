import type { Prisma, Tx } from "@/platform/db";

/** Company-scoped data access for the AI project controller. */
export class AiRepo {
  constructor(
    private readonly db: Tx,
    private readonly companyId: string,
  ) {}

  findProject(projectId: string) {
    return this.db.project.findFirst({ where: { id: projectId, companyId: this.companyId, archivedAt: null }, select: { id: true, code: true, name: true } });
  }

  findCompanyBudget() {
    return this.db.company.findFirst({ where: { id: this.companyId }, select: { aiMonthlyBudgetEur: true } });
  }

  setCompanyBudget(value: Prisma.Decimal | number, userId: string) {
    return this.db.company.update({ where: { id: this.companyId }, data: { aiMonthlyBudgetEur: value, updatedById: userId } });
  }

  async costSince(from: Date) {
    const r = await this.db.aiRun.aggregate({ where: { companyId: this.companyId, createdAt: { gte: from } }, _sum: { costEur: true } });
    return r._sum.costEur;
  }

  siteCount(projectId: string) {
    return this.db.site.count({ where: { companyId: this.companyId, projectId, archivedAt: null } });
  }

  problemActivities(projectId: string) {
    return this.db.taktActivity.findMany({
      where: { companyId: this.companyId, projectId, archivedAt: null, execution: { not: "COMPLETE" }, OR: [{ blocked: true }, { delayReason: { not: null } }] },
      select: { name: true, crewTrade: true, execution: true, progressPct: true, blocked: true, delayReason: true, recoveryAction: true, taktArea: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: 30,
    });
  }

  openConstraints(projectId: string) {
    return this.db.activityConstraint.findMany({
      where: { companyId: this.companyId, status: "OPEN", activity: { projectId, archivedAt: null } },
      select: { type: true, description: true, dueDate: true, activity: { select: { name: true } } },
      orderBy: [{ dueDate: "asc" }],
      take: 30,
    });
  }

  listRuns(projectId: string, take = 10) {
    return this.db.aiRun.findMany({ where: { companyId: this.companyId, projectId }, orderBy: { createdAt: "desc" }, take });
  }

  listRecommendations(projectId: string) {
    return this.db.aiRecommendation.findMany({ where: { companyId: this.companyId, projectId }, orderBy: [{ createdAt: "desc" }, { position: "asc" }], take: 50 });
  }

  findRecommendation(id: string) {
    return this.db.aiRecommendation.findFirst({ where: { id, companyId: this.companyId } });
  }

  createRun(data: Omit<Prisma.AiRunUncheckedCreateInput, "companyId">) {
    return this.db.aiRun.create({ data: { ...data, companyId: this.companyId } });
  }

  createRecommendations(rows: Omit<Prisma.AiRecommendationCreateManyInput, "companyId">[]) {
    return this.db.aiRecommendation.createMany({ data: rows.map((r) => ({ ...r, companyId: this.companyId })) });
  }

  /** Decides a recommendation once; 0 when it was already decided. */
  async decide(id: string, data: { status: "ACCEPTED" | "DISMISSED"; decidedById: string; decisionNote: string | null }) {
    const r = await this.db.aiRecommendation.updateMany({ where: { id, companyId: this.companyId, status: "PROPOSED" }, data: { ...data, decidedAt: new Date() } });
    return r.count;
  }
}
