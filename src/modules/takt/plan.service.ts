import { readClient, runInTransaction, isUniqueViolation, type Tx } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import type { RequestContext } from "@/platform/authz";
import { toIsoDate, workingDaysBetween, type WorkingCalendar } from "./calendar";
import { compareSpans, cycleDates, deriveStatus, generateTrain, plannedSpan, type PlannedSpan, type ReadinessStatus } from "./engine";
import { ensureDefaultCalendar, requireTakt, taktPermissions, toWorkingCalendar, today, visibleTaktProjects } from "./access";
import { TaktRepo } from "./repo";
import { assignmentSchema, draftSchema, planSchema, returnSchema, shiftSchema, trainSchema, versionStartSchema, type AssignmentInput, type PlanInput, type TrainInput } from "./schemas";

type Version = NonNullable<Awaited<ReturnType<TaktRepo["findVersion"]>>>;
type Plan = NonNullable<Awaited<ReturnType<TaktRepo["findPlan"]>>>;

async function loadPlan(repo: TaktRepo, ctx: RequestContext, planId: string, permission: Parameters<typeof requireTakt>[2]) {
  const plan = await repo.findPlan(planId);
  if (!plan) throw new NotFoundError();
  requireTakt(ctx, plan.projectId, permission);
  return plan;
}

async function loadVersion(repo: TaktRepo, ctx: RequestContext, versionId: string, permission: Parameters<typeof requireTakt>[2]) {
  const version = await repo.findVersion(versionId);
  if (!version) throw new NotFoundError();
  const plan = await loadPlan(repo, ctx, version.planId, permission);
  return { version, plan };
}

function requireDraft(version: Version) {
  if (version.status !== "DRAFT") throw new ValidationError({ _form: ["validation.versionNotDraft"] });
}

export async function workingCalendarFor(repo: TaktRepo, plan: Plan): Promise<WorkingCalendar> {
  const cal = await repo.findCalendar(plan.calendarId);
  if (!cal) throw new NotFoundError();
  return toWorkingCalendar(cal);
}

export function spansFor(cal: WorkingCalendar, plan: { cycleLengthDays: number }, version: { startDate: Date } | null, assignments: { activityId: string; startCycle: number; durationCycles: number }[]) {
  const map = new Map<string, PlannedSpan>();
  if (!version) return map;
  for (const a of assignments) map.set(a.activityId, plannedSpan(cal, version.startDate, plan.cycleLengthDays, a.startCycle, a.durationCycles));
  return map;
}

/** Status of every activity, judged against the reference version (baseline, else the open version). */
export async function activityStatuses(repo: TaktRepo, cal: WorkingCalendar, plan: Plan) {
  const [activities, deps, baseline, open] = await Promise.all([repo.listActivities(plan.id), repo.listDependencies(plan.id), repo.findBaseline(plan.id), repo.findOpenVersion(plan.id)]);
  const reference = baseline ?? open;
  const spans = spansFor(cal, plan, reference, reference ? await repo.listAssignments(reference.id) : []);
  const byId = new Map(activities.map((a) => [a.id, a]));
  const now = today();
  const statuses = new Map<string, { status: ReadinessStatus; reasons: string[] }>();
  for (const a of activities) {
    const predecessors = deps
      .filter((d) => d.successorId === a.id && byId.has(d.predecessorId))
      .map((d) => ({ type: d.type, execution: byId.get(d.predecessorId)!.execution }));
    statuses.set(a.id, deriveStatus({ execution: a.execution, blocked: a.blocked, openConstraints: a._count.constraints, predecessors, plannedStart: spans.get(a.id)?.start ?? null, today: now }));
  }
  return { activities, deps, statuses, referenceSpans: spans, baseline, open };
}

async function copyAssignments(repo: TaktRepo, from: Version | null, to: { id: string; planId: string }) {
  if (!from) return 0;
  const rows = await repo.listAssignments(from.id);
  if (rows.length) await repo.createAssignments(rows.map((r) => ({ planId: to.planId, versionId: to.id, activityId: r.activityId, startCycle: r.startCycle, durationCycles: r.durationCycles })));
  return rows.length;
}

