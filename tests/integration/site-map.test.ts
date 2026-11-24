/**
 * Site map in production control (ADR 0034) against real PostgreSQL: the
 * overview image, objects (gates with codes become logistics locations),
 * tasks dragged onto the map and objects, deviations reported on an object
 * or on a task at it make the object blink, and access by capability.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import type { RequestContext } from "@/platform/authz";
import { projectService, siteService } from "@/modules/projects/service";
import { logisticsRequestService } from "@/modules/logistics/logistics.service";
import { deviationService } from "@/modules/production/deviation.service";
import { siteMapService } from "@/modules/production/sitemap.service";
import { auditFor, createMember, createTenant, type Tenant } from "../helpers/fixtures";

/** A tiny PNG (magic bytes are what the server checks; the browser measures the size). */
const PNG = (n = 1) => ({ fileName: `asemapiirros-${n}.png`, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, 0, 0, 0]) });

let t: Tenant;
let o: RequestContext;
let projectId: string;
let siteId: string;
let otherSiteId: string;
let taskId: string;
let otherTaskId: string;
let gateId: string;
let craneId: string;

beforeAll(async () => {
  t = await createTenant("Map");
  o = t.ownerCtx;
  projectId = (await projectService.create(o, { code: "MAP", name: "Map project" })).id;
  siteId = (await siteService.create(o, projectId, { name: "Kampus" })).id;
  otherSiteId = (await siteService.create(o, projectId, { name: "Toinen työmaa" })).id;
  const day = new Date().toISOString().slice(0, 10);
  taskId = (await logisticsRequestService.create(o, { siteId, serviceType: "DELIVERY", title: "Kaapelikelat 4 kpl", requestedStart: `${day}T08:00`, requestedEnd: `${day}T10:00`, submit: "on" })).id;
  otherTaskId = (await logisticsRequestService.create(o, { siteId: otherSiteId, serviceType: "LIFT", title: "Muuntajan nosto", requestedStart: `${day}T12:00`, requestedEnd: `${day}T14:00`, submit: "on" })).id;
});

