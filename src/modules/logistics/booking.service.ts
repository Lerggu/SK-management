import { readClient, runInTransaction, type Tx } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { hasPermission, hasProjectPermission, requirePermission, type RequestContext } from "@/platform/authz";
import { detectConflicts, type Conflict } from "./rules";
import { requireLogistics, visibleLogisticsProjects } from "./access";
import { LogisticsRepo } from "./repo";
import { bookingListSchema, bookingSchema, decisionSchema, type BookingInput, type DecisionInput } from "./schemas";

type Booking = NonNullable<Awaited<ReturnType<LogisticsRepo["findBooking"]>>>;

async function conflictsFor(repo: LogisticsRepo, b: Booking): Promise<Conflict[]> {
  const kind = b.resourceKind;
  const resourceId = (kind === "EMPLOYEE" ? b.employeeId : b.equipmentId)!;
  const others = await repo.bookingsOfResource(kind, resourceId, b.startsAt, b.endsAt, b.id);
  const resource =
    kind === "EMPLOYEE"
      ? { kind, active: b.employee!.status === "ACTIVE", trade: b.employee!.trade }
      : { kind, active: b.equipment!.status === "AVAILABLE" || b.equipment!.status === "IN_USE", equipmentTypeId: b.equipment!.equipmentTypeId, nextInspectionDate: b.equipment!.nextInspectionDate };
  const requirement = b.requirement ? (b.requirement.kind === "TRADE" ? { kind: "TRADE" as const, trade: b.requirement.trade! } : { kind: "EQUIPMENT_TYPE" as const, equipmentTypeId: b.requirement.equipmentTypeId! }) : null;
  return detectConflicts({ period: b, others, resource, requirement });
}

/** Output mapper: the booking company sees the owner's name only; the owner sees where its resource goes. */
function present(b: Booking, ctx: RequestContext, conflicts: Conflict[]) {
  return {
    id: b.id,
    status: b.status,
    resourceKind: b.resourceKind,
    resourceLabel: b.employee ? `${b.employee.lastName} ${b.employee.firstName}` : `${b.equipment!.assetNumber} ${b.equipment!.name}`,
    resourceDetail: b.employee ? b.employee.trade : b.equipment!.equipmentType.name,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    note: b.note,
    decisionNote: b.decisionNote,
    conflictsAccepted: b.conflictsAccepted,
    project: b.project,
    site: b.site,
    activity: b.activity,
    requirementId: b.requirementId,
    company: b.company,
    ownerCompany: b.ownerCompany,
    crossCompany: b.companyId !== b.ownerCompanyId,
    incoming: b.ownerCompanyId === ctx.company.id && b.companyId !== ctx.company.id,
    conflicts,
  };
}

/** Whether ctx may decide (approve/reject) the booking. */
function canDecide(ctx: RequestContext, b: Booking): boolean {
  if (b.ownerCompanyId !== ctx.company.id) return false;
  if (b.companyId === ctx.company.id) return hasProjectPermission(ctx, b.projectId, "booking.manage");
  return hasPermission(ctx, "booking.manage");
}

function canCancel(ctx: RequestContext, b: Booking): boolean {
  if (b.companyId === ctx.company.id) return hasProjectPermission(ctx, b.projectId, "booking.manage");
  return b.ownerCompanyId === ctx.company.id && hasPermission(ctx, "booking.manage");
}

async function loadVisible(repo: LogisticsRepo, ctx: RequestContext, id: string) {
  const b = await repo.findBooking(id);
  if (!b) throw new NotFoundError();
  if (b.companyId === ctx.company.id) requireLogistics(ctx, b.projectId, "logistics.view");
  else if (!hasPermission(ctx, "booking.manage")) throw new NotFoundError();
  return b;
}

/** Audit in the actor's company and, for cross-company bookings, in the other company too. */
async function auditBoth(tx: Tx, ctx: RequestContext, b: { id: string; companyId: string; ownerCompanyId: string; projectId: string }, action: string, after: Record<string, unknown>, before?: Record<string, unknown>) {
  await writeAudit(tx, ctx, { action, entityType: "resource_booking", entityId: b.id, projectId: b.companyId === ctx.company.id ? b.projectId : null, before: before ?? null, after });
  if (b.companyId !== b.ownerCompanyId) {
    const other = b.companyId === ctx.company.id ? b.ownerCompanyId : b.companyId;
    const org = await tx.company.findUniqueOrThrow({ where: { id: other }, select: { organizationId: true } });
    await writeAudit(tx, ctx, { action, entityType: "resource_booking", entityId: b.id, companyId: other, organizationId: org.organizationId, projectId: other === b.companyId ? b.projectId : null, before: before ?? null, after: { ...after, byCompany: ctx.company.name } });
  }
}