/** Resource requirements of a version (generated when it becomes the baseline). */
async function generateRequirements(repo: TaktRepo, cal: WorkingCalendar, plan: Plan, version: Version) {
  const [assignments, activities] = await Promise.all([repo.listAssignments(version.id), repo.listActivities(plan.id)]);
  const byId = new Map(activities.map((a) => [a.id, a]));
  const wps = new Map((await repo.listWorkPackages(plan.projectId)).map((w) => [w.id, w]));
  const rows: Parameters<TaktRepo["createRequirements"]>[0] = [];
  for (const asg of assignments) {
    const a = byId.get(asg.activityId);
    if (!a) continue;
    const span = plannedSpan(cal, version.startDate, plan.cycleLengthDays, asg.startCycle, asg.durationCycles);
    const base = { planId: plan.id, versionId: version.id, activityId: a.id, startDate: span.start, endDate: span.end };
    const trade = a.crewTrade ?? wps.get(a.workPackageId)?.trade ?? null;
    if (a.crewSize > 0 && trade) rows.push({ ...base, kind: "TRADE", trade, quantity: a.crewSize });
    if (a.equipmentCount > 0 && a.equipmentTypeId) rows.push({ ...base, kind: "EQUIPMENT_TYPE", equipmentTypeId: a.equipmentTypeId, quantity: a.equipmentCount });
  }
  if (rows.length) await repo.createRequirements(rows);
  return rows.length;
}

async function newDraft(tx: Tx, repo: TaktRepo, ctx: RequestContext, plan: Plan, reason: string | null) {
  if (await repo.findOpenVersion(plan.id)) throw new ValidationError({ _form: ["validation.openVersionExists"] });
  const baseline = await repo.findBaseline(plan.id);
  const draft = await repo.createVersion({
    planId: plan.id,
    versionNumber: await repo.nextVersionNumber(plan.id),
    startDate: baseline?.startDate ?? today(),
    reason,
    basedOnId: baseline?.id ?? null,
    createdById: ctx.user.id,
    updatedById: ctx.user.id,
  });
  const copied = await copyAssignments(repo, baseline, draft);
  await writeAudit(tx, ctx, {
    action: "takt_plan.version_create",
    entityType: "takt_plan_version",
    entityId: draft.id,
    projectId: plan.projectId,
    after: { planId: plan.id, versionNumber: draft.versionNumber, basedOn: baseline?.versionNumber ?? null, reason, assignments: copied },
  });
  return draft;
}

