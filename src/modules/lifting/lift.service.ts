import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import type { RequestContext } from "@/platform/authz";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { utcToZoned } from "@/platform/i18n/time";
import { hasBlocking, liftPlanChecks, totalLoadKg, utilizationPct, type LiftIssue } from "./rules";
import { liftPermissions, requireAccessoryRegister, requireLift, visibleLiftProjects } from "./access";
import { LiftingRepo } from "./repo";
import {
  accessorySchema,
  accessoryUpdateSchema,
  liftAccessorySchema,
  liftDecisionSchema,
  liftPlanListSchema,
  liftPlanSchema,
  liftVersionSchema,
  noteSchema,
  reasonSchema,
  type AccessoryInput,
  type AccessoryUpdateInput,
  type LiftAccessoryInput,
  type LiftDecisionInput,
  type LiftPlanInput,
  type LiftVersionInput,
} from "./schemas";

const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d.toString()));
const str = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : d.toString());
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// ── accessories ──────────────────────────────────────────────────────
type Accessory = NonNullable<Awaited<ReturnType<LiftingRepo["findAccessory"]>>>;
const presentAccessory = (a: Accessory, today = todayInDisplayZone()) => ({
  ...a,
  wllKg: a.wllKg.toString(),
  nextInspectionDate: isoDate(a.nextInspectionDate),
  inspectionDue: a.nextInspectionDate === null || isoDate(a.nextInspectionDate)! <= today,
});

export const liftingAccessoryService = {
  async list(ctx: RequestContext, input: { includeArchived?: boolean } = {}) {
    requireAccessoryRegister(ctx);
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    const rows = await repo.listAccessories(!!input.includeArchived);
    return rows.map((a) => presentAccessory(a));
  },

  async get(ctx: RequestContext, accessoryId: string) {
    requireAccessoryRegister(ctx);
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    const a = await repo.findAccessory(accessoryId);
    if (!a) throw new NotFoundError();
    return presentAccessory(a);
  },

  async create(ctx: RequestContext, input: AccessoryInput) {
    const data = parseInput(accessorySchema, input);
    requireAccessoryRegister(ctx, true);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      try {
        const a = await repo.createAccessory({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "lifting_accessory.create", entityType: "lifting_accessory", entityId: a.id, after: a });
        return a;
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ code: ["validation.codeTaken"] });
        throw e;
      }
    });
  },

  async update(ctx: RequestContext, accessoryId: string, input: AccessoryUpdateInput) {
    const data = parseInput(accessoryUpdateSchema, input);
    requireAccessoryRegister(ctx, true);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const before = await repo.findAccessory(accessoryId);
      if (!before) throw new NotFoundError();
      if (before.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      const after = await repo.updateAccessory(before.id, { ...data, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "lifting_accessory.update", entityType: "lifting_accessory", entityId: after.id, before, after, diff: true });
      return after;
    });
  },

  async archive(ctx: RequestContext, accessoryId: string) {
    requireAccessoryRegister(ctx, true);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const before = await repo.findAccessory(accessoryId);
      if (!before) throw new NotFoundError();
      const after = await repo.updateAccessory(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "lifting_accessory.archive", entityType: "lifting_accessory", entityId: after.id, before, after, diff: true });
      return after;
    });
  },
};

// ── lift plans ───────────────────────────────────────────────────────
type Plan = NonNullable<Awaited<ReturnType<LiftingRepo["findPlan"]>>>;
type Version = Plan["versions"][number];

function checksFor(plan: Pick<Plan, "plannedStart">, v: Version, liftDate = utcToZoned(plan.plannedStart).date): LiftIssue[] {
  return liftPlanChecks({
    liftDate,
    loadDescription: v.loadDescription,
    loadWeightKg: num(v.loadWeightKg),
    riggingWeightKg: num(v.riggingWeightKg),
    radiusM: num(v.radiusM),
    craneCapacityKg: num(v.craneCapacityKg),
    riskDocumentId: v.riskDocumentId,
    crane: v.crane ? { label: `${v.crane.assetNumber} ${v.crane.name}`, status: v.crane.status, nextInspectionDate: isoDate(v.crane.nextInspectionDate), archived: !!v.crane.archivedAt } : null,
    accessories: v.accessories.map((x) => ({ code: x.accessory.code, wllKg: num(x.accessory.wllKg)!, count: x.count, status: x.accessory.status, archived: !!x.accessory.archivedAt, nextInspectionDate: isoDate(x.accessory.nextInspectionDate) })),
  });
}

