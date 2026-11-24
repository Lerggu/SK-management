import { v7 as uuidv7 } from "uuid";
import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { getStorage } from "@/platform/storage";
import { uploadMaxBytes } from "@/platform/config/env";
import { checkRateLimit, RATE_LIMITS } from "@/platform/ratelimit";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { hasProjectPermission, projectIdsWithPermission, type RequestContext } from "@/platform/authz";
import { requireLogistics } from "@/modules/logistics/access";
import { sha256Hex } from "@/modules/documents/versioning";
import { sniffContentType } from "@/modules/hr/files.service";
import { ProductionRepo } from "./repo";
import { SiteMapRepo } from "./sitemap.repo";
import { calendarRange, taskPhase } from "./calendar";
import { openRolesOf } from "./calendar.service";
import {
  LOCATION_KINDS,
  createObjectSchema,
  moveObjectSchema,
  placeTaskSchema,
  siteMapViewSchema,
  updateObjectSchema,
  uploadMapSchema,
  type CreateObjectInput,
  type MoveObjectInput,
  type PlaceTaskInput,
  type SiteMapViewInput,
  type UpdateObjectInput,
  type UploadMapInput,
} from "./sitemap.schemas";

/**
 * Site map in production control (ADR 0034): an overview image per site,
 * objects on it (gates with their codes, cranes, storage …) and logistics
 * tasks dragged onto it. Open deviations of an object or of a task pinned to
 * it make the object blink red.
 *
 * Access: `logistics.view` in the site's project to see the map;
 * `logistics.approve` (who manages gates and storage) to change it.
 */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function noExternal(ctx: RequestContext) {
  if (ctx.external) throw new NotFoundError();
}

async function loadSite(repo: SiteMapRepo, ctx: RequestContext, siteId: string, permission: "logistics.view" | "logistics.approve") {
  noExternal(ctx);
  const site = await repo.findSite(siteId);
  if (!site) throw new NotFoundError();
  requireLogistics(ctx, site.projectId, permission);
  return site;
}

async function loadObject(repo: SiteMapRepo, ctx: RequestContext, objectId: string, permission: "logistics.view" | "logistics.approve") {
  noExternal(ctx);
  const o = await repo.findObject(objectId);
  if (!o) throw new NotFoundError();
  requireLogistics(ctx, o.projectId, permission);
  return o;
}


