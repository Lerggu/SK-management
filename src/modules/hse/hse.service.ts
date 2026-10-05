import { v7 as uuidv7 } from "uuid";
import { readClient, runInTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { uploadMaxBytes } from "@/platform/config/env";
import { getStorage } from "@/platform/storage";
import { checkRateLimit, RATE_LIMITS } from "@/platform/ratelimit";
import { canAccessProject, projectIdsWithPermission, projectPermissions, type RequestContext } from "@/platform/authz";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { resolveContentType, sanitizeFileName, sha256Hex } from "@/modules/documents/versioning";
import { hseCan, hseProjectIds, requireHse, requireHseVisible, requireRecordVisible, type HseCan } from "./access";
import { HseRepo } from "./repo";
import { notifySeriousIncident } from "./notify";
import { ACTION_FLOW, INCIDENT_FLOW, OBSERVATION_FLOW, hseMetrics, isOverdue, requiresImmediateNotification, requiresInvestigation, type ActionStatus, type IncidentStatus, type ObservationStatus } from "./rules";
import {
  actionDoneSchema,
  actionSchema,
  closeSchema,
  incidentPersonSchema,
  incidentSchema,
  incidentTriageSchema,
  investigationSchema,
  observationSchema,
  observationTriageSchema,
  photoTargetSchema,
  type ActionInput,
  type CloseInput,
  type HseRecordType,
  type IncidentInput,
  type IncidentPersonInput,
  type IncidentTriageInput,
  type InvestigationInput,
  type ObservationInput,
  type ObservationTriageInput,
  type PhotoTargetInput,
} from "./schemas";

const IMAGE = /^image\/(png|jpeg|webp|heic)$/;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function projectOr404(repo: HseRepo, projectId: string) {
  const p = await repo.findProject(projectId);
  if (!p) throw new NotFoundError();
  return p;
}

/** Site and lift plan must belong to the same project (and site be active). */
async function validateRefs(repo: HseRepo, projectId: string, refs: { siteId?: string | null; liftPlanId?: string | null }) {
  if (refs.siteId) {
    const s = await repo.findSite(refs.siteId);
    if (!s || s.archivedAt || s.projectId !== projectId) throw new ValidationError({ siteId: ["validation.invalidOption"] });
  }
  if (refs.liftPlanId) {
    const l = await repo.findLiftPlan(refs.liftPlanId);
    if (!l || l.projectId !== projectId) throw new ValidationError({ liftPlanId: ["validation.invalidOption"] });
  }
}

async function userNames(repo: HseRepo, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const users = unique.length ? await repo.findUsers(unique) : [];
  return Object.fromEntries(users.map((u) => [u.id, u.name ?? u.email]));
}

/** Key figures without an authorization check — callers check first. */
async function computeMetrics(repo: HseRepo, projectId: string) {
  const [observations, incidents, actions, toolboxTalks, inspections, hours] = await Promise.all([
    repo.listObservations(projectId),
    repo.listIncidents(projectId),
    repo.listActions({ projectId }),
    repo.listToolboxTalks(projectId),
    repo.listInspections(projectId),
    repo.approvedHours(projectId),
  ]);
  return hseMetrics({
    hours,
    observations,
    incidents,
    actions: actions.map((a) => ({ status: a.status as ActionStatus, dueDate: iso(a.dueDate) })),
    toolboxTalks,
    inspections: inspections.map((i) => ({ ...i, inspectedOn: iso(i.inspectedOn)! })),
    today: todayInDisplayZone(),
  });
}

// ── overview ─────────────────────────────────────────────────────────
export const hseOverviewService = {
  /** Projects where the member can use HSE (register view or reporting). */
  async projects(ctx: RequestContext) {
    const repo = new HseRepo(readClient(), ctx.company.id);
    const rows = await repo.listProjects(hseProjectIds(ctx));
    return rows.map((p) => ({ ...p, can: hseCan(ctx, p.id) })).filter((p) => p.can.visible);
  },

  /** Project HSE register. Own-only members get their own reports and permits. */
  async register(ctx: RequestContext, projectId: string) {
    const repo = new HseRepo(readClient(), ctx.company.id);
    const project = await projectOr404(repo, projectId);
    const can = requireHseVisible(ctx, project.id);
    const own = can.ownOnly ? ctx.user.id : undefined;
    const [sites, liftPlans, observations, incidents, permits] = await Promise.all([
      repo.listSites(project.id),
      // Lift plans are internal: own-only reporters (subcontractors) do not see them.
      can.ownOnly ? Promise.resolve([]) : repo.listLiftPlans(project.id),
      repo.listObservations(project.id, own),
      repo.listIncidents(project.id, own),
      repo.listPermits(project.id, own),
    ]);
    const today = todayInDisplayZone();
    const base = {
      project,
      can,
      sites,
      liftPlans,
      observations,
      // Own-only reporters do not see investigation results.
      incidents: can.ownOnly ? incidents.map((i) => ({ ...i, rootCause: null, lostDays: null })) : incidents,
      permits,
    };
    if (can.ownOnly) return { ...base, actions: [], toolboxTalks: [], riskAssessments: [], inspections: [], members: [], metrics: null };
    const [actions, toolboxTalks, riskAssessments, inspections, members, hours] = await Promise.all([
      repo.listActions({ projectId: project.id }),
      repo.listToolboxTalks(project.id),
      repo.listRiskAssessments(project.id),
      repo.listInspections(project.id),
      can.manage ? repo.listMembers() : Promise.resolve([]),
      repo.approvedHours(project.id),
    ]);
    const metrics = hseMetrics({
      hours,
      observations,
      incidents,
      actions: actions.map((a) => ({ status: a.status as ActionStatus, dueDate: iso(a.dueDate) })),
      toolboxTalks,
      inspections: inspections.map((i) => ({ ...i, inspectedOn: iso(i.inspectedOn)! })),
      today,
    });
    return {
      ...base,
      actions: actions.map((a) => ({ ...a, overdue: isOverdue({ status: a.status as ActionStatus, dueDate: iso(a.dueDate) }, today) })),
      toolboxTalks,
      riskAssessments,
      inspections,
      members: members.map((m) => ({ userId: m.userId, name: m.user.name ?? m.user.email })),
      metrics,
    };
  },

  /** Key figures (hse.view). */
  async metrics(ctx: RequestContext, projectId: string) {
    const repo = new HseRepo(readClient(), ctx.company.id);
    const project = await projectOr404(repo, projectId);
    requireHse(ctx, project.id, "hse.view");
    return computeMetrics(repo, project.id);
  },

  /**
   * V7 client portal: aggregated key figures only — counts, rates and the
   * inspection index; no names, titles or descriptions. hse.view or portal.client.
   */
  async portalFigures(ctx: RequestContext, projectId: string) {
    const repo = new HseRepo(readClient(), ctx.company.id);
    const project = await projectOr404(repo, projectId);
    if (!canAccessProject(ctx, project.id)) throw new NotFoundError();
    const perms = projectPermissions(ctx, project.id);
    if (!perms.has("hse.view") && !perms.has("portal.client")) throw new NotFoundError();
    const m = await computeMetrics(repo, project.id);
    return {
      hours: m.hours,
      safetyObservations: m.safetyObservations,
      nearMisses: m.nearMisses,
      incidents: m.incidents,
      incidentsBySeverity: m.incidentsBySeverity,
      lostTimeInjuries: m.lostTimeInjuries,
      ltif: m.ltif,
      reportRate: m.reportRate,
      openActions: m.openActions,
      overdueActions: m.overdueActions,
      toolboxTalks: m.toolboxTalks,
      latestInspectionIndex: m.latestInspectionIndex,
      inspectionTrend: m.inspectionTrend,
    };
  },

  /** Open serious / lost-time incidents for hse.serious.notify holders (in-app alert). */
  async urgent(ctx: RequestContext) {
    const ids = projectIdsWithPermission(ctx, "hse.serious.notify");
    if (ids && ids.length === 0) return [];
    const rows = await new HseRepo(readClient(), ctx.company.id).listUrgentIncidents(ids);
    return rows
      .filter((r) => hseCan(ctx, r.projectId).notify)
      .map((r) => ({ id: r.id, number: r.number, title: r.title, severity: r.severity, status: r.status, occurredAt: r.occurredAt, project: r.project }));
  },
};

// ── observations ─────────────────────────────────────────────────────
function observationCan(ctx: RequestContext, can: HseCan, o: { status: string; createdById: string | null }) {
  return {
    triage: can.manage && o.status === "OPEN",
    close: can.manage && o.status !== "CLOSED",
    addAction: can.manage && o.status !== "CLOSED",
    addPhoto: o.status !== "CLOSED" && (can.manage || o.createdById === ctx.user.id),
  };
}

export const hseObservationService = {
  async create(ctx: RequestContext, input: ObservationInput) {
    const data = parseInput(observationSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, data.projectId);
      requireHse(ctx, project.id, "hse.create");
      if (project.archivedAt) throw new ValidationError({ projectId: ["validation.invalidOption"] });
      await validateRefs(repo, project.id, data);
      await repo.lockProject(project.id);
      const o = await repo.createObservation({
        ...data,
        number: await repo.nextObservationNumber(project.id),
        reportedByExternal: ctx.external,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: "hse_observation.create", entityType: "hse_observation", entityId: o.id, projectId: project.id, after: o });
      return o;
    });
  },

  async get(ctx: RequestContext, observationId: string) {
    const repo = new HseRepo(readClient(), ctx.company.id);
    const o = await repo.findObservation(observationId);
    if (!o) throw new NotFoundError();
    const can = requireRecordVisible(ctx, o);
    const [photos, actions] = await Promise.all([repo.listPhotos("OBSERVATION", o.id), can.view ? repo.listActions({ projectId: o.projectId, sourceType: "OBSERVATION", sourceId: o.id }) : Promise.resolve([])]);
    const users = await userNames(repo, [o.createdById, o.triagedById, o.closedById]);
    return { ...o, photos: photos.map((p) => ({ ...p, sizeBytes: Number(p.sizeBytes) })), actions, users, can: observationCan(ctx, can, o), ownOnly: can.ownOnly };
  },

  async triage(ctx: RequestContext, observationId: string, input: ObservationTriageInput) {
    const data = parseInput(observationTriageSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const o = await repo.findObservation(observationId);
      if (!o) throw new NotFoundError();
      requireRecordVisible(ctx, o);
      requireHse(ctx, o.projectId, "hse.manage");
      if (!OBSERVATION_FLOW[o.status as ObservationStatus].includes("TRIAGED")) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      const after = await repo.updateObservation(o.id, { ...data, status: "TRIAGED", triagedAt: new Date(), triagedById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "hse_observation.triage", entityType: "hse_observation", entityId: o.id, projectId: o.projectId, before: o, after, diff: true });
      return after;
    });
  },

  /** Closing requires that no corrective action of the observation is still OPEN. */
  async close(ctx: RequestContext, observationId: string, input: CloseInput) {
    const data = parseInput(closeSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const o = await repo.findObservation(observationId);
      if (!o) throw new NotFoundError();
      requireRecordVisible(ctx, o);
      requireHse(ctx, o.projectId, "hse.manage");
      if (!OBSERVATION_FLOW[o.status as ObservationStatus].includes("CLOSED")) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      const actions = await repo.listActions({ projectId: o.projectId, sourceType: "OBSERVATION", sourceId: o.id });
      if (actions.some((a) => a.status === "OPEN")) throw new ValidationError({ _form: ["validation.hseActionsOpen"] });
      const after = await repo.updateObservation(o.id, { status: "CLOSED", closedAt: new Date(), closedById: ctx.user.id, closeNote: data.note, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "hse_observation.close", entityType: "hse_observation", entityId: o.id, projectId: o.projectId, before: { status: o.status }, after: { status: after.status, note: data.note } });
      return after;
    });
  },
};