const openVersion = (p: Plan) => p.versions.find((v) => v.status === "DRAFT" || v.status === "SUBMITTED") ?? null;
const approvedVersion = (p: Plan) => p.versions.find((v) => v.status === "APPROVED") ?? null;

function actorsFor(ctx: RequestContext, p: Plan) {
  const perms = liftPermissions(ctx, p.projectId);
  const open = openVersion(p);
  const latest = p.versions[0] ?? null;
  const isOpen = p.status === "OPEN";
  const ownDraft = !!open && open.createdById === ctx.user.id;
  const author = perms.manage || (perms.request && (ownDraft || p.createdById === ctx.user.id));
  return {
    edit: isOpen && open?.status === "DRAFT" && (perms.manage || (perms.request && ownDraft)),
    submit: isOpen && open?.status === "DRAFT" && (perms.manage || (perms.request && ownDraft)),
    returnToDraft: isOpen && open?.status === "SUBMITTED" && (perms.approve || perms.manage || open.submittedById === ctx.user.id),
    decide: isOpen && open?.status === "SUBMITTED" && perms.approve && open.submittedById !== ctx.user.id && open.createdById !== ctx.user.id,
    selfApprovalBlocked: isOpen && open?.status === "SUBMITTED" && perms.approve && (open.submittedById === ctx.user.id || open.createdById === ctx.user.id),
    revise: isOpen && !open && !!latest && (latest.status === "APPROVED" || latest.status === "REJECTED") && author,
    complete: isOpen && !!approvedVersion(p) && !open && perms.manage,
    cancel: isOpen && author,
    book: isOpen && perms.book,
  };
}

function presentVersion(p: Plan, v: Version) {
  return {
    ...v,
    loadWeightKg: str(v.loadWeightKg),
    riggingWeightKg: str(v.riggingWeightKg),
    radiusM: str(v.radiusM),
    craneCapacityKg: str(v.craneCapacityKg),
    safetyDistanceM: str(v.safetyDistanceM),
    totalLoadKg: v.loadWeightKg ? totalLoadKg({ loadWeightKg: num(v.loadWeightKg), riggingWeightKg: num(v.riggingWeightKg) }) : null,
    utilizationPct: utilizationPct({ loadWeightKg: num(v.loadWeightKg), riggingWeightKg: num(v.riggingWeightKg), craneCapacityKg: num(v.craneCapacityKg) }),
    accessories: v.accessories.map((x) => ({ id: x.id, count: x.count, accessory: presentAccessory(x.accessory) })),
    crane: v.crane ? { ...v.crane, nextInspectionDate: isoDate(v.crane.nextInspectionDate) } : null,
    issues: checksFor(p, v),
  };
}

async function loadPlan(repo: LiftingRepo, ctx: RequestContext, planId: string) {
  const p = await repo.findPlan(planId);
  if (!p) throw new NotFoundError();
  requireLift(ctx, p.projectId, "logistics.view");
  return p;
}

function requireOpen(p: Plan) {
  if (p.status !== "OPEN") throw new ValidationError({ _form: ["validation.liftClosed"] });
}

