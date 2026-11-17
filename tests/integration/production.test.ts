/**
 * Production control, phase 1 (ADR 0026): task types with resource needs,
 * rule-based candidates from HR cards and competence, and staffing a
 * logistics task through bookings. Real PostgreSQL.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import type { RequestContext } from "@/platform/authz";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { logisticsRequestService } from "@/modules/logistics/logistics.service";
import { competenceAreaService, qualificationTypeService } from "@/modules/hr/settings.service";
import { assessmentService, qualificationService } from "@/modules/hr/card.service";
import { staffingService, taskTypeService } from "@/modules/production/service";
import { createMember, createTenant, type Tenant } from "../helpers/fixtures";

interface W {
  t: Tenant;
  o: RequestContext;
  projectId: string;
  siteId: string;
  liftType: string;
  riggerRole: string;
  supervisorRole: string;
  craneRole: string;
  heavyRole: string;
  card: string;
  area: string;
  craneTypeId: string;
  ok: string;
  noCard: string;
  lowLevel: string;
  crane: string;
  brokenCrane: string;
}
let w: W;

const task = (title: string, start = "2027-01-11T08:00", end = "2027-01-11T12:00", weightKg: string | undefined = "3000") =>
  logisticsRequestService.create(w.o, { siteId: w.siteId, serviceType: "LIFT", title, requestedStart: start, requestedEnd: end, weightKg, taskTypeId: w.liftType, submit: "on" });

beforeAll(async () => {
  const t = await createTenant("Prod");
  const o = t.ownerCtx;
  const project = await projectService.create(o, { code: "P", name: "Production project" });
  const site = await siteService.create(o, project.id, { name: "Site P" });
  const card = (await qualificationTypeService.create(o, { name: "Taakankiinnittäjäkortti" })).id;
  const area = (await competenceAreaService.create(o, { category: "Nostot", name: "Nostotyöt" })).id;
  const craneType = await equipmentTypeService.create(o, { name: "Nosturi", category: "CRANE" });
  const crane = (await equipmentService.create(o, { equipmentTypeId: craneType.id, assetNumber: "N1", name: "Nosturi 1", nextInspectionDate: "2027-06-01" })).id;
  const brokenCrane = (await equipmentService.create(o, { equipmentTypeId: craneType.id, assetNumber: "N2", name: "Nosturi 2", status: "OUT_OF_SERVICE" })).id;
  const person = async (n: string, first: string) => (await employeeService.create(o, { employeeNumber: n, firstName: first, lastName: "Nostaja" })).id;
  const ok = await person("P1", "Olli");
  const noCard = await person("P2", "Kalle");
  const lowLevel = await person("P3", "Lauri");
  for (const id of [ok, lowLevel]) await qualificationService.add(o, id, { typeId: card, expiresOn: "2030-01-01" });
  await qualificationService.add(o, noCard, { typeId: card, expiresOn: "2020-01-01" });
  await assessmentService.create(o, ok, { areaId: area, level: "4", assessedOn: "2026-10-01", publish: "on" });
  await assessmentService.create(o, lowLevel, { areaId: area, level: "2", assessedOn: "2026-10-01", publish: "on" });

  const lift = await taskTypeService.create(o, { name: "Nosto", serviceType: "LIFT", color: "amber" });
  const rigger = await taskTypeService.addRole(o, lift.id, { kind: "PERSON", label: "Taakankiinnittäjä", quantity: "2", qualificationTypeId: card, areaId: area, minLevel: "3" });
  const sup = await taskTypeService.addRole(o, lift.id, { kind: "PERSON", label: "Nostotyönjohtaja", quantity: "1", areaId: area, minLevel: "4" });
  const craneRole = await taskTypeService.addRole(o, lift.id, { kind: "EQUIPMENT", label: "Nosturi", equipmentTypeId: craneType.id });
  const heavy = await taskTypeService.addRole(o, lift.id, { kind: "PERSON", label: "Raskaan noston valvoja", minWeightKg: "5000" });
  w = { t, o, projectId: project.id, siteId: site.id, liftType: lift.id, riggerRole: rigger.id, supervisorRole: sup.id, craneRole: craneRole.id, heavyRole: heavy.id, card, area, craneTypeId: craneType.id, ok, noCard, lowLevel, crane, brokenCrane };
});

describe("task types", () => {
  it("only logistics approvers manage the catalogue; readers list it", async () => {
    const sup = await createMember(w.t, "SUPERVISOR");
    await expect(taskTypeService.create(sup, { name: "X" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await taskTypeService.list(sup)).some((x) => x.id === w.liftType)).toBe(true);
    const client = await createMember(w.t, "CLIENT");
    await expect(taskTypeService.list(client)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(taskTypeService.create(w.o, { name: "Nosto" })).rejects.toMatchObject({ field: "name" });
    await expect(taskTypeService.addRole(w.o, w.liftType, { kind: "EQUIPMENT", label: "Ilman tyyppiä" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("adds the suggested task types once and links HR catalogue entries by name", async () => {
    const t = await createTenant("ProdSuggest");
    await competenceAreaService.addSuggested(t.ownerCtx);
    expect((await taskTypeService.addSuggested(t.ownerCtx)).added).toBe(5);
    expect((await taskTypeService.addSuggested(t.ownerCtx)).added).toBe(0);
    const lift = (await taskTypeService.list(t.ownerCtx)).find((x) => x.name === "Nosto")!;
    expect(lift.roles.map((r) => [r.label, r.quantity])).toEqual([
      ["Nostotyönjohtaja", 1],
      ["Taakankiinnittäjä", 2],
      ["Merkinantaja", 1],
      ["Nostoalueen valvoja", 1],
    ]);
    expect(lift.roles.every((r) => r.areaId && r.minLevel)).toBe(true);
  });
});

describe("staffing", () => {
  it("lists needs by weight with ranked candidates and the reasons they do not fit", async () => {
    const r = await task("Ristikko");
    const s = await staffingService.get(w.o, r.id);
    expect(s.readiness).toBe("MISSING");
    expect(s.needs.map((n) => n.role.label)).toEqual(["Taakankiinnittäjä", "Nostotyönjohtaja", "Nosturi"]);
    const rigger = s.needs.find((n) => n.role.id === w.riggerRole)!;
    const byLabel = Object.fromEntries(rigger.candidates.map((c) => [c.label, c.issues]));
    expect(byLabel["Nostaja Olli"]).toEqual([]);
    expect(byLabel["Nostaja Lauri"]).toEqual(["LEVEL_LOW"]);
    expect(byLabel["Nostaja Kalle"]).toEqual(["QUALIFICATION_MISSING", "NOT_ASSESSED"]);
    expect(rigger.candidates[0].label).toBe("Nostaja Olli");
    expect(rigger.candidates.at(-1)!.label).toBe("Nostaja Kalle");
    const crane = s.needs.find((n) => n.role.id === w.craneRole)!;
    expect(crane.candidates.map((c) => [c.label, c.blocking])).toEqual([
      ["N1 Nosturi 1", false],
      ["N2 Nosturi 2", true],
    ]);

    const heavy = await staffingService.get(w.o, (await task("Muuntaja", "2027-01-12T08:00", "2027-01-12T12:00", "12000")).id);
    expect(heavy.needs.map((n) => n.role.label)).toContain("Raskaan noston valvoja");
    const unknown = await staffingService.get(w.o, (await task("Tuntematon", "2027-01-12T13:00", "2027-01-12T14:00", "")).id);
    expect(unknown.weightUnknown).toBe(true);
  });

  it("assigns resources as bookings for the task's time; refuses a person without a valid card", async () => {
    const r = await task("Elementti", "2027-01-13T08:00", "2027-01-13T10:00");
    await expect(staffingService.assign(w.o, r.id, { roleId: w.riggerRole, resource: `EMPLOYEE:${w.noCard}` })).rejects.toMatchObject({ fieldErrors: { resource: ["validation.fit.QUALIFICATION_MISSING"] } });
    await expect(staffingService.assign(w.o, r.id, { roleId: w.craneRole, resource: `EQUIPMENT:${w.brokenCrane}` })).rejects.toMatchObject({ fieldErrors: { resource: ["validation.fit.OUT_OF_SERVICE"] } });
    await expect(staffingService.assign(w.o, r.id, { roleId: w.craneRole, resource: `EMPLOYEE:${w.ok}` })).rejects.toBeInstanceOf(ValidationError);
    const a = await staffingService.assign(w.o, r.id, { roleId: w.riggerRole, resource: `EMPLOYEE:${w.ok}` });
    expect(a.status).toBe("APPROVED");
    const warn = await staffingService.assign(w.o, r.id, { roleId: w.riggerRole, resource: `EMPLOYEE:${w.lowLevel}` });
    expect(warn.warnings).toEqual(["LEVEL_LOW"]);
    await staffingService.assign(w.o, r.id, { roleId: w.craneRole, resource: `EQUIPMENT:${w.crane}` });
    const booking = await db.resourceBooking.findFirstOrThrow({ where: { logisticsRequestId: r.id, employeeId: w.ok } });
    expect(booking.startsAt.toISOString()).toBe("2027-01-13T06:00:00.000Z");
    expect(booking.endsAt.toISOString()).toBe("2027-01-13T08:00:00.000Z");
    expect(booking.taskRoleId).toBe(w.riggerRole);

    const s = await staffingService.get(w.o, r.id);
    expect(s.needs.find((n) => n.role.id === w.riggerRole)!.missing).toBe(0);
    expect(s.readiness).toBe("MISSING");
    // The supervisor need has the same person as a candidate, but they are booked for this task already.
    expect(s.needs.find((n) => n.role.id === w.supervisorRole)!.candidates.some((c) => c.label === "Nostaja Olli")).toBe(false);
  });

  it("a resource booked for another task at the same time is marked busy", async () => {
    const a = await task("Aamu 1", "2027-01-14T08:00", "2027-01-14T10:00");
    const b = await task("Aamu 2", "2027-01-14T09:00", "2027-01-14T11:00");
    await staffingService.assign(w.o, a.id, { roleId: w.supervisorRole, resource: `EMPLOYEE:${w.ok}` });
    const s = await staffingService.get(w.o, b.id);
    const sup = s.needs.find((n) => n.role.id === w.supervisorRole)!;
    expect(sup.candidates.find((c) => c.label === "Nostaja Olli")!.issues).toEqual(["BUSY"]);
  });

  it("readiness becomes READY when every need is staffed; task type can be changed", async () => {
    const t2 = await taskTypeService.create(w.o, { name: "Pieni nosto" });
    await taskTypeService.addRole(w.o, t2.id, { kind: "PERSON", label: "Avustaja" });
    const r = await logisticsRequestService.create(w.o, { siteId: w.siteId, serviceType: "LIFT", title: "Pieni", requestedStart: "2027-01-15T08:00", requestedEnd: "2027-01-15T09:00", submit: "on" });
    expect((await staffingService.get(w.o, r.id)).readiness).toBe("NO_TYPE");
    await staffingService.setTaskType(w.o, r.id, { taskTypeId: t2.id });
    const s = await staffingService.get(w.o, r.id);
    await staffingService.assign(w.o, r.id, { roleId: s.needs[0].role.id, resource: s.needs[0].candidates[0].value });
    expect((await staffingService.get(w.o, r.id)).readiness).toBe("READY");
  });

  it("members without booking rights see needs but no candidates and cannot assign", async () => {
    const r = await task("Näkymä", "2027-01-16T08:00", "2027-01-16T09:00");
    const emp = await createMember(w.t, "EMPLOYEE", [{ projectId: w.projectId }]);
    const s = await staffingService.get(emp, r.id);
    expect(s.canBook).toBe(false);
    expect(s.needs.every((n) => n.candidates.length === 0)).toBe(true);
    await expect(staffingService.assign(emp, r.id, { roleId: w.riggerRole, resource: `EMPLOYEE:${w.ok}` })).rejects.toBeInstanceOf(ForbiddenError);
    const outsider = await createMember(w.t, "SUPERVISOR");
    await expect(staffingService.get(outsider, r.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the database refuses a booking that names a need without a task", async () => {
    const booking = await db.resourceBooking.findFirstOrThrow({ where: { companyId: w.t.companyId, taskRoleId: { not: null } } });
    await expect(db.resourceBooking.update({ where: { id: booking.id }, data: { logisticsRequestId: null } })).rejects.toThrow();
  });
});

describe("production calendar", () => {
  it("shows tasks in the range with colour phase and open needs, and own resources with bookings", async () => {
    const { productionCalendarService } = await import("@/modules/production/calendar.service");
    const r = await task("Kalenterinosto", "2027-02-03T08:00", "2027-02-03T12:00");
    await staffingService.assign(w.o, r.id, { roleId: w.riggerRole, resource: `EMPLOYEE:${w.ok}` });
    const v = await productionCalendarService.view(w.o, { zoom: "week", date: "2027-02-03" });
    expect(v.range.startDate).toBe("2027-02-01");
    expect(v.ticks).toHaveLength(7);
    const row = v.tasks.find((x) => x.id === r.id)!;
    expect(row.phase).toBe("PLANNED");
    expect(row.bar!.width).toBeGreaterThan(0);
    expect(row.openRoles.find((x) => x.id === w.riggerRole)!.missing).toBe(1);
    expect(row.missing).toBe(1 + 1 + 1);
    expect(row.canAssign).toBe(true);
    const olli = v.resources.find((x) => x.value === `EMPLOYEE:${w.ok}`)!;
    expect(olli.bookings.map((b) => b.taskId)).toContain(r.id);
    // Out-of-service equipment is not offered in the panel.
    expect(v.resources.some((x) => x.value === `EQUIPMENT:${w.brokenCrane}`)).toBe(false);

    await logisticsRequestService.transition(w.o, r.id, { to: "APPROVED" });
    expect((await productionCalendarService.view(w.o, { zoom: "day", date: "2027-02-03" })).tasks.find((x) => x.id === r.id)!.phase).toBe("MISSING_RESOURCES");
    expect((await productionCalendarService.view(w.o, { zoom: "day", date: "2027-02-04" })).tasks.some((x) => x.id === r.id)).toBe(false);
  });

  it("members without booking rights get no resource panel; outsiders and other sites are refused", async () => {
    const { productionCalendarService } = await import("@/modules/production/calendar.service");
    await task("Rajattu", "2027-02-10T08:00", "2027-02-10T09:00");
    const emp = await createMember(w.t, "EMPLOYEE", [{ projectId: w.projectId }]);
    const v = await productionCalendarService.view(emp, { zoom: "week", date: "2027-02-10" });
    expect(v.tasks.length).toBeGreaterThan(0);
    expect(v.resources).toEqual([]);
    expect(v.tasks.every((x) => !x.canAssign)).toBe(true);
    const client = await createMember(w.t, "CLIENT", [{ projectId: w.projectId }]);
    await expect(productionCalendarService.view(client)).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createTenant("ProdOther");
    const p = await projectService.create(other.ownerCtx, { code: "O", name: "O" });
    const s = await siteService.create(other.ownerCtx, p.id, { name: "O" });
    await expect(productionCalendarService.view(w.o, { siteId: s.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(productionCalendarService.view(w.o, { zoom: "year" })).rejects.toBeInstanceOf(ValidationError);
  });
});