// ── incidents ────────────────────────────────────────────────────────
type IncidentRow = NonNullable<Awaited<ReturnType<HseRepo["findIncident"]>>>;

function incidentCan(ctx: RequestContext, can: HseCan, i: IncidentRow, actions: { status: string }[]) {
  const investigation = requiresInvestigation(i.severity);
  const actionsApproved = actions.every((a) => a.status === "VERIFIED");
  return {
    triage: can.manage && i.status === "REPORTED",
    startInvestigation: can.investigate && i.status === "TRIAGED",
    recordInvestigation: can.investigate && i.status === "INVESTIGATING",
    close:
      actionsApproved &&
      (investigation
        ? can.investigate && i.status === "INVESTIGATING" && !!i.rootCause
        : (can.manage || can.investigate) && (i.status === "TRIAGED" || i.status === "INVESTIGATING")),
    actionsPending: !actionsApproved,
    addAction: can.manage && i.status !== "CLOSED" && i.status !== "REPORTED",
    addPerson: can.personal && i.status !== "CLOSED",
    addPhoto: i.status !== "CLOSED" && (can.manage || i.createdById === ctx.user.id),
    requiresInvestigation: investigation,
  };
}

async function loadIncident(repo: HseRepo, ctx: RequestContext, incidentId: string) {
  const i = await repo.findIncident(incidentId);
  if (!i) throw new NotFoundError();
  const can = requireRecordVisible(ctx, i);
  return { i, can };
}

