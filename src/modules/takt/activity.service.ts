import { readClient, runInTransaction } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { dateOnly, parseInput } from "@/platform/http/validation";
import type { RequestContext } from "@/platform/authz";
import { shiftDays, toIsoDate } from "./calendar";
import { applyProgress, mondayOf } from "./engine";
import { requireTakt, taktPermissions, today } from "./access";
import { activityStatuses, spansFor, workingCalendarFor } from "./plan.service";
import { TaktRepo } from "./repo";
import {
  activitySchema,
  activityUpdateSchema,
  blockSchema,
  constraintSchema,
  dependencySchema,
  progressSchema,
  type ActivityInput,
  type ActivityUpdateInput,
  type BlockInput,
  type ConstraintInput,
  type DependencyInput,
  type ProgressInput,
} from "./schemas";
import { z } from "zod";

async function loadActivity(repo: TaktRepo, ctx: RequestContext, activityId: string, permission: Parameters<typeof requireTakt>[2]) {
  const activity = await repo.findActivity(activityId);
  if (!activity) throw new NotFoundError();
  requireTakt(ctx, activity.projectId, permission);
  return activity;
}

/** True when `to` is reachable from `from` following predecessor → successor edges. */
function reachable(edges: { predecessorId: string; successorId: string }[], from: string, to: string): boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.predecessorId, [...(next.get(e.predecessorId) ?? []), e.successorId]);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(next.get(cur) ?? []));
  }
  return false;
}

const weekSchema = z.object({ date: dateOnly().optional() });

