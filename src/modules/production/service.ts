import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { toLocalDateTimeInput } from "@/platform/i18n/time";
import { hasPermission, projectPermissions, type RequestContext } from "@/platform/authz";
import { requireLogistics } from "@/modules/logistics/access";
import { bookingService } from "@/modules/logistics/booking.service";
import { isCurrentlyValid, isoDate, latestPublishedByArea } from "@/modules/hr/rules";
import { ProductionRepo } from "./repo";
import { applicableRoles, equipmentFit, isBlocking, personFit, rankCandidates, readiness, SUGGESTED_TASK_TYPES, type FitIssue, type RoleLike } from "./rules";
import { assignSchema, setTaskTypeSchema, taskRoleSchema, taskTypeSchema, type AssignInput, type TaskRoleInput, type TaskTypeInput } from "./schemas";

/** Task types are a company catalogue maintained by logistics approvers. */
function requireTypeAdmin(ctx: RequestContext) {
  if (ctx.external) throw new ForbiddenError("External members cannot manage task types");
  const any = hasPermission(ctx, "logistics.approve") || [...ctx.projectGrants.values()].some((g) => g.has("logistics.approve"));
  if (!any) throw new ForbiddenError("Missing permission logistics.approve");
}

function requireTypeReader(ctx: RequestContext) {
  if (ctx.external) throw new ForbiddenError("External members have no logistics access");
  const any = hasPermission(ctx, "logistics.view") || [...ctx.projectGrants.values()].some((g) => g.has("logistics.view"));
  if (!any) throw new ForbiddenError("Missing permission logistics.view");
}

const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));
const roleView = <R extends { minWeightKg: { toString(): string } | null; maxWeightKg: { toString(): string } | null }>(r: R) => ({ ...r, minWeightKg: num(r.minWeightKg), maxWeightKg: num(r.maxWeightKg) });

async function validRoleRefs(repo: ProductionRepo, d: ReturnType<typeof taskRoleSchema.parse>) {
  if (d.qualificationTypeId && !(await repo.findQualificationType(d.qualificationTypeId))) throw new ValidationError({ qualificationTypeId: ["validation.invalidOption"] });
  if (d.areaId && !(await repo.findArea(d.areaId))) throw new ValidationError({ areaId: ["validation.invalidOption"] });
  if (d.equipmentTypeId && !(await repo.findEquipmentType(d.equipmentTypeId))) throw new ValidationError({ equipmentTypeId: ["validation.invalidOption"] });
}

function conflictOnName<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (isUniqueViolation(e)) throw new ConflictError("Already exists", "name");
    throw e;
  });
}