export const incidentService = {
  /** Anyone with hse.create reports; serious / lost-time reports notify immediately. */
  async report(ctx: RequestContext, input: IncidentInput) {
    const data = parseInput(incidentSchema, input);
    const { incident, project } = await runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, data.projectId);
      requireHse(ctx, project.id, "hse.create");
      if (project.archivedAt) throw new ValidationError({ projectId: ["validation.invalidOption"] });
      await validateRefs(repo, project.id, data);
      await repo.lockProject(project.id);
      const incident = await repo.createIncident({
        ...data,
        number: await repo.nextIncidentNumber(project.id),
        reportedByExternal: ctx.external,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: "incident.report", entityType: "incident", entityId: incident.id, projectId: project.id, after: incident });
      return { incident, project };
    });
    if (requiresImmediateNotification(incident.severity)) await notifySeriousIncident(ctx, incident, project);
    return incident;
  },

  async get(ctx: RequestContext, incidentId: string) {
    const repo = new HseRepo(readClient(), ctx.company.id);
    const { i, can } = await loadIncident(repo, ctx, incidentId);
    const [photos, actions, persons] = await Promise.all([
      repo.listPhotos("INCIDENT", i.id),
      can.view ? repo.listActions({ projectId: i.projectId, sourceType: "INCIDENT", sourceId: i.id }) : Promise.resolve([]),
      can.personal ? repo.listPersons(i.id) : Promise.resolve(null),
    ]);
    const users = await userNames(repo, [i.createdById, i.triagedById, i.investigatorId, i.closedById]);
    const base = can.ownOnly ? { ...i, rootCause: null, lostDays: null } : i;
    return { ...base, photos: photos.map((p) => ({ ...p, sizeBytes: Number(p.sizeBytes) })), actions, persons, users, can: incidentCan(ctx, can, i, actions), ownOnly: can.ownOnly };
  },

  /** Site Manager triage (hse.manage): type, severity, immediate actions. */
  async triage(ctx: RequestContext, incidentId: string, input: IncidentTriageInput) {
    const data = parseInput(incidentTriageSchema, input);
    const { after, project, notify } = await runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { i } = await loadIncident(repo, ctx, incidentId);
      requireHse(ctx, i.projectId, "hse.manage");
      if (!INCIDENT_FLOW[i.status as IncidentStatus].includes("TRIAGED")) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      const after = await repo.updateIncident(i.id, { ...data, status: "TRIAGED", triagedAt: new Date(), triagedById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "incident.triage", entityType: "incident", entityId: i.id, projectId: i.projectId, before: i, after, diff: true });
      const project = (await repo.findProject(i.projectId))!;
      return { after, project, notify: !i.notifiedAt && requiresImmediateNotification(after.severity) };
    });
    if (notify) await notifySeriousIncident(ctx, after, project);
    return after;
  },

  async startInvestigation(ctx: RequestContext, incidentId: string) {
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { i } = await loadIncident(repo, ctx, incidentId);
      requireHse(ctx, i.projectId, "hse.investigate");
      if (!INCIDENT_FLOW[i.status as IncidentStatus].includes("INVESTIGATING")) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      const after = await repo.updateIncident(i.id, { status: "INVESTIGATING", investigationStartedAt: new Date(), investigatorId: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "incident.investigation_start", entityType: "incident", entityId: i.id, projectId: i.projectId, before: { status: i.status }, after: { status: after.status } });
      return after;
    });
  },

  async recordInvestigation(ctx: RequestContext, incidentId: string, input: InvestigationInput) {
    const data = parseInput(investigationSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { i } = await loadIncident(repo, ctx, incidentId);
      requireHse(ctx, i.projectId, "hse.investigate");
      if (i.status !== "INVESTIGATING") throw new ValidationError({ _form: ["validation.invalidTransition"] });
      const after = await repo.updateIncident(i.id, { rootCause: data.rootCause, lostDays: data.lostDays, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "incident.investigation_update", entityType: "incident", entityId: i.id, projectId: i.projectId, before: i, after, diff: true });
      return after;
    });
  },

  /**
   * Lost-time and serious incidents: closed by hse.investigate after the
   * investigation; others by hse.manage. Every corrective action must be
   * approved (VERIFIED) first — also enforced by a DB trigger.
   */
  async close(ctx: RequestContext, incidentId: string, input: CloseInput) {
    const data = parseInput(closeSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { i } = await loadIncident(repo, ctx, incidentId);
      if (!INCIDENT_FLOW[i.status as IncidentStatus].includes("CLOSED")) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      if (requiresInvestigation(i.severity)) {
        requireHse(ctx, i.projectId, "hse.investigate");
        if (i.status !== "INVESTIGATING" || !i.rootCause) throw new ValidationError({ _form: ["validation.incidentInvestigationRequired"] });
      } else {
        const can = requireHseVisible(ctx, i.projectId);
        if (!can.manage && !can.investigate) throw new ForbiddenError("Missing permission hse.manage");
      }
      const actions = await repo.listActions({ projectId: i.projectId, sourceType: "INCIDENT", sourceId: i.id });
      if (actions.some((a) => a.status !== "VERIFIED")) throw new ValidationError({ _form: ["validation.incidentActionsUnapproved"] });
      const after = await repo.updateIncident(i.id, { status: "CLOSED", closedAt: new Date(), closedById: ctx.user.id, closeNote: data.note, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "incident.close", entityType: "incident", entityId: i.id, projectId: i.projectId, before: { status: i.status }, after: { status: after.status, note: data.note } });
      return after;
    });
  },

  /** Injured-person details: hse.personal.view only (masked in audit). */
  async addPerson(ctx: RequestContext, incidentId: string, input: IncidentPersonInput) {
    const data = parseInput(incidentPersonSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { i } = await loadIncident(repo, ctx, incidentId);
      requireHse(ctx, i.projectId, "hse.personal.view");
      if (ctx.external) throw new ForbiddenError();
      if (i.status === "CLOSED") throw new ValidationError({ _form: ["validation.invalidTransition"] });
      if (data.employeeId && !(await repo.findEmployee(data.employeeId))) throw new ValidationError({ employeeId: ["validation.invalidOption"] });
      const p = await repo.createPerson({ ...data, incidentId: i.id, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "incident_person.create", entityType: "incident_person", entityId: p.id, projectId: i.projectId, after: p });
      return p;
    });
  },
};