export const siteMapService = {
  /** The map of a site with its objects, the site's tasks for the period and what blinks. */
  async view(ctx: RequestContext, input: SiteMapViewInput = {}) {
    noExternal(ctx);
    const data = parseInput(siteMapViewSchema, input);
    const projectIds = projectIdsWithPermission(ctx, "logistics.view");
    if (projectIds && projectIds.length === 0) throw new ForbiddenError("Missing permission logistics.view");
    const repo = new SiteMapRepo(readClient(), ctx.company.id);
    const sites = await repo.sites(projectIds);
    if (data.siteId && !sites.some((s) => s.id === data.siteId)) throw new NotFoundError();
    // Without a choice: the first site that has a map, else the first site.
    const site = sites.find((s) => s.id === data.siteId) ?? sites.find((s) => s.siteMaps.length > 0) ?? sites[0] ?? null;
    const range = calendarRange(data.range, data.date ?? todayInDisplayZone());
    const siteList = sites.map((s) => ({ id: s.id, name: `${s.project.code} · ${s.name}`, hasMap: s.siteMaps.length > 0 }));
    const rangeOut = { kind: data.range, startDate: range.startDate, prevDate: range.prevDate, nextDate: range.nextDate, today: todayInDisplayZone() };
    if (!site) return { sites: siteList, site: null, map: null, objects: [], tasks: [], locations: [], range: rangeOut, can: { edit: false, report: false } };

    const [map, objects, pins] = await Promise.all([repo.activeMap(site.id), repo.objects(site.id), repo.pins(site.id)]);
    const tasks = await repo.siteTasks(site.id, range.from, range.to, pins.map((p) => p.requestId));
    const prepo = new ProductionRepo(repo.tx, ctx.company.id);
    const [types, bookings, deviations] = await Promise.all([
      prepo.listTypes(true),
      prepo.bookingsOfTasks(tasks.map((t) => t.id)),
      repo.openDeviations(
        objects.map((o) => o.id),
        tasks.map((t) => t.id),
      ),
    ]);
    const now = new Date();
    const pinOf = new Map(pins.map((p) => [p.requestId, p]));
    const taskRows = tasks.map((t) => {
      const type = types.find((x) => x.id === t.taskTypeId) ?? null;
      const { missing } = openRolesOf(type, t.weightKg, t.id, bookings);
      const pin = pinOf.get(t.id) ?? null;
      const inRange = t.requestedStart < range.to && t.requestedEnd > range.from;
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        serviceType: t.serviceType,
        start: t.requestedStart,
        end: t.requestedEnd,
        taskType: type ? { name: type.name, color: type.color } : null,
        phase: taskPhase({ status: t.status, end: t.requestedEnd, missing, hasType: Boolean(type) }, now),
        missing,
        inRange,
        pin: pin ? { x: pin.x, y: pin.y, objectId: pin.objectId } : null,
        deviations: deviations.filter((d) => d.requestId === t.id).map(({ id, type: dt, status, comment, createdAt }) => ({ id, type: dt, status, comment, createdAt })),
      };
    });
    const objectRows = objects.map((o) => {
      const own = deviations.filter((d) => d.mapObjectId === o.id);
      const viaTasks = taskRows.filter((t) => t.pin?.objectId === o.id && t.deviations.length > 0);
      return {
        id: o.id,
        kind: o.kind,
        code: o.code,
        name: o.name,
        notes: o.notes,
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        location: o.location ? { id: o.location.id, kind: o.location.kind, opensMinute: o.location.opensMinute, closesMinute: o.location.closesMinute } : null,
        taskIds: taskRows.filter((t) => t.pin?.objectId === o.id).map((t) => t.id),
        deviations: own.map(({ id, type, status, comment, createdAt }) => ({ id, type, status, comment, createdAt })),
        // Blinks red while it or a task at it has an open deviation.
        blinking: own.length > 0 || viaTasks.length > 0,
      };
    });
    const canEdit = hasProjectPermission(ctx, site.projectId, "logistics.approve");
    return {
      sites: siteList,
      site: { id: site.id, name: `${site.project.code} · ${site.name}`, projectId: site.projectId },
      map: map ? { id: map.id, title: map.title, width: map.widthPx, height: map.heightPx, fileName: map.fileName, createdAt: map.createdAt } : null,
      objects: objectRows,
      tasks: taskRows,
      locations: canEdit ? await repo.unplacedLocations(site.id) : [],
      range: rangeOut,
      can: { edit: canEdit, report: hasProjectPermission(ctx, site.projectId, "logistics.view") },
    };
  },

  /** The map image (authorized; the image is never public). */
  async image(ctx: RequestContext, mapId: string) {
    noExternal(ctx);
    const repo = new SiteMapRepo(readClient(), ctx.company.id);
    const map = await repo.findMap(mapId);
    if (!map) throw new NotFoundError();
    requireLogistics(ctx, map.projectId, "logistics.view");
    const object = await getStorage().get(map.storageKey);
    if (!object) throw new NotFoundError("File missing from storage");
    return { fileName: map.fileName, contentType: map.contentType, body: object.body, sha256: map.sha256 };
  },

  /**
   * Uploads a site's overview image (PNG, JPEG or WebP; a PDF is converted to
   * an image in the browser). It replaces the previous map; objects and task
   * pins stay where they are.
   */
  async uploadMap(ctx: RequestContext, siteId: string, input: UploadMapInput, file: { fileName: string; bytes: Uint8Array }) {
    const data = parseInput(uploadMapSchema, input);
    const site = await loadSite(new SiteMapRepo(readClient(), ctx.company.id), ctx, siteId, "logistics.approve");
    checkRateLimit(RATE_LIMITS.upload, ctx.user.id);
    if (!file || file.bytes.byteLength === 0) throw new ValidationError({ file: ["validation.fileRequired"] });
    if (file.bytes.byteLength > uploadMaxBytes()) throw new ValidationError({ file: ["validation.fileTooLarge"] });
    const contentType = sniffContentType(file.bytes);
    if (!contentType || !IMAGE_TYPES.has(contentType)) throw new ValidationError({ file: ["validation.imageOnly"] });
    const id = uuidv7();
    const storageKey = `companies/${ctx.company.id}/site-maps/${site.id}/${id}.${EXT[contentType]}`;
    // Written before the transaction; if it fails the object is never referenced.
    await getStorage().put(storageKey, file.bytes, contentType);
    const base = (file.fileName.replace(/\.[^.]+$/, "") || "aluekartta").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 80);
    return runInTransaction(async (tx) => {
      const repo = new SiteMapRepo(tx, ctx.company.id);
      const previous = await repo.activeMap(site.id);
      if (previous) await repo.archiveMap(previous.id, ctx.user.id);
      const map = await repo.createMap({
        id,
        projectId: site.projectId,
        siteId: site.id,
        title: data.title,
        fileName: `${base}.${EXT[contentType]}`,
        contentType,
        sizeBytes: BigInt(file.bytes.byteLength),
        sha256: sha256Hex(file.bytes),
        storageKey,
        widthPx: data.width,
        heightPx: data.height,
        createdById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: "site_map.upload", entityType: "site_map", entityId: map.id, projectId: site.projectId, after: { siteId: site.id, fileName: map.fileName, sizeBytes: map.sizeBytes, sha256: map.sha256, replaced: previous?.id ?? null } });
      return { id: map.id };
    });
  },

  /** Adds an object; a new gate, unloading point or storage also becomes a logistics location (same name). */
  async createObject(ctx: RequestContext, siteId: string, input: CreateObjectInput) {
    const data = parseInput(createObjectSchema, input);
    const site = await loadSite(new SiteMapRepo(readClient(), ctx.company.id), ctx, siteId, "logistics.approve");
    try {
      return await runInTransaction(async (tx) => {
        const repo = new SiteMapRepo(tx, ctx.company.id);
        let locationId: string | null = null;
        if (data.locationId) {
          const loc = await repo.findLocation(data.locationId);
          if (!loc || loc.siteId !== site.id || loc.mapObject) throw new ValidationError({ locationId: ["validation.invalidOption"] });
          if (loc.kind !== data.kind) throw new ValidationError({ kind: ["validation.invalidOption"] });
          locationId = loc.id;
        } else if (LOCATION_KINDS.includes(data.kind)) {
          const loc = await repo.createLocation({
            projectId: site.projectId,
            siteId: site.id,
            kind: data.kind as "GATE" | "UNLOADING" | "STORAGE",
            // The code is shown on the map; the location keeps the plain name used in delivery forms.
            name: data.name,
            opensMinute: data.kind === "GATE" ? data.opens : null,
            closesMinute: data.kind === "GATE" ? data.closes : null,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          });
          locationId = loc.id;
          await writeAudit(tx, ctx, { action: "logistics_location.create", entityType: "logistics_location", entityId: loc.id, projectId: site.projectId, after: loc });
        }
        const o = await repo.createObject({
          projectId: site.projectId,
          siteId: site.id,
          kind: data.kind,
          code: data.code,
          name: data.name,
          x: data.x,
          y: data.y,
          width: data.width,
          height: data.height,
          notes: data.notes,
          locationId,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        });
        await writeAudit(tx, ctx, { action: "site_map_object.create", entityType: "site_map_object", entityId: o.id, projectId: site.projectId, after: o });
        return o;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError({ code: ["validation.codeTaken"] });
      throw e;
    }
  },

  async updateObject(ctx: RequestContext, objectId: string, input: UpdateObjectInput) {
    const data = parseInput(updateObjectSchema, input);
    const before = await loadObject(new SiteMapRepo(readClient(), ctx.company.id), ctx, objectId, "logistics.approve");
    try {
      return await runInTransaction(async (tx) => {
        const repo = new SiteMapRepo(tx, ctx.company.id);
        const after = await repo.updateObject(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "site_map_object.update", entityType: "site_map_object", entityId: before.id, projectId: before.projectId, before, after, diff: true });
        return after;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError({ code: ["validation.codeTaken"] });
      throw e;
    }
  },

  /** Moves (and for an area, resizes) an object by dragging. */
  async moveObject(ctx: RequestContext, objectId: string, input: MoveObjectInput) {
    const data = parseInput(moveObjectSchema, input);
    const before = await loadObject(new SiteMapRepo(readClient(), ctx.company.id), ctx, objectId, "logistics.approve");
    // A point stays a point: a size is kept only for an area.
    const size = before.width === null ? { width: null, height: null } : { width: data.width ?? before.width, height: data.height ?? before.height };
    if (size.width !== null && (data.x + size.width > 1.000001 || data.y + size.height! > 1.000001)) throw new ValidationError({ width: ["validation.areaOutside"] });
    return runInTransaction(async (tx) => {
      const after = await new SiteMapRepo(tx, ctx.company.id).updateObject(before.id, { x: data.x, y: data.y, ...size, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "site_map_object.move", entityType: "site_map_object", entityId: before.id, projectId: before.projectId, before: { x: before.x, y: before.y, width: before.width, height: before.height }, after: { x: after.x, y: after.y, width: after.width, height: after.height } });
      return after;
    });
  },

  /** Removes an object from the map; its tasks stay pinned where they were, and its logistics location is kept. */
  async archiveObject(ctx: RequestContext, objectId: string) {
    const before = await loadObject(new SiteMapRepo(readClient(), ctx.company.id), ctx, objectId, "logistics.approve");
    return runInTransaction(async (tx) => {
      const repo = new SiteMapRepo(tx, ctx.company.id);
      await repo.detachPinsFromObject(before.id);
      // The location link is released so the location can be placed again.
      await repo.updateObject(before.id, { archivedAt: new Date(), locationId: null, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "site_map_object.archive", entityType: "site_map_object", entityId: before.id, projectId: before.projectId, before: { name: before.name, code: before.code } });
    });
  },

  /** Drops a task on the map, optionally at an object (the task and the object must be on the same site). */
  async placeTask(ctx: RequestContext, requestId: string, input: PlaceTaskInput) {
    const data = parseInput(placeTaskSchema, input);
    noExternal(ctx);
    const readRepo = new SiteMapRepo(readClient(), ctx.company.id);
    const task = await readRepo.findRequest(requestId);
    if (!task) throw new NotFoundError();
    requireLogistics(ctx, task.projectId, "logistics.approve");
    if (data.objectId) {
      const o = await readRepo.findObject(data.objectId);
      if (!o || o.siteId !== task.siteId) throw new ValidationError({ objectId: ["validation.invalidOption"] });
    }
    return runInTransaction(async (tx) => {
      const repo = new SiteMapRepo(tx, ctx.company.id);
      const before = await repo.findPinOfRequest(task.id);
      const pin = await repo.upsertPin(
        task.id,
        { projectId: task.projectId, siteId: task.siteId, requestId: task.id, objectId: data.objectId, x: data.x, y: data.y, createdById: ctx.user.id, updatedById: ctx.user.id },
        { objectId: data.objectId, x: data.x, y: data.y, updatedById: ctx.user.id },
      );
      await writeAudit(tx, ctx, { action: "site_map.place_task", entityType: "logistics_request", entityId: task.id, projectId: task.projectId, before: before ? { x: before.x, y: before.y, objectId: before.objectId } : null, after: { x: pin.x, y: pin.y, objectId: pin.objectId } });
      return pin;
    });
  },

  async unplaceTask(ctx: RequestContext, requestId: string) {
    noExternal(ctx);
    const readRepo = new SiteMapRepo(readClient(), ctx.company.id);
    const task = await readRepo.findRequest(requestId);
    if (!task) throw new NotFoundError();
    requireLogistics(ctx, task.projectId, "logistics.approve");
    return runInTransaction(async (tx) => {
      const repo = new SiteMapRepo(tx, ctx.company.id);
      const pin = await repo.findPinOfRequest(task.id);
      if (!pin) return;
      await repo.deletePin(pin.id);
      await writeAudit(tx, ctx, { action: "site_map.unplace_task", entityType: "logistics_request", entityId: task.id, projectId: task.projectId, before: { x: pin.x, y: pin.y, objectId: pin.objectId } });
    });
  },
};