export const taktPlanService = {
  /** Plans across the projects the member may see. */
  async list(ctx: RequestContext) {
    const repo = new TaktRepo(readClient(), ctx.company.id);
    return repo.listPlans(visibleTaktProjects(ctx));
  },

  async create(ctx: RequestContext, input: PlanInput) {
    const data = parseInput(planSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const site = await repo.findSite(data.siteId);
      if (!site) throw new NotFoundError();
      requireTakt(ctx, site.projectId, "takt.manage");
      if (site.archivedAt || site.project.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      const calendar = await ensureDefaultCalendar(tx, repo, ctx);
      try {
        const plan = await repo.createPlan({ projectId: site.projectId, siteId: site.id, calendarId: calendar.id, name: data.name, cycleLengthDays: data.cycleLengthDays, createdById: ctx.user.id, updatedById: ctx.user.id });
        const version = await repo.createVersion({ planId: plan.id, versionNumber: 1, startDate: data.startDate, reason: null, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "takt_plan.create", entityType: "takt_plan", entityId: plan.id, projectId: plan.projectId, after: { ...plan, firstVersionId: version.id, startDate: toIsoDate(version.startDate) } });
        return plan;
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ name: ["validation.nameTaken"] });
        throw e;
      }
    });
  },

  /** Takt board data for one version (default: the open version, else the baseline). */
  async board(ctx: RequestContext, planId: string, input: { versionId?: string | null } = {}) {
    const repo = new TaktRepo(readClient(), ctx.company.id);
    const plan = await loadPlan(repo, ctx, planId, "takt.view");
    const cal = await workingCalendarFor(repo, plan);
    const versions = await repo.listVersions(plan.id);
    const selected = input.versionId
      ? versions.find((v) => v.id === input.versionId)
      : (versions.find((v) => v.status === "DRAFT" || v.status === "PROPOSED") ?? versions.find((v) => v.status === "BASELINE") ?? versions[0]);
    if (input.versionId && !selected) throw new NotFoundError();
    const [buildings, workPackages, { activities, deps, statuses }, assignments, imports] = await Promise.all([
      repo.listBuildingsForSite(plan.siteId),
      repo.listWorkPackages(plan.projectId),
      activityStatuses(repo, cal, plan),
      selected ? repo.listAssignments(selected.id) : Promise.resolve([]),
      repo.listImports(plan.id),
    ]);
    const asgByActivity = new Map(assignments.map((a) => [a.activityId, a]));
    const lastCycle = assignments.reduce((m, a) => Math.max(m, a.startCycle + a.durationCycles), 0);
    const cycleCount = Math.min(400, Math.max(10, lastCycle + 3));
    const dates = selected ? cycleDates(cal, selected.startDate, plan.cycleLengthDays, cycleCount) : [];
    const users = await repo.findUsers([...new Set(versions.flatMap((v) => [v.approvedById, v.proposedById]).filter((x): x is string => !!x))]);
    return {
      plan,
      versions: versions.map((v) => ({ ...v, approvedBy: users.find((u) => u.id === v.approvedById) ?? null, proposedBy: users.find((u) => u.id === v.proposedById) ?? null })),
      selected: selected ?? null,
      cycleDates: dates.map(toIsoDate),
      today: toIsoDate(today()),
      buildings,
      workPackages,
      activities: activities.map((a) => {
        const asg = asgByActivity.get(a.id) ?? null;
        const span = asg && selected ? plannedSpan(cal, selected.startDate, plan.cycleLengthDays, asg.startCycle, asg.durationCycles) : null;
        return {
          ...a,
          openConstraints: a._count.constraints,
          status: statuses.get(a.id)!.status,
          reasons: statuses.get(a.id)!.reasons,
          assignment: asg ? { startCycle: asg.startCycle, durationCycles: asg.durationCycles } : null,
          plannedStart: span ? toIsoDate(span.start) : null,
          plannedEnd: span ? toIsoDate(span.end) : null,
        };
      }),
      dependencyCount: deps.length,
      imports: imports.map((i) => ({ id: i.id, fileName: i.fileName, format: i.format, status: i.status, createdAt: i.createdAt })),
      permissions: taktPermissions(ctx, plan.projectId),
    };
  },

  /** New draft version copied from the baseline. */
  async createDraft(ctx: RequestContext, planId: string, input: { reason?: string | null }) {
    const data = parseInput(draftSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const plan = await loadPlan(repo, ctx, planId, "takt.manage");
      return newDraft(tx, repo, ctx, plan, data.reason);
    });
  },

  async updateDraft(ctx: RequestContext, versionId: string, input: { startDate: string; reason?: string | null }) {
    const data = parseInput(versionStartSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const { version, plan } = await loadVersion(repo, ctx, versionId, "takt.manage");
      requireDraft(version);
      const after = await repo.updateVersion(version.id, { startDate: data.startDate, reason: data.reason, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "takt_plan.version_update", entityType: "takt_plan_version", entityId: version.id, projectId: plan.projectId, before: version, after, diff: true });
      return after;
    });
  },

  async discardDraft(ctx: RequestContext, versionId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const { version, plan } = await loadVersion(repo, ctx, versionId, "takt.manage");
      requireDraft(version);
      if (!(await repo.findBaseline(plan.id))) throw new ValidationError({ _form: ["validation.cannotDiscardOnlyVersion"] });
      await repo.deleteVersion(version.id);
      await writeAudit(tx, ctx, { action: "takt_plan.version_discard", entityType: "takt_plan_version", entityId: version.id, projectId: plan.projectId, before: { planId: plan.id, versionNumber: version.versionNumber } });
    });
  },

  async propose(ctx: RequestContext, versionId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const { version, plan } = await loadVersion(repo, ctx, versionId, "takt.manage");
      requireDraft(version);
      if ((await repo.listAssignments(version.id)).length === 0) throw new ValidationError({ _form: ["validation.emptyPlan"] });
      const after = await repo.updateVersion(version.id, { status: "PROPOSED", proposedAt: new Date(), proposedById: ctx.user.id, returnedNote: null, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "takt_plan.version_propose", entityType: "takt_plan_version", entityId: version.id, projectId: plan.projectId, before: { status: "DRAFT" }, after: { status: "PROPOSED", versionNumber: version.versionNumber } });
      return after;
    });
  },

  /** Returns a proposed version to draft (approver's note, or the proposer withdrawing it). */
  async returnToDraft(ctx: RequestContext, versionId: string, input: { note: string }) {
    const data = parseInput(returnSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const { version, plan } = await loadVersion(repo, ctx, versionId, "takt.view");
      const perms = taktPermissions(ctx, plan.projectId);
      if (!perms.approve && !perms.manage) requireTakt(ctx, plan.projectId, "takt.baseline.approve");
      if (version.status !== "PROPOSED") throw new ValidationError({ _form: ["validation.versionNotProposed"] });
      const after = await repo.updateVersion(version.id, { status: "DRAFT", returnedNote: data.note, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "takt_plan.version_return", entityType: "takt_plan_version", entityId: version.id, projectId: plan.projectId, before: { status: "PROPOSED" }, after: { status: "DRAFT", note: data.note } });
      return after;
    });
  },

  /**
   * Approves a proposed version as the baseline: the previous baseline is
   * superseded (never overwritten) and resource requirements are generated.
   */
  async approve(ctx: RequestContext, versionId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const { version, plan } = await loadVersion(repo, ctx, versionId, "takt.baseline.approve");
      if (version.status !== "PROPOSED") throw new ValidationError({ _form: ["validation.versionNotProposed"] });
      const previous = await repo.findBaseline(plan.id);
      if (previous) await repo.updateVersion(previous.id, { status: "SUPERSEDED", supersededAt: new Date(), updatedById: ctx.user.id });
      const approved = await repo.updateVersion(version.id, { status: "BASELINE", approvedAt: new Date(), approvedById: ctx.user.id, updatedById: ctx.user.id });
      const cal = await workingCalendarFor(repo, plan);
      const requirements = await generateRequirements(repo, cal, plan, approved);
      await writeAudit(tx, ctx, {
        action: "takt_plan.baseline_approve",
        entityType: "takt_plan_version",
        entityId: approved.id,
        projectId: plan.projectId,
        before: { baseline: previous?.versionNumber ?? null },
        after: { baseline: approved.versionNumber, startDate: toIsoDate(approved.startDate), requirements, reason: approved.reason },
      });
      return approved;
    });
  },

  /** Planned dates of a version against another (default: the baseline). */
  async compare(ctx: RequestContext, planId: string, input: { versionId: string; againstId?: string | null }) {
    const repo = new TaktRepo(readClient(), ctx.company.id);
    const plan = await loadPlan(repo, ctx, planId, "takt.view");
    const versions = await repo.listVersions(plan.id);
    const other = versions.find((v) => v.id === input.versionId);
    const base = input.againstId ? versions.find((v) => v.id === input.againstId) : versions.find((v) => v.status === "BASELINE");
    if (!other || (input.againstId && !base)) throw new NotFoundError();
    const cal = await workingCalendarFor(repo, plan);
    const [activities, otherAsg, baseAsg] = await Promise.all([repo.listActivities(plan.id), repo.listAssignments(other.id), base ? repo.listAssignments(base.id) : Promise.resolve([])]);
    const rows = compareSpans(cal, spansFor(cal, plan, base ?? null, baseAsg), spansFor(cal, plan, other, otherAsg));
    const byId = new Map(activities.map((a) => [a.id, a]));
    return {
      plan,
      base: base ?? null,
      other,
      versions,
      rows: rows
        .filter((r) => byId.has(r.activityId))
        .map((r) => {
          const a = byId.get(r.activityId)!;
          return {
            ...r,
            base: r.base ? { start: toIsoDate(r.base.start), end: toIsoDate(r.base.end) } : null,
            other: r.other ? { start: toIsoDate(r.other.start), end: toIsoDate(r.other.end) } : null,
            activity: { id: a.id, name: a.name, workPackage: a.workPackage, taktArea: a.taktArea },
          };
        })
        .sort((x, y) => (x.other?.start ?? x.base?.start ?? "").localeCompare(y.other?.start ?? y.base?.start ?? "") || x.activity.taktArea.code.localeCompare(y.activity.taktArea.code)),
      summary: {
        moved: rows.filter((r) => r.change === "MOVED").length,
        added: rows.filter((r) => r.change === "ADDED").length,
        removed: rows.filter((r) => r.change === "REMOVED").length,
        finishDelta: base && baseAsg.length && otherAsg.length ? endDelta(cal, plan, base, baseAsg, other, otherAsg) : 0,
      },
    };
  },

  /** Fills a draft with the takt train: every work package through every takt area of the site. */
  async generateTrain(ctx: RequestContext, versionId: string, input: TrainInput) {
    const data = parseInput(trainSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const { version, plan } = await loadVersion(repo, ctx, versionId, "takt.manage");
      requireDraft(version);
      const wps = await repo.listWorkPackages(plan.projectId);
      const areas = (await repo.listBuildingsForSite(plan.siteId)).flatMap((b) => b.taktAreas);
      if (!wps.length || !areas.length) throw new ValidationError({ _form: ["validation.trainNeedsStructure"] });
      const train = generateTrain({ workPackages: wps.map((w) => ({ id: w.id, durationCycles: w.defaultDurationCycles })), areas, startCycle: data.startCycle, bufferCycles: data.bufferCycles });
      const activityIds = new Map<string, string>();
      let created = 0;
      for (const asg of train.assignments) {
        const wp = wps.find((w) => w.id === asg.workPackageId)!;
        let activity = await repo.findActivityByPair(plan.id, wp.id, asg.areaId);
        if (!activity) {
          activity = await repo.createActivity({
            projectId: plan.projectId,
            siteId: plan.siteId,
            planId: plan.id,
            taktAreaId: asg.areaId,
            workPackageId: wp.id,
            name: wp.name,
            crewTrade: wp.trade,
            crewSize: wp.defaultCrewSize,
            equipmentTypeId: wp.equipmentTypeId,
            equipmentCount: wp.equipmentCount,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          });
          created++;
        } else if (activity.archivedAt) {
          activity = await repo.updateActivity(activity.id, { archivedAt: null, updatedById: ctx.user.id });
        }
        activityIds.set(`${wp.id}:${asg.areaId}`, activity.id);
        await repo.upsertAssignment(plan.id, version.id, activity.id, { startCycle: asg.startCycle, durationCycles: asg.durationCycles });
      }
      const deps = train.dependencies.map((d) => ({
        planId: plan.id,
        predecessorId: activityIds.get(`${d.predecessor.workPackageId}:${d.predecessor.areaId}`)!,
        successorId: activityIds.get(`${d.successor.workPackageId}:${d.successor.areaId}`)!,
        type: "FS" as const,
        lagDays: 0,
        createdById: ctx.user.id,
      }));
      const depResult = deps.length ? await repo.createDependencies(deps) : { count: 0 };
      await writeAudit(tx, ctx, {
        action: "takt_plan.train_generate",
        entityType: "takt_plan_version",
        entityId: version.id,
        projectId: plan.projectId,
        after: { taktTime: train.taktTime, assignments: train.assignments.length, activitiesCreated: created, dependenciesCreated: depResult.count, ...data },
      });
      return { taktTime: train.taktTime, assignments: train.assignments.length, activitiesCreated: created, dependenciesCreated: depResult.count };
    });
  },

  async setAssignment(ctx: RequestContext, versionId: string, activityId: string, input: AssignmentInput) {
    const data = parseInput(assignmentSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const { version, plan } = await loadVersion(repo, ctx, versionId, "takt.manage");
      requireDraft(version);
      const activity = await repo.findActivity(activityId);
      if (!activity || activity.planId !== plan.id || activity.archivedAt) throw new NotFoundError();
      const before = await repo.findAssignment(version.id, activity.id);
      const after = await repo.upsertAssignment(plan.id, version.id, activity.id, data);
      await writeAudit(tx, ctx, {
        action: "takt_plan.assignment_set",
        entityType: "takt_assignment",
        entityId: after.id,
        projectId: plan.projectId,
        before: before ? { startCycle: before.startCycle, durationCycles: before.durationCycles } : null,
        after: { versionNumber: version.versionNumber, activityId: activity.id, startCycle: after.startCycle, durationCycles: after.durationCycles },
      });
      return after;
    });
  },

  async removeAssignment(ctx: RequestContext, versionId: string, activityId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const { version, plan } = await loadVersion(repo, ctx, versionId, "takt.manage");
      requireDraft(version);
      const before = await repo.findAssignment(version.id, activityId);
      if (!before) throw new NotFoundError();
      await repo.deleteAssignment(before.id);
      await writeAudit(tx, ctx, { action: "takt_plan.assignment_remove", entityType: "takt_assignment", entityId: before.id, projectId: plan.projectId, before: { versionNumber: version.versionNumber, activityId, startCycle: before.startCycle, durationCycles: before.durationCycles } });
    });
  },

  /** Moves a whole wagon (work package) by ± cycles in a draft. */
  async shiftWorkPackage(ctx: RequestContext, versionId: string, workPackageId: string, input: { days: number | string }) {
    const data = parseInput(shiftSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const { version, plan } = await loadVersion(repo, ctx, versionId, "takt.manage");
      requireDraft(version);
      const wp = await repo.findWorkPackage(workPackageId);
      if (!wp || wp.projectId !== plan.projectId) throw new NotFoundError();
      const activityIds = new Set((await repo.listActivities(plan.id)).filter((a) => a.workPackageId === wp.id).map((a) => a.id));
      const rows = (await repo.listAssignments(version.id)).filter((r) => activityIds.has(r.activityId));
      if (rows.some((r) => r.startCycle + data.days < 0)) throw new ValidationError({ days: ["validation.beforePlanStart"] });
      for (const r of rows) await repo.updateAssignment(r.id, { startCycle: r.startCycle + data.days });
      await writeAudit(tx, ctx, { action: "takt_plan.work_package_shift", entityType: "takt_plan_version", entityId: version.id, projectId: plan.projectId, after: { workPackageId: wp.id, code: wp.code, days: data.days, assignments: rows.length } });
      return { moved: rows.length };
    });
  },
};

function endDelta(cal: WorkingCalendar, plan: Plan, a: Version, aAsg: { activityId: string; startCycle: number; durationCycles: number }[], b: Version, bAsg: typeof aAsg) {
  const last = (v: Version, rows: typeof aAsg) => [...spansFor(cal, plan, v, rows).values()].reduce((m, s) => (s.end > m ? s.end : m), new Date(0));
  return workingDaysBetween(cal, last(a, aAsg), last(b, bAsg));
}
