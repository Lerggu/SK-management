/**
 * Workforce rotation plan (ADR 0027): ranges, rhythm, privacy of sick leave,
 * permissions, and the warning in logistics staffing. Real PostgreSQL.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import type { RequestContext } from "@/platform/authz";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { rotationService } from "@/modules/workforce/rotation.service";
import { logisticsRequestService } from "@/modules/logistics/logistics.service";
import { staffingService, taskTypeService } from "@/modules/production/service";
import { createMember, createTenant, type Tenant } from "../helpers/fixtures";

let t: Tenant;
let o: RequestContext;
let siteId: string;
let otherSite: string;
let anna: string;
let bertta: string;

beforeAll(async () => {
  t = await createTenant("Rotation");
  o = t.ownerCtx;
  const p = await projectService.create(o, { code: "R", name: "Rotation project" });
  siteId = (await siteService.create(o, p.id, { name: "Työmaa R" })).id;
  otherSite = (await siteService.create(o, p.id, { name: "Työmaa S" })).id;
  anna = (await employeeService.create(o, { employeeNumber: "R1", firstName: "Anna", lastName: "Asentaja", trade: "Asentaja" })).id;
  bertta = (await employeeService.create(o, { employeeNumber: "R2", firstName: "Bertta", lastName: "Betoni", trade: "Betonityöntekijä" })).id;
});

describe("rotation plan", () => {
  it("sets a range on a site, shows it per site and per person, and overwrites on re-set", async () => {
    expect(await rotationService.setRange(o, { employeeId: anna, from: "2026-12-07", until: "2026-12-11", status: "WORK", siteId })).toEqual({ days: 5 });
    await rotationService.setRange(o, { employeeId: anna, from: "2026-12-10", until: "2026-12-10", status: "WORK", siteId: otherSite });
    const b = await rotationService.board(o, { date: "2026-12-09", weeks: 1 });
    expect(b.range).toMatchObject({ start: "2026-12-07", end: "2026-12-13" });
    const a = b.people.find((p) => p.id === anna)!;
    expect(a.workDays).toBe(5);
    expect(a.days["2026-12-10"]).toEqual({ status: "WORK", siteId: otherSite, note: null });
    expect(b.sites.find((s) => s.id === siteId)!.days["2026-12-08"]).toEqual([anna]);
    expect(b.sites.find((s) => s.id === siteId)!.days["2026-12-10"]).toEqual([]);
    expect(b.days.find((d) => d.date === "2026-12-12")!.weekend).toBe(true);
    const audit = await db.auditEvent.findFirst({ where: { companyId: t.companyId, action: "rotation.set", entityId: anna } });
    expect(audit).not.toBeNull();
  });

  it("marks Finnish holidays", async () => {
    const b = await rotationService.board(o, { date: "2026-12-06", weeks: 1 });
    expect(b.days.find((d) => d.date === "2026-12-06")!.holiday).toBe("Itsenäisyyspäivä");
  });

  it("validates: site only at work, order and length of the range, active employee in the company", async () => {
    await expect(rotationService.setRange(o, { employeeId: anna, from: "2026-12-01", until: "2026-12-01", status: "OFF", siteId })).rejects.toBeInstanceOf(ValidationError);
    await expect(rotationService.setRange(o, { employeeId: anna, from: "2026-12-05", until: "2026-12-01", status: "OFF" })).rejects.toBeInstanceOf(ValidationError);
    await expect(rotationService.setRange(o, { employeeId: anna, from: "2026-01-01", until: "2027-06-01", status: "OFF" })).rejects.toBeInstanceOf(ValidationError);
    await expect(rotationService.setRange(o, { employeeId: "01900000-0000-7000-8000-000000000000", from: "2026-12-01", until: "2026-12-01", status: "OFF" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(db.rotationEntry.create({ data: { companyId: t.companyId, employeeId: anna, day: new Date("2027-03-01"), status: "SICK", siteId, projectId: (await db.site.findUniqueOrThrow({ where: { id: siteId } })).projectId } })).rejects.toThrow(/rotation_entries_site_only_work/);
  });

  it("hides sick leave and other reasons from viewers, shows them to managers", async () => {
    await rotationService.setRange(o, { employeeId: bertta, from: "2026-12-14", until: "2026-12-15", status: "SICK", note: "flunssa" });
    await rotationService.setRange(o, { employeeId: bertta, from: "2026-12-16", until: "2026-12-16", status: "VACATION", note: "x" });
    const mgr = (await rotationService.board(o, { date: "2026-12-14", weeks: 1 })).people.find((p) => p.id === bertta)!;
    expect(mgr.days["2026-12-14"]).toEqual({ status: "SICK", siteId: null, note: "flunssa" });
    const sup = await createMember(t, "SUPERVISOR");
    const view = await rotationService.board(sup, { date: "2026-12-14", weeks: 1 });
    expect(view.canManage).toBe(false);
    const b = view.people.find((p) => p.id === bertta)!;
    expect(b.days["2026-12-14"]).toEqual({ status: "ABSENT", siteId: null, note: null });
    expect(b.days["2026-12-16"]).toEqual({ status: "VACATION", siteId: null, note: null });
    expect(JSON.stringify(view)).not.toContain("flunssa");
    expect(view.statusRows.map((r) => r.status)).not.toContain("SICK");
  });

  it("applies a work/off rhythm without overwriting absences, and clears a range", async () => {
    const r = await rotationService.applyPattern(o, { employeeIds: [anna, bertta], from: "2026-12-14", until: "2026-12-20", workDays: "3", offDays: "2", siteId });
    // Bertta's sick days (14–15) and vacation (16) are kept.
    expect(r).toEqual({ written: 11, kept: 3 });
    const b = await rotationService.board(o, { date: "2026-12-14", weeks: 1 });
    const a = b.people.find((p) => p.id === anna)!;
    expect(["14", "15", "16", "17", "18", "19", "20"].map((d) => a.days[`2026-12-${d}`].status)).toEqual(["WORK", "WORK", "WORK", "OFF", "OFF", "WORK", "WORK"]);
    expect(b.people.find((p) => p.id === bertta)!.days["2026-12-14"].status).toBe("SICK");
    expect(await rotationService.applyPattern(o, { employeeIds: [anna], from: "2026-12-14", until: "2026-12-16", workDays: "1", offDays: "1" })).toEqual({ written: 0, kept: 3 });
    expect(await rotationService.clearRange(o, { employeeId: anna, from: "2026-12-19", until: "2026-12-20" })).toEqual({ removed: 2 });
  });

  it("only rotation.manage edits; external roles have no access", async () => {
    const sup = await createMember(t, "SUPERVISOR");
    await expect(rotationService.setRange(sup, { employeeId: anna, from: "2026-12-01", until: "2026-12-01", status: "OFF" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rotationService.applyPattern(sup, { employeeIds: [anna], from: "2026-12-01", until: "2026-12-02", workDays: "1", offDays: "1" })).rejects.toBeInstanceOf(ForbiddenError);
    const sm = await createMember(t, "SITE_MANAGER");
    expect((await rotationService.setRange(sm, { employeeId: anna, from: "2026-12-02", until: "2026-12-02", status: "TRAINING" })).days).toBe(1);
    const client = await createMember(t, "CLIENT");
    await expect(rotationService.board(client)).rejects.toBeInstanceOf(ForbiddenError);
    const employee = await createMember(t, "EMPLOYEE");
    await expect(rotationService.board(employee)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("warns in logistics staffing when a candidate is away in the rotation plan", async () => {
    const type = await taskTypeService.create(o, { name: "Rotaatiotesti", serviceType: "DELIVERY" });
    await taskTypeService.addRole(o, type.id, { kind: "PERSON", label: "Purkaja", quantity: "1" });
    await rotationService.setRange(o, { employeeId: bertta, from: "2027-01-11", until: "2027-01-11", status: "VACATION" });
    const task = await logisticsRequestService.create(o, { siteId, serviceType: "DELIVERY", title: "Purku", requestedStart: "2027-01-11T08:00", requestedEnd: "2027-01-11T10:00", taskTypeId: type.id });
    const s = await staffingService.get(o, task.id);
    const cands = s.needs[0].candidates;
    expect(cands.find((c) => c.value === `EMPLOYEE:${bertta}`)!.issues).toContain("ABSENT");
    expect(cands.find((c) => c.value === `EMPLOYEE:${anna}`)!.issues).not.toContain("ABSENT");
    expect(cands.findIndex((c) => c.value === `EMPLOYEE:${anna}`)).toBeLessThan(cands.findIndex((c) => c.value === `EMPLOYEE:${bertta}`));
  });
});
