import { readClient, runInTransaction, isExclusionViolation, isUniqueViolation } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { projectPermissions, type RequestContext } from "@/platform/authz";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { formatMinute, utcToZoned, zonedToUtc } from "@/platform/i18n/time";
import { canAdvanceDelivery, canTransitionRequest, deliveryWindow, gateSlots, MATERIAL_ON_SITE, nextDeliveryStatuses, REQUEST_TRANSITIONS, type DeliveryStatus, type RequestActor, type RequestStatus } from "./rules";
import { logisticsPermissions, requireLogistics, visibleLogisticsProjects } from "./access";
import { LogisticsRepo } from "./repo";
import {
  advanceSchema,
  boardSchema,
  deliverySchema,
  locationSchema,
  requestListSchema,
  requestSchema,
  rescheduleSchema,
  transitionSchema,
  type DeliveryInput,
  type LocationInput,
  type RequestInput,
  type RescheduleInput,
  type TransitionInput,
} from "./schemas";

/** V5: a LIFT request is scheduled, started or completed only with an approved lift plan. */
const LIFT_GATED: RequestStatus[] = ["SCHEDULED", "IN_PROGRESS", "COMPLETE"];
const liftBlocked = async (repo: LogisticsRepo, r: { id: string; serviceType: string }) => r.serviceType === "LIFT" && !(await repo.hasApprovedLiftPlan(r.id));

const dayBounds = (dateIso: string) => ({ from: zonedToUtc(dateIso, 0), to: zonedToUtc(dateIso, 24 * 60) });

