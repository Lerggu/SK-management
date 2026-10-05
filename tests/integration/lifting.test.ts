import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError } from "@/platform/errors";
import { projectService, siteService } from "@/modules/projects/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { documentService } from "@/modules/documents/service";
import { taktStructureService } from "@/modules/takt/structure.service";
import { taktPlanService } from "@/modules/takt/plan.service";
import { bookingService } from "@/modules/logistics/booking.service";
import { deliveryService, logisticsLocationService, logisticsRequestService } from "@/modules/logistics/logistics.service";
import { liftingAccessoryService, liftPlanService } from "@/modules/lifting/lift.service";
import { cableDrumService, materialBatchService, materialLabelService, materialTraceService, scanService } from "@/modules/lifting/material.service";
import { employeeService } from "@/modules/workforce/service";
import { auditFor, createMember, createTenant, textFile } from "../helpers/fixtures";

async function setup() {
  const t = await createTenant("Lift");
  const project = await projectService.create(t.ownerCtx, { code: "N", name: "Lifting project" });
  const site = await siteService.create(t.ownerCtx, project.id, { name: "Hall N" });
  const pm = await createMember(t, "PROJECT_MANAGER", [{ projectId: project.id }]);
  const sm = await createMember(t, "SITE_MANAGER", [{ projectId: project.id }]);
  const sup = await createMember(t, "SUPERVISOR", [{ projectId: project.id }]);
  const lift = await createMember(t, "LIFTING_SUPERVISOR", [{ projectId: project.id }]);
  const lift2 = await createMember(t, "LIFTING_SUPERVISOR", [{ projectId: project.id }]);
  const log = await createMember(t, "LOGISTICS_COORDINATOR", [{ projectId: project.id }]);
  const craneType = await equipmentTypeService.create(t.ownerCtx, { name: "Nosturi", category: "CRANE" });
  const crane = await equipmentService.create(t.ownerCtx, { equipmentTypeId: craneType.id, assetNumber: "AN-1", name: "Ajoneuvonosturi 60 t", nextInspectionDate: "2027-06-01" });
  const building = await taktStructureService.createBuilding(pm, { siteId: site.id, name: "B" });
  await taktStructureService.createArea(pm, { buildingId: building.id, code: "A1", name: "A1" });
  await taktStructureService.createWorkPackage(pm, project.id, { code: "KA", name: "Kaapelointi", trade: "Sähköasentaja", defaultCrewSize: "2" });
  const plan = await taktPlanService.create(pm, { siteId: site.id, name: "P", startDate: "2026-11-02" });
  const v1 = (await taktPlanService.board(pm, plan.id)).selected!;
  await taktPlanService.generateTrain(pm, v1.id, {});
  await taktPlanService.propose(pm, v1.id);
  await taktPlanService.approve(pm, v1.id);
  const activity = (await taktPlanService.board(pm, plan.id)).activities[0];
  const sling = await liftingAccessoryService.create(sm, { code: "ls-01", name: "Raksi 4 t", kind: "SLING", wllKg: "4000", nextInspectionDate: "2027-05-01" });
  const shackle = await liftingAccessoryService.create(sm, { code: "SH-01", name: "Sakkeli 2 t", kind: "SHACKLE", wllKg: "2000", nextInspectionDate: "2026-10-01" });
  const gate = await logisticsLocationService.create(log, { siteId: site.id, kind: "GATE", name: "Portti 1", opens: "06:00", closes: "18:00" });
  const storage = await logisticsLocationService.create(log, { siteId: site.id, kind: "STORAGE", name: "Kenttävarasto" });
  return { t, project, site, pm, sm, sup, lift, lift2, log, crane, activity, sling, shackle, gate, storage };
}

type S = Awaited<ReturnType<typeof setup>>;

