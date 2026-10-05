import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError } from "@/platform/errors";
import { resolveRequestContext } from "@/modules/companies/context";
import { companyDirectoryService } from "@/modules/companies/service";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { taktStructureService } from "@/modules/takt/structure.service";
import { taktPlanService } from "@/modules/takt/plan.service";
import { taktActivityService } from "@/modules/takt/activity.service";
import { lookaheadService } from "@/modules/takt/lookahead.service";
import { bookingService } from "@/modules/logistics/booking.service";
import { deliveryService, logisticsBoardService, logisticsLocationService, logisticsRequestService } from "@/modules/logistics/logistics.service";
import { auditFor, createMember, createTenant, meta } from "../helpers/fixtures";

async function setup() {
  const t = await createTenant("Log");
  const project = await projectService.create(t.ownerCtx, { code: "L", name: "Logistics project" });
  const site = await siteService.create(t.ownerCtx, project.id, { name: "Hall L" });
  const pm = await createMember(t, "PROJECT_MANAGER", [{ projectId: project.id }]);
  const log = await createMember(t, "LOGISTICS_COORDINATOR", [{ projectId: project.id }]);
  const sm = await createMember(t, "SITE_MANAGER", [{ projectId: project.id }]);
  const sup = await createMember(t, "SUPERVISOR", [{ projectId: project.id }]);
  const craneType = await equipmentTypeService.create(t.ownerCtx, { name: "Nosturi", category: "CRANE" });
  const crane = await equipmentService.create(t.ownerCtx, { equipmentTypeId: craneType.id, assetNumber: "N1", name: "Nosturi 1", nextInspectionDate: "2027-06-01" });
  const building = await taktStructureService.createBuilding(pm, { siteId: site.id, name: "B" });
  await taktStructureService.createArea(pm, { buildingId: building.id, code: "A1", name: "A1" });
  await taktStructureService.createWorkPackage(pm, project.id, { code: "KA", name: "Kaapelointi", trade: "Sähköasentaja", defaultCrewSize: "2", equipmentTypeId: craneType.id, equipmentCount: "1" });
  const plan = await taktPlanService.create(pm, { siteId: site.id, name: "P", startDate: "2026-11-02" });
  const v1 = (await taktPlanService.board(pm, plan.id)).selected!;
  await taktPlanService.generateTrain(pm, v1.id, {});
  await taktPlanService.propose(pm, v1.id);
  await taktPlanService.approve(pm, v1.id);
  const activity = (await taktPlanService.board(pm, plan.id)).activities[0];
  const gate = await logisticsLocationService.create(log, { siteId: site.id, kind: "GATE", name: "Portti 1", opens: "06:00", closes: "18:00" });
  const storage = await logisticsLocationService.create(log, { siteId: site.id, kind: "STORAGE", name: "Varasto" });
  return { t, project, site, pm, log, sm, sup, craneType, crane, activity, gate, storage };
}

