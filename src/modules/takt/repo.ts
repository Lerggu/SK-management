import type { Prisma, Tx } from "@/platform/db";

type Create<T> = Omit<T, "companyId">;

/** Company-scoped takt repository: every query carries company_id. */
export class TaktRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
  }

  // ── projects / sites ──────────────────────────────────────────────
  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, ...this.c } });
  }

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, ...this.c }, include: { project: { select: { id: true, code: true, name: true, archivedAt: true } } } });
  }

  listSites(projectId: string) {
    return this.tx.site.findMany({ where: { ...this.c, projectId, archivedAt: null }, orderBy: { name: "asc" } });
  }

  findEquipmentType(id: string) {
    return this.tx.equipmentType.findFirst({ where: { id, ...this.c, archivedAt: null } });
  }

  listEquipmentTypes() {
    return this.tx.equipmentType.findMany({ where: { ...this.c, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true } });
  }

  findUsers(ids: string[]) {
    return this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  }

  // ── calendars ─────────────────────────────────────────────────────
  findDefaultCalendar() {
    return this.tx.workCalendar.findFirst({ where: { ...this.c, isDefault: true, archivedAt: null }, include: { holidays: { orderBy: { date: "asc" } } } });
  }

  findCalendar(id: string) {
    return this.tx.workCalendar.findFirst({ where: { id, ...this.c }, include: { holidays: { orderBy: { date: "asc" } } } });
  }

  createCalendar(data: Create<Prisma.WorkCalendarUncheckedCreateInput>) {
    return this.tx.workCalendar.create({ data: { ...data, ...this.c } });
  }

  updateCalendar(id: string, data: Prisma.WorkCalendarUncheckedUpdateInput) {
    return this.tx.workCalendar.update({ where: { id, ...this.c }, data });
  }

  createHolidays(rows: Create<Prisma.CalendarHolidayUncheckedCreateInput>[]) {
    return this.tx.calendarHoliday.createMany({ data: rows.map((r) => ({ ...r, ...this.c })), skipDuplicates: true });
  }

  findHoliday(id: string) {
    return this.tx.calendarHoliday.findFirst({ where: { id, ...this.c } });
  }

  deleteHoliday(id: string) {
    return this.tx.calendarHoliday.delete({ where: { id, ...this.c } });
  }

  // ── structure ─────────────────────────────────────────────────────
  listBuildings(projectId: string) {
    return this.tx.building.findMany({
      where: { ...this.c, projectId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { taktAreas: { where: { archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] } },
    });
  }

  listBuildingsForSite(siteId: string) {
    return this.tx.building.findMany({
      where: { ...this.c, siteId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { taktAreas: { where: { archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] } },
    });
  }

  findBuilding(id: string) {
    return this.tx.building.findFirst({ where: { id, ...this.c } });
  }

  createBuilding(data: Create<Prisma.BuildingUncheckedCreateInput>) {
    return this.tx.building.create({ data: { ...data, ...this.c } });
  }

  updateBuilding(id: string, data: Prisma.BuildingUncheckedUpdateInput) {
    return this.tx.building.update({ where: { id, ...this.c }, data });
  }

  findArea(id: string) {
    return this.tx.taktArea.findFirst({ where: { id, ...this.c }, include: { building: true } });
  }

  createArea(data: Create<Prisma.TaktAreaUncheckedCreateInput>) {
    return this.tx.taktArea.create({ data: { ...data, ...this.c } });
  }

  updateArea(id: string, data: Prisma.TaktAreaUncheckedUpdateInput) {
    return this.tx.taktArea.update({ where: { id, ...this.c }, data });
  }

  countAreas(buildingId: string) {
    return this.tx.taktArea.count({ where: { ...this.c, buildingId } });
  }

  listWorkPackages(projectId: string) {
    return this.tx.workPackage.findMany({
      where: { ...this.c, projectId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      include: { equipmentType: { select: { id: true, name: true } } },
    });
  }

  findWorkPackage(id: string) {
    return this.tx.workPackage.findFirst({ where: { id, ...this.c } });
  }

  createWorkPackage(data: Create<Prisma.WorkPackageUncheckedCreateInput>) {
    return this.tx.workPackage.create({ data: { ...data, ...this.c } });
  }

  updateWorkPackage(id: string, data: Prisma.WorkPackageUncheckedUpdateInput) {
    return this.tx.workPackage.update({ where: { id, ...this.c }, data });
  }

  countWorkPackages(projectId: string) {
    return this.tx.workPackage.count({ where: { ...this.c, projectId } });
  }

  // ── plans and versions ────────────────────────────────────────────
  listPlans(projectIds: string[] | undefined) {
    return this.tx.taktPlan.findMany({
      where: { ...this.c, archivedAt: null, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
      orderBy: [{ createdAt: "desc" }],
      include: {
        site: { select: { id: true, name: true, project: { select: { id: true, code: true, name: true } } } },
        versions: { orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, status: true, startDate: true, approvedAt: true } },
        _count: { select: { activities: true } },
      },
    });
  }

  findPlan(id: string) {
    return this.tx.taktPlan.findFirst({
      where: { id, ...this.c },
      include: { site: { select: { id: true, name: true, projectId: true, project: { select: { id: true, code: true, name: true, archivedAt: true } } } } },
    });
  }

  createPlan(data: Create<Prisma.TaktPlanUncheckedCreateInput>) {
    return this.tx.taktPlan.create({ data: { ...data, ...this.c } });
  }

  listVersions(planId: string) {
    return this.tx.taktPlanVersion.findMany({ where: { ...this.c, planId }, orderBy: { versionNumber: "desc" } });
  }

  findVersion(id: string) {
    return this.tx.taktPlanVersion.findFirst({ where: { id, ...this.c } });
  }

  findBaseline(planId: string) {
    return this.tx.taktPlanVersion.findFirst({ where: { ...this.c, planId, status: "BASELINE" } });
  }

  findOpenVersion(planId: string) {
    return this.tx.taktPlanVersion.findFirst({ where: { ...this.c, planId, status: { in: ["DRAFT", "PROPOSED"] } } });
  }

  async nextVersionNumber(planId: string) {
    const last = await this.tx.taktPlanVersion.findFirst({ where: { ...this.c, planId }, orderBy: { versionNumber: "desc" }, select: { versionNumber: true } });
    return (last?.versionNumber ?? 0) + 1;
  }

  createVersion(data: Create<Prisma.TaktPlanVersionUncheckedCreateInput>) {
    return this.tx.taktPlanVersion.create({ data: { ...data, ...this.c } });
  }

  updateVersion(id: string, data: Prisma.TaktPlanVersionUncheckedUpdateInput) {
    return this.tx.taktPlanVersion.update({ where: { id, ...this.c }, data });
  }

  deleteVersion(id: string) {
    return this.tx.taktPlanVersion.delete({ where: { id, ...this.c } });
  }

  listAssignments(versionId: string) {
    return this.tx.taktAssignment.findMany({ where: { ...this.c, versionId } });
  }

  findAssignment(versionId: string, activityId: string) {
    return this.tx.taktAssignment.findFirst({ where: { ...this.c, versionId, activityId } });
  }

  createAssignments(rows: Create<Prisma.TaktAssignmentUncheckedCreateInput>[]) {
    return this.tx.taktAssignment.createMany({ data: rows.map((r) => ({ ...r, ...this.c })) });
  }

  upsertAssignment(planId: string, versionId: string, activityId: string, data: { startCycle: number; durationCycles: number }) {
    return this.tx.taktAssignment.upsert({
      where: { versionId_activityId: { versionId, activityId } },
      create: { ...this.c, planId, versionId, activityId, ...data },
      update: data,
    });
  }

  deleteAssignment(id: string) {
    return this.tx.taktAssignment.delete({ where: { id, ...this.c } });
  }

  updateAssignment(id: string, data: { startCycle?: number; durationCycles?: number }) {
    return this.tx.taktAssignment.update({ where: { id, ...this.c }, data });
  }

  // ── activities ────────────────────────────────────────────────────
  listActivities(planId: string) {
    return this.tx.taktActivity.findMany({
      where: { ...this.c, planId, archivedAt: null },
      include: {
        workPackage: { select: { id: true, code: true, name: true, color: true, sortOrder: true } },
        taktArea: { select: { id: true, code: true, name: true, sortOrder: true, buildingId: true } },
        equipmentType: { select: { id: true, name: true } },
        _count: { select: { constraints: { where: { status: "OPEN" } } } },
      },
    });
  }

  findActivity(id: string) {
    return this.tx.taktActivity.findFirst({ where: { id, ...this.c } });
  }

  findActivityDetailed(id: string) {
    return this.tx.taktActivity.findFirst({
      where: { id, ...this.c },
      include: {
        workPackage: true,
        taktArea: { include: { building: true } },
        equipmentType: { select: { id: true, name: true } },
        constraints: { orderBy: [{ status: "asc" }, { createdAt: "asc" }] },
        progress: { orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }], take: 50 },
        predecessors: { include: { predecessor: { include: { workPackage: { select: { code: true, name: true } }, taktArea: { select: { code: true, name: true } } } } } },
        successors: { include: { successor: { include: { workPackage: { select: { code: true, name: true } }, taktArea: { select: { code: true, name: true } } } } } },
      },
    });
  }

  findActivityByPair(planId: string, workPackageId: string, taktAreaId: string) {
    return this.tx.taktActivity.findFirst({ where: { ...this.c, planId, workPackageId, taktAreaId } });
  }

  createActivity(data: Create<Prisma.TaktActivityUncheckedCreateInput>) {
    return this.tx.taktActivity.create({ data: { ...data, ...this.c } });
  }

  updateActivity(id: string, data: Prisma.TaktActivityUncheckedUpdateInput) {
    return this.tx.taktActivity.update({ where: { id, ...this.c }, data });
  }

  listDependencies(planId: string) {
    return this.tx.activityDependency.findMany({ where: { ...this.c, planId } });
  }

  findDependency(id: string) {
    return this.tx.activityDependency.findFirst({ where: { id, ...this.c } });
  }

  findDependencyPair(predecessorId: string, successorId: string) {
    return this.tx.activityDependency.findFirst({ where: { ...this.c, predecessorId, successorId } });
  }

  createDependency(data: Create<Prisma.ActivityDependencyUncheckedCreateInput>) {
    return this.tx.activityDependency.create({ data: { ...data, ...this.c } });
  }

  createDependencies(rows: Create<Prisma.ActivityDependencyUncheckedCreateInput>[]) {
    return this.tx.activityDependency.createMany({ data: rows.map((r) => ({ ...r, ...this.c })), skipDuplicates: true });
  }

  deleteDependency(id: string) {
    return this.tx.activityDependency.delete({ where: { id, ...this.c } });
  }

  createConstraint(data: Create<Prisma.ActivityConstraintUncheckedCreateInput>) {
    return this.tx.activityConstraint.create({ data: { ...data, ...this.c } });
  }

  findConstraint(id: string) {
    return this.tx.activityConstraint.findFirst({ where: { id, ...this.c } });
  }

  updateConstraint(id: string, data: Prisma.ActivityConstraintUncheckedUpdateInput) {
    return this.tx.activityConstraint.update({ where: { id, ...this.c }, data });
  }

  createProgress(data: Create<Prisma.ActivityProgressUncheckedCreateInput>) {
    return this.tx.activityProgress.create({ data: { ...data, ...this.c } });
  }

  // ── requirements / capacity ───────────────────────────────────────
  createRequirements(rows: Create<Prisma.ResourceRequirementUncheckedCreateInput>[]) {
    return this.tx.resourceRequirement.createMany({ data: rows.map((r) => ({ ...r, ...this.c })) });
  }

  /** Baseline requirements overlapping [from, to] for not-yet-complete activities. */
  baselineRequirements(projectIds: string[] | undefined, from: Date, to: Date) {
    return this.tx.resourceRequirement.findMany({
      where: {
        ...this.c,
        startDate: { lte: to },
        endDate: { gte: from },
        version: { status: "BASELINE", plan: { archivedAt: null, ...(projectIds ? { projectId: { in: projectIds } } : {}) } },
        activity: { archivedAt: null, execution: { not: "COMPLETE" } },
      },
      include: { activity: { select: { id: true, name: true, projectId: true, planId: true } } },
    });
  }

  countRequirements(versionId: string) {
    return this.tx.resourceRequirement.count({ where: { ...this.c, versionId } });
  }

  async tradeCapacity() {
    const rows = await this.tx.employee.groupBy({ by: ["trade"], where: { ...this.c, archivedAt: null, status: "ACTIVE", trade: { not: null } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.trade!.toLowerCase(), r._count._all]));
  }

  async equipmentCapacity() {
    const rows = await this.tx.equipment.groupBy({ by: ["equipmentTypeId"], where: { ...this.c, archivedAt: null, status: { in: ["AVAILABLE", "IN_USE"] } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.equipmentTypeId, r._count._all]));
  }

  /** Approved bookings made by this company (V4), for booked capacity in the look-ahead. */
  approvedBookings(from: Date, to: Date) {
    return this.tx.resourceBooking.findMany({
      where: { ...this.c, status: "APPROVED", startsAt: { lt: to }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true, employee: { select: { trade: true } }, equipment: { select: { equipmentTypeId: true } } },
    });
  }

  /** Resource requirements of the activity in the current baseline. */
  activityRequirements(activityId: string) {
    return this.tx.resourceRequirement.findMany({
      where: { ...this.c, activityId, version: { status: "BASELINE" } },
      orderBy: { kind: "asc" },
      include: { equipmentType: { select: { id: true, name: true } } },
    });
  }

  /** Logistics linked to an activity (V4 traceability). */
  async activityLogistics(activityId: string) {
    const [requests, deliveries, bookings] = await Promise.all([
      this.tx.logisticsRequest.findMany({ where: { ...this.c, activityId }, orderBy: { requestedStart: "asc" }, select: { id: true, title: true, status: true, serviceType: true, requestedStart: true } }),
      this.tx.delivery.findMany({ where: { ...this.c, activityId }, orderBy: { slotStart: "asc" }, select: { id: true, material: true, supplier: true, status: true, slotStart: true } }),
      this.tx.resourceBooking.findMany({
        where: { ...this.c, activityId },
        orderBy: { startsAt: "asc" },
        select: { id: true, status: true, startsAt: true, endsAt: true, employee: { select: { firstName: true, lastName: true } }, equipment: { select: { assetNumber: true, name: true } }, ownerCompany: { select: { name: true } } },
      }),
    ]);
    return { requests, deliveries, bookings };
  }

  // ── imports ───────────────────────────────────────────────────────
  createImport(data: Create<Prisma.ScheduleImportUncheckedCreateInput>) {
    return this.tx.scheduleImport.create({ data: { ...data, ...this.c } });
  }

  findImport(id: string) {
    return this.tx.scheduleImport.findFirst({ where: { id, ...this.c } });
  }

  updateImport(id: string, data: Prisma.ScheduleImportUncheckedUpdateInput) {
    return this.tx.scheduleImport.update({ where: { id, ...this.c }, data });
  }

  listImports(planId: string) {
    return this.tx.scheduleImport.findMany({ where: { ...this.c, planId }, orderBy: { createdAt: "desc" }, take: 20 });
  }
}