// ── locations ────────────────────────────────────────────────────────
export const logisticsLocationService = {
  async list(ctx: RequestContext, siteId: string) {
    const repo = new LogisticsRepo(readClient(), ctx.company.id);
    const site = await repo.findSite(siteId);
    if (!site) throw new NotFoundError();
    requireLogistics(ctx, site.projectId, "logistics.view");
    return { site, locations: await repo.listLocations(site.id), permissions: logisticsPermissions(ctx, site.projectId) };
  },

  async create(ctx: RequestContext, input: LocationInput) {
    const data = parseInput(locationSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LogisticsRepo(tx, ctx.company.id);
      const site = await repo.findSite(data.siteId);
      if (!site) throw new NotFoundError();
      requireLogistics(ctx, site.projectId, "logistics.approve");
      try {
        const loc = await repo.createLocation({
          projectId: site.projectId,
          siteId: site.id,
          kind: data.kind,
          name: data.name,
          opensMinute: data.kind === "GATE" ? data.opens : null,
          closesMinute: data.kind === "GATE" ? data.closes : null,
          notes: data.notes,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        });
        await writeAudit(tx, ctx, { action: "logistics_location.create", entityType: "logistics_location", entityId: loc.id, projectId: site.projectId, after: loc });
        return loc;
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ name: ["validation.nameTaken"] });
        throw e;
      }
    });
  },

  async archive(ctx: RequestContext, locationId: string) {
    return runInTransaction(async (tx) => {
      const repo = new LogisticsRepo(tx, ctx.company.id);
      const before = await repo.findLocation(locationId);
      if (!before) throw new NotFoundError();
      requireLogistics(ctx, before.projectId, "logistics.approve");
      const after = await repo.updateLocation(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "logistics_location.archive", entityType: "logistics_location", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },
};

// ── logistics requests ───────────────────────────────────────────────
function requestActors(ctx: RequestContext, projectId: string, createdById: string | null): RequestActor[] {
  const p = projectPermissions(ctx, projectId);
  const actors: RequestActor[] = [];
  if (p.has("logistics.request") && (createdById === ctx.user.id || p.has("logistics.approve"))) actors.push("requester");
  if (p.has("logistics.approve")) actors.push("approver");
  if (p.has("delivery.manage")) actors.push("operator");
  return actors;
}

export const logisticsRequestService = {
  async list(ctx: RequestContext, input: { siteId?: string | null; status?: string } = {}) {
    const data = parseInput(requestListSchema, input);
    const repo = new LogisticsRepo(readClient(), ctx.company.id);
    if (data.siteId) {
      const site = await repo.findSite(data.siteId);
      if (!site) throw new NotFoundError();
      requireLogistics(ctx, site.projectId, "logistics.view");
    }
    return repo.listRequests({ projectIds: visibleLogisticsProjects(ctx), siteId: data.siteId ?? undefined, status: data.status });
  },

  async get(ctx: RequestContext, requestId: string) {
    const repo = new LogisticsRepo(readClient(), ctx.company.id);
    const r = await repo.findRequest(requestId);
    if (!r) throw new NotFoundError();
    requireLogistics(ctx, r.projectId, "logistics.view");
    const actors = requestActors(ctx, r.projectId, r.createdById);
    const next = (Object.keys(REQUEST_TRANSITIONS[r.status]) as RequestStatus[]).filter((to) => canTransitionRequest(r.status, to, actors));
    const users = await repo.findUsers([r.requestedById, r.approvedById, r.createdById].filter((x): x is string => !!x));
    return { ...r, weightKg: r.weightKg?.toString() ?? null, next, users, permissions: logisticsPermissions(ctx, r.projectId) };
  },

  async create(ctx: RequestContext, input: RequestInput) {
    const data = parseInput(requestSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LogisticsRepo(tx, ctx.company.id);
      const site = await repo.findSite(data.siteId);
      if (!site) throw new NotFoundError();
      requireLogistics(ctx, site.projectId, "logistics.request");
      if (site.archivedAt || site.project.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      if (data.activityId) {
        const a = await repo.findActivity(data.activityId);
        if (!a || a.siteId !== site.id) throw new ValidationError({ activityId: ["validation.invalidOption"] });
      }
      if (data.equipmentTypeId && !(await repo.findEquipmentType(data.equipmentTypeId))) throw new ValidationError({ equipmentTypeId: ["validation.invalidOption"] });
      const { submit, ...fields } = data;
      const r = await repo.createRequest({
        ...fields,
        projectId: site.projectId,
        status: submit ? "REQUESTED" : "DRAFT",
        requestedAt: submit ? new Date() : null,
        requestedById: submit ? ctx.user.id : null,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: "logistics_request.create", entityType: "logistics_request", entityId: r.id, projectId: r.projectId, after: r });
      return r;
    });
  },

  /** Moves a request through its workflow (Logistics Coordinator or Site Manager approve). */
  async transition(ctx: RequestContext, requestId: string, input: TransitionInput) {
    const data = parseInput(transitionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LogisticsRepo(tx, ctx.company.id);
      const r = await repo.findRequest(requestId);
      if (!r) throw new NotFoundError();
      requireLogistics(ctx, r.projectId, "logistics.view");
      const actors = requestActors(ctx, r.projectId, r.createdById);
      if (!REQUEST_TRANSITIONS[r.status][data.to]) throw new ValidationError({ to: ["validation.invalidTransition"] });
      if (!canTransitionRequest(r.status, data.to, actors)) throw new ForbiddenError(`Cannot move request ${r.status} → ${data.to}`);
      if (r.serviceType === "LIFT" && LIFT_GATED.includes(data.to) && !(await repo.hasApprovedLiftPlan(r.id))) throw new ValidationError({ to: ["validation.liftNotApproved"] });
      const stamp =
        data.to === "REQUESTED" ? { requestedAt: new Date(), requestedById: ctx.user.id } : data.to === "APPROVED" ? { approvedAt: new Date(), approvedById: ctx.user.id } : {};
      const after = await repo.updateRequest(r.id, { status: data.to, decisionNote: data.note ?? r.decisionNote, ...stamp, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "logistics_request.transition", entityType: "logistics_request", entityId: r.id, projectId: r.projectId, before: { status: r.status }, after: { status: data.to, note: data.note } });
      return after;
    });
  },
};

// ── deliveries ───────────────────────────────────────────────────────
function slotError(e: unknown): never {
  if (isExclusionViolation(e, "deliveries_no_gate_overlap")) throw new ValidationError({ startTime: ["validation.slotTaken"] });
  throw e;
}

export const deliveryService = {
  async get(ctx: RequestContext, deliveryId: string) {
    const repo = new LogisticsRepo(readClient(), ctx.company.id);
    const d = await repo.findDelivery(deliveryId);
    if (!d) throw new NotFoundError();
    requireLogistics(ctx, d.projectId, "logistics.view");
    const start = utcToZoned(d.slotStart);
    const end = utcToZoned(d.slotEnd);
    return { ...d, weightKg: d.weightKg?.toString() ?? null, local: { date: start.date, start: formatMinute(start.minute), end: formatMinute(end.minute) }, next: nextDeliveryStatuses(d.status), permissions: logisticsPermissions(ctx, d.projectId) };
  },

  /**
   * Books a delivery into 30-minute gate slots. A delivery for a takt activity
   * opens a MATERIAL constraint on it; an approved logistics request becomes SCHEDULED.
   */
  async create(ctx: RequestContext, input: DeliveryInput) {
    const data = parseInput(deliverySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LogisticsRepo(tx, ctx.company.id);
      const site = await repo.findSite(data.siteId);
      if (!site) throw new NotFoundError();
      requireLogistics(ctx, site.projectId, "delivery.manage");
      const gate = await repo.findLocation(data.gateId);
      if (!gate || gate.siteId !== site.id || gate.kind !== "GATE" || gate.archivedAt) throw new ValidationError({ gateId: ["validation.invalidOption"] });
      for (const [field, id, kind] of [["unloadingId", data.unloadingId, "UNLOADING"], ["storageId", data.storageId, "STORAGE"]] as const) {
        if (!id) continue;
        const loc = await repo.findLocation(id);
        if (!loc || loc.siteId !== site.id || loc.kind !== kind) throw new ValidationError({ [field]: ["validation.invalidOption"] });
      }
      const dateIso = data.date.toISOString().slice(0, 10);
      const w = deliveryWindow(dateIso, data.startTime, data.slots, { opensMinute: gate.opensMinute!, closesMinute: gate.closesMinute! });
      if (!w.ok) throw new ValidationError({ startTime: [w.error] });
      const request = data.requestId ? await repo.findRequest(data.requestId) : null;
      if (data.requestId && (!request || request.siteId !== site.id)) throw new ValidationError({ requestId: ["validation.invalidOption"] });
      const activityId = data.activityId ?? request?.activityId ?? null;
      const activity = activityId ? await repo.findActivity(activityId) : null;
      if (activityId && (!activity || activity.siteId !== site.id)) throw new ValidationError({ activityId: ["validation.invalidOption"] });
      let constraintId: string | null = null;
      if (activity) {
        const c = await repo.createConstraint({ planId: activity.planId, activityId: activity.id, type: "MATERIAL", description: `${data.material} (${dateIso} ${formatMinute(data.startTime)})`, dueDate: data.date, createdById: ctx.user.id, updatedById: ctx.user.id });
        constraintId = c.id;
      }
      let d;
      try {
        d = await repo.createDelivery({
          projectId: site.projectId,
          siteId: site.id,
          gateId: gate.id,
          unloadingId: data.unloadingId,
          storageId: data.storageId,
          requestId: request?.id ?? null,
          activityId: activity?.id ?? null,
          constraintId,
          supplier: data.supplier,
          carrier: data.carrier,
          vehicle: data.vehicle,
          material: data.material,
          quantity: data.quantity,
          weightKg: data.weightKg,
          slotStart: w.start,
          slotEnd: w.end,
          notes: data.notes,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        });
      } catch (e) {
        slotError(e);
      }
      if (request?.status === "APPROVED" && !(await liftBlocked(repo, request))) await repo.updateRequest(request.id, { status: "SCHEDULED", updatedById: ctx.user.id });
      await writeAudit(tx, ctx, {
        action: "delivery.create",
        entityType: "delivery",
        entityId: d.id,
        projectId: d.projectId,
        after: { ...d, constraintOpened: !!constraintId },
      });
      return d;
    });
  },

  async reschedule(ctx: RequestContext, deliveryId: string, input: RescheduleInput) {
    const data = parseInput(rescheduleSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LogisticsRepo(tx, ctx.company.id);
      const before = await repo.findDelivery(deliveryId);
      if (!before) throw new NotFoundError();
      requireLogistics(ctx, before.projectId, "delivery.manage");
      if (!["PLANNED", "CONFIRMED"].includes(before.status)) throw new ValidationError({ _form: ["validation.deliveryArrived"] });
      const gate = await repo.findLocation(data.gateId);
      if (!gate || gate.siteId !== before.siteId || gate.kind !== "GATE" || gate.archivedAt) throw new ValidationError({ gateId: ["validation.invalidOption"] });
      const dateIso = data.date.toISOString().slice(0, 10);
      const w = deliveryWindow(dateIso, data.startTime, data.slots, { opensMinute: gate.opensMinute!, closesMinute: gate.closesMinute! });
      if (!w.ok) throw new ValidationError({ startTime: [w.error] });
      let after;
      try {
        after = await repo.updateDelivery(before.id, { gateId: gate.id, slotStart: w.start, slotEnd: w.end, updatedById: ctx.user.id });
      } catch (e) {
        slotError(e);
      }
      await writeAudit(tx, ctx, { action: "delivery.reschedule", entityType: "delivery", entityId: after.id, projectId: after.projectId, before: { gateId: before.gateId, slotStart: before.slotStart, slotEnd: before.slotEnd }, after: { gateId: after.gateId, slotStart: after.slotStart, slotEnd: after.slotEnd } });
      return after;
    });
  },

  /** Gate and unloading workflow; material on site clears the activity's material constraint. */
  async advance(ctx: RequestContext, deliveryId: string, input: { to: string }) {
    const data = parseInput(advanceSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LogisticsRepo(tx, ctx.company.id);
      const d = await repo.findDelivery(deliveryId);
      if (!d) throw new NotFoundError();
      requireLogistics(ctx, d.projectId, "delivery.manage");
      const to = data.to as DeliveryStatus;
      if (!canAdvanceDelivery(d.status, to)) throw new ValidationError({ to: ["validation.invalidTransition"] });
      const after = await repo.updateDelivery(d.id, {
        status: to,
        ...(to === "ARRIVED_GATE" || (!d.arrivedAt && ["CHECKED_IN", "UNLOADING", "STORED", "MOVED_TO_WORKFACE", "INSTALLED"].includes(to)) ? { arrivedAt: d.arrivedAt ?? new Date() } : {}),
        ...(to === "INSTALLED" ? { completedAt: new Date() } : {}),
        updatedById: ctx.user.id,
      });
      let constraintCleared = false;
      if (MATERIAL_ON_SITE.includes(to) && d.constraintId) constraintCleared = (await repo.clearConstraint(d.constraintId, ctx.user.id)).count > 0;
      if (d.request && !(await liftBlocked(repo, d.request))) {
        if (to === "ARRIVED_GATE" && d.request.status === "SCHEDULED") await repo.updateRequest(d.request.id, { status: "IN_PROGRESS", updatedById: ctx.user.id });
        if (MATERIAL_ON_SITE.includes(to) && (d.request.status === "IN_PROGRESS" || d.request.status === "SCHEDULED")) {
          if (d.request.status === "SCHEDULED") await repo.updateRequest(d.request.id, { status: "IN_PROGRESS", updatedById: ctx.user.id });
          await repo.updateRequest(d.request.id, { status: "COMPLETE", updatedById: ctx.user.id });
        }
      }
      await writeAudit(tx, ctx, { action: to === "CANCELLED" ? "delivery.cancel" : "delivery.status", entityType: "delivery", entityId: d.id, projectId: d.projectId, before: { status: d.status }, after: { status: to, constraintCleared } });
      return after;
    });
  },
};

