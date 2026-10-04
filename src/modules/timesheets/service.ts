import { randomUUID } from "node:crypto";
import { readClient, runInTransaction, type Tx } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { canAccessProject, projectIdsWithPermission, projectPermissions, requirePermission, type PermissionKey, type RequestContext } from "@/platform/authz";
import { TimesheetRepo, type TimeEntryRow } from "./repo";
import { CORRECTABLE_STATUSES, SUBMITTABLE_STATUSES, isEditable, weekRange } from "./rules";
import {
  approvalQuerySchema,
  correctionSchema,
  crewEntrySchema,
  decisionSchema,
  exportSchema,
  submitWeekSchema,
  timeEntrySchema,
  weekQuerySchema,
  type CrewEntryInput,
  type TimeEntryInput,
} from "./schemas";

const has = (ctx: RequestContext, projectId: string, p: PermissionKey) => projectPermissions(ctx, projectId).has(p);

/** Fields copied into audit events for time entries. */
function auditView(e: { employeeId: string; projectId: string; siteId: string | null; workDate: Date; hours: unknown; workClass: string; status: string; correctionOfId?: string | null; note?: string | null }) {
  return {
    employeeId: e.employeeId,
    projectId: e.projectId,
    siteId: e.siteId,
    workDate: e.workDate,
    hours: e.hours,
    workClass: e.workClass,
    status: e.status,
    correctionOfId: e.correctionOfId ?? null,
    note: e.note ?? null,
  };
}

/**
 * Who may enter or edit hours for an employee on a project:
 * - own hours: `timesheet.submit` in the project;
 * - anyone else's: `timesheet.manage` in the project (crew entry).
 */
function canEnterFor(ctx: RequestContext, projectId: string, employee: { userId: string | null }) {
  if (!canAccessProject(ctx, projectId)) return false;
  if (employee.userId === ctx.user.id && has(ctx, projectId, "timesheet.submit")) return true;
  return has(ctx, projectId, "timesheet.manage");
}

/** Visibility: own entries, or entries in projects where the member manages, approves or sees finance. */
function canSee(ctx: RequestContext, e: TimeEntryRow) {
  if (!canAccessProject(ctx, e.projectId)) return false;
  if (e.employee.userId === ctx.user.id) return true;
  const perms = projectPermissions(ctx, e.projectId);
  return perms.has("timesheet.manage") || perms.has("timesheet.approve") || perms.has("finance.view");
}

async function checkPlacement(repo: TimesheetRepo, ctx: RequestContext, projectId: string, siteId: string | null) {
  const project = await repo.findProject(projectId);
  if (!project || project.archivedAt || !canAccessProject(ctx, project.id)) throw new ValidationError({ projectId: ["validation.invalidOption"] });
  if (siteId) {
    const site = await repo.findSite(siteId);
    if (!site || site.archivedAt || site.projectId !== projectId) throw new ValidationError({ siteId: ["validation.invalidOption"] });
  }
}

async function resolveEmployee(repo: TimesheetRepo, ctx: RequestContext, employeeId: string | null) {
  if (employeeId) {
    const [e] = await repo.findEmployees([employeeId]);
    if (!e) throw new ValidationError({ employeeId: ["validation.invalidOption"] });
    return e;
  }
  const own = await repo.findOwnEmployee(ctx.user.id);
  if (!own) throw new ValidationError({ employeeId: ["validation.noEmployeeRecord"] });
  return own;
}

async function audit(tx: Tx, ctx: RequestContext, action: string, before: TimeEntryRow | null, after: TimeEntryRow, metadata?: Record<string, string | number | null>) {
  await writeAudit(tx, ctx, {
    action,
    entityType: "time_entry",
    entityId: after.id,
    projectId: after.projectId,
    before: before ? auditView(before) : null,
    after: auditView(after),
    diff: Boolean(before),
    metadata,
  });
}

