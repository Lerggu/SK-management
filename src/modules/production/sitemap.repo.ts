import type { Prisma, Tx } from "@/platform/db";

type Data<T> = Omit<T, "companyId">;
const OPEN = ["OPEN", "ACKNOWLEDGED"] as const;

/** Company-scoped repository of the site map (ADR 0034): every query carries company_id. */
export class SiteMapRepo {
  constructor(
    readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
  }

  sites(projectIds?: string[]) {
    return this.tx.site.findMany({
      where: { ...this.c, archivedAt: null, project: { archivedAt: null }, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
      select: { id: true, name: true, projectId: true, project: { select: { code: true } }, siteMaps: { where: { archivedAt: null }, select: { id: true } } },
      orderBy: [{ project: { code: "asc" } }, { name: "asc" }],
    });
  }

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, ...this.c, archivedAt: null }, select: { id: true, name: true, projectId: true, project: { select: { code: true } } } });
  }

  // ── maps ───────────────────────────────────────────────────────────
  activeMap(siteId: string) {
    return this.tx.siteMap.findFirst({ where: { ...this.c, siteId, archivedAt: null } });
  }

  findMap(id: string) {
    return this.tx.siteMap.findFirst({ where: { id, ...this.c } });
  }

  archiveMap(id: string, userId: string) {
    return this.tx.siteMap.update({ where: { id, companyId: this.companyId }, data: { archivedAt: new Date(), archivedById: userId } });
  }

  createMap(data: Data<Prisma.SiteMapUncheckedCreateInput>) {
    return this.tx.siteMap.create({ data: { ...data, ...this.c } });
  }

  // ── objects ────────────────────────────────────────────────────────
  objects(siteId: string) {
    return this.tx.siteMapObject.findMany({
      where: { ...this.c, siteId, archivedAt: null },
      include: { location: { select: { id: true, kind: true, name: true, opensMinute: true, closesMinute: true } } },
      orderBy: [{ kind: "asc" }, { code: "asc" }, { name: "asc" }],
    });
  }

  findObject(id: string) {
    return this.tx.siteMapObject.findFirst({ where: { id, ...this.c, archivedAt: null } });
  }

  createObject(data: Data<Prisma.SiteMapObjectUncheckedCreateInput>) {
    return this.tx.siteMapObject.create({ data: { ...data, ...this.c } });
  }

  updateObject(id: string, data: Prisma.SiteMapObjectUncheckedUpdateInput) {
    return this.tx.siteMapObject.update({ where: { id, companyId: this.companyId }, data });
  }

  /** Logistics locations of the site that are not on the map yet (can be placed). */
  unplacedLocations(siteId: string) {
    return this.tx.logisticsLocation.findMany({ where: { ...this.c, siteId, archivedAt: null, mapObject: null }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, kind: true, name: true } });
  }

  findLocation(id: string) {
    return this.tx.logisticsLocation.findFirst({ where: { id, ...this.c, archivedAt: null }, include: { mapObject: { select: { id: true } } } });
  }

  createLocation(data: Data<Prisma.LogisticsLocationUncheckedCreateInput>) {
    return this.tx.logisticsLocation.create({ data: { ...data, ...this.c } });
  }

  // ── task pins ──────────────────────────────────────────────────────
  pins(siteId: string) {
    return this.tx.siteMapTaskPin.findMany({ where: { ...this.c, siteId } });
  }

  findPinOfRequest(requestId: string) {
    return this.tx.siteMapTaskPin.findFirst({ where: { ...this.c, requestId } });
  }

  upsertPin(requestId: string, create: Data<Prisma.SiteMapTaskPinUncheckedCreateInput>, update: Prisma.SiteMapTaskPinUncheckedUpdateInput) {
    return this.tx.siteMapTaskPin.upsert({ where: { requestId }, create: { ...create, ...this.c }, update });
  }

  deletePin(id: string) {
    return this.tx.siteMapTaskPin.delete({ where: { id, companyId: this.companyId } });
  }

  detachPinsFromObject(objectId: string) {
    return this.tx.siteMapTaskPin.updateMany({ where: { ...this.c, objectId }, data: { objectId: null } });
  }

  findRequest(id: string) {
    return this.tx.logisticsRequest.findFirst({ where: { id, ...this.c }, select: { id: true, title: true, projectId: true, siteId: true, status: true } });
  }

  /** Tasks of a site overlapping a period, or pinned on the map, never cancelled ones. */
  siteTasks(siteId: string, from: Date, to: Date, pinnedIds: string[]) {
    return this.tx.logisticsRequest.findMany({
      where: {
        ...this.c,
        siteId,
        status: { not: "CANCELLED" },
        OR: [{ requestedStart: { lt: to }, requestedEnd: { gt: from } }, ...(pinnedIds.length ? [{ id: { in: pinnedIds } }] : [])],
      },
      select: { id: true, title: true, projectId: true, status: true, serviceType: true, requestedStart: true, requestedEnd: true, weightKg: true, taskTypeId: true },
      orderBy: { requestedStart: "asc" },
      take: 500,
    });
  }

  /** Open or acknowledged deviations of the site's objects and tasks. */
  openDeviations(objectIds: string[], requestIds: string[]) {
    if (!objectIds.length && !requestIds.length) return Promise.resolve([]);
    return this.tx.logisticsDeviation.findMany({
      where: { ...this.c, status: { in: [...OPEN] }, OR: [...(objectIds.length ? [{ mapObjectId: { in: objectIds } }] : []), ...(requestIds.length ? [{ requestId: { in: requestIds } }] : [])] },
      select: { id: true, type: true, status: true, comment: true, createdAt: true, mapObjectId: true, requestId: true },
      orderBy: { createdAt: "desc" },
    });
  }
}