export const taktActivityService = {
  async get(ctx: RequestContext, activityId: string) {
    const repo = new TaktRepo(readClient(), ctx.company.id);
    const base = await loadActivity(repo, ctx, activityId, "takt.view");
    const activity = (await repo.findActivityDetailed(base.id))!;
    const plan = (await repo.findPlan(activity.planId))!;
    const cal = await workingCalendarFor(repo, plan);
    const { statuses, baseline, open } = await activityStatuses(repo, cal, plan);
    const spanIn = async (v: typeof baseline) => {
      if (!v) return null;
      const s = spansFor(cal, plan, v, (await repo.listAssignments(v.id)).filter((a) => a.activityId === activity.id)).get(activity.id);
      return s ? { versionNumber: v.versionNumber, status: v.status, start: toIsoDate(s.start), end: toIsoDate(s.end) } : null;
    };
    const users = await repo.findUsers([...new Set([...activity.progress.map((p) => p.createdById), ...activity.constraints.map((c) => c.clearedById)].filter((x): x is string => !!x))]);
    const status = statuses.get(activity.id) ?? { status: "NOT_READY" as const, reasons: [] };
    const planActivities = (await repo.listActivities(plan.id)).filter((a) => a.id !== activity.id);
    return {
      activity: { ...activity, progress: activity.progress.map((p) => ({ ...p, by: users.find((u) => u.id === p.createdById) ?? null })) },
      plan,
      status: status.status,
      reasons: status.reasons,
      baselineSpan: await spanIn(baseline),
      openSpan: await spanIn(open),
      equipmentTypes: await repo.listEquipmentTypes(),
      otherActivities: planActivities.map((a) => ({ id: a.id, label: `${a.taktArea.code} · ${a.workPackage.code} ${a.name}` })).sort((x, y) => x.label.localeCompare(y.label)),
      permissions: taktPermissions(ctx, plan.projectId),
      today: toIsoDate(today()),
    };
  },

  /** Activities of the plan for a week (planned in the reference version, or in progress). */
  async listForWeek(ctx: RequestContext, planId: string, input: { date?: string } = {}) {
    const data = parseInput(weekSchema, input);
    const repo = new TaktRepo(readClient(), ctx.company.id);
    const plan = await repo.findPlan(planId);
    if (!plan) throw new NotFoundError();
    requireTakt(ctx, plan.projectId, "takt.view");
    const cal = await workingCalendarFor(repo, plan);
    const { activities, statuses, referenceSpans } = await activityStatuses(repo, cal, plan);
    const from = mondayOf(data.date ?? today());
    const to = shiftDays(from, 6);
    const rows = activities
      .map((a) => ({ a, span: referenceSpans.get(a.id) ?? null, status: statuses.get(a.id)! }))
      .filter(({ a, span }) => a.execution === "IN_PROGRESS" || (span !== null && span.start <= to && span.end >= from && a.execution !== "COMPLETE") || (a.actualEnd !== null && a.actualEnd >= from && a.actualEnd <= to))
      .map(({ a, span, status }) => ({
        id: a.id,
        name: a.name,
        workPackage: a.workPackage,
        taktArea: a.taktArea,
        progressPct: a.progressPct,
        execution: a.execution,
        status: status.status,
        reasons: status.reasons,
        openConstraints: a._count.constraints,
        plannedStart: span ? toIsoDate(span.start) : null,
        plannedEnd: span ? toIsoDate(span.end) : null,
      }))
      .sort((x, y) => (x.plannedStart ?? "").localeCompare(y.plannedStart ?? "") || x.taktArea.sortOrder - y.taktArea.sortOrder || x.workPackage.sortOrder - y.workPackage.sortOrder);
    return { plan, from: toIsoDate(from), to: toIsoDate(to), activities: rows, permissions: taktPermissions(ctx, plan.projectId) };
  },

  async create(ctx: RequestContext, planId: string, input: ActivityInput) {
    const data = parseInput(activitySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const plan = await repo.findPlan(planId);
      if (!plan) throw new NotFoundError();
      requireTakt(ctx, plan.projectId, "takt.manage");
      const [wp, area] = await Promise.all([repo.findWorkPackage(data.workPackageId), repo.findArea(data.taktAreaId)]);
      if (!wp || wp.projectId !== plan.projectId || wp.archivedAt) throw new ValidationError({ workPackageId: ["validation.invalidOption"] });
      if (!area || area.siteId !== plan.siteId || area.archivedAt) throw new ValidationError({ taktAreaId: ["validation.invalidOption"] });
      if (await repo.findActivityByPair(plan.id, wp.id, area.id)) throw new ValidationError({ _form: ["validation.activityExists"] });
      const a = await repo.createActivity({
        projectId: plan.projectId,
        siteId: plan.siteId,
        planId: plan.id,
        taktAreaId: area.id,
        workPackageId: wp.id,
        name: data.name ?? wp.name,
        crewTrade: wp.trade,
        crewSize: wp.defaultCrewSize,
        equipmentTypeId: wp.equipmentTypeId,
        equipmentCount: wp.equipmentCount,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: "takt_activity.create", entityType: "takt_activity", entityId: a.id, projectId: a.projectId, after: a });
      return a;
    });
  },

  async update(ctx: RequestContext, activityId: string, input: ActivityUpdateInput) {
    const data = parseInput(activityUpdateSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await loadActivity(repo, ctx, activityId, "takt.manage");
      if (data.equipmentTypeId && !(await repo.findEquipmentType(data.equipmentTypeId))) throw new ValidationError({ equipmentTypeId: ["validation.invalidOption"] });
      const after = await repo.updateActivity(before.id, { ...data, equipmentCount: data.equipmentTypeId ? data.equipmentCount : 0, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "takt_activity.update", entityType: "takt_activity", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },

  /** Archives an activity and removes it from the open draft (baselines keep it, frozen). */
  async archive(ctx: RequestContext, activityId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await loadActivity(repo, ctx, activityId, "takt.manage");
      const open = await repo.findOpenVersion(before.planId);
      if (open?.status === "DRAFT") {
        const asg = await repo.findAssignment(open.id, before.id);
        if (asg) await repo.deleteAssignment(asg.id);
      }
      const after = await repo.updateActivity(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "takt_activity.archive", entityType: "takt_activity", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },

  async addDependency(ctx: RequestContext, input: DependencyInput) {
    const data = parseInput(dependencySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const successor = await loadActivity(repo, ctx, data.successorId, "takt.manage");
      const predecessor = await repo.findActivity(data.predecessorId);
      if (!predecessor || predecessor.planId !== successor.planId) throw new ValidationError({ predecessorId: ["validation.invalidOption"] });
      if (predecessor.id === successor.id) throw new ValidationError({ predecessorId: ["validation.dependencyCycle"] });
      if (await repo.findDependencyPair(predecessor.id, successor.id)) throw new ValidationError({ predecessorId: ["validation.dependencyExists"] });
      if (reachable(await repo.listDependencies(successor.planId), successor.id, predecessor.id)) throw new ValidationError({ predecessorId: ["validation.dependencyCycle"] });
      const dep = await repo.createDependency({ planId: successor.planId, predecessorId: predecessor.id, successorId: successor.id, type: data.type, lagDays: data.lagDays, createdById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "activity_dependency.create", entityType: "activity_dependency", entityId: dep.id, projectId: successor.projectId, after: dep });
      return dep;
    });
  },

  async removeDependency(ctx: RequestContext, dependencyId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const dep = await repo.findDependency(dependencyId);
      if (!dep) throw new NotFoundError();
      const successor = await loadActivity(repo, ctx, dep.successorId, "takt.manage");
      await repo.deleteDependency(dep.id);
      await writeAudit(tx, ctx, { action: "activity_dependency.remove", entityType: "activity_dependency", entityId: dep.id, projectId: successor.projectId, before: dep });
    });
  },

  async addConstraint(ctx: RequestContext, activityId: string, input: ConstraintInput) {
    const data = parseInput(constraintSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const activity = await loadActivity(repo, ctx, activityId, "takt.progress.update");
      const c = await repo.createConstraint({ planId: activity.planId, activityId: activity.id, ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "activity_constraint.create", entityType: "activity_constraint", entityId: c.id, projectId: activity.projectId, after: c });
      return c;
    });
  },

  async clearConstraint(ctx: RequestContext, constraintId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await repo.findConstraint(constraintId);
      if (!before) throw new NotFoundError();
      const activity = await loadActivity(repo, ctx, before.activityId, "takt.progress.update");
      if (before.status === "CLEARED") return before;
      const after = await repo.updateConstraint(before.id, { status: "CLEARED", clearedAt: new Date(), clearedById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "activity_constraint.clear", entityType: "activity_constraint", entityId: after.id, projectId: activity.projectId, before, after, diff: true });
      return after;
    });
  },

  /** Appends a progress report; sets execution state and actual dates. */
  async recordProgress(ctx: RequestContext, activityId: string, input: ProgressInput) {
    const data = parseInput(progressSchema, input);
    if (data.reportDate > today()) throw new ValidationError({ reportDate: ["validation.futureDate"] });
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await loadActivity(repo, ctx, activityId, "takt.progress.update");
      if (before.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      const next = applyProgress(before, data.progressPct, data.reportDate);
      const progress = await repo.createProgress({ planId: before.planId, activityId: before.id, reportDate: data.reportDate, progressPct: data.progressPct, note: data.note, createdById: ctx.user.id });
      const after = await repo.updateActivity(before.id, { ...next, ...(next.execution === "COMPLETE" ? { blocked: false } : {}), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, {
        action: "takt_activity.progress",
        entityType: "takt_activity",
        entityId: after.id,
        projectId: after.projectId,
        before: { progressPct: before.progressPct, execution: before.execution },
        after: { progressPct: after.progressPct, execution: after.execution, reportDate: toIsoDate(data.reportDate), note: data.note },
        metadata: { progressId: progress.id },
      });
      return after;
    });
  },

  /** Flags an activity blocked with a delay reason and recovery action, or unblocks it. */
  async setBlocked(ctx: RequestContext, activityId: string, input: BlockInput) {
    const data = parseInput(blockSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await loadActivity(repo, ctx, activityId, "takt.progress.update");
      const after = await repo.updateActivity(before.id, {
        blocked: data.blocked,
        delayReason: data.blocked ? data.delayReason : before.delayReason,
        recoveryAction: data.recoveryAction ?? (data.blocked ? null : before.recoveryAction),
        updatedById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: data.blocked ? "takt_activity.block" : "takt_activity.unblock", entityType: "takt_activity", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },
};