describe("resource bookings and conflicts", () => {
  it("own resource: approved at once; an overlapping booking waits and needs an acknowledged decision", async () => {
    const s = await setup();
    const first = await bookingService.create(s.pm, { resources: [`EQUIPMENT:${s.crane.id}`], projectId: s.project.id, activityId: s.activity.id, startsAt: "2026-11-02T07:00", endsAt: "2026-11-02T15:30" });
    expect(first).toEqual([expect.objectContaining({ status: "APPROVED", conflicts: [] })]);
    const [second] = await bookingService.create(s.pm, { resources: `EQUIPMENT:${s.crane.id}`, projectId: s.project.id, startsAt: "2026-11-02T12:00", endsAt: "2026-11-02T18:00" });
    expect(second.status).toBe("REQUESTED");
    expect(second.conflicts.map((c) => c.code)).toEqual(["OVERLAP"]);
    await expect(bookingService.decide(s.pm, second.id, { decision: "APPROVE" })).rejects.toMatchObject({ fieldErrors: { acceptConflicts: ["validation.conflictsNotAccepted"] } });
    expect((await bookingService.decide(s.pm, second.id, { decision: "APPROVE", acceptConflicts: "on", note: "Kaksi nostoa, sovittu" })).status).toBe("APPROVED");
    const list = await bookingService.list(s.pm, { projectId: s.project.id });
    expect(list.find((b) => b.id === second.id)).toMatchObject({ conflictsAccepted: true, conflicts: [expect.objectContaining({ code: "OVERLAP" })] });
    expect(list[0].activity?.id).toBe(s.activity.id);
    // An approved booking cannot be moved or deleted, even directly in the database.
    await expect(db.resourceBooking.update({ where: { id: first[0].id }, data: { endsAt: new Date("2026-11-03T00:00:00Z") } })).rejects.toThrow(/cannot be moved/);
    await expect(db.resourceBooking.delete({ where: { id: first[0].id } })).rejects.toThrow(/cannot be deleted/);
    await bookingService.cancel(s.pm, first[0].id);
    await expect(bookingService.cancel(s.pm, first[0].id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.bookingNotActive"] } });
    expect((await auditFor(s.t.companyId, second.id)).map((a) => a.action)).toEqual(["resource_booking.create", "resource_booking.approve"]);
  });

  it("detects inspection due, inactive resources and competence mismatches", async () => {
    const s = await setup();
    const old = await equipmentService.create(s.t.ownerCtx, { equipmentTypeId: s.craneType.id, assetNumber: "N2", name: "Nosturi 2", nextInspectionDate: "2026-11-01" });
    const rigger = await employeeService.create(s.t.ownerCtx, { employeeNumber: "R1", firstName: "Riku", lastName: "Rigger", trade: "Rigger" });
    const req = await db.resourceRequirement.findFirstOrThrow({ where: { activityId: s.activity.id, kind: "TRADE" } });
    const [a] = await bookingService.create(s.pm, { resources: [`EQUIPMENT:${old.id}`], projectId: s.project.id, startsAt: "2026-11-02T07:00", endsAt: "2026-11-02T15:00" });
    expect(a.conflicts.map((c) => c.code)).toEqual(["INSPECTION_DUE"]);
    const [b] = await bookingService.create(s.pm, { resources: [`EMPLOYEE:${rigger.id}`], projectId: s.project.id, activityId: s.activity.id, requirementId: req.id, startsAt: "2026-11-02T07:00", endsAt: "2026-11-02T15:00" });
    expect(b.conflicts.map((c) => c.code)).toEqual(["TRADE_MISMATCH"]);
    await equipmentService.update(s.t.ownerCtx, s.crane.id, { equipmentTypeId: s.craneType.id, assetNumber: "N1", name: "Nosturi 1", status: "MAINTENANCE" });
    const [c] = await bookingService.create(s.pm, { resources: [`EQUIPMENT:${s.crane.id}`], projectId: s.project.id, startsAt: "2026-11-03T07:00", endsAt: "2026-11-03T15:00" });
    expect(c.conflicts.map((x) => x.code)).toEqual(["RESOURCE_INACTIVE"]);
  });

  it("cross-company booking within the group: owner approves, ownership never changes, no rates exposed", async () => {
    const s = await setup();
    const purent = await companyDirectoryService.createCompany(s.t.owner, { organizationId: s.t.organizationId, name: "Purent Test Oy", slug: `purent-${Date.now()}` });
    const pCtx = await resolveRequestContext({ userId: s.t.owner.user.id, companySlug: purent.slug, meta, locale: "fi" });
    const forkType = await equipmentTypeService.create(pCtx, { name: "Trukki", category: "FORKLIFT" });
    const fork = await equipmentService.create(pCtx, { equipmentTypeId: forkType.id, assetNumber: "P-T1", name: "Trukki 3 t" });
    await equipmentService.addRate(pCtx, fork.id, { rateType: "COST", amount: "12", validFrom: "2026-01-01" });

    // Not shared yet → not bookable.
    await expect(bookingService.create(s.pm, { resources: [`EQUIPMENT:${fork.id}`], projectId: s.project.id, startsAt: "2026-11-04T07:00", endsAt: "2026-11-04T15:00" })).rejects.toMatchObject({ fieldErrors: { resources: ["validation.invalidOption"] } });
    expect((await bookingService.resourceOptions(s.pm, s.project.id)).group).toHaveLength(0);
    await equipmentService.update(pCtx, fork.id, { equipmentTypeId: forkType.id, assetNumber: "P-T1", name: "Trukki 3 t", shareableInGroup: "on" });
    const options = await bookingService.resourceOptions(s.pm, s.project.id);
    expect(options.group).toEqual([expect.objectContaining({ value: `EQUIPMENT:${fork.id}`, owner: "Purent Test Oy" })]);
    expect(JSON.stringify(options)).not.toMatch(/amount|rate/i);

    const [b] = await bookingService.create(s.pm, { resources: [`EQUIPMENT:${fork.id}`], projectId: s.project.id, startsAt: "2026-11-04T07:00", endsAt: "2026-11-04T15:00" });
    expect(b.status).toBe("REQUESTED");
    await expect(bookingService.decide(s.pm, b.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
    const incoming = await bookingService.incoming(pCtx);
    expect(incoming).toEqual([expect.objectContaining({ id: b.id, incoming: true, company: expect.objectContaining({ id: s.t.companyId }) })]);
    await bookingService.decide(pCtx, b.id, { decision: "APPROVE", note: "OK" });
    const row = await db.resourceBooking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row).toMatchObject({ status: "APPROVED", companyId: s.t.companyId, ownerCompanyId: purent.id });
    expect((await db.equipment.findUniqueOrThrow({ where: { id: fork.id } })).companyId).toBe(purent.id);
    // Both companies' audit trails record the decision.
    expect((await auditFor(s.t.companyId, b.id)).map((a) => a.action)).toEqual(["resource_booking.create", "resource_booking.approve"]);
    expect((await auditFor(purent.id, b.id)).map((a) => a.action)).toEqual(["resource_booking.create", "resource_booking.approve"]);

    // A company outside the organization can never book it, even directly in the database.
    const other = await createTenant("Outsider");
    const otherProject = await projectService.create(other.ownerCtx, { code: "O", name: "O" });
    await expect(
      db.resourceBooking.create({ data: { companyId: other.companyId, ownerCompanyId: purent.id, resourceKind: "EQUIPMENT", equipmentId: fork.id, projectId: otherProject.id, startsAt: new Date("2026-11-05T05:00:00Z"), endsAt: new Date("2026-11-05T13:00:00Z") } }),
    ).rejects.toThrow(/within one organization/);
  });

  it("books a crew in one go and shows booked capacity in the look-ahead", async () => {
    const s = await setup();
    const e1 = await employeeService.create(s.t.ownerCtx, { employeeNumber: "S1", firstName: "A", lastName: "Sähkö", trade: "Sähköasentaja" });
    const e2 = await employeeService.create(s.t.ownerCtx, { employeeNumber: "S2", firstName: "B", lastName: "Sähkö", trade: "Sähköasentaja" });
    const created = await bookingService.create(s.pm, { resources: [`EMPLOYEE:${e1.id}`, `EMPLOYEE:${e2.id}`], projectId: s.project.id, activityId: s.activity.id, startsAt: "2026-11-02T07:00", endsAt: "2026-11-02T15:30" });
    expect(created.map((c) => c.status)).toEqual(["APPROVED", "APPROVED"]);
    const la = await lookaheadService.compute(s.pm, { weeks: 2, from: "2026-11-02", projectId: s.project.id });
    expect(la.rows.find((r) => r.kind === "TRADE")!.cells[0]).toMatchObject({ peak: 2, booked: 2, shortage: 0 });
  });
});

describe("logistics requests", () => {
  it("supervisor requests, Logistics Coordinator or Site Manager approves, PM cannot approve", async () => {
    const s = await setup();
    const r = await logisticsRequestService.create(s.sup, { siteId: s.site.id, activityId: s.activity.id, serviceType: "DELIVERY", title: "Kaapelirummut 4 kpl", requestedStart: "2026-11-02T07:00", requestedEnd: "2026-11-02T09:00", weightKg: "8400", priority: "HIGH", submit: "on" });
    expect(r.status).toBe("REQUESTED");
    await expect(logisticsRequestService.transition(s.sup, r.id, { to: "APPROVED" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(logisticsRequestService.transition(s.pm, r.id, { to: "APPROVED" })).rejects.toBeInstanceOf(ForbiddenError);
    await logisticsRequestService.transition(s.log, r.id, { to: "REVIEW" });
    await logisticsRequestService.transition(s.sm, r.id, { to: "APPROVED", note: "Portti 1 klo 7" });
    await expect(logisticsRequestService.transition(s.sm, r.id, { to: "COMPLETE" })).rejects.toMatchObject({ fieldErrors: { to: ["validation.invalidTransition"] } });
    const got = await logisticsRequestService.get(s.log, r.id);
    expect(got).toMatchObject({ status: "APPROVED", activity: expect.objectContaining({ id: s.activity.id }) });
    expect(got.next).toEqual(expect.arrayContaining(["SCHEDULED", "CANCELLED"]));
    await expect(db.logisticsRequest.update({ where: { id: r.id }, data: { status: "DRAFT" } })).rejects.toThrow(/invalid logistics request transition/);
  });
});

describe("deliveries", () => {
  it("30-minute gate slots, no double booking, material constraint follows the delivery", async () => {
    const s = await setup();
    const req = await logisticsRequestService.create(s.sup, { siteId: s.site.id, activityId: s.activity.id, serviceType: "DELIVERY", title: "Rummut", requestedStart: "2026-11-02T07:00", requestedEnd: "2026-11-02T08:00", submit: "on" });
    await logisticsRequestService.transition(s.log, req.id, { to: "APPROVED" });
    const d = await deliveryService.create(s.log, { siteId: s.site.id, gateId: s.gate.id, storageId: s.storage.id, requestId: req.id, supplier: "Kaapeli Oy", material: "Kaapelirummut", date: "2026-11-02", startTime: "07:00", slots: "2" });
    expect([d.slotStart.toISOString(), d.slotEnd.toISOString()]).toEqual(["2026-11-02T05:00:00.000Z", "2026-11-02T06:00:00.000Z"]);
    expect(d.activityId).toBe(s.activity.id); // taken from the request
    expect((await logisticsRequestService.get(s.log, req.id)).status).toBe("SCHEDULED");
    expect((await taktActivityService.get(s.pm, s.activity.id)).activity.constraints).toEqual([expect.objectContaining({ type: "MATERIAL", status: "OPEN" })]);

    const base = { siteId: s.site.id, gateId: s.gate.id, supplier: "X", material: "Y", date: "2026-11-02" };
    await expect(deliveryService.create(s.log, { ...base, startTime: "07:30" })).rejects.toMatchObject({ fieldErrors: { startTime: ["validation.slotTaken"] } });
    await expect(deliveryService.create(s.log, { ...base, startTime: "07:15" })).rejects.toMatchObject({ fieldErrors: { startTime: ["validation.slotAlignment"] } });
    await expect(deliveryService.create(s.log, { ...base, startTime: "17:30", slots: "2" })).rejects.toMatchObject({ fieldErrors: { startTime: ["validation.gateClosed"] } });
    await expect(deliveryService.create(s.pm, { ...base, startTime: "09:00" })).rejects.toBeInstanceOf(ForbiddenError);
    const next = await deliveryService.create(s.sup, { ...base, startTime: "08:00" });

    for (const to of ["ARRIVED_GATE", "CHECKED_IN", "UNLOADING", "STORED"]) await deliveryService.advance(s.sup, d.id, { to });
    expect((await taktActivityService.get(s.pm, s.activity.id)).activity.constraints[0].status).toBe("CLEARED");
    expect((await logisticsRequestService.get(s.log, req.id)).status).toBe("COMPLETE");
    await expect(deliveryService.advance(s.sup, d.id, { to: "UNLOADING" })).rejects.toMatchObject({ fieldErrors: { to: ["validation.invalidTransition"] } });
    await expect(deliveryService.advance(s.sup, d.id, { to: "CANCELLED" })).rejects.toMatchObject({ fieldErrors: { to: ["validation.invalidTransition"] } });
    await expect(db.delivery.update({ where: { id: d.id }, data: { status: "PLANNED" } })).rejects.toThrow(/backwards/);
    await expect(db.delivery.delete({ where: { id: d.id } })).rejects.toThrow(/cannot be deleted/);

    // Cancelling frees the slot; rescheduling respects slots too.
    await deliveryService.advance(s.log, next.id, { to: "CANCELLED" });
    const again = await deliveryService.create(s.log, { ...base, startTime: "08:00" });
    await expect(deliveryService.reschedule(s.log, again.id, { gateId: s.gate.id, date: "2026-11-02", startTime: "07:00", slots: "1" })).rejects.toMatchObject({ fieldErrors: { startTime: ["validation.slotTaken"] } });
    await deliveryService.reschedule(s.log, again.id, { gateId: s.gate.id, date: "2026-11-02", startTime: "10:00", slots: "1" });

    const board = await logisticsBoardService.day(s.sup, { siteId: s.site.id, date: "2026-11-02" });
    expect(board.slots).toHaveLength(24);
    expect(board.deliveries.map((x) => x.startLabel)).toEqual(["07:00", "08:00", "10:00"]);
    expect((await auditFor(s.t.companyId, d.id)).map((a) => a.action)).toEqual(["delivery.create", "delivery.status", "delivery.status", "delivery.status", "delivery.status"]);

    // Traceability: the takt activity shows its logistics.
    const detail = await taktActivityService.get(s.pm, s.activity.id);
    expect(detail.logistics?.deliveries.map((x) => x.id)).toContain(d.id);
    expect(detail.logistics?.requests.map((x) => x.id)).toContain(req.id);
  });

  it("employees view the schedule but cannot manage it; external roles see nothing", async () => {
    const s = await setup();
    const emp = await createMember(s.t, "EMPLOYEE", [{ projectId: s.project.id }]);
    expect((await logisticsBoardService.day(emp, { siteId: s.site.id, date: "2026-11-02" })).site.id).toBe(s.site.id);
    await expect(logisticsLocationService.create(emp, { siteId: s.site.id, kind: "STORAGE", name: "X" })).rejects.toBeInstanceOf(ForbiddenError);
    const client = await createMember(s.t, "CLIENT", [{ projectId: s.project.id }]);
    await expect(logisticsBoardService.day(client, { siteId: s.site.id })).rejects.toMatchObject({ status: 404 });
    expect(await logisticsBoardService.sites(client)).toHaveLength(0);
  });
});