// ── corrective actions ───────────────────────────────────────────────
async function loadSource(repo: HseRepo, type: HseRecordType, id: string) {
  switch (type) {
    case "OBSERVATION":
      return repo.findObservation(id);
    case "INCIDENT":
      return repo.findIncident(id);
    case "INSPECTION":
      return repo.findInspection(id);
    case "RISK_ASSESSMENT":
      return repo.findRiskAssessment(id);
  }
}

async function loadAction(repo: HseRepo, ctx: RequestContext, actionId: string) {
  const a = await repo.findAction(actionId);
  if (!a) throw new NotFoundError();
  const can = requireHseVisible(ctx, a.projectId);
  if (!can.view) throw new NotFoundError();
  return { a, can };
}

/** Incident actions are approved by hse.action.approve (PM); others by hse.manage. */
function verifierPermission(sourceType: string) {
  return sourceType === "INCIDENT" ? ("hse.action.approve" as const) : ("hse.manage" as const);
}

export const hseActionService = {
  async create(ctx: RequestContext, input: ActionInput) {
    const data = parseInput(actionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const source = await loadSource(repo, data.sourceType, data.sourceId);
      if (!source) throw new ValidationError({ sourceId: ["validation.invalidOption"] });
      requireHse(ctx, source.projectId, "hse.manage");
      if ("status" in source && (source.status === "CLOSED" || source.status === "ARCHIVED")) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      if (data.assigneeId && !(await repo.findMember(data.assigneeId))) throw new ValidationError({ assigneeId: ["validation.invalidOption"] });
      const a = await repo.createAction({ ...data, projectId: source.projectId, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "hse_action.create", entityType: "hse_action", entityId: a.id, projectId: a.projectId, after: a });
      return a;
    });
  },

  /** The assignee or an hse.manage holder marks an action done. */
  async markDone(ctx: RequestContext, actionId: string, input: { note?: string | null }) {
    const data = parseInput(actionDoneSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { a, can } = await loadAction(repo, ctx, actionId);
      if (!can.manage && a.assigneeId !== ctx.user.id) throw new ForbiddenError("Only the assignee or HSE management");
      if (!ACTION_FLOW[a.status as ActionStatus].includes("DONE")) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      const after = await repo.updateAction(a.id, { status: "DONE", doneAt: new Date(), doneById: ctx.user.id, doneNote: data.note, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "hse_action.done", entityType: "hse_action", entityId: a.id, projectId: a.projectId, before: { status: a.status }, after: { status: after.status, note: data.note } });
      return after;
    });
  },

  async reopen(ctx: RequestContext, actionId: string, input: { note?: string | null }) {
    const data = parseInput(actionDoneSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { a } = await loadAction(repo, ctx, actionId);
      requireHse(ctx, a.projectId, verifierPermission(a.sourceType));
      if (!ACTION_FLOW[a.status as ActionStatus].includes("OPEN")) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      const after = await repo.updateAction(a.id, { status: "OPEN", doneAt: null, doneById: null, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "hse_action.reopen", entityType: "hse_action", entityId: a.id, projectId: a.projectId, before: { status: a.status }, after: { status: after.status, note: data.note } });
      return after;
    });
  },

  async verify(ctx: RequestContext, actionId: string) {
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { a } = await loadAction(repo, ctx, actionId);
      requireHse(ctx, a.projectId, verifierPermission(a.sourceType));
      if (!ACTION_FLOW[a.status as ActionStatus].includes("VERIFIED")) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      const after = await repo.updateAction(a.id, { status: "VERIFIED", verifiedAt: new Date(), verifiedById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "hse_action.verify", entityType: "hse_action", entityId: a.id, projectId: a.projectId, before: { status: a.status }, after: { status: after.status } });
      return after;
    });
  },
};

