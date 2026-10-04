import type { Prisma, Tx } from "@/platform/db";

/** Company-scoped finance repository (budgets, costs and cost sources). */
export class FinanceRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, companyId: this.companyId } });
  }

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, companyId: this.companyId } });
  }

  listBudgets(projectId: string) {
    return this.tx.budget.findMany({
      where: { companyId: this.companyId, projectId },
      orderBy: { versionNumber: "desc" },
      include: { lines: { orderBy: [{ category: "asc" }, { createdAt: "asc" }] } },
    });
  }

  findBudget(id: string) {
    return this.tx.budget.findFirst({ where: { id, companyId: this.companyId }, include: { lines: true } });
  }

  activeBudget(projectId: string) {
    return this.tx.budget.findFirst({ where: { companyId: this.companyId, projectId, status: "ACTIVE" }, include: { lines: true } });
  }

  createBudget(data: Omit<Prisma.BudgetUncheckedCreateInput, "companyId">) {
    return this.tx.budget.create({ data: { ...data, companyId: this.companyId } });
  }

  updateBudget(id: string, data: Prisma.BudgetUncheckedUpdateInput) {
    return this.tx.budget.update({ where: { id, companyId: this.companyId }, data });
  }

  deleteBudget(id: string) {
    return this.tx.budget.delete({ where: { id, companyId: this.companyId } });
  }

  createLine(data: Omit<Prisma.BudgetLineUncheckedCreateInput, "companyId">) {
    return this.tx.budgetLine.create({ data: { ...data, companyId: this.companyId } });
  }

  findLine(id: string) {
    return this.tx.budgetLine.findFirst({ where: { id, companyId: this.companyId } });
  }

  updateLine(id: string, data: Prisma.BudgetLineUncheckedUpdateInput) {
    return this.tx.budgetLine.update({ where: { id, companyId: this.companyId }, data });
  }

  deleteLine(id: string) {
    return this.tx.budgetLine.delete({ where: { id, companyId: this.companyId } });
  }

  listCosts(projectId: string) {
    return this.tx.costEntry.findMany({
      where: { companyId: this.companyId, projectId, archivedAt: null },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      include: { site: { select: { id: true, name: true } } },
    });
  }

  findCost(id: string) {
    return this.tx.costEntry.findFirst({ where: { id, companyId: this.companyId } });
  }

  createCost(data: Omit<Prisma.CostEntryUncheckedCreateInput, "companyId">) {
    return this.tx.costEntry.create({ data: { ...data, companyId: this.companyId } });
  }

  updateCost(id: string, data: Prisma.CostEntryUncheckedUpdateInput) {
    return this.tx.costEntry.update({ where: { id, companyId: this.companyId }, data });
  }

  /** Approved/exported hours of the project (labour actuals). */
  approvedHours(projectId: string) {
    return this.tx.timeEntry.findMany({
      where: { companyId: this.companyId, projectId, archivedAt: null, status: { in: ["APPROVED", "EXPORTED"] } },
      select: { id: true, employeeId: true, workDate: true, hours: true, workClass: true },
    });
  }

  countByStatus(projectId: string) {
    return this.tx.timeEntry.groupBy({
      by: ["status"],
      where: { companyId: this.companyId, projectId, archivedAt: null },
      _count: { _all: true },
      _sum: { hours: true },
    });
  }

  employeeRates(employeeIds: string[]) {
    return this.tx.employeeRate.findMany({ where: { companyId: this.companyId, employeeId: { in: employeeIds } } });
  }

  /** Equipment hours from signed diaries of the project (equipment actuals). */
  signedEquipmentHours(projectId: string) {
    return this.tx.dailyReportEntry.findMany({
      where: { companyId: this.companyId, kind: "EQUIPMENT", dailyReport: { projectId, status: "SIGNED" } },
      select: { id: true, equipmentId: true, hours: true, dailyReport: { select: { reportDate: true } } },
    });
  }

  equipmentRates(equipmentIds: string[]) {
    return this.tx.equipmentRate.findMany({ where: { companyId: this.companyId, equipmentId: { in: equipmentIds } } });
  }

  draftDiaries(projectId: string) {
    return this.tx.dailyReport.count({ where: { companyId: this.companyId, projectId, status: "DRAFT" } });
  }
}
