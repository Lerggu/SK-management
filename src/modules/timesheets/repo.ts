import type { Prisma, Tx } from "@/platform/db";

const entryInclude = {
  employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, userId: true } },
  project: { select: { id: true, code: true, name: true } },
  site: { select: { id: true, name: true } },
} satisfies Prisma.TimeEntryInclude;

export type TimeEntryRow = Prisma.TimeEntryGetPayload<{ include: typeof entryInclude }>;

/** Company-scoped time entry repository. */
export class TimesheetRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  findOwnEmployee(userId: string) {
    return this.tx.employee.findFirst({ where: { companyId: this.companyId, userId, archivedAt: null } });
  }

  findEmployees(ids: string[]) {
    return this.tx.employee.findMany({ where: { companyId: this.companyId, id: { in: ids }, archivedAt: null } });
  }

  listEmployees() {
    return this.tx.employee.findMany({
      where: { companyId: this.companyId, archivedAt: null, status: "ACTIVE" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, employeeNumber: true, userId: true },
    });
  }

  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, companyId: this.companyId } });
  }

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, companyId: this.companyId } });
  }

  find(id: string) {
    return this.tx.timeEntry.findFirst({ where: { id, companyId: this.companyId }, include: entryInclude });
  }

  findMany(ids: string[]) {
    return this.tx.timeEntry.findMany({ where: { id: { in: ids }, companyId: this.companyId }, include: entryInclude });
  }

  list(where: Omit<Prisma.TimeEntryWhereInput, "companyId">) {
    return this.tx.timeEntry.findMany({
      where: { ...where, companyId: this.companyId, archivedAt: null },
      orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
      include: entryInclude,
    });
  }

  create(data: Omit<Prisma.TimeEntryUncheckedCreateInput, "companyId">) {
    return this.tx.timeEntry.create({ data: { ...data, companyId: this.companyId }, include: entryInclude });
  }

  update(id: string, data: Prisma.TimeEntryUncheckedUpdateInput) {
    return this.tx.timeEntry.update({ where: { id, companyId: this.companyId }, data, include: entryInclude });
  }

  markExported(ids: string[], batchId: string, userId: string) {
    return this.tx.timeEntry.updateMany({
      where: { companyId: this.companyId, id: { in: ids }, status: "APPROVED" },
      data: { status: "EXPORTED", exportedAt: new Date(), exportBatchId: batchId, updatedById: userId },
    });
  }

  findUsers(ids: string[]) {
    return this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  }
}
