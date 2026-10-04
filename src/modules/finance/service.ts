import { readClient, runInTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { canAccessProject, projectPermissions, type PermissionKey, type RequestContext } from "@/platform/authz";
import { FinanceRepo } from "./repo";
import { COST_CATEGORIES, D, compareBudget, priceHours, sumAmounts, type CostCategory, type RatePeriod } from "./calculations";
import { budgetLineSchema, costEntrySchema, createBudgetSchema, type BudgetLineInput, type CostEntryInput } from "./schemas";

/** Finance data is sensitive and project-scoped. */
function requireFinance(ctx: RequestContext, projectId: string, permission: PermissionKey) {
  if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
  const perms = projectPermissions(ctx, projectId);
  if (!perms.has("project.view") && !perms.has("finance.view")) throw new NotFoundError();
  if (!perms.has("finance.view") || !perms.has(permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

async function projectOr404(repo: FinanceRepo, projectId: string) {
  const project = await repo.findProject(projectId);
  if (!project) throw new NotFoundError();
  return project;
}

async function draftBudgetOf(repo: FinanceRepo, ctx: RequestContext, budgetId: string) {
  const budget = await repo.findBudget(budgetId);
  if (!budget) throw new NotFoundError();
  requireFinance(ctx, budget.projectId, "finance.manage");
  if (budget.status !== "DRAFT") throw new ValidationError({ _form: ["validation.budgetFrozen"] });
  return budget;
}

export const budgetService = {
  async listVersions(ctx: RequestContext, projectId: string) {
    const repo = new FinanceRepo(readClient(), ctx.company.id);
    const project = await projectOr404(repo, projectId);
    requireFinance(ctx, project.id, "finance.view");
    return repo.listBudgets(project.id);
  },

  /** New version (v1 = original budget). Optionally copies the active version's lines. */
  async createVersion(ctx: RequestContext, projectId: string, input: { note?: string | null; copyFromCurrent?: boolean | string } = {}) {
    const data = parseInput(createBudgetSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new FinanceRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, projectId);
      requireFinance(ctx, project.id, "finance.manage");
      const versions = await repo.listBudgets(project.id);
      if (versions.some((v) => v.status === "DRAFT")) throw new ValidationError({ _form: ["validation.draftBudgetExists"] });
      const active = versions.find((v) => v.status === "ACTIVE");
      const budget = await repo.createBudget({
        projectId: project.id,
        versionNumber: (versions[0]?.versionNumber ?? 0) + 1,
        currency: active?.currency ?? ctx.company.defaultCurrency,
        note: data.note,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      if (data.copyFromCurrent && active) {
        for (const l of active.lines) await repo.createLine({ budgetId: budget.id, category: l.category, description: l.description, amount: l.amount, createdById: ctx.user.id, updatedById: ctx.user.id });
      }
      await writeAudit(tx, ctx, {
        action: "budget.create",
        entityType: "budget",
        entityId: budget.id,
        projectId: project.id,
        after: { versionNumber: budget.versionNumber, copiedFrom: data.copyFromCurrent && active ? active.versionNumber : null, note: budget.note },
      });
      return budget;
    });
  },

  async addLine(ctx: RequestContext, budgetId: string, input: BudgetLineInput) {
    const data = parseInput(budgetLineSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new FinanceRepo(tx, ctx.company.id);
      const budget = await draftBudgetOf(repo, ctx, budgetId);
      const line = await repo.createLine({ budgetId: budget.id, ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "budget_line.create", entityType: "budget_line", entityId: line.id, projectId: budget.projectId, after: { budgetId: budget.id, ...data } });
      return line;
    });
  },

  async updateLine(ctx: RequestContext, lineId: string, input: BudgetLineInput) {
    const data = parseInput(budgetLineSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new FinanceRepo(tx, ctx.company.id);
      const before = await repo.findLine(lineId);
      if (!before) throw new NotFoundError();
      const budget = await draftBudgetOf(repo, ctx, before.budgetId);
      const after = await repo.updateLine(before.id, { ...data, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "budget_line.update", entityType: "budget_line", entityId: after.id, projectId: budget.projectId, before, after, diff: true });
      return after;
    });
  },

  async removeLine(ctx: RequestContext, lineId: string) {
    return runInTransaction(async (tx) => {
      const repo = new FinanceRepo(tx, ctx.company.id);
      const line = await repo.findLine(lineId);
      if (!line) throw new NotFoundError();
      const budget = await draftBudgetOf(repo, ctx, line.budgetId);
      await repo.deleteLine(line.id);
      await writeAudit(tx, ctx, { action: "budget_line.remove", entityType: "budget_line", entityId: line.id, projectId: budget.projectId, before: line });
    });
  },

  async discardDraft(ctx: RequestContext, budgetId: string) {
    return runInTransaction(async (tx) => {
      const repo = new FinanceRepo(tx, ctx.company.id);
      const budget = await draftBudgetOf(repo, ctx, budgetId);
      await repo.deleteBudget(budget.id);
      await writeAudit(tx, ctx, { action: "budget.discard", entityType: "budget", entityId: budget.id, projectId: budget.projectId, before: { versionNumber: budget.versionNumber, lines: budget.lines.length } });
    });
  },

  /** Activates a draft; the previous active version becomes SUPERSEDED (kept, frozen). */
  async activate(ctx: RequestContext, budgetId: string) {
    return runInTransaction(async (tx) => {
      const repo = new FinanceRepo(tx, ctx.company.id);
      const budget = await draftBudgetOf(repo, ctx, budgetId);
      if (budget.lines.length === 0) throw new ValidationError({ _form: ["validation.budgetEmpty"] });
      const previous = await repo.activeBudget(budget.projectId);
      if (previous) await repo.updateBudget(previous.id, { status: "SUPERSEDED", updatedById: ctx.user.id });
      const activated = await repo.updateBudget(budget.id, { status: "ACTIVE", activatedAt: new Date(), activatedById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, {
        action: "budget.activate",
        entityType: "budget",
        entityId: activated.id,
        projectId: activated.projectId,
        before: previous ? { activeVersion: previous.versionNumber, total: sumAmounts(previous.lines.map((l) => l.amount)) } : null,
        after: { activeVersion: activated.versionNumber, total: sumAmounts(budget.lines.map((l) => l.amount)) },
      });
      return activated;
    });
  },
};

export const costService = {
  async list(ctx: RequestContext, projectId: string) {
    const repo = new FinanceRepo(readClient(), ctx.company.id);
    const project = await projectOr404(repo, projectId);
    requireFinance(ctx, project.id, "finance.view");
    return repo.listCosts(project.id);
  },

  async create(ctx: RequestContext, projectId: string, input: CostEntryInput) {
    const data = parseInput(costEntrySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new FinanceRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, projectId);
      requireFinance(ctx, project.id, "finance.manage");
      if (project.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      if (data.siteId) {
        const site = await repo.findSite(data.siteId);
        if (!site || site.projectId !== project.id) throw new ValidationError({ siteId: ["validation.invalidOption"] });
      }
      const entry = await repo.createCost({ projectId: project.id, ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "cost_entry.create", entityType: "cost_entry", entityId: entry.id, projectId: project.id, after: entry });
      return entry;
    });
  },

  /** Corrections: archive the wrong entry (audited) and record a new one. */
  async archive(ctx: RequestContext, costEntryId: string) {
    return runInTransaction(async (tx) => {
      const repo = new FinanceRepo(tx, ctx.company.id);
      const before = await repo.findCost(costEntryId);
      if (!before) throw new NotFoundError();
      requireFinance(ctx, before.projectId, "finance.manage");
      if (before.archivedAt) return before;
      const after = await repo.updateCost(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "cost_entry.archive", entityType: "cost_entry", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },
};

export const projectFinanceService = {
  /**
   * Budget vs actual for a project. Actuals:
   * - LABOR: approved/exported hours × employee hourly cost rate × class multiplier;
   * - EQUIPMENT: signed diary equipment hours × equipment hourly cost rate,
   *   plus manual equipment costs;
   * - other categories: manual cost entries.
   * Hours without a usable rate are reported as unpriced, never guessed.
   */
  async summary(ctx: RequestContext, projectId: string) {
    const repo = new FinanceRepo(readClient(), ctx.company.id);
    const project = await projectOr404(repo, projectId);
    requireFinance(ctx, project.id, "finance.view");

    const [budget, hours, statusCounts, equipmentHours, costs, draftDiaries] = await Promise.all([
      repo.activeBudget(project.id),
      repo.approvedHours(project.id),
      repo.countByStatus(project.id),
      repo.signedEquipmentHours(project.id),
      repo.listCosts(project.id),
      repo.draftDiaries(project.id),
    ]);
    const currency = budget?.currency ?? ctx.company.defaultCurrency;

    const employeeRates = await repo.employeeRates([...new Set(hours.map((h) => h.employeeId))]);
    const labor = priceHours(
      hours.map((h) => ({ id: h.id, resourceId: h.employeeId, date: h.workDate, hours: h.hours, workClass: h.workClass })),
      employeeRates.map<RatePeriod>((r) => ({ ...r, resourceId: r.employeeId })),
      currency,
    );

    const equipmentRates = await repo.equipmentRates([...new Set(equipmentHours.map((e) => e.equipmentId!))]);
    const equipment = priceHours(
      equipmentHours.map((e) => ({ id: e.id, resourceId: e.equipmentId!, date: e.dailyReport.reportDate, hours: e.hours! })),
      equipmentRates.map<RatePeriod>((r) => ({ ...r, resourceId: r.equipmentId })),
      currency,
    );

    const manualBy: Partial<Record<CostCategory, ReturnType<typeof D>>> = {};
    const otherCurrencyCosts = costs.filter((c) => c.currency !== currency);
    for (const c of costs.filter((c) => c.currency === currency)) manualBy[c.category] = (manualBy[c.category] ?? D(0)).plus(c.amount);

    const actuals: Partial<Record<CostCategory, ReturnType<typeof D>>> = { ...manualBy };
    actuals.LABOR = (actuals.LABOR ?? D(0)).plus(labor.totalCost);
    actuals.EQUIPMENT = (actuals.EQUIPMENT ?? D(0)).plus(equipment.totalCost);

    const comparison = compareBudget(budget?.lines ?? [], actuals);
    const counts = Object.fromEntries(statusCounts.map((s) => [s.status, { entries: s._count._all, hours: s._sum.hours?.toString() ?? "0" }]));

    return {
      project: { id: project.id, code: project.code, name: project.name },
      currency,
      budget: budget ? { id: budget.id, versionNumber: budget.versionNumber, activatedAt: budget.activatedAt } : null,
      comparison,
      breakdown: {
        laborComputed: labor.totalCost,
        equipmentComputed: equipment.totalCost,
        manual: Object.fromEntries(COST_CATEGORIES.map((c) => [c, manualBy[c] ?? D(0)])) as Record<CostCategory, ReturnType<typeof D>>,
      },
      hours: {
        approved: labor.totalHours,
        unpriced: labor.unpriced.length ? labor.unpricedHours : D(0),
        equipmentApproved: equipment.totalHours,
        equipmentUnpriced: equipment.unpricedHours,
      },
      warnings: {
        unpricedLaborEntries: labor.unpriced.length,
        unpricedEquipmentEntries: equipment.unpriced.length,
        otherCurrencyCosts: otherCurrencyCosts.length,
      },
      workflow: {
        submitted: counts.SUBMITTED ?? { entries: 0, hours: "0" },
        drafts: counts.DRAFT ?? { entries: 0, hours: "0" },
        draftDiaries,
      },
    };
  },
};

