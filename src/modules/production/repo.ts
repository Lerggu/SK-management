import type { Prisma, Tx } from "@/platform/db";

type Data<T> = Omit<T, "companyId">;
const ACTIVE_BOOKING = { in: ["REQUESTED", "APPROVED"] as ("REQUESTED" | "APPROVED")[] };

/** Company-scoped repository for production control (ADR 0026). */
export class ProductionRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
  }

  // ── task types ──────────────────────────────────────────────────────
  listTypes(includeArchived = false) {
    return this.tx.logisticsTaskType.findMany({
      where: { ...this.c, ...(includeArchived ? {} : { archivedAt: null }) },
      include: { roles: { where: { archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  findType(id: string) {
    return this.tx.logisticsTaskType.findFirst({ where: { id, ...this.c }, include: { roles: { where: { archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } });
  }

  createType(data: Data<Prisma.LogisticsTaskTypeUncheckedCreateInput>) {
    return this.tx.logisticsTaskType.create({ data: { ...data, ...this.c } });
  }

  updateType(id: string, data: Prisma.LogisticsTaskTypeUncheckedUpdateInput) {
    return this.tx.logisticsTaskType.update({ where: { id, ...this.c }, data });
  }

  findRole(id: string) {
    return this.tx.logisticsTaskRole.findFirst({ where: { id, ...this.c } });
  }

  createRole(data: Data<Prisma.LogisticsTaskRoleUncheckedCreateInput>) {
    return this.tx.logisticsTaskRole.create({ data: { ...data, ...this.c } });
  }

  updateRole(id: string, data: Prisma.LogisticsTaskRoleUncheckedUpdateInput) {
    return this.tx.logisticsTaskRole.update({ where: { id, ...this.c }, data });
  }

  // ── catalogue references ───────────────────────────────────────────
  findQualificationType(id: string) {
    return this.tx.qualificationType.findFirst({ where: { id, ...this.c, archivedAt: null } });
  }

  findArea(id: string) {
    return this.tx.competenceArea.findFirst({ where: { id, ...this.c, archivedAt: null } });
  }

  findEquipmentType(id: string) {
    return this.tx.equipmentType.findFirst({ where: { id, ...this.c, archivedAt: null } });
  }

  catalogues() {
    return Promise.all([
      this.tx.qualificationType.findMany({ where: { ...this.c, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.tx.competenceArea.findMany({ where: { ...this.c, archivedAt: null }, select: { id: true, name: true, category: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
      this.tx.equipmentType.findMany({ where: { ...this.c, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
  }

  // ── tasks and staffing ─────────────────────────────────────────────
  findRequest(id: string) {
    return this.tx.logisticsRequest.findFirst({ where: { id, ...this.c }, include: { site: { select: { id: true, name: true, projectId: true } } } });
  }

  updateRequest(id: string, data: Prisma.LogisticsRequestUncheckedUpdateInput) {
    return this.tx.logisticsRequest.update({ where: { id, ...this.c }, data });
  }

  /** Active bookings that staff this task. */
  taskBookings(requestId: string) {
    return this.tx.resourceBooking.findMany({
      where: { ...this.c, logisticsRequestId: requestId, status: ACTIVE_BOOKING },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        equipment: { select: { id: true, assetNumber: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  employees() {
    return this.tx.employee.findMany({
      where: { ...this.c, archivedAt: null, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, trade: true, status: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
  }

  equipment() {
    return this.tx.equipment.findMany({
      where: { ...this.c, archivedAt: null },
      select: { id: true, assetNumber: true, name: true, status: true, equipmentTypeId: true, nextInspectionDate: true },
      orderBy: { assetNumber: "asc" },
    });
  }

  qualifications(employeeIds: string[]) {
    return this.tx.employeeQualification.findMany({
      where: { ...this.c, employeeId: { in: employeeIds }, archivedAt: null, replacedAt: null, typeId: { not: null } },
      select: { employeeId: true, typeId: true, expiresOn: true, noExpiry: true },
    });
  }

  publishedAssessments(employeeIds: string[]) {
    return this.tx.competenceAssessment.findMany({
      where: { ...this.c, employeeId: { in: employeeIds }, kind: "SUPERVISOR", status: "PUBLISHED", archivedAt: null },
      select: { employeeId: true, areaId: true, kind: true, status: true, level: true, assessedOn: true, publishedAt: true, createdAt: true },
    });
  }

  /** Active bookings overlapping a period (any company's bookings of own resources). */
  overlapping(from: Date, to: Date) {
    return this.tx.resourceBooking.findMany({
      where: { ownerCompanyId: this.companyId, status: ACTIVE_BOOKING, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { id: true, employeeId: true, equipmentId: true, logisticsRequestId: true, startsAt: true, endsAt: true },
    });
  }
}