export const taskTypeService = {
  async list(ctx: RequestContext, input: { includeArchived?: boolean } = {}) {
    requireTypeReader(ctx);
    const rows = await new ProductionRepo(readClient(), ctx.company.id).listTypes(Boolean(input.includeArchived));
    return rows.map((t) => ({ ...t, roles: t.roles.map(roleView) }));
  },

  /** Catalogues for the role form (cards, competence areas, equipment types). */
  async options(ctx: RequestContext) {
    requireTypeAdmin(ctx);
    const [qualificationTypes, areas, equipmentTypes] = await new ProductionRepo(readClient(), ctx.company.id).catalogues();
    return { qualificationTypes, areas, equipmentTypes };
  },

  async create(ctx: RequestContext, input: TaskTypeInput) {
    requireTypeAdmin(ctx);
    const data = parseInput(taskTypeSchema, input);
    return conflictOnName(
      runInTransaction(async (tx) => {
        const t = await new ProductionRepo(tx, ctx.company.id).createType({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "logistics_task_type.create", entityType: "logistics_task_type", entityId: t.id, after: t });
        return t;
      }),
    );
  },

  async update(ctx: RequestContext, typeId: string, input: TaskTypeInput) {
    requireTypeAdmin(ctx);
    const data = parseInput(taskTypeSchema, input);
    return conflictOnName(
      runInTransaction(async (tx) => {
        const repo = new ProductionRepo(tx, ctx.company.id);
        const before = await repo.findType(typeId);
        if (!before) throw new NotFoundError();
        const after = await repo.updateType(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "logistics_task_type.update", entityType: "logistics_task_type", entityId: after.id, before: { name: before.name, serviceType: before.serviceType, description: before.description, color: before.color }, after, diff: true });
        return after;
      }),
    );
  },

  async archive(ctx: RequestContext, typeId: string) {
    requireTypeAdmin(ctx);
    return runInTransaction(async (tx) => {
      const repo = new ProductionRepo(tx, ctx.company.id);
      const before = await repo.findType(typeId);
      if (!before) throw new NotFoundError();
      if (before.archivedAt) return before;
      const after = await repo.updateType(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "logistics_task_type.archive", entityType: "logistics_task_type", entityId: after.id });
      return after;
    });
  },

  async addRole(ctx: RequestContext, typeId: string, input: TaskRoleInput) {
    requireTypeAdmin(ctx);
    const data = parseInput(taskRoleSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new ProductionRepo(tx, ctx.company.id);
      const type = await repo.findType(typeId);
      if (!type || type.archivedAt) throw new NotFoundError();
      await validRoleRefs(repo, data);
      const person = data.kind === "PERSON";
      const role = await repo.createRole({
        taskTypeId: type.id,
        kind: data.kind,
        label: data.label,
        quantity: data.quantity,
        qualificationTypeId: person ? data.qualificationTypeId : null,
        areaId: person ? data.areaId : null,
        minLevel: person && data.areaId ? data.minLevel : null,
        trade: person ? data.trade : null,
        equipmentTypeId: person ? null : data.equipmentTypeId,
        minWeightKg: data.minWeightKg,
        maxWeightKg: data.maxWeightKg,
        sortOrder: (type.roles.length + 1) * 10,
        createdById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: "logistics_task_role.create", entityType: "logistics_task_role", entityId: role.id, after: role, metadata: { taskTypeId: type.id } });
      return roleView(role);
    });
  },

  async removeRole(ctx: RequestContext, roleId: string) {
    requireTypeAdmin(ctx);
    return runInTransaction(async (tx) => {
      const repo = new ProductionRepo(tx, ctx.company.id);
      const before = await repo.findRole(roleId);
      if (!before) throw new NotFoundError();
      if (before.archivedAt) return roleView(before);
      const after = await repo.updateRole(before.id, { archivedAt: new Date() });
      await writeAudit(tx, ctx, { action: "logistics_task_role.archive", entityType: "logistics_task_role", entityId: after.id, metadata: { taskTypeId: before.taskTypeId } });
      return roleView(after);
    });
  },

  /** Adds the suggested task types that do not exist yet, linking HR catalogue entries by name. */
  async addSuggested(ctx: RequestContext) {
    requireTypeAdmin(ctx);
    return runInTransaction(async (tx) => {
      const repo = new ProductionRepo(tx, ctx.company.id);
      const existing = new Set((await repo.listTypes(true)).map((t) => t.name));
      const [quals, areas] = await repo.catalogues();
      let added = 0;
      for (const [i, s] of SUGGESTED_TASK_TYPES.entries()) {
        if (existing.has(s.name)) continue;
        const type = await repo.createType({ name: s.name, serviceType: s.serviceType, color: s.color, sortOrder: (i + 1) * 10, createdById: ctx.user.id, updatedById: ctx.user.id });
        for (const [j, r] of s.roles.entries()) {
          const areaId = r.area ? (areas.find((a) => a.name === r.area)?.id ?? null) : null;
          await repo.createRole({
            taskTypeId: type.id,
            kind: r.kind,
            label: r.label,
            quantity: r.quantity,
            qualificationTypeId: r.qualification ? (quals.find((q) => q.name === r.qualification)?.id ?? null) : null,
            areaId,
            minLevel: areaId ? (r.minLevel ?? null) : null,
            minWeightKg: r.minWeightKg ?? null,
            sortOrder: (j + 1) * 10,
            createdById: ctx.user.id,
          });
        }
        added += 1;
      }
      await writeAudit(tx, ctx, { action: "logistics_task_type.add_suggested", entityType: "logistics_task_type", metadata: { added } });
      return { added };
    });
  },
};

// ── staffing ─────────────────────────────────────────────────────────
type Candidate = { value: string; label: string; detail: string | null; issues: FitIssue[]; blocking: boolean };

async function loadTask(ctx: RequestContext, requestId: string, repo = new ProductionRepo(readClient(), ctx.company.id)) {
  const r = await repo.findRequest(requestId);
  if (!r) throw new NotFoundError();
  requireLogistics(ctx, r.projectId, "logistics.view");
  return { r, repo };
}

