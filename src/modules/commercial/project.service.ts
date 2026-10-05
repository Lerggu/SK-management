import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { projectPermissions, type RequestContext } from "@/platform/authz";
import { D } from "@/modules/finance/calculations";
import { projectFinanceService } from "@/modules/finance/service";
import { commercialPermissions, requireProjectCommercial } from "./access";
import { CommercialRepo } from "./repo";
import { VARIATION_APPROVED_STATES, VARIATION_FLOW, VARIATION_UNINVOICED_STATES, forecast, priceVariation, type VariationStatus } from "./rules";
import {
  clientDecisionSchema,
  contractSchema,
  contractUpdateSchema,
  decisionSchema,
  etcSchema,
  milestoneSchema,
  noteSchema,
  variationDraftSchema,
  variationSchema,
  type ClientDecisionInput,
  type ContractInput,
  type ContractUpdateInput,
  type DecisionInput,
  type EtcInput,
  type MilestoneInput,
  type VariationDraftInput,
  type VariationInput,
} from "./schemas";

const s = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : d.toString());

async function projectOr404(repo: CommercialRepo, projectId: string) {
  const p = await repo.findProject(projectId);
  if (!p) throw new NotFoundError();
  return p;
}

// ── contracts ────────────────────────────────────────────────────────
export const contractService = {
  async list(ctx: RequestContext, projectId: string) {
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    const project = await projectOr404(repo, projectId);
    requireProjectCommercial(ctx, project.id, "commercial.view");
    const rows = await repo.listContracts(project.id);
    return rows.map((c) => ({ ...c, value: c.value.toString(), milestones: c.milestones.map((m) => ({ ...m, amount: m.amount.toString() })) }));
  },

  async create(ctx: RequestContext, input: ContractInput) {
    const data = parseInput(contractSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, data.projectId);
      requireProjectCommercial(ctx, project.id, "commercial.manage");
      const customer = await repo.findCustomer(data.customerId);
      if (!customer || customer.archivedAt) throw new ValidationError({ customerId: ["validation.invalidOption"] });
      try {
        const c = await repo.createContract({ ...data, currency: ctx.company.defaultCurrency, createdById: ctx.user.id, updatedById: ctx.user.id });
        if (!project.customerId) await repo.updateProject(project.id, { customerId: customer.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "contract.create", entityType: "contract", entityId: c.id, projectId: project.id, after: c });
        return c;
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ contractNumber: ["validation.codeTaken"] });
        throw e;
      }
    });
  },

  async update(ctx: RequestContext, contractId: string, input: ContractUpdateInput) {
    const data = parseInput(contractUpdateSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const before = await repo.findContract(contractId);
      if (!before) throw new NotFoundError();
      requireProjectCommercial(ctx, before.projectId, "commercial.manage");
      const after = await repo.updateContract(before.id, { title: data.title, signedDate: data.signedDate, retentionNote: data.retentionNote, status: data.closed ? "CLOSED" : "ACTIVE", updatedById: ctx.user.id });
      const { milestones: _m, customer: _c, project: _p, ...plain } = before;
      await writeAudit(tx, ctx, { action: "contract.update", entityType: "contract", entityId: after.id, projectId: after.projectId, before: plain, after, diff: true });
      return after;
    });
  },

  async addMilestone(ctx: RequestContext, contractId: string, input: MilestoneInput) {
    const data = parseInput(milestoneSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const c = await repo.findContract(contractId);
      if (!c) throw new NotFoundError();
      requireProjectCommercial(ctx, c.projectId, "commercial.manage");
      if (c.status !== "ACTIVE") throw new ValidationError({ _form: ["validation.contractClosed"] });
      const m = await repo.createMilestone({ contractId: c.id, ...data, createdById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "contract.milestone_add", entityType: "contract", entityId: c.id, projectId: c.projectId, after: { milestoneId: m.id, ...data } });
      return m;
    });
  },
};

// ── variations (Build Master §21) ────────────────────────────────────
type Variation = NonNullable<Awaited<ReturnType<CommercialRepo["findVariation"]>>>;