export const bookingService = {
  /** Own resources plus resources shared with the group by other companies of the organization. */
  async resourceOptions(ctx: RequestContext, projectId: string) {
    const repo = new LogisticsRepo(readClient(), ctx.company.id);
    const project = await repo.findProject(projectId);
    if (!project) throw new NotFoundError();
    requireLogistics(ctx, project.id, "booking.manage");
    const [employees, equipment, group] = await Promise.all([repo.ownEmployees(), repo.ownEquipment(), repo.groupResources(ctx.company.organizationId)]);
    const companyName = new Map(group.companies.map((c) => [c.id, c.name]));
    return {
      own: [
        ...employees.filter((e) => e.status === "ACTIVE").map((e) => ({ value: `EMPLOYEE:${e.id}`, kind: "EMPLOYEE" as const, label: `${e.lastName} ${e.firstName}`, detail: e.trade })),
        ...equipment.map((q) => ({ value: `EQUIPMENT:${q.id}`, kind: "EQUIPMENT" as const, label: `${q.assetNumber} ${q.name}`, detail: q.equipmentType.name })),
      ],
      group: [
        ...group.employees.map((e) => ({ value: `EMPLOYEE:${e.id}`, kind: "EMPLOYEE" as const, label: `${e.lastName} ${e.firstName}`, detail: e.trade, owner: companyName.get(e.companyId)! })),
        ...group.equipment.map((q) => ({ value: `EQUIPMENT:${q.id}`, kind: "EQUIPMENT" as const, label: `${q.assetNumber} ${q.name}`, detail: q.equipmentType.name, owner: companyName.get(q.companyId)! })),
      ],
    };
  },

  /** Bookings made by this company in projects the member can see, with conflicts. */
  async list(ctx: RequestContext, input: { projectId?: string | null; from?: string; to?: string } = {}) {
    const data = parseInput(bookingListSchema, input);
    const repo = new LogisticsRepo(readClient(), ctx.company.id);
    let projectIds = visibleLogisticsProjects(ctx);
    if (data.projectId) {
      if (!(await repo.findProject(data.projectId))) throw new NotFoundError();
      requireLogistics(ctx, data.projectId, "logistics.view");
      projectIds = [data.projectId];
    }
    const rows = await repo.listBookings({ projectIds, from: data.from, to: data.to ? new Date(data.to.getTime() + 86_400_000) : undefined });
    return Promise.all(rows.map(async (b) => ({ ...present(b, ctx, b.status === "REQUESTED" || b.status === "APPROVED" ? await conflictsFor(repo, b) : []), permissions: { decide: canDecide(ctx, b), cancel: canCancel(ctx, b) } })));
  },

  /** Booking requests from other companies for resources this company owns. */
  async incoming(ctx: RequestContext) {
    requirePermission(ctx, "booking.manage");
    const repo = new LogisticsRepo(readClient(), ctx.company.id);
    const rows = await repo.incomingBookings();
    return Promise.all(rows.map(async (b) => ({ ...present(b, ctx, b.status === "REQUESTED" || b.status === "APPROVED" ? await conflictsFor(repo, b) : []), permissions: { decide: canDecide(ctx, b), cancel: canCancel(ctx, b) } })));
  },

  async get(ctx: RequestContext, bookingId: string) {
    const repo = new LogisticsRepo(readClient(), ctx.company.id);
    const b = await loadVisible(repo, ctx, bookingId);
    return { ...present(b, ctx, await conflictsFor(repo, b)), permissions: { decide: canDecide(ctx, b), cancel: canCancel(ctx, b) } };
  },

  /**
   * Books one resource, or several (a crew). An own resource without
   * conflicts is approved at once; with conflicts, or when another company
   * owns it, the booking waits for a decision.
   */
  async create(ctx: RequestContext, input: BookingInput) {
    const data = parseInput(bookingSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LogisticsRepo(tx, ctx.company.id);
      const project = await repo.findProject(data.projectId);
      if (!project) throw new NotFoundError();
      requireLogistics(ctx, project.id, "booking.manage");
      if (project.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      let siteId = data.siteId;
      if (siteId) {
        const site = await repo.findSite(siteId);
        if (!site || site.projectId !== project.id) throw new ValidationError({ siteId: ["validation.invalidOption"] });
      }
      if (data.activityId) {
        const a = await repo.findActivity(data.activityId);
        if (!a || a.projectId !== project.id) throw new ValidationError({ activityId: ["validation.invalidOption"] });
        siteId = siteId ?? a.siteId;
        if (a.siteId !== siteId) throw new ValidationError({ activityId: ["validation.invalidOption"] });
      }
      if (data.requirementId) {
        const r = await repo.findRequirement(data.requirementId);
        if (!r || r.activityId !== data.activityId) throw new ValidationError({ requirementId: ["validation.invalidOption"] });
      }
      if (data.liftPlanId) {
        const lp = await repo.findLiftPlan(data.liftPlanId);
        if (!lp || lp.projectId !== project.id || lp.status !== "OPEN") throw new ValidationError({ liftPlanId: ["validation.invalidOption"] });
        siteId = siteId ?? lp.siteId;
        if (lp.siteId !== siteId) throw new ValidationError({ liftPlanId: ["validation.invalidOption"] });
      }
      const created = [];
      for (const ref of [...new Set(data.resources)]) {
        const [kind, id] = ref.split(":") as ["EMPLOYEE" | "EQUIPMENT", string];
        const resource = await repo.findBookableResource(kind, id, ctx.company.organizationId);
        if (!resource) throw new ValidationError({ resources: ["validation.invalidOption"] });
        const row = await repo.createBooking({
          ownerCompanyId: resource.ownerCompanyId,
          resourceKind: kind,
          employeeId: kind === "EMPLOYEE" ? id : null,
          equipmentId: kind === "EQUIPMENT" ? id : null,
          projectId: project.id,
          siteId,
          activityId: data.activityId,
          requirementId: data.requirementId,
          liftPlanId: data.liftPlanId,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          note: data.note,
          status: "REQUESTED",
          requestedById: ctx.user.id,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        });
        const full = (await repo.findBooking(row.id))!;
        const conflicts = await conflictsFor(repo, full);
        const autoApprove = resource.ownerCompanyId === ctx.company.id && conflicts.length === 0;
        if (autoApprove) await repo.updateBooking(row.id, { status: "APPROVED", decidedAt: new Date(), decidedById: ctx.user.id, updatedById: ctx.user.id });
        await auditBoth(tx, ctx, row, "resource_booking.create", {
          resource: resource.label,
          projectId: project.id,
          startsAt: data.startsAt.toISOString(),
          endsAt: data.endsAt.toISOString(),
          status: autoApprove ? "APPROVED" : "REQUESTED",
          liftPlanId: data.liftPlanId,
          conflicts: conflicts.map((c) => c.code),
        });
        created.push({ id: row.id, status: autoApprove ? "APPROVED" : "REQUESTED", conflicts });
      }
      return created;
    });
  },

  /** Approve or reject. Approving despite conflicts needs an explicit acknowledgement (audited). */
  async decide(ctx: RequestContext, bookingId: string, input: DecisionInput) {
    const data = parseInput(decisionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LogisticsRepo(tx, ctx.company.id);
      const b = await loadVisible(repo, ctx, bookingId);
      if (!canDecide(ctx, b)) throw new ForbiddenError("Only the owning company decides");
      if (b.status !== "REQUESTED") throw new ValidationError({ _form: ["validation.bookingNotPending"] });
      const conflicts = await conflictsFor(repo, b);
      if (data.decision === "APPROVE" && conflicts.length > 0 && !data.acceptConflicts) throw new ValidationError({ acceptConflicts: ["validation.conflictsNotAccepted"] });
      const status = data.decision === "APPROVE" ? "APPROVED" : "REJECTED";
      await repo.updateBooking(b.id, { status, decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: data.note, conflictsAccepted: data.decision === "APPROVE" && conflicts.length > 0, updatedById: ctx.user.id });
      await auditBoth(tx, ctx, b, data.decision === "APPROVE" ? "resource_booking.approve" : "resource_booking.reject", { status, note: data.note, conflicts: conflicts.map((c) => c.code), conflictsAccepted: data.acceptConflicts }, { status: b.status });
      return { status, conflicts };
    });
  },

  async cancel(ctx: RequestContext, bookingId: string) {
    return runInTransaction(async (tx) => {
      const repo = new LogisticsRepo(tx, ctx.company.id);
      const b = await loadVisible(repo, ctx, bookingId);
      if (!canCancel(ctx, b)) throw new ForbiddenError("Cannot cancel this booking");
      if (b.status !== "REQUESTED" && b.status !== "APPROVED") throw new ValidationError({ _form: ["validation.bookingNotActive"] });
      await repo.updateBooking(b.id, { status: "CANCELLED", updatedById: ctx.user.id });
      await auditBoth(tx, ctx, b, "resource_booking.cancel", { status: "CANCELLED" }, { status: b.status });
    });
  },
};
