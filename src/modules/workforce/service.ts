import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ConflictError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { hasPermission, requirePermission, type RequestContext } from "@/platform/authz";
import { currentRates, overlapsExisting, rateSchema, ratesToClose, type RateInput } from "@/modules/shared/rates";
import { EmployeeRepo } from "./repo";
import { employeeListSchema, employeeSchema, type EmployeeInput } from "./schemas";

type EmployeeRow = NonNullable<Awaited<ReturnType<EmployeeRepo["find"]>>>;
type RateRow = Awaited<ReturnType<EmployeeRepo["listRates"]>>[number];

/**
 * Output mapper. Rates are attached only with `employee.rates.view`; without
 * it the `rates` key is absent (not merely empty), so callers cannot infer
 * anything from it.
 */
function toEmployeeView(ctx: RequestContext, e: EmployeeRow, rates?: RateRow[]) {
  const base = {
    id: e.id,
    employeeNumber: e.employeeNumber,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    phone: e.phone,
    jobTitle: e.jobTitle,
    trade: e.trade,
    employmentType: e.employmentType,
    status: e.status,
    userId: e.userId,
    startDate: e.startDate,
    endDate: e.endDate,
    notes: e.notes,
    shareableInGroup: e.shareableInGroup,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    archivedAt: e.archivedAt,
  };
  if (!hasPermission(ctx, "employee.rates.view") || !rates) return base;
  const current = currentRates(rates);
  return { ...base, currentRates: current, rates };
}

function conflictOnNumber<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (isUniqueViolation(e)) throw new ConflictError("Employee number already in use", "employeeNumber");
    throw e;
  });
}

export const employeeService = {
  async list(ctx: RequestContext, input: { q?: string | null; includeArchived?: boolean } = {}) {
    requirePermission(ctx, "employee.view");
    const filter = parseInput(employeeListSchema, input);
    const repo = new EmployeeRepo(readClient(), ctx.company.id);
    const employees = await repo.list(filter);
    if (!hasPermission(ctx, "employee.rates.view")) return employees.map((e) => toEmployeeView(ctx, e));
    const rates = await repo.listRates(employees.map((e) => e.id));
    return employees.map((e) => toEmployeeView(ctx, e, rates.filter((r) => r.employeeId === e.id)));
  },

  async get(ctx: RequestContext, employeeId: string) {
    requirePermission(ctx, "employee.view");
    const repo = new EmployeeRepo(readClient(), ctx.company.id);
    const employee = await repo.find(employeeId);
    if (!employee) throw new NotFoundError();
    const rates = hasPermission(ctx, "employee.rates.view") ? await repo.listRates([employee.id]) : undefined;
    return toEmployeeView(ctx, employee, rates);
  },

  async create(ctx: RequestContext, input: EmployeeInput) {
    requirePermission(ctx, "employee.manage");
    const data = parseInput(employeeSchema, input);
    return conflictOnNumber(
      runInTransaction(async (tx) => {
        const repo = new EmployeeRepo(tx, ctx.company.id);
        if (data.userId && !(await repo.isCompanyMember(data.userId))) throw new ValidationError({ userId: ["validation.invalidOption"] });
        const employee = await repo.create({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "employee.create", entityType: "employee", entityId: employee.id, after: employee });
        return toEmployeeView(ctx, employee);
      }),
    );
  },

  async update(ctx: RequestContext, employeeId: string, input: EmployeeInput) {
    requirePermission(ctx, "employee.manage");
    const data = parseInput(employeeSchema, input);
    return conflictOnNumber(
      runInTransaction(async (tx) => {
        const repo = new EmployeeRepo(tx, ctx.company.id);
        const before = await repo.find(employeeId);
        if (!before) throw new NotFoundError();
        if (before.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
        if (data.userId && !(await repo.isCompanyMember(data.userId))) throw new ValidationError({ userId: ["validation.invalidOption"] });
        const after = await repo.update(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "employee.update", entityType: "employee", entityId: after.id, before, after, diff: true });
        return toEmployeeView(ctx, after);
      }),
    );
  },

  async archive(ctx: RequestContext, employeeId: string) {
    requirePermission(ctx, "employee.manage");
    return runInTransaction(async (tx) => {
      const repo = new EmployeeRepo(tx, ctx.company.id);
      const before = await repo.find(employeeId);
      if (!before) throw new NotFoundError();
      if (before.archivedAt) return toEmployeeView(ctx, before);
      const after = await repo.update(before.id, { archivedAt: new Date(), status: "INACTIVE", updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "employee.archive", entityType: "employee", entityId: after.id, before, after, diff: true });
      return toEmployeeView(ctx, after);
    });
  },

  async listRates(ctx: RequestContext, employeeId: string) {
    requirePermission(ctx, "employee.view");
    requirePermission(ctx, "employee.rates.view");
    const repo = new EmployeeRepo(readClient(), ctx.company.id);
    const employee = await repo.find(employeeId);
    if (!employee) throw new NotFoundError();
    return repo.listRates([employee.id]);
  },

  /**
   * Adds a rate period. An open-ended earlier rate of the same type is closed
   * the day before the new one starts; any other overlap is rejected.
   */
  async addRate(ctx: RequestContext, employeeId: string, input: RateInput) {
    requirePermission(ctx, "employee.rates.manage");
    const data = parseInput(rateSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new EmployeeRepo(tx, ctx.company.id);
      const employee = await repo.find(employeeId);
      if (!employee) throw new NotFoundError();
      const existing = await repo.listRates([employee.id]);
      const toClose = ratesToClose(existing, data);
      if (overlapsExisting(existing, data, new Set(toClose.map((c) => c.id)))) {
        throw new ValidationError({ validFrom: ["validation.rateOverlap"] });
      }
      for (const c of toClose) {
        const before = existing.find((r) => r.id === c.id)!;
        const after = await repo.updateRate(c.id, { validTo: c.validTo, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "employee_rate.close", entityType: "employee_rate", entityId: c.id, before, after, diff: true });
      }
      const rate = await repo.createRate({ ...data, employeeId: employee.id, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, {
        action: "employee_rate.create",
        entityType: "employee_rate",
        entityId: rate.id,
        after: rate,
        metadata: { employeeId: employee.id },
      });
      return rate;
    });
  },

  async archiveRate(ctx: RequestContext, rateId: string) {
    requirePermission(ctx, "employee.rates.manage");
    return runInTransaction(async (tx) => {
      const repo = new EmployeeRepo(tx, ctx.company.id);
      const before = await repo.findRate(rateId);
      if (!before) throw new NotFoundError();
      if (before.archivedAt) return before;
      const after = await repo.updateRate(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "employee_rate.archive", entityType: "employee_rate", entityId: after.id, before, after, diff: true });
      return after;
    });
  },
};