function variationCan(ctx: RequestContext, v: Variation) {
  const p = projectPermissions(ctx, v.projectId);
  const manage = p.has("commercial.manage");
  const approve = p.has("commercial.approve");
  const self = v.createdById === ctx.user.id || v.submittedById === ctx.user.id;
  return {
    edit: manage && v.status === "DRAFT",
    submit: manage && v.status === "DRAFT",
    returnToDraft: v.status === "INTERNAL_REVIEW" && (manage || approve),
    approveInternal: approve && v.status === "INTERNAL_REVIEW" && !self,
    selfApprovalBlocked: approve && v.status === "INTERNAL_REVIEW" && self,
    clientDecision: manage && v.status === "SUBMITTED_TO_CLIENT",
    execute: manage && v.status === "APPROVED",
    readyToInvoice: manage && v.status === "EXECUTED",
  };
}

function presentVariation(v: Variation) {
  return {
    ...v,
    laborCost: v.laborCost.toString(),
    equipmentCost: v.equipmentCost.toString(),
    materialsCost: v.materialsCost.toString(),
    subcontractCost: v.subcontractCost.toString(),
    otherCost: v.otherCost.toString(),
    markupPct: v.markupPct.toString(),
    salesPrice: v.salesPrice.toString(),
    cost: priceVariation(v).cost.toString(),
  };
}

async function loadVariation(repo: CommercialRepo, ctx: RequestContext, id: string) {
  const v = await repo.findVariation(id);
  if (!v) throw new NotFoundError();
  requireProjectCommercial(ctx, v.projectId, "commercial.view");
  return v;
}

async function move(repo: CommercialRepo, ctx: RequestContext, v: Variation, to: VariationStatus, extra: Record<string, unknown>, action: string, note?: string | null) {
  if (!VARIATION_FLOW[v.status].includes(to)) throw new ValidationError({ _form: ["validation.invalidTransition"] });
  await repo.updateVariation(v.id, { status: to, ...extra, updatedById: ctx.user.id });
  return { action, before: { status: v.status }, after: { status: to, note: note ?? null, salesPrice: v.salesPrice.toString() } };
}

