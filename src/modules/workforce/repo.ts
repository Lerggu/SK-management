import type { Prisma, Tx } from "@/platform/db";

/** Company-scoped employee repository. */
export class EmployeeRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  list(filter: { q: string | null; includeArchived: boolean }) {
    return this.tx.employee.findMany({
      where: {
        companyId: this.companyId,
        ...(filter.includeArchived ? {} : { archivedAt: null }),
        ...(filter.q
          ? {
              OR: [
                { firstName: { contains: filter.q, mode: "insensitive" } },
                { lastName: { contains: filter.q, mode: "insensitive" } },
                { employeeNumber: { contains: filter.q, mode: "insensitive" } },
                { trade: { contains: filter.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { lastName: "asc" }, { firstName: "asc" }],
    });
  }

  find(id: string) {
    return this.tx.employee.findFirst({ where: { id, companyId: this.companyId } });
  }

  create(data: Omit<Prisma.EmployeeUncheckedCreateInput, "companyId">) {
    return this.tx.employee.create({ data: { ...data, companyId: this.companyId } });
  }

  update(id: string, data: Prisma.EmployeeUncheckedUpdateInput) {
    return this.tx.employee.update({ where: { id, companyId: this.companyId }, data });
  }

  isCompanyMember(userId: string) {
    return this.tx.companyMembership.findFirst({ where: { companyId: this.companyId, userId } });
  }

  listRates(employeeIds: string[]) {
    return this.tx.employeeRate.findMany({
      where: { companyId: this.companyId, employeeId: { in: employeeIds } },
      orderBy: [{ rateType: "asc" }, { validFrom: "desc" }],
    });
  }

  findRate(id: string) {
    return this.tx.employeeRate.findFirst({ where: { id, companyId: this.companyId } });
  }

  createRate(data: Omit<Prisma.EmployeeRateUncheckedCreateInput, "companyId">) {
    return this.tx.employeeRate.create({ data: { ...data, companyId: this.companyId } });
  }

  updateRate(id: string, data: Prisma.EmployeeRateUncheckedUpdateInput) {
    return this.tx.employeeRate.update({ where: { id, companyId: this.companyId }, data });
  }
}
