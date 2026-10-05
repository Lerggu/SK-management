import type { Prisma, Tx } from "@/platform/db";

/** Company-scoped site diary repository. */
export class DiaryRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, companyId: this.companyId }, include: { project: { select: { id: true, code: true, name: true, archivedAt: true } } } });
  }

  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, companyId: this.companyId } });
  }

  findBySiteDate(siteId: string, date: Date) {
    return this.tx.dailyReport.findFirst({ where: { companyId: this.companyId, siteId, reportDate: date } });
  }

  find(id: string) {
    return this.tx.dailyReport.findFirst({ where: { id, companyId: this.companyId } });
  }

  findDetailed(id: string) {
    return this.tx.dailyReport.findFirst({
      where: { id, companyId: this.companyId },
      include: {
        site: { select: { id: true, name: true, project: { select: { id: true, code: true, name: true } } } },
        entries: { orderBy: { createdAt: "asc" }, include: { equipment: { select: { id: true, assetNumber: true, name: true } } } },
        attachments: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  listForProject(projectId: string) {
    return this.tx.dailyReport.findMany({
      where: { companyId: this.companyId, projectId },
      orderBy: [{ reportDate: "desc" }],
      take: 120,
      include: { site: { select: { id: true, name: true } }, _count: { select: { entries: true, attachments: true } } },
    });
  }

  create(data: Omit<Prisma.DailyReportUncheckedCreateInput, "companyId">) {
    return this.tx.dailyReport.create({ data: { ...data, companyId: this.companyId } });
  }

  update(id: string, data: Prisma.DailyReportUncheckedUpdateInput) {
    return this.tx.dailyReport.update({ where: { id, companyId: this.companyId }, data });
  }

  /** Time entries recorded for the site on the date (attendance). */
  attendance(siteId: string, date: Date) {
    return this.tx.timeEntry.findMany({
      where: { companyId: this.companyId, siteId, workDate: date, archivedAt: null, status: { not: "REJECTED" } },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  findEquipment(id: string) {
    return this.tx.equipment.findFirst({ where: { id, companyId: this.companyId, archivedAt: null } });
  }

  listEquipment() {
    return this.tx.equipment.findMany({ where: { companyId: this.companyId, archivedAt: null }, orderBy: { assetNumber: "asc" }, select: { id: true, assetNumber: true, name: true, currentProjectId: true } });
  }

  createEntry(data: Omit<Prisma.DailyReportEntryUncheckedCreateInput, "companyId">) {
    return this.tx.dailyReportEntry.create({ data: { ...data, companyId: this.companyId } });
  }

  findEntry(id: string) {
    return this.tx.dailyReportEntry.findFirst({ where: { id, companyId: this.companyId } });
  }

  deleteEntry(id: string) {
    return this.tx.dailyReportEntry.delete({ where: { id, companyId: this.companyId } });
  }

  createAttachment(data: Omit<Prisma.DailyReportAttachmentUncheckedCreateInput, "companyId">) {
    return this.tx.dailyReportAttachment.create({ data: { ...data, companyId: this.companyId } });
  }

  findAttachment(id: string) {
    return this.tx.dailyReportAttachment.findFirst({ where: { id, companyId: this.companyId } });
  }

  findUsers(ids: string[]) {
    return this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  }
}
