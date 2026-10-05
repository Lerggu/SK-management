import type { Prisma, Tx } from "@/platform/db";

type Create<T> = Omit<T, "companyId">;

const ACTIVE_BOOKING: Prisma.ResourceBookingWhereInput["status"] = { in: ["REQUESTED", "APPROVED"] };

/**
 * Company-scoped logistics repository. Two reads intentionally cross the
 * company boundary, both limited to the caller's organization (ADR 0014):
 * the group resource directory (shareable resources only, no rates) and the
 * bookings of one resource for conflict checks (periods only).
 */
export class LogisticsRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
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
    return this.tx.taktActivity.findFirst({ where: { id, ...this.c }, include: { taktArea: { select: { code: true, name: true } }, workPackage: { select: { code: true, name: true } } } });
  }

  findRequirement(id: string) {
    return this.tx.resourceRequirement.findFirst({ where: { id, ...this.c } });
  }

  findEquipmentType(id: string) {
    return this.tx.equipmentType.findFirst({ where: { id, ...this.c, archivedAt: null } });
  }

  listEquipmentTypes() {
    return this.tx.equipmentType.findMany({ where: { ...this.c, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  }

  findCompany(id: string) {
    return this.tx.company.findUnique({ where: { id }, select: { id: true, name: true, organizationId: true } });
  }

  findUsers(ids: string[]) {
    return this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  }

  // ── resources ─────────────────────────────────────────────────────
  ownEmployees() {
    return this.tx.employee.findMany({ where: { ...this.c, archivedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, trade: true, status: true, shareableInGroup: true } });
  }

  ownEquipment() {
    return this.tx.equipment.findMany({ where: { ...this.c, archivedAt: null }, orderBy: { assetNumber: "asc" }, select: { id: true, assetNumber: true, name: true, status: true, equipmentTypeId: true, nextInspectionDate: true, shareableInGroup: true, equipmentType: { select: { name: true } } } });
  }

  /** Shareable resources of the other companies in the organization (no rates, no personal contact data). */
  async groupResources(organizationId: string) {
    const companies = await this.tx.company.findMany({ where: { organizationId, id: { not: this.companyId }, archivedAt: null }, select: { id: true, name: true } });
    const ids = companies.map((c) => c.id);
    const [employees, equipment] = await Promise.all([
      this.tx.employee.findMany({ where: { companyId: { in: ids }, shareableInGroup: true, archivedAt: null }, select: { id: true, companyId: true, firstName: true, lastName: true, trade: true, status: true } }),
      this.tx.equipment.findMany({ where: { companyId: { in: ids }, shareableInGroup: true, archivedAt: null }, select: { id: true, companyId: true, assetNumber: true, name: true, status: true, equipmentTypeId: true, nextInspectionDate: true, equipmentType: { select: { name: true } } } }),
    ]);
    return { companies, employees, equipment };
  }

  /** A resource owned by this company or shared with the group by another company of the organization. */
  async findBookableResource(kind: "EMPLOYEE" | "EQUIPMENT", id: string, organizationId: string) {
    const orgCompanies = (await this.tx.company.findMany({ where: { organizationId }, select: { id: true } })).map((c) => c.id);
    const scope = { OR: [{ companyId: this.companyId }, { companyId: { in: orgCompanies }, shareableInGroup: true }] };
    if (kind === "EMPLOYEE") {
      const e = await this.tx.employee.findFirst({ where: { id, archivedAt: null, ...scope } });
      return e ? { kind, id: e.id, ownerCompanyId: e.companyId, label: `${e.lastName} ${e.firstName}`, active: e.status === "ACTIVE", trade: e.trade } : null;
    }
    const q = await this.tx.equipment.findFirst({ where: { id, archivedAt: null, ...scope } });
    return q ? { kind, id: q.id, ownerCompanyId: q.companyId, label: `${q.assetNumber} ${q.name}`, active: q.status === "AVAILABLE" || q.status === "IN_USE", equipmentTypeId: q.equipmentTypeId, nextInspectionDate: q.nextInspectionDate } : null;
  }

  /** Active bookings of one resource (any booking company), for conflict checks only. */
  bookingsOfResource(kind: "EMPLOYEE" | "EQUIPMENT", resourceId: string, from: Date, to: Date, excludeId?: string) {
    return this.tx.resourceBooking.findMany({
      where: { ...(kind === "EMPLOYEE" ? { employeeId: resourceId } : { equipmentId: resourceId }), status: ACTIVE_BOOKING, startsAt: { lt: to }, endsAt: { gt: from }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, startsAt: true, endsAt: true },
    });
  }

  // ── bookings ──────────────────────────────────────────────────────
  private bookingInclude = {
    employee: { select: { id: true, firstName: true, lastName: true, trade: true, status: true } },
    equipment: { select: { id: true, assetNumber: true, name: true, status: true, equipmentTypeId: true, nextInspectionDate: true, equipmentType: { select: { name: true } } } },
    project: { select: { id: true, code: true, name: true } },
    site: { select: { id: true, name: true } },
    activity: { select: { id: true, name: true, planId: true, taktArea: { select: { code: true } } } },
    requirement: true,
    company: { select: { id: true, name: true } },
    ownerCompany: { select: { id: true, name: true } },
  } satisfies Prisma.ResourceBookingInclude;

  createBooking(data: Create<Prisma.ResourceBookingUncheckedCreateInput>) {
    return this.tx.resourceBooking.create({ data: { ...data, ...this.c } });
  }

  /** A booking visible to this company: made by it, or of a resource it owns. */
  findBooking(id: string) {
    return this.tx.resourceBooking.findFirst({ where: { id, OR: [{ companyId: this.companyId }, { ownerCompanyId: this.companyId }] }, include: this.bookingInclude });
  }

  updateBooking(id: string, data: Prisma.ResourceBookingUncheckedUpdateInput) {
    return this.tx.resourceBooking.update({ where: { id }, data });
  }

  listBookings(where: { projectIds?: string[]; from?: Date; to?: Date; siteId?: string; activityId?: string }) {
    return this.tx.resourceBooking.findMany({
      where: {
        ...this.c,
        ...(where.projectIds ? { projectId: { in: where.projectIds } } : {}),
        ...(where.siteId ? { siteId: where.siteId } : {}),
        ...(where.activityId ? { activityId: where.activityId } : {}),
        ...(where.from ? { endsAt: { gt: where.from } } : {}),
        ...(where.to ? { startsAt: { lt: where.to } } : {}),
      },
      orderBy: { startsAt: "asc" },
      take: 300,
      include: this.bookingInclude,
    });
  }

  /** Requests from other companies for resources this company owns. */
  incomingBookings() {
    return this.tx.resourceBooking.findMany({ where: { ownerCompanyId: this.companyId, companyId: { not: this.companyId } }, orderBy: [{ status: "asc" }, { startsAt: "asc" }], take: 200, include: this.bookingInclude });
  }

  approvedBookingsInRange(from: Date, to: Date) {
    return this.tx.resourceBooking.findMany({
      where: { ...this.c, status: "APPROVED", startsAt: { lt: to }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true, resourceKind: true, employee: { select: { trade: true } }, equipment: { select: { equipmentTypeId: true } } },
    });
  }

  // ── locations ─────────────────────────────────────────────────────
  listLocations(siteId: string) {
    return this.tx.logisticsLocation.findMany({ where: { ...this.c, siteId, archivedAt: null }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
  }

  findLocation(id: string) {
    return this.tx.logisticsLocation.findFirst({ where: { id, ...this.c } });
  }

  createLocation(data: Create<Prisma.LogisticsLocationUncheckedCreateInput>) {
    return this.tx.logisticsLocation.create({ data: { ...data, ...this.c } });
  }

  updateLocation(id: string, data: Prisma.LogisticsLocationUncheckedUpdateInput) {
    return this.tx.logisticsLocation.update({ where: { id, ...this.c }, data });
  }

  // ── requests ──────────────────────────────────────────────────────
  private requestInclude = {
    site: { select: { id: true, name: true, projectId: true, project: { select: { code: true, name: true } } } },
    activity: { select: { id: true, name: true, planId: true, taktArea: { select: { code: true } }, workPackage: { select: { code: true } } } },
    equipmentType: { select: { id: true, name: true } },
    deliveries: { select: { id: true, material: true, slotStart: true, status: true } },
  } satisfies Prisma.LogisticsRequestInclude;

  createRequest(data: Create<Prisma.LogisticsRequestUncheckedCreateInput>) {
    return this.tx.logisticsRequest.create({ data: { ...data, ...this.c } });
  }

  findRequest(id: string) {
    return this.tx.logisticsRequest.findFirst({ where: { id, ...this.c }, include: this.requestInclude });
  }

  updateRequest(id: string, data: Prisma.LogisticsRequestUncheckedUpdateInput) {
    return this.tx.logisticsRequest.update({ where: { id, ...this.c }, data });
  }

  listRequests(where: { projectIds?: string[]; siteId?: string; status?: Prisma.LogisticsRequestWhereInput["status"]; from?: Date; to?: Date; activityId?: string }) {
    return this.tx.logisticsRequest.findMany({
      where: {
        ...this.c,
        ...(where.projectIds ? { projectId: { in: where.projectIds } } : {}),
        ...(where.siteId ? { siteId: where.siteId } : {}),
        ...(where.status ? { status: where.status } : {}),
        ...(where.activityId ? { activityId: where.activityId } : {}),
        ...(where.from ? { requestedEnd: { gt: where.from } } : {}),
        ...(where.to ? { requestedStart: { lt: where.to } } : {}),
      },
      orderBy: [{ requestedStart: "asc" }],
      take: 300,
      include: this.requestInclude,
    });
  }

  // ── deliveries ────────────────────────────────────────────────────
  private deliveryInclude = {
    site: { select: { id: true, name: true, projectId: true, project: { select: { code: true, name: true } } } },
    gate: { select: { id: true, name: true } },
    unloading: { select: { id: true, name: true } },
    storage: { select: { id: true, name: true } },
    request: { select: { id: true, title: true, status: true } },
    activity: { select: { id: true, name: true, planId: true, taktArea: { select: { code: true } }, workPackage: { select: { code: true, color: true } } } },
    constraint: { select: { id: true, status: true } },
  } satisfies Prisma.DeliveryInclude;

  createDelivery(data: Create<Prisma.DeliveryUncheckedCreateInput>) {
    return this.tx.delivery.create({ data: { ...data, ...this.c } });
  }

  findDelivery(id: string) {
    return this.tx.delivery.findFirst({ where: { id, ...this.c }, include: this.deliveryInclude });
  }

  updateDelivery(id: string, data: Prisma.DeliveryUncheckedUpdateInput) {
    return this.tx.delivery.update({ where: { id, ...this.c }, data });
  }

  listDeliveries(where: { siteId?: string; from?: Date; to?: Date; activityId?: string; projectIds?: string[] }) {
    return this.tx.delivery.findMany({
      where: {
        ...this.c,
        ...(where.siteId ? { siteId: where.siteId } : {}),
        ...(where.activityId ? { activityId: where.activityId } : {}),
        ...(where.projectIds ? { projectId: { in: where.projectIds } } : {}),
        ...(where.from ? { slotEnd: { gt: where.from } } : {}),
        ...(where.to ? { slotStart: { lt: where.to } } : {}),
      },
      orderBy: { slotStart: "asc" },
      take: 300,
      include: this.deliveryInclude,
    });
  }

  createConstraint(data: Create<Prisma.ActivityConstraintUncheckedCreateInput>) {
    return this.tx.activityConstraint.create({ data: { ...data, ...this.c } });
  }

  clearConstraint(id: string, userId: string) {
    return this.tx.activityConstraint.updateMany({ where: { id, ...this.c, status: "OPEN" }, data: { status: "CLEARED", clearedAt: new Date(), clearedById: userId, updatedById: userId } });
  }
}
