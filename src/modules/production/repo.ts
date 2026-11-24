import type { Prisma, Tx } from "@/platform/db";

type Data<T> = Omit<T, "companyId">;
const ACTIVE_BOOKING = { in: ["REQUESTED", "APPROVED"] as ("REQUESTED" | "APPROVED")[] };

/** Company-scoped repository for production control (ADR 0026). */
export class ProductionRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  /** The client this repository runs on (for sibling repositories in the same transaction). */
  get db(): Tx {
    return this.tx;
  }

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

  // ── calendar ───────────────────────────────────────────────────────
  tasksInRange(params: { projectIds?: string[]; siteId?: string | null; from: Date; to: Date }) {
    return this.tx.logisticsRequest.findMany({
      where: {
        ...this.c,
        status: { not: "CANCELLED" },
        requestedStart: { lt: params.to },
        requestedEnd: { gt: params.from },
        ...(params.projectIds ? { projectId: { in: params.projectIds } } : {}),
        ...(params.siteId ? { siteId: params.siteId } : {}),
      },
      include: { site: { select: { id: true, name: true, project: { select: { code: true } } } } },
      orderBy: [{ siteId: "asc" }, { requestedStart: "asc" }],
      take: 500,
    });
  }

  bookingsOfTasks(requestIds: string[]) {
    return requestIds.length
      ? this.tx.resourceBooking.findMany({ where: { ...this.c, logisticsRequestId: { in: requestIds }, status: ACTIVE_BOOKING }, select: { logisticsRequestId: true, taskRoleId: true } })
      : Promise.resolve([]);
  }

  /** Bookings of the company's own resources in a period, with the task they staff. */
  resourceBookings(from: Date, to: Date) {
    return this.tx.resourceBooking.findMany({
      where: { ownerCompanyId: this.companyId, status: ACTIVE_BOOKING, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { id: true, projectId: true, employeeId: true, equipmentId: true, startsAt: true, endsAt: true, status: true, logisticsRequestId: true, logisticsRequest: { select: { title: true } }, project: { select: { code: true } } },
      orderBy: { startsAt: "asc" },
    });
  }

  sites(projectIds?: string[]) {
    return this.tx.site.findMany({
      where: { ...this.c, archivedAt: null, project: { archivedAt: null }, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
      select: { id: true, name: true, project: { select: { code: true } } },
      orderBy: [{ project: { code: "asc" } }, { name: "asc" }],
    });
  }

  // ── deviations ─────────────────────────────────────────────────────
  createDeviation(data: Data<Prisma.LogisticsDeviationUncheckedCreateInput>) {
    return this.tx.logisticsDeviation.create({ data: { ...data, ...this.c } });
  }

  findDeviation(id: string) {
    return this.tx.logisticsDeviation.findFirst({ where: { id, ...this.c }, include: { photos: { orderBy: { createdAt: "asc" } }, request: { select: { id: true, title: true, projectId: true, siteId: true } } } });
  }

  updateDeviation(id: string, data: Prisma.LogisticsDeviationUncheckedUpdateInput) {
    return this.tx.logisticsDeviation.update({ where: { id, ...this.c }, data });
  }

  listDeviations(params: { projectIds?: string[]; requestId?: string; mapObjectId?: string; open?: boolean; take?: number }) {
    return this.tx.logisticsDeviation.findMany({
      where: {
        ...this.c,
        ...(params.projectIds ? { projectId: { in: params.projectIds } } : {}),
        ...(params.requestId ? { requestId: params.requestId } : {}),
        ...(params.mapObjectId ? { mapObjectId: params.mapObjectId } : {}),
        ...(params.open ? { status: { in: ["OPEN", "ACKNOWLEDGED"] as ("OPEN" | "ACKNOWLEDGED")[] } } : {}),
      },
      include: {
        photos: { select: { id: true } },
        request: { select: { id: true, title: true, site: { select: { name: true, project: { select: { code: true } } } } } },
        mapObject: { select: { id: true, code: true, name: true, siteId: true, site: { select: { name: true, project: { select: { code: true } } } } } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: params.take ?? 200,
    });
  }

  openDeviationTaskIds(requestIds: string[]) {
    return requestIds.length
      ? this.tx.logisticsDeviation.findMany({ where: { ...this.c, requestId: { in: requestIds }, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, select: { requestId: true } })
      : Promise.resolve([]);
  }

  createDeviationPhoto(data: Data<Prisma.LogisticsDeviationPhotoUncheckedCreateInput>) {
    return this.tx.logisticsDeviationPhoto.create({ data: { ...data, ...this.c } });
  }

  findDeviationPhoto(id: string) {
    return this.tx.logisticsDeviationPhoto.findFirst({ where: { id, ...this.c }, include: { deviation: { select: { projectId: true } } } });
  }

  usersByIds(ids: string[]) {
    return ids.length ? this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]);
  }

  /** Active internal members with their company and project roles (for notifications). */
  membersWithRoles(projectId: string) {
    const roleSelect = { templateKey: true, projectAccess: true, permissions: { select: { permissionKey: true } } } as const;
    return this.tx.companyMembership.findMany({
      where: { ...this.c, status: "ACTIVE", user: { status: "ACTIVE", archivedAt: null } },
      select: {
        userId: true,
        user: { select: { email: true, name: true, locale: true } },
        roles: { where: { role: { archivedAt: null } }, select: { role: { select: roleSelect } } },
        projectMemberships: { where: { projectId, archivedAt: null, role: { archivedAt: null } }, select: { projectId: true, role: { select: roleSelect } } },
        extraPermissions: { select: { permissionKey: true } },
      },
    });
  }

  /** Active bookings overlapping a period (any company's bookings of own resources). */
  overlapping(from: Date, to: Date) {
    return this.tx.resourceBooking.findMany({
      where: { ownerCompanyId: this.companyId, status: ACTIVE_BOOKING, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { id: true, employeeId: true, equipmentId: true, logisticsRequestId: true, startsAt: true, endsAt: true },
    });
  }

  // ── AI (phase 4) ───────────────────────────────────────────────────
  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, ...this.c, archivedAt: null }, select: { id: true } });
  }

  latestStaffingRun(requestId: string) {
    return this.tx.aiRun.findFirst({ where: { ...this.c, kind: "STAFFING", logisticsRequestId: requestId }, orderBy: { createdAt: "desc" } });
  }

  findAiRun(id: string) {
    return this.tx.aiRun.findFirst({ where: { id, ...this.c } });
  }

  latestRiskRun(projectId: string) {
    return this.tx.aiRun.findFirst({ where: { ...this.c, kind: "LOGISTICS_RISK", projectId }, orderBy: { createdAt: "desc" }, include: { recommendations: { orderBy: { position: "asc" } } } });
  }

  /** Requests of the given tasks with a STAFFING run with picks (for the calendar badge). */
  async tasksWithStaffingSuggestion(requestIds: string[]) {
    if (!requestIds.length) return new Set<string>();
    const rows = await this.tx.aiRun.findMany({ where: { ...this.c, kind: "STAFFING", status: "SUCCEEDED", logisticsRequestId: { in: requestIds } }, select: { logisticsRequestId: true } });
    return new Set(rows.map((r) => r.logisticsRequestId!));
  }

  deliveries(projectId: string, from: Date, to: Date) {
    return this.tx.delivery.findMany({
      where: { ...this.c, projectId, status: { notIn: ["CANCELLED", "INSTALLED", "STORED", "MOVED_TO_WORKFACE"] }, slotStart: { lt: to }, slotEnd: { gt: from } },
      select: { id: true, material: true, supplier: true, slotStart: true, slotEnd: true, status: true, activity: { select: { name: true } } },
      orderBy: { slotStart: "asc" },
      take: 200,
    });
  }

  blockedActivities(projectId: string) {
    return this.tx.taktActivity.findMany({
      where: { ...this.c, projectId, archivedAt: null, execution: { not: "COMPLETE" }, blocked: true },
      select: { id: true, name: true },
      take: 50,
    });
  }

  activityNames(ids: string[]) {
    return ids.length ? this.tx.taktActivity.findMany({ where: { ...this.c, id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]);
  }
}