export const timesheetService = {
  /** The member's own employee record and the people they may enter hours for. */
  async entryOptions(ctx: RequestContext) {
    const repo = new TimesheetRepo(readClient(), ctx.company.id);
    const own = await repo.findOwnEmployee(ctx.user.id);
    const crewProjects = projectIdsWithPermission(ctx, "timesheet.manage");
    const canManageCrew = crewProjects === undefined || crewProjects.length > 0;
    const employees = canManageCrew ? await repo.listEmployees() : [];
    return { ownEmployee: own, crewEmployees: employees, canManageCrew };
  },

  /** One employee's week (Mon–Sun). Defaults to the member's own hours. */
  async listWeek(ctx: RequestContext, input: { employeeId?: string | null; date: string }) {
    const q = parseInput(weekQuerySchema, input);
    const repo = new TimesheetRepo(readClient(), ctx.company.id);
    const employee = await resolveEmployee(repo, ctx, q.employeeId);
    const { from, to } = weekRange(q.date);
    const rows = await repo.list({ employeeId: employee.id, workDate: { gte: from, lt: to } });
    return { employee, from, to, entries: rows.filter((e) => canSee(ctx, e)) };
  },

  async create(ctx: RequestContext, input: TimeEntryInput) {
    const data = parseInput(timeEntrySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TimesheetRepo(tx, ctx.company.id);
      const employee = await resolveEmployee(repo, ctx, data.employeeId);
      await checkPlacement(repo, ctx, data.projectId, data.siteId);
      if (!canEnterFor(ctx, data.projectId, employee)) throw new ForbiddenError();
      const entry = await repo.create({
        employeeId: employee.id,
        projectId: data.projectId,
        siteId: data.siteId,
        workDate: data.workDate,
        hours: data.hours,
        startMinute: data.startMinute,
        endMinute: data.endMinute,
        workClass: data.workClass,
        note: data.note,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      await audit(tx, ctx, "time_entry.create", null, entry);
      return entry;
    });
  },

  /** Same hours for several people at once (supervisor crew entry). */
  async createCrew(ctx: RequestContext, input: CrewEntryInput) {
    const data = parseInput(crewEntrySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TimesheetRepo(tx, ctx.company.id);
      await checkPlacement(repo, ctx, data.projectId, data.siteId);
      if (!has(ctx, data.projectId, "timesheet.manage")) throw new ForbiddenError();
      const ids = [...new Set(data.employeeIds)];
      const employees = await repo.findEmployees(ids);
      if (employees.length !== ids.length) throw new ValidationError({ employeeIds: ["validation.invalidOption"] });
      const created = [];
      for (const employee of employees) {
        const entry = await repo.create({
          employeeId: employee.id,
          projectId: data.projectId,
          siteId: data.siteId,
          workDate: data.workDate,
          hours: data.hours,
          startMinute: data.startMinute,
          endMinute: data.endMinute,
          workClass: data.workClass,
          note: data.note,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        });
        await audit(tx, ctx, "time_entry.create", null, entry, { crew: ids.length });
        created.push(entry);
      }
      return created;
    });
  },

  /** Edit a draft or rejected entry; it returns to DRAFT. */
  async update(ctx: RequestContext, entryId: string, input: TimeEntryInput) {
    const data = parseInput(timeEntrySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TimesheetRepo(tx, ctx.company.id);
      const before = await repo.find(entryId);
      if (!before || before.archivedAt || !canSee(ctx, before)) throw new NotFoundError();
      if (!canEnterFor(ctx, before.projectId, before.employee)) throw new ForbiddenError();
      if (!isEditable(before.status)) throw new ValidationError({ _form: ["validation.entryLocked"] });
      await checkPlacement(repo, ctx, data.projectId, data.siteId);
      if (!canEnterFor(ctx, data.projectId, before.employee)) throw new ForbiddenError();
      const after = await repo.update(before.id, {
        projectId: data.projectId,
        siteId: data.siteId,
        workDate: data.workDate,
        hours: data.hours,
        startMinute: data.startMinute,
        endMinute: data.endMinute,
        workClass: data.workClass,
        note: data.note,
        status: "DRAFT",
        rejectionReason: null,
        updatedById: ctx.user.id,
      });
      await audit(tx, ctx, "time_entry.update", before, after);
      return after;
    });
  },

  async archive(ctx: RequestContext, entryId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TimesheetRepo(tx, ctx.company.id);
      const before = await repo.find(entryId);
      if (!before || before.archivedAt || !canSee(ctx, before)) throw new NotFoundError();
      if (!canEnterFor(ctx, before.projectId, before.employee)) throw new ForbiddenError();
      if (!isEditable(before.status)) throw new ValidationError({ _form: ["validation.entryLocked"] });
      const after = await repo.update(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "time_entry.archive", entityType: "time_entry", entityId: after.id, projectId: after.projectId, before: auditView(before) });
      return after;
    });
  },

  /** Weekly submission (owner decision #4): all draft/rejected entries of the week. */
  async submitWeek(ctx: RequestContext, input: { employeeId?: string | null; date: string }) {
    const q = parseInput(submitWeekSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TimesheetRepo(tx, ctx.company.id);
      const employee = await resolveEmployee(repo, ctx, q.employeeId);
      const { from, to } = weekRange(q.date);
      const rows = await repo.list({ employeeId: employee.id, workDate: { gte: from, lt: to }, status: { in: [...SUBMITTABLE_STATUSES] } });
      const allowed = rows.filter((e) => canEnterFor(ctx, e.projectId, e.employee));
      if (rows.length > 0 && allowed.length === 0) throw new ForbiddenError();
      const now = new Date();
      for (const e of allowed) {
        const after = await repo.update(e.id, { status: "SUBMITTED", submittedAt: now, submittedById: ctx.user.id, rejectionReason: null, updatedById: ctx.user.id });
        await audit(tx, ctx, "time_entry.submit", e, after);
      }
      return { submitted: allowed.length };
    });
  },

  /** Submitted entries the member may approve (owner decision #2). */
  async listForApproval(ctx: RequestContext, input: { projectId?: string | null } = {}) {
    const q = parseInput(approvalQuerySchema, input);
    const projectIds = projectIdsWithPermission(ctx, "timesheet.approve");
    if (projectIds && projectIds.length === 0) throw new ForbiddenError();
    if (q.projectId && !has(ctx, q.projectId, "timesheet.approve")) throw new NotFoundError();
    const repo = new TimesheetRepo(readClient(), ctx.company.id);
    const rows = await repo.list({
      status: "SUBMITTED",
      ...(q.projectId ? { projectId: q.projectId } : projectIds ? { projectId: { in: projectIds } } : {}),
    });
    return rows.filter((e) => has(ctx, e.projectId, "timesheet.approve"));
  },

  /**
   * Approve or reject submitted entries. Nobody approves their own hours
   * (segregation of duties).
   */
  async decide(ctx: RequestContext, input: { entryIds: string[]; decision: "APPROVE" | "REJECT"; reason?: string | null }) {
    const data = parseInput(decisionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TimesheetRepo(tx, ctx.company.id);
      const rows = await repo.findMany([...new Set(data.entryIds)]);
      if (rows.length !== new Set(data.entryIds).size || rows.some((e) => !canSee(ctx, e))) throw new NotFoundError();
      for (const e of rows) {
        if (!has(ctx, e.projectId, "timesheet.approve")) throw new ForbiddenError();
        if (e.employee.userId === ctx.user.id) throw new ValidationError({ _form: ["validation.selfApproval"] });
        if (e.status !== "SUBMITTED" || e.archivedAt) throw new ValidationError({ _form: ["validation.entryNotSubmitted"] });
      }
      const now = new Date();
      for (const e of rows) {
        const after = await repo.update(e.id, {
          status: data.decision === "APPROVE" ? "APPROVED" : "REJECTED",
          decidedAt: now,
          decidedById: ctx.user.id,
          rejectionReason: data.decision === "REJECT" ? data.reason : null,
          updatedById: ctx.user.id,
        });
        await audit(tx, ctx, data.decision === "APPROVE" ? "time_entry.approve" : "time_entry.reject", e, after);
      }
      return { decided: rows.length };
    });
  },

  /**
   * Correction of an approved/exported entry: a new SUBMITTED entry with a
   * ± hours delta referencing the original. It needs approval like any entry.
   */
  async createCorrection(ctx: RequestContext, entryId: string, input: { hours: string; note: string }) {
    const data = parseInput(correctionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TimesheetRepo(tx, ctx.company.id);
      const original = await repo.find(entryId);
      if (!original || original.archivedAt || !canSee(ctx, original)) throw new NotFoundError();
      const perms = projectPermissions(ctx, original.projectId);
      if (!perms.has("timesheet.manage") && !perms.has("timesheet.approve")) throw new ForbiddenError();
      if (!CORRECTABLE_STATUSES.includes(original.status) || original.correctionOfId) throw new ValidationError({ _form: ["validation.notCorrectable"] });
      const now = new Date();
      const correction = await repo.create({
        employeeId: original.employeeId,
        projectId: original.projectId,
        siteId: original.siteId,
        workDate: original.workDate,
        hours: data.hours,
        workClass: original.workClass,
        note: data.note,
        correctionOfId: original.id,
        status: "SUBMITTED",
        submittedAt: now,
        submittedById: ctx.user.id,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      await audit(tx, ctx, "time_entry.correction", null, correction, { correctionOf: original.id });
      return correction;
    });
  },

  /** Marks approved hours in the range as exported and returns the batch id. */
  async exportApproved(ctx: RequestContext, input: { from: string; to: string }) {
    requirePermission(ctx, "timesheet.export");
    const data = parseInput(exportSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TimesheetRepo(tx, ctx.company.id);
      const rows = await repo.list({ status: "APPROVED", workDate: { gte: data.from, lte: data.to } });
      if (rows.length === 0) throw new ValidationError({ _form: ["validation.nothingToExport"] });
      const batchId = randomUUID();
      await repo.markExported(
        rows.map((r) => r.id),
        batchId,
        ctx.user.id,
      );
      await writeAudit(tx, ctx, {
        action: "time_entry.export",
        entityType: "time_entry_export",
        entityId: batchId,
        after: { from: data.from, to: data.to, entries: rows.length },
      });
      return { batchId, count: rows.length };
    });
  },

  /** Rows of an export batch for the payroll CSV. */
  async exportRows(ctx: RequestContext, batchId: string) {
    requirePermission(ctx, "timesheet.export");
    const repo = new TimesheetRepo(readClient(), ctx.company.id);
    const rows = await repo.list({ exportBatchId: batchId });
    if (rows.length === 0) throw new NotFoundError();
    return rows.map((r) => ({
      employeeNumber: r.employee.employeeNumber,
      lastName: r.employee.lastName,
      firstName: r.employee.firstName,
      workDate: r.workDate,
      projectCode: r.project.code,
      site: r.site?.name ?? "",
      hours: r.hours.toString(),
      workClass: r.workClass,
      correctionOf: r.correctionOfId ?? "",
      note: r.note ?? "",
    }));
  },
};