export const variationService = {
  async list(ctx: RequestContext, projectId: string) {
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    const project = await projectOr404(repo, projectId);
    requireProjectCommercial(ctx, project.id, "commercial.view");
    const rows = await repo.listVariations({ projectId: project.id });
    const sum = (states: readonly string[]) => rows.filter((v) => states.includes(v.status)).reduce((a, v) => a.plus(v.salesPrice), D(0)).toString();
    return { rows: rows.map((v) => ({ ...v, salesPrice: v.salesPrice.toString() })), approvedValue: sum(VARIATION_APPROVED_STATES), uninvoicedValue: sum(VARIATION_UNINVOICED_STATES), permissions: commercialPermissions(ctx, project.id) };
  },

  async get(ctx: RequestContext, variationId: string) {
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    const v = await loadVariation(repo, ctx, variationId);
    const users = await repo.findUsers([v.createdById, v.submittedById, v.internalApprovedBy].filter((x): x is string => !!x));
    return { ...presentVariation(v), users, can: variationCan(ctx, v), documents: await repo.listDocuments(v.projectId) };
  },

  async create(ctx: RequestContext, input: VariationInput) {
    const data = parseInput(variationSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, data.projectId);
      requireProjectCommercial(ctx, project.id, "commercial.manage");
      if (project.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      if (data.contractId) {
        const c = await repo.findContract(data.contractId);
        if (!c || c.projectId !== project.id) throw new ValidationError({ contractId: ["validation.invalidOption"] });
      }
      const v = await repo.createVariation({ ...data, number: await repo.nextVariationNumber(project.id), currency: ctx.company.defaultCurrency, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "variation.create", entityType: "variation", entityId: v.id, projectId: project.id, after: v });
      return v;
    });
  },

  /** Pricing is editable only in DRAFT; the sales price is always recomputed (§21). */
  async updateDraft(ctx: RequestContext, variationId: string, input: VariationDraftInput) {
    const data = parseInput(variationDraftSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const v = await loadVariation(repo, ctx, variationId);
      if (!variationCan(ctx, v).edit) {
        if (v.status !== "DRAFT") throw new ValidationError({ _form: ["validation.versionNotDraft"] });
        throw new ForbiddenError("Cannot edit this variation");
      }
      if (data.evidenceDocumentId) {
        const d = await repo.findDocument(data.evidenceDocumentId);
        if (!d || d.projectId !== v.projectId) throw new ValidationError({ evidenceDocumentId: ["validation.invalidOption"] });
      }
      const { salesPrice } = priceVariation(data);
      const after = await repo.updateVariation(v.id, { ...data, salesPrice, updatedById: ctx.user.id });
      const { project: _p, contract: _c, evidenceDocument: _e, ...before } = v;
      await writeAudit(tx, ctx, { action: "variation.update", entityType: "variation", entityId: v.id, projectId: v.projectId, before, after, diff: true });
      return after;
    });
  },

  async submitForReview(ctx: RequestContext, variationId: string) {
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const v = await loadVariation(repo, ctx, variationId);
      if (!variationCan(ctx, v).submit) throw new ForbiddenError("Cannot submit this variation");
      if (v.salesPrice.isZero()) throw new ValidationError({ _form: ["validation.variationUnpriced"] });
      const a = await move(repo, ctx, v, "INTERNAL_REVIEW", { submittedAt: new Date(), submittedById: ctx.user.id }, "variation.submit");
      await writeAudit(tx, ctx, { ...a, entityType: "variation", entityId: v.id, projectId: v.projectId });
    });
  },

  async returnToDraft(ctx: RequestContext, variationId: string, input: { note?: string | null } = {}) {
    const data = parseInput(noteSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const v = await loadVariation(repo, ctx, variationId);
      if (!variationCan(ctx, v).returnToDraft) throw new ForbiddenError("Cannot return this variation");
      const a = await move(repo, ctx, v, "DRAFT", { submittedAt: null, submittedById: null, decisionNote: data.note }, "variation.return", data.note);
      await writeAudit(tx, ctx, { ...a, entityType: "variation", entityId: v.id, projectId: v.projectId });
    });
  },

  /** Internal approval by the Project Director (owner decision 3) before the client sees it. */
  async approveInternal(ctx: RequestContext, variationId: string, input: DecisionInput) {
    const data = parseInput(decisionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const v = await loadVariation(repo, ctx, variationId);
      requireProjectCommercial(ctx, v.projectId, "commercial.approve");
      if (v.status !== "INTERNAL_REVIEW") throw new ValidationError({ _form: ["validation.versionNotSubmitted"] });
      if (v.createdById === ctx.user.id || v.submittedById === ctx.user.id) throw new ValidationError({ _form: ["validation.commercialSelfApproval"] });
      const a =
        data.decision === "APPROVE"
          ? await move(repo, ctx, v, "SUBMITTED_TO_CLIENT", { internalApprovedAt: new Date(), internalApprovedBy: ctx.user.id, decisionNote: data.note }, "variation.approve_internal", data.note)
          : await move(repo, ctx, v, "DRAFT", { submittedAt: null, submittedById: null, decisionNote: data.note }, "variation.return", data.note);
      await writeAudit(tx, ctx, { ...a, entityType: "variation", entityId: v.id, projectId: v.projectId });
    });
  },

  /** The client's decision with approval evidence (reference or document). */
  async recordClientDecision(ctx: RequestContext, variationId: string, input: ClientDecisionInput) {
    const data = parseInput(clientDecisionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const v = await loadVariation(repo, ctx, variationId);
      if (!variationCan(ctx, v).clientDecision) throw new ForbiddenError("Cannot record the client decision");
      if (data.evidenceDocumentId) {
        const d = await repo.findDocument(data.evidenceDocumentId);
        if (!d || d.projectId !== v.projectId) throw new ValidationError({ evidenceDocumentId: ["validation.invalidOption"] });
      }
      const a = await move(
        repo,
        ctx,
        v,
        data.decision,
        { clientDecisionAt: new Date(), clientReference: data.clientReference ?? v.clientReference, evidenceDocumentId: data.evidenceDocumentId ?? v.evidenceDocumentId, decisionNote: data.note },
        data.decision === "APPROVED" ? "variation.client_approve" : "variation.client_reject",
        data.note,
      );
      await writeAudit(tx, ctx, { ...a, entityType: "variation", entityId: v.id, projectId: v.projectId });
    });
  },

  async markExecuted(ctx: RequestContext, variationId: string) {
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const v = await loadVariation(repo, ctx, variationId);
      if (!variationCan(ctx, v).execute) throw new ForbiddenError("Cannot mark executed");
      const a = await move(repo, ctx, v, "EXECUTED", { executedAt: new Date() }, "variation.execute");
      await writeAudit(tx, ctx, { ...a, entityType: "variation", entityId: v.id, projectId: v.projectId });
    });
  },

  async markReadyToInvoice(ctx: RequestContext, variationId: string) {
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const v = await loadVariation(repo, ctx, variationId);
      if (!variationCan(ctx, v).readyToInvoice) throw new ForbiddenError("Cannot mark ready to invoice");
      const a = await move(repo, ctx, v, "READY_TO_INVOICE", {}, "variation.ready_to_invoice");
      await writeAudit(tx, ctx, { ...a, entityType: "variation", entityId: v.id, projectId: v.projectId });
    });
  },
};