// ── board ────────────────────────────────────────────────────────────
export const logisticsBoardService = {
  /** Sites the member can see logistics for. */
  async sites(ctx: RequestContext) {
    const repo = new LogisticsRepo(readClient(), ctx.company.id);
    return repo.listSites(visibleLogisticsProjects(ctx));
  },

  /** One site, one day: gates × 30-minute slots, deliveries, requests and bookings. */
  async day(ctx: RequestContext, input: { siteId: string; date?: string }) {
    const data = parseInput(boardSchema, { ...input, date: input.date || todayInDisplayZone() });
    const repo = new LogisticsRepo(readClient(), ctx.company.id);
    const site = await repo.findSite(data.siteId);
    if (!site) throw new NotFoundError();
    requireLogistics(ctx, site.projectId, "logistics.view");
    const dateIso = data.date.toISOString().slice(0, 10);
    const { from, to } = dayBounds(dateIso);
    const [locations, deliveries, requests, bookings, equipmentTypes] = await Promise.all([
      repo.listLocations(site.id),
      repo.listDeliveries({ siteId: site.id, from, to }),
      repo.listRequests({ siteId: site.id, from, to }),
      repo.listBookings({ siteId: site.id, from, to }),
      repo.listEquipmentTypes(),
    ]);
    const gates = locations.filter((l) => l.kind === "GATE");
    const opens = Math.min(...gates.map((g) => g.opensMinute!), 7 * 60);
    const closes = Math.max(...gates.map((g) => g.closesMinute!), 16 * 60);
    const slots = gateSlots(dateIso, opens, closes);
    return {
      site,
      date: dateIso,
      gates,
      unloading: locations.filter((l) => l.kind === "UNLOADING"),
      storage: locations.filter((l) => l.kind === "STORAGE"),
      slots: slots.map((s) => ({ start: s.start.toISOString(), minute: s.minute, label: formatMinute(s.minute) })),
      deliveries: deliveries.map((d) => ({ ...d, weightKg: d.weightKg?.toString() ?? null, startMinute: utcToZoned(d.slotStart).minute, endMinute: utcToZoned(d.slotEnd).minute, startLabel: formatMinute(utcToZoned(d.slotStart).minute), endLabel: formatMinute(utcToZoned(d.slotEnd).minute), next: nextDeliveryStatuses(d.status) })),
      requests: requests.map((r) => ({ ...r, weightKg: r.weightKg?.toString() ?? null })),
      bookings: bookings.map((b) => ({ id: b.id, status: b.status, label: b.employee ? `${b.employee.lastName} ${b.employee.firstName}` : `${b.equipment!.assetNumber} ${b.equipment!.name}`, startsAt: b.startsAt, endsAt: b.endsAt, owner: b.ownerCompany, activity: b.activity })),
      equipmentTypes,
      permissions: logisticsPermissions(ctx, site.projectId),
    };
  },
};