/** Facts for fit checks of the company's own people and equipment. */
async function resourceFacts(repo: ProductionRepo, from: Date, to: Date, requestId: string) {
  const [employees, equipment, overlaps] = await Promise.all([repo.employees(), repo.equipment(), repo.overlapping(from, to)]);
  const ids = employees.map((e) => e.id);
  const [quals, assessments] = await Promise.all([repo.qualifications(ids), repo.publishedAssessments(ids)]);
  const today = todayInDisplayZone();
  const validTypes = new Map<string, Set<string>>();
  for (const q of quals) {
    if (!q.typeId || !isCurrentlyValid(q.expiresOn ? isoDate(q.expiresOn) : null, q.noExpiry, today)) continue;
    if (!validTypes.has(q.employeeId)) validTypes.set(q.employeeId, new Set());
    validTypes.get(q.employeeId)!.add(q.typeId);
  }
  const levels = new Map<string, Map<string, number | null>>();
  for (const e of employees) {
    const latest = latestPublishedByArea(
      assessments.filter((a) => a.employeeId === e.id),
      "SUPERVISOR",
    );
    levels.set(e.id, new Map([...latest].map(([k, v]) => [k, v.level])));
  }
  // Bookings for other tasks or other work in the same period make a resource busy.
  const busyEmployees = new Set(overlaps.filter((b) => b.employeeId && b.logisticsRequestId !== requestId).map((b) => b.employeeId!));
  const busyEquipment = new Set(overlaps.filter((b) => b.equipmentId && b.logisticsRequestId !== requestId).map((b) => b.equipmentId!));
  return { employees, equipment, validTypes, levels, busyEmployees, busyEquipment };
}

function candidatesFor(role: RoleLike, facts: Awaited<ReturnType<typeof resourceFacts>>, periodEnd: Date, assigned: Set<string>): Candidate[] {
  const list: Candidate[] =
    role.kind === "PERSON"
      ? facts.employees
          .filter((e) => !assigned.has(`EMPLOYEE:${e.id}`))
          .map((e) => {
            const issues = personFit(role, { active: e.status === "ACTIVE", trade: e.trade, validQualificationTypes: facts.validTypes.get(e.id) ?? new Set(), levels: facts.levels.get(e.id) ?? new Map() });
            if (facts.busyEmployees.has(e.id)) issues.push("BUSY");
            return { value: `EMPLOYEE:${e.id}`, label: `${e.lastName} ${e.firstName}`, detail: e.trade, issues, blocking: isBlocking(issues) };
          })
      : facts.equipment
          .filter((q) => q.equipmentTypeId === role.equipmentTypeId && !assigned.has(`EQUIPMENT:${q.id}`))
          .map((q) => {
            const issues = equipmentFit(role, q, periodEnd);
            if (facts.busyEquipment.has(q.id)) issues.push("BUSY");
            return { value: `EQUIPMENT:${q.id}`, label: `${q.assetNumber} ${q.name}`, detail: null, issues, blocking: isBlocking(issues) };
          });
  return rankCandidates(list);
}