// ── forecast / EAC (Build Master §22) ────────────────────────────────
export const forecastService = {
  /** Budget, actual, ETC, EAC, forecast revenue and margin, invoicing status. */
  async get(ctx: RequestContext, projectId: string) {
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    const project = await projectOr404(repo, projectId);
    requireProjectCommercial(ctx, project.id, "commercial.view");
    const perms = projectPermissions(ctx, project.id);
    // Actual cost comes from the V2 project control (labour, equipment, manual costs).
    const finance = perms.has("finance.view") ? await projectFinanceService.summary(ctx, project.id) : null;
    const [contracts, variations, etcRows, totals] = await Promise.all([repo.listContracts(project.id), repo.listVariations({ projectId: project.id }), repo.latestEtc(project.id), repo.candidateTotals(project.id)]);
    const latest = new Map<string, (typeof etcRows)[number]>();
    for (const r of etcRows) if (!latest.has(r.category)) latest.set(r.category, r);
    const sumStatus = (st: string[]) => totals.filter((t) => st.includes(t.status)).reduce((a, t) => a.plus(t._sum.amount ?? 0), D(0));
    const f = forecast({
      budget: finance?.budget ? finance.comparison.total.budget : null,
      actualCost: finance ? finance.comparison.total.actual : 0,
      etc: [...latest.values()].map((r) => r.etcAmount),
      contractValue: contracts.filter((c) => c.status === "ACTIVE" || c.status === "CLOSED").reduce((a, c) => a.plus(c.value), D(0)),
      approvedVariations: variations.filter((v) => (VARIATION_APPROVED_STATES as readonly string[]).includes(v.status)).reduce((a, v) => a.plus(v.salesPrice), D(0)),
      invoiced: sumStatus(["EXPORTED", "INVOICED"]),
      openCandidates: sumStatus(["OPEN"]),
    });
    return {
      project: { id: project.id, code: project.code, name: project.name, customer: project.customer },
      currency: ctx.company.defaultCurrency,
      costVisible: !!finance,
      forecast: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, s(v as { toString(): string } | null)])) as Record<keyof typeof f, string | null>,
      etc: [...latest.values()].map((r) => ({ category: r.category, etcAmount: r.etcAmount.toString(), note: r.note, createdAt: r.createdAt })),
      uninvoicedVariations: variations.filter((v) => (VARIATION_UNINVOICED_STATES as readonly string[]).includes(v.status)).reduce((a, v) => a.plus(v.salesPrice), D(0)).toString(),
      permissions: commercialPermissions(ctx, project.id),
    };
  },

  /** Records a new estimate to complete for one cost category (append-only). */
  async setEtc(ctx: RequestContext, projectId: string, input: EtcInput) {
    const data = parseInput(etcSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, projectId);
      requireProjectCommercial(ctx, project.id, "commercial.manage");
      const row = await repo.createEtc({ projectId: project.id, ...data, currency: ctx.company.defaultCurrency, createdById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "forecast.etc", entityType: "cost_forecast", entityId: row.id, projectId: project.id, after: { category: data.category, etcAmount: data.etcAmount, note: data.note } });
      return row;
    });
  },
};