describe("site map", () => {
  it("shows the site without a map until one is uploaded", async () => {
    const v = await siteMapService.view(o, { siteId });
    expect(v.site?.id).toBe(siteId);
    expect(v.map).toBeNull();
    expect(v.tasks.map((x) => x.title)).toEqual(["Kaapelikelat 4 kpl"]);
    expect(v.can).toEqual({ edit: true, report: true });
  });

  it("accepts only images and replaces the previous map", async () => {
    await expect(siteMapService.uploadMap(o, siteId, { width: "2400", height: "1600" }, { fileName: "a.pdf", bytes: new TextEncoder().encode("%PDF-1.7 x") })).rejects.toBeInstanceOf(ValidationError);
    await expect(siteMapService.uploadMap(o, siteId, { width: "10", height: "1600" }, PNG())).rejects.toBeInstanceOf(ValidationError);
    const first = await siteMapService.uploadMap(o, siteId, { width: "2400", height: "1600", title: "Asemapiirros" }, PNG(1));
    const second = await siteMapService.uploadMap(o, siteId, { width: "3000", height: "2000" }, PNG(2));
    const v = await siteMapService.view(o, { siteId });
    expect(v.map).toMatchObject({ id: second.id, width: 3000, height: 2000, fileName: "asemapiirros-2.png" });
    expect(await db.siteMap.count({ where: { siteId, archivedAt: null } })).toBe(1);
    expect((await db.siteMap.findUniqueOrThrow({ where: { id: first.id } })).archivedAt).not.toBeNull();
    const img = await siteMapService.image(o, second.id);
    expect(img.contentType).toBe("image/png");
    expect(Array.from(img.body)).toEqual(Array.from(PNG(2).bytes));
    expect((await auditFor(t.companyId, second.id)).map((e) => e.action)).toContain("site_map.upload");
  });

  it("creates a gate with its code as a logistics location; codes are unique per site", async () => {
    const gate = await siteMapService.createObject(o, siteId, { kind: "GATE", code: "P1", name: "Portti 1 (pohjoinen)", x: "0.46", y: "0.1", opens: "06:00", closes: "18:00" });
    gateId = gate.id;
    const loc = await db.logisticsLocation.findUniqueOrThrow({ where: { id: gate.locationId! } });
    expect(loc).toMatchObject({ kind: "GATE", name: "P1 Portti 1 (pohjoinen)", opensMinute: 360, closesMinute: 1080, siteId });
    await expect(siteMapService.createObject(o, siteId, { kind: "CRANE", code: "p1", name: "Nosturi", x: "0.5", y: "0.5" })).rejects.toBeInstanceOf(ValidationError);
    await expect(siteMapService.createObject(o, siteId, { kind: "STORAGE", name: "Liian iso", x: "0.9", y: "0.5", width: "0.2", height: "0.1" })).rejects.toBeInstanceOf(ValidationError);
    await expect(siteMapService.createObject(o, siteId, { kind: "OTHER", name: "Ulkona", x: "1.5", y: "0.5" })).rejects.toBeInstanceOf(ValidationError);
    craneId = (await siteMapService.createObject(o, siteId, { kind: "CRANE", code: "N1", name: "Ajoneuvonosturi 100 t", x: "0.45", y: "0.3" })).id;
    const area = await siteMapService.createObject(o, siteId, { kind: "STORAGE", code: "V1", name: "Kaapelivarasto", x: "0.5", y: "0.6", width: "0.13", height: "0.18" });
    expect(area.locationId).not.toBeNull();
    const moved = await siteMapService.moveObject(o, area.id, { x: "0.52", y: "0.61", width: "0.2", height: "0.2" });
    expect(moved).toMatchObject({ x: 0.52, y: 0.61, width: 0.2, height: 0.2 });
    const point = await siteMapService.moveObject(o, craneId, { x: "0.44", y: "0.31", width: "0.3", height: "0.3" });
    expect(point).toMatchObject({ x: 0.44, y: 0.31, width: null, height: null });
    const renamed = await siteMapService.updateObject(o, craneId, { code: "N1", name: "Ajoneuvonosturi 100 t", notes: "Tukijalat levyjen päällä" });
    expect(renamed.notes).toBe("Tukijalat levyjen päällä");
  });

  it("places an existing location after its object is removed", async () => {
    const v1 = await siteMapService.view(o, { siteId });
    const storage = v1.objects.find((x) => x.code === "V1")!;
    await siteMapService.archiveObject(o, storage.id);
    const v2 = await siteMapService.view(o, { siteId });
    expect(v2.objects.map((x) => x.code)).not.toContain("V1");
    const loc = v2.locations.find((l) => l.name === "V1 Kaapelivarasto")!;
    expect(loc).toBeDefined();
    const again = await siteMapService.createObject(o, siteId, { kind: "STORAGE", code: "V1", name: "Kaapelivarasto", x: "0.5", y: "0.6", width: "0.1", height: "0.1", locationId: loc.id });
    expect(again.locationId).toBe(loc.id);
    await expect(siteMapService.createObject(o, siteId, { kind: "GATE", code: "X", name: "Väärä tyyppi", x: "0.1", y: "0.1", locationId: loc.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("drags a task onto the map and onto an object on the same site only", async () => {
    await siteMapService.placeTask(o, taskId, { x: "0.2", y: "0.2" });
    let v = await siteMapService.view(o, { siteId });
    expect(v.tasks.find((x) => x.id === taskId)?.pin).toEqual({ x: 0.2, y: 0.2, objectId: null });
    await siteMapService.placeTask(o, taskId, { x: "0.46", y: "0.1", objectId: gateId });
    v = await siteMapService.view(o, { siteId });
    expect(v.objects.find((x) => x.id === gateId)?.taskIds).toEqual([taskId]);
    await expect(siteMapService.placeTask(o, otherTaskId, { x: "0.5", y: "0.5", objectId: gateId })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.siteMapTaskPin.count({ where: { requestId: taskId } })).toBe(1);
  });

  it("blinks an object with an open deviation of its own or of a task at it", async () => {
    let v = await siteMapService.view(o, { siteId });
    expect(v.objects.find((x) => x.id === craneId)?.blinking).toBe(false);
    const d = await deviationService.reportOnObject(o, craneId, { type: "EQUIPMENT_FAULT", comment: "Tukijalan anturi hälyttää" });
    v = await siteMapService.view(o, { siteId });
    const crane = v.objects.find((x) => x.id === craneId)!;
    expect(crane.blinking).toBe(true);
    expect(crane.deviations).toEqual([expect.objectContaining({ id: d.id, type: "EQUIPMENT_FAULT", status: "OPEN" })]);

    const listed = (await deviationService.list(o, { open: "1" })).find((x) => x.id === d.id)!;
    expect(listed.task).toBeNull();
    expect(listed.object).toMatchObject({ id: craneId, label: "N1 Ajoneuvonosturi 100 t", siteId });

    const td = await deviationService.report(o, taskId, { type: "LATE_DELIVERY", comment: "Rekka myöhässä" });
    v = await siteMapService.view(o, { siteId });
    expect(v.objects.find((x) => x.id === gateId)?.blinking).toBe(true);
    expect(v.tasks.find((x) => x.id === taskId)?.deviations).toHaveLength(1);

    await deviationService.resolve(o, d.id, { resolution: "Anturi vaihdettu" });
    await deviationService.resolve(o, td.id, {});
    v = await siteMapService.view(o, { siteId });
    expect(v.objects.find((x) => x.id === craneId)?.blinking).toBe(false);
    expect(v.objects.find((x) => x.id === gateId)?.blinking).toBe(false);
  });

  it("keeps the database rule: a deviation concerns a task or an object", async () => {
    await expect(db.logisticsDeviation.create({ data: { companyId: t.companyId, projectId, type: "OTHER", reportedById: t.owner.user.id } })).rejects.toThrow();
  });

  it("removes a task from the map", async () => {
    await siteMapService.unplaceTask(o, taskId);
    const v = await siteMapService.view(o, { siteId });
    expect(v.tasks.find((x) => x.id === taskId)?.pin).toBeNull();
  });
});

describe("site map access", () => {
  it("lets site staff see the map and report, but only approvers change it", async () => {
    const sup = await createMember(t, "SUPERVISOR", [{ projectId }]);
    const v = await siteMapService.view(sup, { siteId });
    expect(v.can).toEqual({ edit: false, report: true });
    expect(v.locations).toEqual([]);
    await expect(siteMapService.createObject(sup, siteId, { kind: "OTHER", name: "Ei saa", x: "0.1", y: "0.1" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(siteMapService.moveObject(sup, gateId, { x: "0.1", y: "0.1" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(siteMapService.placeTask(sup, taskId, { x: "0.1", y: "0.1" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(siteMapService.uploadMap(sup, siteId, { width: "100", height: "100" }, PNG())).rejects.toBeInstanceOf(ForbiddenError);
    const d = await deviationService.reportOnObject(sup, gateId, { type: "SAFETY", comment: "Portin puomi rikki" });
    expect(d.status).toBe("OPEN");

    const sm = await createMember(t, "SITE_MANAGER", [{ projectId }]);
    expect((await siteMapService.view(sm, { siteId })).can.edit).toBe(true);
  });

  it("hides the map from members without the project and from external members", async () => {
    const unassigned = await createMember(t, "SUPERVISOR");
    await expect(siteMapService.view(unassigned, { siteId })).rejects.toBeInstanceOf(ForbiddenError);
    const client = await createMember(t, "CLIENT", [{ projectId }]);
    await expect(siteMapService.view(client, { siteId })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deviationService.reportOnObject(client, gateId, { type: "OTHER" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