export const liftPlanService = {
  /** Choices for the plan form: cranes, accessories, documents, activities and LIFT requests of the site. */
  async options(ctx: RequestContext, siteId: string) {
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    const site = await repo.findSite(siteId);
    if (!site) throw new NotFoundError();
    requireLift(ctx, site.projectId, "logistics.view");
    const [cranes, accessories, documents, activities, requests] = await Promise.all([repo.listCranes(), repo.listAccessories(), repo.listDocuments(site.projectId), repo.listActivities(site.id), repo.listLiftRequests(site.id)]);
    return { site, cranes: cranes.map((c) => ({ ...c, nextInspectionDate: isoDate(c.nextInspectionDate) })), accessories: accessories.map((a) => presentAccessory(a)), documents, activities, requests, permissions: liftPermissions(ctx, site.projectId) };
  },

  async sites(ctx: RequestContext) {
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    return repo.listSites(visibleLiftProjects(ctx));
  },

  async list(ctx: RequestContext, input: { siteId?: string | null; status?: string } = {}) {
    const data = parseInput(liftPlanListSchema, input);
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    if (data.siteId) {
      const site = await repo.findSite(data.siteId);
      if (!site) throw new NotFoundError();
      requireLift(ctx, site.projectId, "logistics.view");
    }
    const rows = await repo.listPlans({ projectIds: visibleLiftProjects(ctx), siteId: data.siteId ?? undefined, status: data.status });
    return rows.map((p) => {
      const latest = p.versions[0];
      return { id: p.id, title: p.title, status: p.status, plannedStart: p.plannedStart, plannedEnd: p.plannedEnd, site: p.site, activity: p.activity, versionNumber: latest?.versionNumber ?? null, versionStatus: latest?.status ?? null, approved: p.versions.some((v) => v.status === "APPROVED"), loadWeightKg: str(latest?.loadWeightKg) };
    });
  },

  async get(ctx: RequestContext, planId: string) {
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    const p = await loadPlan(repo, ctx, planId);
    const userIds = new Set<string>();
    for (const v of p.versions) for (const id of [v.createdById, v.submittedById, v.decidedById]) if (id) userIds.add(id);
    if (p.createdById) userIds.add(p.createdById);
    if (p.completedById) userIds.add(p.completedById);
    const [users, bookings] = await Promise.all([repo.findUsers([...userIds]), repo.listPlanBookings(p.id)]);
    const open = openVersion(p);
    const approved = approvedVersion(p);
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      projectId: p.projectId,
      siteId: p.siteId,
      plannedStart: p.plannedStart,
      plannedEnd: p.plannedEnd,
      completedAt: p.completedAt,
      completedById: p.completedById,
      completionNote: p.completionNote,
      createdById: p.createdById,
      site: p.site,
      request: p.request,
      activity: p.activity,
      versions: p.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, status: v.status, changeReason: v.changeReason, createdById: v.createdById, submittedAt: v.submittedAt, submittedById: v.submittedById, decidedAt: v.decidedAt, decidedById: v.decidedById, decisionNote: v.decisionNote })),
      open: open ? presentVersion(p, open) : null,
      approved: approved ? presentVersion(p, approved) : null,
      bookings: bookings.map((b) => ({ id: b.id, status: b.status, startsAt: b.startsAt, endsAt: b.endsAt, label: b.employee ? `${b.employee.lastName} ${b.employee.firstName}` : `${b.equipment!.assetNumber} ${b.equipment!.name}`, detail: b.employee?.trade ?? null, owner: b.ownerCompany.name })),
      users,
      can: actorsFor(ctx, p),
      permissions: liftPermissions(ctx, p.projectId),
    };
  },

  /** Creates a lift with an empty draft (version 1), optionally for a V4 LIFT request. */
  async create(ctx: RequestContext, input: LiftPlanInput) {
    const data = parseInput(liftPlanSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const site = await repo.findSite(data.siteId);
      if (!site) throw new NotFoundError();
      requireLift(ctx, site.projectId, "lift.request");
      if (site.archivedAt || site.project.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      let activityId = data.activityId;
      if (data.requestId) {
        const r = await repo.findRequest(data.requestId);
        if (!r || r.siteId !== site.id || r.serviceType !== "LIFT" || r.status === "CANCELLED" || r.status === "COMPLETE") throw new ValidationError({ requestId: ["validation.invalidOption"] });
        activityId = activityId ?? r.activityId;
      }
      if (activityId) {
        const a = await repo.findActivity(activityId);
        if (!a || a.siteId !== site.id) throw new ValidationError({ activityId: ["validation.invalidOption"] });
      }
      const plan = await repo.createPlan({ projectId: site.projectId, siteId: site.id, requestId: data.requestId, activityId, title: data.title, plannedStart: data.plannedStart, plannedEnd: data.plannedEnd, createdById: ctx.user.id, updatedById: ctx.user.id });
      const v = await repo.createVersion({ planId: plan.id, versionNumber: 1, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "lift_plan.create", entityType: "lift_plan", entityId: plan.id, projectId: plan.projectId, after: { ...plan, versionId: v.id } });
      return plan;
    });
  },

  /** Edits the open draft: load, crane, radius, capacity, area, risk assessment. */
  async updateDraft(ctx: RequestContext, planId: string, input: LiftVersionInput) {
    const data = parseInput(liftVersionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const p = await loadPlan(repo, ctx, planId);
      requireOpen(p);
      const can = actorsFor(ctx, p);
      const open = openVersion(p);
      if (!open || open.status !== "DRAFT") throw new ValidationError({ _form: ["validation.versionNotDraft"] });
      if (!can.edit) throw new ForbiddenError("Cannot edit this lift plan");
      if (data.craneId && !(await repo.findEquipment(data.craneId))) throw new ValidationError({ craneId: ["validation.invalidOption"] });
      if (data.riskDocumentId && !(await repo.findDocument(data.riskDocumentId))) throw new ValidationError({ riskDocumentId: ["validation.invalidOption"] });
      const after = await repo.updateVersion(open.id, { ...data, updatedById: ctx.user.id });
      const { accessories: _a, crane: _c, riskDocument: _r, ...before } = open;
      await writeAudit(tx, ctx, { action: "lift_plan.update", entityType: "lift_plan_version", entityId: open.id, projectId: p.projectId, before, after, diff: true });
      return after;
    });
  },

  async addAccessory(ctx: RequestContext, planId: string, input: LiftAccessoryInput) {
    const data = parseInput(liftAccessorySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const p = await loadPlan(repo, ctx, planId);
      requireOpen(p);
      const open = openVersion(p);
      if (!open || open.status !== "DRAFT") throw new ValidationError({ _form: ["validation.versionNotDraft"] });
      if (!actorsFor(ctx, p).edit) throw new ForbiddenError("Cannot edit this lift plan");
      const a = await repo.findAccessory(data.accessoryId);
      if (!a || a.archivedAt) throw new ValidationError({ accessoryId: ["validation.invalidOption"] });
      await repo.addVersionAccessory(open.id, a.id, data.count, ctx.user.id);
      await writeAudit(tx, ctx, { action: "lift_plan.accessory_add", entityType: "lift_plan_version", entityId: open.id, projectId: p.projectId, after: { accessory: a.code, count: data.count } });
    });
  },

  async removeAccessory(ctx: RequestContext, planId: string, accessoryId: string) {
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const p = await loadPlan(repo, ctx, planId);
      requireOpen(p);
      const open = openVersion(p);
      if (!open || open.status !== "DRAFT") throw new ValidationError({ _form: ["validation.versionNotDraft"] });
      if (!actorsFor(ctx, p).edit) throw new ForbiddenError("Cannot edit this lift plan");
      const line = open.accessories.find((x) => x.accessoryId === accessoryId);
      if (!line) throw new NotFoundError();
      await repo.removeVersionAccessory(open.id, accessoryId);
      await writeAudit(tx, ctx, { action: "lift_plan.accessory_remove", entityType: "lift_plan_version", entityId: open.id, projectId: p.projectId, before: { accessory: line.accessory.code, count: line.count } });
    });
  },

  /** Sends the draft to the person responsible for lifting. Blocking check issues refuse. */
  async submit(ctx: RequestContext, planId: string) {
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const p = await loadPlan(repo, ctx, planId);
      requireOpen(p);
      const open = openVersion(p);
      if (!open || open.status !== "DRAFT") throw new ValidationError({ _form: ["validation.versionNotDraft"] });
      if (!actorsFor(ctx, p).submit) throw new ForbiddenError("Cannot submit this lift plan");
      const issues = checksFor(p, open);
      if (hasBlocking(issues)) throw new ValidationError({ _form: ["validation.liftChecksFailed"] });
      await repo.updateVersion(open.id, { status: "SUBMITTED", submittedAt: new Date(), submittedById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "lift_plan.submit", entityType: "lift_plan_version", entityId: open.id, projectId: p.projectId, before: { status: "DRAFT" }, after: { status: "SUBMITTED", warnings: issues.map((i) => i.code) } });
    });
  },

  async returnToDraft(ctx: RequestContext, planId: string, input: { note?: string | null } = {}) {
    const data = parseInput(noteSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const p = await loadPlan(repo, ctx, planId);
      requireOpen(p);
      const open = openVersion(p);
      if (!open || open.status !== "SUBMITTED") throw new ValidationError({ _form: ["validation.versionNotSubmitted"] });
      if (!actorsFor(ctx, p).returnToDraft) throw new ForbiddenError("Cannot return this lift plan");
      await repo.updateVersion(open.id, { status: "DRAFT", submittedAt: null, submittedById: null, decisionNote: data.note, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "lift_plan.return", entityType: "lift_plan_version", entityId: open.id, projectId: p.projectId, before: { status: "SUBMITTED" }, after: { status: "DRAFT", note: data.note } });
    });
  },

  /**
   * Approval by the person responsible for lifting (lift.plan.approve; owner
   * decision 1). Never by the author or submitter. Checks are re-run; warnings
   * must be acknowledged. Approving supersedes the earlier approved version
   * and schedules an approved LIFT request.
   */
  async decide(ctx: RequestContext, planId: string, input: LiftDecisionInput) {
    const data = parseInput(liftDecisionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const p = await loadPlan(repo, ctx, planId);
      requireLift(ctx, p.projectId, "lift.plan.approve");
      requireOpen(p);
      const open = openVersion(p);
      if (!open || open.status !== "SUBMITTED") throw new ValidationError({ _form: ["validation.versionNotSubmitted"] });
      if (open.submittedById === ctx.user.id || open.createdById === ctx.user.id) throw new ValidationError({ _form: ["validation.liftSelfApproval"] });
      const issues = checksFor(p, open);
      if (data.decision === "APPROVE") {
        if (hasBlocking(issues)) throw new ValidationError({ _form: ["validation.liftChecksFailed"] });
        if (issues.length > 0 && !data.acknowledgeWarnings) throw new ValidationError({ acknowledgeWarnings: ["validation.liftWarningsNotAcknowledged"] });
        const previous = approvedVersion(p);
        if (previous) await repo.updateVersion(previous.id, { status: "SUPERSEDED", updatedById: ctx.user.id });
        await repo.updateVersion(open.id, { status: "APPROVED", decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: data.note, updatedById: ctx.user.id });
        let requestScheduled = false;
        if (p.request && p.request.status === "APPROVED") {
          await repo.updateRequest(p.request.id, { status: "SCHEDULED", updatedById: ctx.user.id });
          requestScheduled = true;
        }
        await writeAudit(tx, ctx, { action: "lift_plan.approve", entityType: "lift_plan_version", entityId: open.id, projectId: p.projectId, before: { status: "SUBMITTED" }, after: { status: "APPROVED", versionNumber: open.versionNumber, supersededVersion: previous?.versionNumber ?? null, warningsAcknowledged: issues.map((i) => i.code), note: data.note, requestScheduled } });
        return { status: "APPROVED" as const };
      }
      await repo.updateVersion(open.id, { status: "REJECTED", decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: data.note, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "lift_plan.reject", entityType: "lift_plan_version", entityId: open.id, projectId: p.projectId, before: { status: "SUBMITTED" }, after: { status: "REJECTED", note: data.note } });
      return { status: "REJECTED" as const };
    });
  },

  /** An approved (or rejected) plan is changed only through a new draft version with a reason. */
  async revise(ctx: RequestContext, planId: string, input: { reason: string }) {
    const data = parseInput(reasonSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const p = await loadPlan(repo, ctx, planId);
      requireOpen(p);
      if (openVersion(p)) throw new ValidationError({ _form: ["validation.openVersionExists"] });
      if (!actorsFor(ctx, p).revise) throw new ForbiddenError("Cannot revise this lift plan");
      const src = p.versions[0];
      const v = await repo.createVersion({
        planId: p.id,
        versionNumber: src.versionNumber + 1,
        loadDescription: src.loadDescription,
        loadWeightKg: src.loadWeightKg,
        riggingWeightKg: src.riggingWeightKg,
        cogNotes: src.cogNotes,
        craneId: src.craneId,
        radiusM: src.radiusM,
        craneCapacityKg: src.craneCapacityKg,
        areaDescription: src.areaDescription,
        safetyDistanceM: src.safetyDistanceM,
        riskDocumentId: src.riskDocumentId,
        changeReason: data.reason,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      await repo.copyVersionAccessories(src.id, v.id, ctx.user.id);
      await writeAudit(tx, ctx, { action: "lift_plan.revise", entityType: "lift_plan_version", entityId: v.id, projectId: p.projectId, after: { versionNumber: v.versionNumber, from: src.versionNumber, reason: data.reason } });
      return v;
    });
  },

  /**
   * Records the lift as carried out. Requires the approved version, no pending
   * revision, and passing checks on the day of completion (an accessory whose
   * inspection lapsed since approval stops the lift).
   */
  async complete(ctx: RequestContext, planId: string, input: { note?: string | null } = {}) {
    const data = parseInput(noteSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const p = await loadPlan(repo, ctx, planId);
      requireLift(ctx, p.projectId, "lift.plan.manage");
      requireOpen(p);
      const approved = approvedVersion(p);
      if (!approved) throw new ValidationError({ _form: ["validation.liftNotApproved"] });
      if (openVersion(p)) throw new ValidationError({ _form: ["validation.liftRevisionPending"] });
      const today = todayInDisplayZone();
      const liftDate = utcToZoned(p.plannedStart).date;
      if (hasBlocking(checksFor(p, approved, today > liftDate ? today : liftDate))) throw new ValidationError({ _form: ["validation.liftChecksFailed"] });
      const after = await repo.updatePlan(p.id, { status: "COMPLETED", completedAt: new Date(), completedById: ctx.user.id, completionNote: data.note, updatedById: ctx.user.id });
      if (p.request) {
        const chain: Record<string, ("SCHEDULED" | "IN_PROGRESS" | "COMPLETE")[]> = { APPROVED: ["SCHEDULED", "IN_PROGRESS", "COMPLETE"], SCHEDULED: ["IN_PROGRESS", "COMPLETE"], IN_PROGRESS: ["COMPLETE"] };
        for (const status of chain[p.request.status] ?? []) await repo.updateRequest(p.request.id, { status, updatedById: ctx.user.id });
      }
      await writeAudit(tx, ctx, { action: "lift_plan.complete", entityType: "lift_plan", entityId: p.id, projectId: p.projectId, before: { status: "OPEN" }, after: { status: "COMPLETED", versionNumber: approved.versionNumber, note: data.note } });
      return after;
    });
  },

  async cancel(ctx: RequestContext, planId: string, input: { note?: string | null } = {}) {
    const data = parseInput(noteSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const p = await loadPlan(repo, ctx, planId);
      requireOpen(p);
      if (!actorsFor(ctx, p).cancel) throw new ForbiddenError("Cannot cancel this lift plan");
      const after = await repo.updatePlan(p.id, { status: "CANCELLED", completionNote: data.note, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "lift_plan.cancel", entityType: "lift_plan", entityId: p.id, projectId: p.projectId, before: { status: "OPEN" }, after: { status: "CANCELLED", note: data.note } });
      return after;
    });
  },
};

