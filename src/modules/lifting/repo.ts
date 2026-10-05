import type { Prisma, Tx } from "@/platform/db";

type Create<T> = Omit<T, "companyId">;

const versionInclude = {
  crane: { select: { id: true, assetNumber: true, name: true, status: true, nextInspectionDate: true, archivedAt: true } },
  riskDocument: { select: { id: true, title: true, documentNumber: true } },
  accessories: { include: { accessory: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.LiftPlanVersionInclude;

const planInclude = {
  site: { select: { id: true, name: true, code: true, project: { select: { id: true, code: true, name: true } } } },
  request: { select: { id: true, title: true, status: true, serviceType: true } },
  activity: { select: { id: true, name: true, planId: true, taktArea: { select: { code: true, name: true } }, workPackage: { select: { code: true, name: true } } } },
  versions: { include: versionInclude, orderBy: { versionNumber: "desc" } },
} satisfies Prisma.LiftPlanInclude;

const activitySelect = { select: { id: true, name: true, planId: true, taktArea: { select: { code: true } }, workPackage: { select: { code: true } } } } as const;

/** Company-scoped V5 repository: every query carries company_id. */
export class LiftingRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
  }

  findCompanySlug() {
    return this.tx.company.findUniqueOrThrow({ where: { id: this.companyId }, select: { slug: true, name: true } });
  }

  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, ...this.c } });
  }

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, ...this.c }, include: { project: { select: { id: true, code: true, name: true, archivedAt: true } } } });
  }

  listSites(projectIds: string[] | undefined) {
    return this.tx.site.findMany({
      where: { ...this.c, archivedAt: null, project: { archivedAt: null }, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
      orderBy: [{ project: { code: "asc" } }, { name: "asc" }],
      include: { project: { select: { id: true, code: true, name: true } } },
    });
  }

  findActivity(id: string) {
    return this.tx.taktActivity.findFirst({ where: { id, ...this.c } });
  }

  listActivities(siteId: string) {
    return this.tx.taktActivity.findMany({ where: { ...this.c, siteId, archivedAt: null, plan: { archivedAt: null } }, orderBy: [{ taktArea: { code: "asc" } }, { workPackage: { code: "asc" } }], ...activitySelect });
  }

  findRequest(id: string) {
    return this.tx.logisticsRequest.findFirst({ where: { id, ...this.c } });
  }

  listLiftRequests(siteId: string) {
    return this.tx.logisticsRequest.findMany({ where: { ...this.c, siteId, serviceType: "LIFT", status: { notIn: ["COMPLETE", "CANCELLED"] } }, orderBy: { requestedStart: "asc" }, select: { id: true, title: true, status: true, activityId: true } });
  }

  updateRequest(id: string, data: Prisma.LogisticsRequestUncheckedUpdateInput) {
    return this.tx.logisticsRequest.update({ where: { id, companyId: this.companyId }, data });
  }

  findLocation(id: string) {
    return this.tx.logisticsLocation.findFirst({ where: { id, ...this.c } });
  }

  listLocations(siteId: string) {
    return this.tx.logisticsLocation.findMany({ where: { ...this.c, siteId, archivedAt: null, kind: { in: ["STORAGE", "UNLOADING"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } });
  }

  findDelivery(id: string) {
    return this.tx.delivery.findFirst({ where: { id, ...this.c } });
  }

  listDeliveries(siteId: string) {
    return this.tx.delivery.findMany({ where: { ...this.c, siteId, status: { not: "CANCELLED" } }, orderBy: { slotStart: "desc" }, take: 100, select: { id: true, supplier: true, material: true, slotStart: true } });
  }

  findDocument(id: string) {
    return this.tx.document.findFirst({ where: { id, ...this.c, archivedAt: null } });
  }

  listDocuments(projectId: string) {
    return this.tx.document.findMany({ where: { ...this.c, archivedAt: null, OR: [{ projectId }, { projectId: null }] }, orderBy: { title: "asc" }, select: { id: true, title: true, documentNumber: true } });
  }

  findEquipment(id: string) {
    return this.tx.equipment.findFirst({ where: { id, ...this.c } });
  }

  listCranes() {
    return this.tx.equipment.findMany({ where: { ...this.c, archivedAt: null, equipmentType: { category: { in: ["CRANE", "TELEHANDLER"] } } }, orderBy: { assetNumber: "asc" }, select: { id: true, assetNumber: true, name: true, status: true, nextInspectionDate: true } });
  }

  findUsers(ids: string[]) {
    return this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  }

  // ── accessories ───────────────────────────────────────────────────
  listAccessories(includeArchived = false) {
    return this.tx.liftingAccessory.findMany({ where: { ...this.c, ...(includeArchived ? {} : { archivedAt: null }) }, orderBy: { code: "asc" } });
  }

  findAccessory(id: string) {
    return this.tx.liftingAccessory.findFirst({ where: { id, ...this.c } });
  }

  findAccessoryByCode(code: string) {
    return this.tx.liftingAccessory.findFirst({ where: { code, ...this.c } });
  }

  findAccessoriesByIds(ids: string[]) {
    return this.tx.liftingAccessory.findMany({ where: { id: { in: ids }, ...this.c }, orderBy: { code: "asc" } });
  }

  createAccessory(data: Create<Prisma.LiftingAccessoryUncheckedCreateInput>) {
    return this.tx.liftingAccessory.create({ data: { ...data, ...this.c } });
  }

  updateAccessory(id: string, data: Prisma.LiftingAccessoryUncheckedUpdateInput) {
    return this.tx.liftingAccessory.update({ where: { id, companyId: this.companyId }, data });
  }

  // ── lift plans ────────────────────────────────────────────────────
  listPlans(where: { projectIds?: string[]; siteId?: string; status?: "OPEN" | "COMPLETED" | "CANCELLED"; activityId?: string }) {
    return this.tx.liftPlan.findMany({
      where: { ...this.c, ...(where.projectIds ? { projectId: { in: where.projectIds } } : {}), ...(where.siteId ? { siteId: where.siteId } : {}), ...(where.status ? { status: where.status } : {}), ...(where.activityId ? { activityId: where.activityId } : {}) },
      orderBy: [{ plannedStart: "asc" }],
      take: 300,
      include: { site: planInclude.site, activity: planInclude.activity, versions: { orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, status: true, loadWeightKg: true } } },
    });
  }

  findPlan(id: string) {
    return this.tx.liftPlan.findFirst({ where: { id, ...this.c }, include: planInclude });
  }

  createPlan(data: Create<Prisma.LiftPlanUncheckedCreateInput>) {
    return this.tx.liftPlan.create({ data: { ...data, ...this.c } });
  }

  updatePlan(id: string, data: Prisma.LiftPlanUncheckedUpdateInput) {
    return this.tx.liftPlan.update({ where: { id, companyId: this.companyId }, data });
  }

  createVersion(data: Create<Prisma.LiftPlanVersionUncheckedCreateInput>) {
    return this.tx.liftPlanVersion.create({ data: { ...data, ...this.c } });
  }

  updateVersion(id: string, data: Prisma.LiftPlanVersionUncheckedUpdateInput) {
    return this.tx.liftPlanVersion.update({ where: { id, companyId: this.companyId }, data });
  }

  addVersionAccessory(versionId: string, accessoryId: string, count: number, userId: string) {
    return this.tx.liftPlanAccessory.upsert({
      where: { versionId_accessoryId: { versionId, accessoryId } },
      create: { ...this.c, versionId, accessoryId, count, createdById: userId },
      update: { count },
    });
  }

  removeVersionAccessory(versionId: string, accessoryId: string) {
    return this.tx.liftPlanAccessory.deleteMany({ where: { ...this.c, versionId, accessoryId } });
  }

  copyVersionAccessories(fromVersionId: string, toVersionId: string, userId: string) {
    return this.tx.$executeRaw`
      INSERT INTO lift_plan_accessories (id, company_id, version_id, accessory_id, count, created_at, created_by)
      SELECT gen_random_uuid(), company_id, ${toVersionId}::uuid, accessory_id, count, now(), ${userId}::uuid
      FROM lift_plan_accessories WHERE version_id = ${fromVersionId}::uuid AND company_id = ${this.companyId}::uuid`;
  }

  listPlanBookings(planId: string) {
    return this.tx.resourceBooking.findMany({
      where: { ...this.c, liftPlanId: planId },
      orderBy: { startsAt: "asc" },
      select: { id: true, status: true, startsAt: true, endsAt: true, resourceKind: true, employee: { select: { firstName: true, lastName: true, trade: true } }, equipment: { select: { assetNumber: true, name: true } }, ownerCompany: { select: { name: true } } },
    });
  }

  // ── material batches ──────────────────────────────────────────────
  listBatches(where: { projectIds?: string[]; siteId?: string; status?: string; activityId?: string }) {
    return this.tx.materialBatch.findMany({
      where: { ...this.c, archivedAt: null, ...(where.projectIds ? { projectId: { in: where.projectIds } } : {}), ...(where.siteId ? { siteId: where.siteId } : {}), ...(where.status ? { status: where.status as never } : {}), ...(where.activityId ? { activityId: where.activityId } : {}) },
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
      include: { site: { select: { id: true, name: true } }, activity: activitySelect, location: { select: { id: true, name: true } }, delivery: { select: { id: true, supplier: true, slotStart: true } } },
    });
  }

  findBatch(id: string) {
    return this.tx.materialBatch.findFirst({
      where: { id, ...this.c },
      include: {
        site: { select: { id: true, name: true, project: { select: { id: true, code: true, name: true } } } },
        activity: activitySelect,
        location: { select: { id: true, name: true } },
        delivery: { select: { id: true, supplier: true, material: true, slotStart: true, status: true } },
        movements: { orderBy: { movedAt: "asc" }, include: { location: { select: { name: true } }, activity: activitySelect } },
      },
    });
  }

  findBatchByCode(code: string) {
    return this.tx.materialBatch.findFirst({ where: { code, ...this.c } });
  }

  findBatchesByIds(ids: string[]) {
    return this.tx.materialBatch.findMany({ where: { id: { in: ids }, ...this.c }, orderBy: { code: "asc" } });
  }

  createBatch(data: Create<Prisma.MaterialBatchUncheckedCreateInput>) {
    return this.tx.materialBatch.create({ data: { ...data, ...this.c } });
  }

  updateBatch(id: string, data: Prisma.MaterialBatchUncheckedUpdateInput) {
    return this.tx.materialBatch.update({ where: { id, companyId: this.companyId }, data });
  }

  createMovement(data: Create<Prisma.MaterialMovementUncheckedCreateInput>) {
    return this.tx.materialMovement.create({ data: { ...data, ...this.c } });
  }

  // ── cable drums ───────────────────────────────────────────────────
  listDrums(where: { projectIds?: string[]; siteId?: string; activityId?: string }) {
    return this.tx.cableDrum.findMany({
      where: { ...this.c, archivedAt: null, ...(where.projectIds ? { projectId: { in: where.projectIds } } : {}), ...(where.siteId ? { siteId: where.siteId } : {}), ...(where.activityId ? { OR: [{ reservedActivityId: where.activityId }, { pulls: { some: { activityId: where.activityId } } }] } : {}) },
      orderBy: [{ code: "asc" }],
      take: 300,
      include: { site: { select: { id: true, name: true } }, location: { select: { id: true, name: true } }, reservedActivity: activitySelect },
    });
  }

  findDrum(id: string) {
    return this.tx.cableDrum.findFirst({
      where: { id, ...this.c },
      include: {
        site: { select: { id: true, name: true, project: { select: { id: true, code: true, name: true } } } },
        location: { select: { id: true, name: true } },
        reservedActivity: activitySelect,
        delivery: { select: { id: true, supplier: true, slotStart: true } },
        pulls: { orderBy: [{ pulledOn: "asc" }, { createdAt: "asc" }], include: { activity: activitySelect } },
      },
    });
  }

  findDrumByCode(code: string) {
    return this.tx.cableDrum.findFirst({ where: { code, ...this.c } });
  }

  findDrumsByIds(ids: string[]) {
    return this.tx.cableDrum.findMany({ where: { id: { in: ids }, ...this.c }, orderBy: { code: "asc" } });
  }

  createDrum(data: Create<Prisma.CableDrumUncheckedCreateInput>) {
    return this.tx.cableDrum.create({ data: { ...data, ...this.c } });
  }

  updateDrum(id: string, data: Prisma.CableDrumUncheckedUpdateInput) {
    return this.tx.cableDrum.update({ where: { id, companyId: this.companyId }, data });
  }

  createPull(data: Create<Prisma.CablePullUncheckedCreateInput>) {
    return this.tx.cablePull.create({ data: { ...data, ...this.c } });
  }

  /** Pulls and movements recorded against one takt activity (traceability). */
  async activityTrace(activityId: string) {
    const [pulls, movements] = await Promise.all([
      this.tx.cablePull.findMany({ where: { ...this.c, activityId }, orderBy: { pulledOn: "asc" }, include: { drum: { select: { id: true, code: true, cableType: true } } } }),
      this.tx.materialMovement.findMany({ where: { ...this.c, activityId }, orderBy: { movedAt: "asc" }, include: { batch: { select: { id: true, code: true, material: true, unit: true, quantity: true } } } }),
    ]);
    return { pulls, movements };
  }
}