/** A complete draft by `author`: 3 t beam + 0,2 t rigging, 60 t crane at 18 m = 6 t capacity. */
async function draftPlan(s: S, author = s.sup, extra: { requestId?: string } = {}) {
  const p = await liftPlanService.create(author, { siteId: s.site.id, activityId: s.activity.id, title: "Teräspalkki P1", plannedStart: "2026-11-10T08:00", plannedEnd: "2026-11-10T09:00", ...extra });
  await liftPlanService.updateDraft(author, p.id, { loadDescription: "Teräspalkki HEA400, 12 m", loadWeightKg: "3000", riggingWeightKg: "200", cogNotes: "Keskellä", craneId: s.crane.id, radiusM: "18", craneCapacityKg: "6000", areaDescription: "Nostoalue aidattu", safetyDistanceM: "5" });
  await liftPlanService.addAccessory(author, p.id, { accessoryId: s.sling.id, count: 2 });
  return p;
}

describe("acceptance 1: a lift cannot be carried out without an approved lift plan", () => {
  it("LIFT request, plan approval by the person responsible for lifting, completion", async () => {
    const s = await setup();
    const req = await logisticsRequestService.create(s.sup, { siteId: s.site.id, activityId: s.activity.id, serviceType: "LIFT", title: "Palkkinosto", requestedStart: "2026-11-10T08:00", requestedEnd: "2026-11-10T09:00", submit: "on" });
    await logisticsRequestService.transition(s.log, req.id, { to: "APPROVED" });
    // The approved LIFT request cannot be scheduled without a plan — neither through the service nor in the database.
    await expect(logisticsRequestService.transition(s.log, req.id, { to: "SCHEDULED" })).rejects.toMatchObject({ fieldErrors: { to: ["validation.liftNotApproved"] } });
    await expect(db.logisticsRequest.update({ where: { id: req.id }, data: { status: "SCHEDULED" } })).rejects.toThrow(/without an approved lift plan/);

    const p = await draftPlan(s, s.sup, { requestId: req.id });
    expect((await liftPlanService.get(s.sup, p.id)).activity?.id).toBe(s.activity.id);
    await expect(liftPlanService.complete(s.sm, p.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.liftNotApproved"] } });
    await expect(db.liftPlan.update({ where: { id: p.id }, data: { status: "COMPLETED", completedAt: new Date() } })).rejects.toThrow(/without an approved lift plan/);

    await liftPlanService.submit(s.sup, p.id);
    // Only lift.plan.approve holders decide: the Site Manager and Project Manager cannot.
    await expect(liftPlanService.decide(s.sm, p.id, { decision: "APPROVE", acknowledgeWarnings: "on" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(liftPlanService.decide(s.pm, p.id, { decision: "APPROVE", acknowledgeWarnings: "on" })).rejects.toBeInstanceOf(ForbiddenError);
    // Risk assessment missing → a warning that must be acknowledged.
    await expect(liftPlanService.decide(s.lift, p.id, { decision: "APPROVE" })).rejects.toMatchObject({ fieldErrors: { acknowledgeWarnings: ["validation.liftWarningsNotAcknowledged"] } });
    await liftPlanService.decide(s.lift, p.id, { decision: "APPROVE", acknowledgeWarnings: "on", note: "OK" });
    expect((await db.logisticsRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("SCHEDULED");

    const view = await liftPlanService.get(s.lift, p.id);
    expect(view.approved).toMatchObject({ versionNumber: 1, status: "APPROVED", totalLoadKg: 3200, utilizationPct: 53.3 });
    expect(view.approved!.issues.map((i) => i.code)).toEqual(["RISK_ASSESSMENT_MISSING"]);
    expect(view.can).toMatchObject({ complete: true, revise: true });
    expect((await liftPlanService.get(s.pm, p.id)).can).toMatchObject({ complete: false, revise: false, decide: false });
    expect((await liftPlanService.get(s.sm, p.id)).can.complete).toBe(true);

    await liftPlanService.complete(s.sm, p.id, { note: "Nosto tehty klo 8.40" });
    expect((await db.logisticsRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("COMPLETE");
    await expect(liftPlanService.cancel(s.sm, p.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.liftClosed"] } });
    expect((await auditFor(s.t.companyId, p.id)).map((a) => a.action)).toEqual(["lift_plan.create", "lift_plan.complete"]);
  });

  it("the author never approves their own plan, even with the approval right", async () => {
    const s = await setup();
    const p = await draftPlan(s, s.lift);
    await liftPlanService.submit(s.lift, p.id);
    expect((await liftPlanService.get(s.lift, p.id)).can).toMatchObject({ decide: false, selfApprovalBlocked: true });
    await expect(liftPlanService.decide(s.lift, p.id, { decision: "APPROVE", acknowledgeWarnings: "on" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.liftSelfApproval"] } });
    const v = await db.liftPlanVersion.findFirstOrThrow({ where: { planId: p.id } });
    await expect(db.liftPlanVersion.update({ where: { id: v.id }, data: { status: "APPROVED", decidedById: v.submittedById } })).rejects.toThrow(/person who submitted/);
    // Rejection needs a reason; another responsible person can decide.
    await expect(liftPlanService.decide(s.lift2, p.id, { decision: "REJECT" })).rejects.toMatchObject({ fieldErrors: { note: ["validation.required"] } });
    await liftPlanService.decide(s.lift2, p.id, { decision: "REJECT", note: "Säde tarkistettava" });
    const r = await liftPlanService.revise(s.lift, p.id, { reason: "Säde korjattu" });
    expect(r.versionNumber).toBe(2);
  });

  it("an approved plan is locked; a change is a new version that supersedes it once approved", async () => {
    const s = await setup();
    const p = await draftPlan(s);
    await liftPlanService.submit(s.sup, p.id);
    await liftPlanService.decide(s.lift, p.id, { decision: "APPROVE", acknowledgeWarnings: "on" });
    const v1 = await db.liftPlanVersion.findFirstOrThrow({ where: { planId: p.id, versionNumber: 1 } });
    await expect(db.liftPlanVersion.update({ where: { id: v1.id }, data: { loadWeightKg: "5900" } })).rejects.toThrow(/locked/);
    await expect(db.liftPlanAccessory.create({ data: { companyId: s.t.companyId, versionId: v1.id, accessoryId: s.shackle.id } })).rejects.toThrow(/draft/);
    await expect(db.liftPlanVersion.delete({ where: { id: v1.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(liftPlanService.updateDraft(s.sup, p.id, { loadWeightKg: "1" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.versionNotDraft"] } });

    const v2 = await liftPlanService.revise(s.sup, p.id, { reason: "Kuorma muuttui" });
    expect(v2).toMatchObject({ versionNumber: 2, status: "DRAFT", changeReason: "Kuorma muuttui" });
    expect(await db.liftPlanAccessory.count({ where: { versionId: v2.id } })).toBe(1);
    // A pending revision stops the lift until it is decided.
    await expect(liftPlanService.complete(s.sm, p.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.liftRevisionPending"] } });
    await liftPlanService.updateDraft(s.sup, p.id, { loadDescription: "Palkki + kiinnikkeet", loadWeightKg: "3400", craneId: s.crane.id, radiusM: "18", craneCapacityKg: "6000" });
    await liftPlanService.submit(s.sup, p.id);
    await liftPlanService.decide(s.lift, p.id, { decision: "APPROVE", acknowledgeWarnings: "on" });
    const statuses = await db.liftPlanVersion.findMany({ where: { planId: p.id }, orderBy: { versionNumber: "asc" }, select: { status: true } });
    expect(statuses.map((x) => x.status)).toEqual(["SUPERSEDED", "APPROVED"]);
    expect((await auditFor(s.t.companyId, v2.id)).map((a) => a.action)).toEqual(["lift_plan.revise", "lift_plan.update", "lift_plan.submit", "lift_plan.approve"]);
  });
});

describe("acceptance 2: overdue and overloaded accessories are detected", () => {
  it("refuses accessories whose inspection is due or whose WLL is below the load, and capacity overruns", async () => {
    const s = await setup();
    const p = await draftPlan(s);
    await liftPlanService.addAccessory(s.sup, p.id, { accessoryId: s.shackle.id, count: 1 });
    let issues = (await liftPlanService.get(s.sup, p.id)).open!.issues;
    expect(issues.filter((i) => i.severity === "block").map((i) => [i.code, i.subject])).toEqual([
      ["ACCESSORY_INSPECTION_DUE", "SH-01"],
      ["ACCESSORY_WLL_EXCEEDED", "SH-01"],
    ]);
    await expect(liftPlanService.submit(s.sup, p.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.liftChecksFailed"] } });
    await liftPlanService.removeAccessory(s.sup, p.id, s.shackle.id);

    await liftPlanService.updateDraft(s.sup, p.id, { loadDescription: "Raskas", loadWeightKg: "5900", riggingWeightKg: "200", craneId: s.crane.id, radiusM: "18", craneCapacityKg: "6000" });
    issues = (await liftPlanService.get(s.sup, p.id)).open!.issues;
    expect(issues.map((i) => i.code)).toEqual(["CAPACITY_EXCEEDED", "RISK_ASSESSMENT_MISSING"]);

    await liftPlanService.updateDraft(s.sup, p.id, { loadDescription: "Lähes raja", loadWeightKg: "5300", riggingWeightKg: "100", craneId: s.crane.id, radiusM: "18", craneCapacityKg: "6000" });
    await liftPlanService.addAccessory(s.sup, p.id, { accessoryId: s.sling.id, count: 2 });
    issues = (await liftPlanService.get(s.sup, p.id)).open!.issues;
    expect(issues.map((i) => [i.code, i.severity])).toEqual([["HIGH_UTILIZATION", "warn"], ["RISK_ASSESSMENT_MISSING", "warn"]]);
    const doc = await documentService.create(s.sm, { title: "Nostosuunnitelman riskiarvio", projectId: s.project.id }, textFile("riski.pdf"));
    await liftPlanService.updateDraft(s.sup, p.id, { loadDescription: "Lähes raja", loadWeightKg: "5300", riggingWeightKg: "100", craneId: s.crane.id, radiusM: "18", craneCapacityKg: "6000", riskDocumentId: doc.id });
    await liftPlanService.submit(s.sup, p.id);
  });

  it("refuses an inactive accessory and a crane in maintenance; the register flags due inspections", async () => {
    const s = await setup();
    const p = await draftPlan(s);
    await liftingAccessoryService.update(s.sm, s.sling.id, { name: "Raksi 4 t", kind: "SLING", wllKg: "4000", nextInspectionDate: "2027-05-01", status: "INACTIVE" });
    expect((await liftPlanService.get(s.sup, p.id)).open!.issues.map((i) => i.code)).toContain("ACCESSORY_INACTIVE");
    await equipmentService.update(s.t.ownerCtx, s.crane.id, { equipmentTypeId: s.crane.equipmentTypeId, assetNumber: "AN-1", name: "Ajoneuvonosturi 60 t", status: "MAINTENANCE", nextInspectionDate: "2027-06-01" });
    expect((await liftPlanService.get(s.sup, p.id)).open!.issues.map((i) => i.code)).toContain("CRANE_UNAVAILABLE");
    const register = await liftingAccessoryService.list(s.lift);
    expect(register.find((a) => a.code === "SH-01")).toMatchObject({ inspectionDue: true });
    expect(register.find((a) => a.code === "LS-01")?.inspectionDue).toBe(false);
    // Only lift.plan.manage holders change the register.
    await expect(liftingAccessoryService.create(s.pm, { code: "X", name: "x", kind: "HOOK", wllKg: "1" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(liftingAccessoryService.create(s.sm, { code: "ls-01", name: "dup", kind: "SLING", wllKg: "1" })).rejects.toMatchObject({ fieldErrors: { code: ["validation.codeTaken"] } });
  });

  it("rigging crew is booked with V4 bookings against the lift plan", async () => {
    const s = await setup();
    const p = await draftPlan(s);
    const rigger = await employeeService.create(s.t.ownerCtx, { employeeNumber: "R-1", firstName: "Riku", lastName: "Riggari", trade: "Nostomies" });
    const [b] = await bookingService.create(s.sm, { resources: [`EMPLOYEE:${rigger.id}`], projectId: s.project.id, liftPlanId: p.id, startsAt: "2026-11-10T07:30", endsAt: "2026-11-10T09:30" });
    expect(b.status).toBe("APPROVED");
    expect((await liftPlanService.get(s.sup, p.id)).bookings).toEqual([expect.objectContaining({ label: "Riggari Riku", detail: "Nostomies" })]);
  });
});

describe("acceptance 3: material and cable drum movements are traceable to the takt activity", () => {
  it("material batch: delivery → storage → workface → installed, append-only movements", async () => {
    const s = await setup();
    const d = await deliveryService.create(s.log, { siteId: s.site.id, gateId: s.gate.id, supplier: "Kaapelitukku Demo Oy", material: "Kaapelihyllyt", date: "2026-11-09", startTime: "07:00" });
    const b = await materialBatchService.create(s.sup, { siteId: s.site.id, code: "mb-001", material: "Kaapelihylly 300 mm", quantity: "120", unit: "m", deliveryId: d.id });
    expect(b.code).toBe("MB-001");
    await expect(materialBatchService.move(s.sup, b.id, { to: "STORED" })).rejects.toMatchObject({ fieldErrors: { locationId: ["validation.required"] } });
    await materialBatchService.move(s.sup, b.id, { to: "STORED", locationId: s.storage.id });
    await expect(materialBatchService.move(s.sup, b.id, { to: "INSTALLED" })).rejects.toMatchObject({ fieldErrors: { to: ["validation.invalidTransition"] } });
    await expect(materialBatchService.move(s.sup, b.id, { to: "AT_WORKFACE" })).rejects.toMatchObject({ fieldErrors: { activityId: ["validation.activityRequired"] } });
    await materialBatchService.move(s.sup, b.id, { to: "AT_WORKFACE", activityId: s.activity.id });
    await materialBatchService.move(s.sup, b.id, { to: "INSTALLED" });
    const view = await materialBatchService.get(s.sup, b.id);
    expect(view.movements.map((m) => [m.fromStatus, m.toStatus])).toEqual([[null, "RECEIVED"], ["RECEIVED", "STORED"], ["STORED", "AT_WORKFACE"], ["AT_WORKFACE", "INSTALLED"]]);
    expect(view.delivery?.id).toBe(d.id);
    expect(view.next).toEqual([]);
    const m = await db.materialMovement.findFirstOrThrow({ where: { batchId: b.id } });
    await expect(db.materialMovement.update({ where: { id: m.id }, data: { note: "x" } })).rejects.toThrow(/append-only/);
    await expect(db.materialMovement.delete({ where: { id: m.id } })).rejects.toThrow(/append-only/);
    // PM sees materials but cannot move them.
    await expect(materialBatchService.move(s.pm, b.id, { to: "RETURNED" })).rejects.toBeInstanceOf(ForbiddenError);
    const trace = await materialTraceService.activity(s.sup, s.activity.id);
    expect(trace.movements.map((x) => x.toStatus)).toEqual(["AT_WORKFACE", "INSTALLED"]);
    expect(trace.batches.map((x) => x.code)).toEqual(["MB-001"]);
  });

  it("cable drum: metres per pull, never negative, database-maintained remaining length", async () => {
    const s = await setup();
    const drum = await cableDrumService.create(s.sup, { siteId: s.site.id, code: "KK-0001", manufacturer: "Kaapelitehdas Demo", cableType: "AXMK 4x240", originalLengthM: "500", weightKg: "1450", dimensions: "Ø 2000 mm", locationId: s.storage.id, reservedActivityId: s.activity.id, receivedDate: "2026-11-02" });
    expect(drum.remainingM.toString()).toBe("500");
    const r1 = await cableDrumService.pull(s.sup, drum.id, { lengthM: "120,5", pulledOn: "2026-11-03" });
    expect(r1).toMatchObject({ remainingM: "379.5", status: "IN_USE" });
    expect(r1.pull.activityId).toBe(s.activity.id); // defaults to the reserved activity
    await expect(cableDrumService.pull(s.sup, drum.id, { lengthM: "379.6", pulledOn: "2026-11-04" })).rejects.toMatchObject({ fieldErrors: { lengthM: ["validation.pullExceedsRemaining"] } });
    // The database refuses negative lengths and direct edits of the remaining length.
    await expect(db.cablePull.create({ data: { companyId: s.t.companyId, siteId: s.site.id, drumId: drum.id, lengthM: "400", pulledOn: new Date("2026-11-04") } })).rejects.toThrow(/cable_drums_remaining/);
    await expect(db.cableDrum.update({ where: { id: drum.id }, data: { remainingM: "500" } })).rejects.toThrow(/only through a cable pull/);
    const r2 = await cableDrumService.pull(s.sup, drum.id, { lengthM: "379.5", pulledOn: "2026-11-04", activityId: s.activity.id });
    expect(r2).toMatchObject({ remainingM: "0", status: "EMPTY" });
    await expect(cableDrumService.pull(s.sup, drum.id, { lengthM: "1", pulledOn: "2026-11-05" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.drumNotUsable"] } });
    const pull = await db.cablePull.findFirstOrThrow({ where: { drumId: drum.id } });
    await expect(db.cablePull.update({ where: { id: pull.id }, data: { lengthM: "1" } })).rejects.toThrow(/append-only/);
    const view = await cableDrumService.get(s.sup, drum.id);
    expect(view).toMatchObject({ usedPct: 100, remainingM: "0" });
    expect(view.pulls.map((p) => p.lengthM)).toEqual(["120.5", "379.5"]);
    const trace = await materialTraceService.activity(s.pm, s.activity.id);
    expect(trace.totalPulledM).toBe(500);
    expect(trace.pulls.map((p) => p.drum.code)).toEqual(["KK-0001", "KK-0001"]);
    expect((await auditFor(s.t.companyId, drum.id)).map((a) => a.action)).toEqual(["cable_drum.create", "cable_drum.pull", "cable_drum.pull"]);
  });
});

describe("acceptance 4: QR labels and scanning", () => {
  it("generates an A4 PDF label sheet and resolves scans by URL, id or typed code", async () => {
    const s = await setup();
    const drum = await cableDrumService.create(s.sup, { siteId: s.site.id, code: "KK-0002", cableType: "MCMK 3x2,5+2,5", originalLengthM: "1000" });
    const pdf = await materialLabelService.pdf(s.sup, { kind: "drum", siteId: s.site.id }, "https://sk.example", { title: "Kaapelikelat", footer: "Skannaa SK Managementilla" });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
    const acc = await materialLabelService.pdf(s.lift, { kind: "accessory", ids: s.sling.id }, "https://sk.example", { title: "Nostoapuvälineet", footer: "x" });
    expect(Buffer.from(acc.slice(0, 5)).toString()).toBe("%PDF-");
    await expect(materialLabelService.pdf(s.sup, { kind: "batch", siteId: s.site.id }, "https://sk.example", { title: "x", footer: "x" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.nothingToLabel"] } });

    expect(await scanService.resolve(s.sup, { code: `https://sk.example/c/${s.t.slug}/scan/${drum.id}` })).toEqual({ kind: "drum", id: drum.id });
    expect(await scanService.resolve(s.sup, { code: "kk-0002" })).toEqual({ kind: "drum", id: drum.id });
    expect(await scanService.resolve(s.lift, { code: s.sling.id })).toEqual({ kind: "accessory", id: s.sling.id });
    // A Client (no material.view) cannot resolve the same code: 404.
    const client = await createMember(s.t, "CLIENT", [{ projectId: s.project.id }]);
    await expect(scanService.resolve(client, { code: drum.id })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("Lifting Supervisor role template", () => {
  it("exists in every company with lift.plan.approve, and nobody else assigned holds it", async () => {
    const s = await setup();
    const role = await db.role.findFirstOrThrow({ where: { companyId: s.t.companyId, key: "LIFTING_SUPERVISOR" }, include: { permissions: true } });
    expect(role.projectAccess).toBe("ASSIGNED");
    expect(role.permissions.map((p) => p.permissionKey)).toContain("lift.plan.approve");
    const approvers = await db.rolePermission.findMany({ where: { companyId: s.t.companyId, permissionKey: "lift.plan.approve" }, include: { role: { select: { key: true } } } });
    expect(approvers.map((a) => a.role.key).sort()).toEqual(["CEO", "LIFTING_SUPERVISOR", "PROJECT_DIRECTOR"]);
    // Migration-created roles for pre-existing companies match the template too.
    const anyCompanyWithout = await db.company.count({ where: { roles: { none: { key: "LIFTING_SUPERVISOR" } } } });
    expect(anyCompanyWithout).toBe(0);
  });
});