// ── photos ───────────────────────────────────────────────────────────
async function loadPhotoTarget(repo: HseRepo, ctx: RequestContext, type: HseRecordType, id: string) {
  const record = await loadSource(repo, type, id);
  if (!record) throw new NotFoundError();
  const can = type === "OBSERVATION" || type === "INCIDENT" ? requireRecordVisible(ctx, record) : requireHseVisible(ctx, record.projectId);
  if (!can.view && type !== "OBSERVATION" && type !== "INCIDENT") throw new NotFoundError();
  return { record, can };
}

export const hsePhotoService = {
  /** Photos from the phone camera. Reporter (own open record) or hse.manage. */
  async add(ctx: RequestContext, input: PhotoTargetInput, file: { fileName: string; bytes: Uint8Array }) {
    const target = parseInput(photoTargetSchema, input);
    const repo = new HseRepo(readClient(), ctx.company.id);
    const { record, can } = await loadPhotoTarget(repo, ctx, target.recordType, target.recordId);
    const status = "status" in record ? record.status : null;
    const own = "createdById" in record && record.createdById === ctx.user.id;
    if (status === "CLOSED") throw new ValidationError({ _form: ["validation.invalidTransition"] });
    if (!can.manage && !(own && (target.recordType === "OBSERVATION" || target.recordType === "INCIDENT"))) throw new ForbiddenError("Cannot add photos");
    checkRateLimit(RATE_LIMITS.upload, ctx.user.id);
    const fileName = sanitizeFileName(file.fileName);
    const contentType = resolveContentType(fileName);
    if (!contentType || !IMAGE.test(contentType)) throw new ValidationError({ file: ["validation.imageOnly"] });
    if (file.bytes.byteLength === 0) throw new ValidationError({ file: ["validation.fileEmpty"] });
    if (file.bytes.byteLength > uploadMaxBytes()) throw new ValidationError({ file: ["validation.fileTooLarge"] });
    const id = uuidv7();
    const storageKey = `companies/${ctx.company.id}/hse/${target.recordType.toLowerCase()}/${record.id}/${id}`;
    await getStorage().put(storageKey, file.bytes, contentType);
    return runInTransaction(async (tx) => {
      const p = await new HseRepo(tx, ctx.company.id).createPhoto({
        id,
        projectId: record.projectId,
        recordType: target.recordType,
        recordId: record.id,
        fileName,
        contentType,
        sizeBytes: BigInt(file.bytes.byteLength),
        sha256: sha256Hex(file.bytes),
        storageKey,
        createdById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: "hse_photo.add", entityType: "hse_photo", entityId: p.id, projectId: record.projectId, after: { recordType: target.recordType, recordId: record.id, fileName, sha256: p.sha256 } });
      return { ...p, sizeBytes: Number(p.sizeBytes) };
    });
  },

  async download(ctx: RequestContext, photoId: string) {
    const repo = new HseRepo(readClient(), ctx.company.id);
    const p = await repo.findPhoto(photoId);
    if (!p) throw new NotFoundError();
    await loadPhotoTarget(repo, ctx, p.recordType, p.recordId);
    const object = await getStorage().get(p.storageKey);
    if (!object) throw new NotFoundError("File missing from storage");
    return { fileName: p.fileName, contentType: p.contentType, body: object.body };
  },
};