export const staffingService = {
  /**
   * The task's resource needs (from its task type and heaviest load), who is
   * assigned, what is missing, and ranked candidates with the reasons a
   * candidate does not fit. Candidates are shown to members who can book.
   */
  async get(ctx: RequestContext, requestId: string) {
    const { r, repo } = await loadTask(ctx, requestId);
    const canBook = projectPermissions(ctx, r.projectId).has("booking.manage");
    const type = r.taskTypeId ? await repo.findType(r.taskTypeId) : null;
    const bookings = await repo.taskBookings(r.id);
    const weight = num(r.weightKg);
    const { roles, weightUnknown } = applicableRoles((type?.roles ?? []).map(roleView), weight);
    const facts = canBook && roles.length ? await resourceFacts(repo, r.requestedStart, r.requestedEnd, r.id) : null;
    const assignedRefs = new Set(bookings.map((b) => (b.employeeId ? `EMPLOYEE:${b.employeeId}` : `EQUIPMENT:${b.equipmentId}`)));
    const needs = roles.map((role) => {
      const assigned = bookings
        .filter((b) => b.taskRoleId === role.id)
        .map((b) => ({ bookingId: b.id, status: b.status, label: b.employee ? `${b.employee.lastName} ${b.employee.firstName}` : `${b.equipment!.assetNumber} ${b.equipment!.name}` }));
      return {
        role,
        assigned,
        missing: Math.max(0, role.quantity - assigned.length),
        candidates: facts && assigned.length < role.quantity ? candidatesFor(role, facts, r.requestedEnd, assignedRefs).slice(0, 25) : [],
      };
    });
    return {
      request: { id: r.id, title: r.title, projectId: r.projectId, siteId: r.siteId, requestedStart: r.requestedStart, requestedEnd: r.requestedEnd, weightKg: weight, status: r.status },
      taskType: type ? { id: type.id, name: type.name, color: type.color } : null,
      weightUnknown,
      needs,
      readiness: readiness(Boolean(type), needs.map((n) => ({ quantity: n.role.quantity, assigned: n.assigned.length }))),
      canBook,
      canEdit: canBook || projectPermissions(ctx, r.projectId).has("logistics.approve"),
    };
  },

  /** Sets or changes the task type (requester's approvers or bookers). */
  async setTaskType(ctx: RequestContext, requestId: string, input: { taskTypeId?: string | null }) {
    const data = parseInput(setTaskTypeSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new ProductionRepo(tx, ctx.company.id);
      const { r } = await loadTask(ctx, requestId, repo);
      const perms = projectPermissions(ctx, r.projectId);
      if (!perms.has("booking.manage") && !perms.has("logistics.approve")) throw new ForbiddenError("Cannot change the task type");
      if (r.status === "COMPLETE" || r.status === "CANCELLED") throw new ValidationError({ _form: ["validation.invalidTransition"] });
      if (data.taskTypeId) {
        const t = await repo.findType(data.taskTypeId);
        if (!t || t.archivedAt) throw new ValidationError({ taskTypeId: ["validation.invalidOption"] });
      }
      const after = await repo.updateRequest(r.id, { taskTypeId: data.taskTypeId, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "logistics_request.task_type", entityType: "logistics_request", entityId: r.id, projectId: r.projectId, before: { taskTypeId: r.taskTypeId }, after: { taskTypeId: after.taskTypeId } });
      return { id: after.id, taskTypeId: after.taskTypeId };
    });
  },

  /**
   * Books a resource for one need of the task for the task's time. A person
   * without a required valid card, or equipment of the wrong type or out of
   * service, is refused; other conflicts follow the booking rules (V4).
   */
  async assign(ctx: RequestContext, requestId: string, input: AssignInput) {
    const data = parseInput(assignSchema, input);
    const { r, repo } = await loadTask(ctx, requestId);
    requireLogistics(ctx, r.projectId, "booking.manage");
    if (r.status === "COMPLETE" || r.status === "CANCELLED") throw new ValidationError({ _form: ["validation.invalidTransition"] });
    const type = r.taskTypeId ? await repo.findType(r.taskTypeId) : null;
    const role = type?.roles.find((x) => x.id === data.roleId);
    if (!type || !role) throw new ValidationError({ roleId: ["validation.invalidOption"] });
    const [kind, id] = data.resource.split(":") as ["EMPLOYEE" | "EQUIPMENT", string];
    if ((kind === "EMPLOYEE") !== (role.kind === "PERSON")) throw new ValidationError({ resource: ["validation.invalidOption"] });
    // A need is staffed once: no booking beyond its quantity, and a resource only once per task.
    const taskBookings = await repo.taskBookings(r.id);
    if (taskBookings.some((b) => (b.employeeId ? `EMPLOYEE:${b.employeeId}` : `EQUIPMENT:${b.equipmentId}`) === data.resource)) {
      throw new ValidationError({ resource: ["validation.fit.ALREADY_ASSIGNED"] });
    }
    if (taskBookings.filter((b) => b.taskRoleId === role.id).length >= role.quantity) throw new ValidationError({ roleId: ["validation.fit.FULL"] });
    const facts = await resourceFacts(repo, r.requestedStart, r.requestedEnd, r.id);
    const view = roleView(role);
    let issues: FitIssue[];
    if (kind === "EMPLOYEE") {
      const e = facts.employees.find((x) => x.id === id);
      if (!e) throw new ValidationError({ resource: ["validation.invalidOption"] });
      issues = personFit(view, { active: true, trade: e.trade, validQualificationTypes: facts.validTypes.get(e.id) ?? new Set(), levels: facts.levels.get(e.id) ?? new Map() });
    } else {
      const q = facts.equipment.find((x) => x.id === id);
      if (!q) throw new ValidationError({ resource: ["validation.invalidOption"] });
      issues = equipmentFit(view, q, r.requestedEnd);
    }
    if (isBlocking(issues)) throw new ValidationError({ resource: [`validation.fit.${issues.find((i) => isBlocking([i]))}`] });
    const [created] = await bookingService.create(ctx, {
      projectId: r.projectId,
      siteId: r.siteId,
      activityId: r.activityId,
      logisticsRequestId: r.id,
      taskRoleId: role.id,
      startsAt: toLocalDateTimeInput(r.requestedStart),
      endsAt: toLocalDateTimeInput(r.requestedEnd),
      note: `${type.name}: ${role.label}`,
      resources: [data.resource],
    });
    return { ...created, warnings: issues };
  },
};
