import type { Prisma, Tx } from "@/platform/db";
import { toDay } from "./rotation";

/** Company-scoped data access for the rotation plan. */
export class RotationRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
  }

  employees(trade?: string | null) {
    return this.tx.employee.findMany({
      where: { ...this.c, archivedAt: null, status: "ACTIVE", ...(trade ? { trade: { equals: trade, mode: "insensitive" } } : {}) },
      select: { id: true, firstName: true, lastName: true, trade: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
  }

  trades() {
    return this.tx.employee.findMany({ where: { ...this.c, archivedAt: null, status: "ACTIVE", trade: { not: null } }, select: { trade: true }, distinct: ["trade"], orderBy: { trade: "asc" } });
  }

  findEmployee(id: string) {
    return this.tx.employee.findFirst({ where: { id, ...this.c, archivedAt: null }, select: { id: true, status: true, firstName: true, lastName: true } });
  }

  employeesByIds(ids: string[]) {
    return this.tx.employee.findMany({ where: { id: { in: ids }, ...this.c, archivedAt: null, status: "ACTIVE" }, select: { id: true } });
  }

  sites() {
    return this.tx.site.findMany({
      where: { ...this.c, archivedAt: null, project: { archivedAt: null } },
      select: { id: true, name: true, projectId: true, project: { select: { code: true } } },
      orderBy: [{ project: { code: "asc" } }, { name: "asc" }],
    });
  }

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, ...this.c, archivedAt: null, project: { archivedAt: null } }, select: { id: true, projectId: true } });
  }

  entries(from: string, until: string, employeeIds?: string[]) {
    return this.tx.rotationEntry.findMany({
      where: { ...this.c, day: { gte: toDay(from), lte: toDay(until) }, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
      select: { employeeId: true, day: true, status: true, siteId: true, note: true },
    });
  }

  upsert(employeeId: string, day: string, data: { status: Prisma.RotationEntryUncheckedCreateInput["status"]; projectId: string | null; siteId: string | null; note: string | null }, userId: string) {
    return this.tx.rotationEntry.upsert({
      where: { companyId_employeeId_day: { companyId: this.companyId, employeeId, day: toDay(day) } },
      create: { ...this.c, employeeId, day: toDay(day), ...data, createdById: userId, updatedById: userId },
      update: { ...data, updatedById: userId },
    });
  }

  clear(employeeId: string, from: string, until: string) {
    return this.tx.rotationEntry.deleteMany({ where: { ...this.c, employeeId, day: { gte: toDay(from), lte: toDay(until) } } });
  }

  /** Statuses of employees on any day of a period (for staffing warnings). */
  absences(employeeIds: string[], from: string, until: string) {
    return employeeIds.length
      ? this.tx.rotationEntry.findMany({ where: { ...this.c, employeeId: { in: employeeIds }, day: { gte: toDay(from), lte: toDay(until) }, status: { not: "WORK" } }, select: { employeeId: true } })
      : Promise.resolve([]);
  }
}
