import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { canAccessProject, hasPermission, type RequestContext } from "@/platform/authz";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { requireCompanyPermission } from "./access";
import { CommercialRepo } from "./repo";
import { priceQuote, type QuoteStatus } from "./rules";
import {
  decisionSchema,
  noteSchema,
  outcomeSchema,
  quoteDraftSchema,
  quoteLineSchema,
  quoteSchema,
  reasonSchema,
  type DecisionInput,
  type OutcomeInput,
  type QuoteDraftInput,
  type QuoteInput,
  type QuoteLineInput,
} from "./schemas";

type Quote = NonNullable<Awaited<ReturnType<CommercialRepo["findQuote"]>>>;
type Version = Quote["versions"][number];

const s = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : d.toString());
const OPEN: QuoteStatus[] = ["DRAFT", "SUBMITTED"];
const LIVE: QuoteStatus[] = ["APPROVED", "SENT", "WON"];

function presentVersion(v: Version) {
  const p = priceQuote(v.lines, v);
  return {
    ...v,
    overheadPct: v.overheadPct.toString(),
    riskPct: v.riskPct.toString(),
    marginPct: v.marginPct.toString(),
    lines: v.lines.map((l) => ({ ...l, quantity: l.quantity.toString(), unitCost: l.unitCost.toString(), amount: l.quantity.times(l.unitCost).toDecimalPlaces(2).toString() })),
    pricing: {
      byCategory: Object.fromEntries(Object.entries(p.byCategory).map(([k, v2]) => [k, v2.toString()])),
      base: p.base.toString(),
      overhead: p.overhead.toString(),
      risk: p.risk.toString(),
      cost: p.cost.toString(),
      price: p.price.toString(),
      margin: p.margin.toString(),
      marginPct: s(p.marginPct),
    },
  };
}

async function load(repo: CommercialRepo, ctx: RequestContext, quoteId: string) {
  requireCompanyPermission(ctx, "commercial.view");
  const q = await repo.findQuote(quoteId);
  if (!q) throw new NotFoundError();
  return q;
}

const openVersion = (q: Quote) => q.versions.find((v) => OPEN.includes(v.status)) ?? null;
const liveVersion = (q: Quote) => q.versions.find((v) => LIVE.includes(v.status)) ?? null;

function can(ctx: RequestContext, q: Quote) {
  const manage = hasPermission(ctx, "commercial.manage");
  const approve = hasPermission(ctx, "commercial.approve");
  const open = openVersion(q);
  const live = liveVersion(q);
  const latest = q.versions[0];
  return {
    edit: manage && open?.status === "DRAFT",
    submit: manage && open?.status === "DRAFT" && open.lines.length > 0,
    returnToDraft: open?.status === "SUBMITTED" && (manage || approve),
    decide: approve && open?.status === "SUBMITTED" && open.submittedById !== ctx.user.id && open.createdById !== ctx.user.id,
    selfApprovalBlocked: approve && open?.status === "SUBMITTED" && (open.submittedById === ctx.user.id || open.createdById === ctx.user.id),
    send: manage && live?.status === "APPROVED" && !open,
    outcome: manage && live?.status === "SENT",
    revise: manage && !open && !!latest && ["APPROVED", "SENT", "REJECTED"].includes(latest.status),
  };
}

export const quoteService = {
  async list(ctx: RequestContext) {
    requireCompanyPermission(ctx, "commercial.view");
    const rows = await new CommercialRepo(readClient(), ctx.company.id).listQuotes();
    return rows.map((q) => {
      const latest = q.versions[0];
      return { id: q.id, quoteNumber: q.quoteNumber, title: q.title, customer: q.customer, project: q.project, currency: q.currency, versionNumber: latest?.versionNumber ?? null, status: latest?.status ?? null, price: latest ? priceQuote(latest.lines, latest).price.toString() : "0", validUntil: latest?.validUntil ?? null };
    });
  },

  async get(ctx: RequestContext, quoteId: string) {
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    const q = await load(repo, ctx, quoteId);
    const ids = new Set<string>();
    for (const v of q.versions) for (const id of [v.createdById, v.submittedById, v.decidedById]) if (id) ids.add(id);
    return {
      id: q.id,
      quoteNumber: q.quoteNumber,
      title: q.title,
      currency: q.currency,
      customer: q.customer,
      opportunity: q.opportunity,
      project: q.project && canAccessProject(ctx, q.project.id) ? q.project : null,
      versions: q.versions.map(presentVersion),
      users: await repo.findUsers([...ids]),
      can: can(ctx, q),
      today: todayInDisplayZone(),
    };
  },

  /** New quote with an empty draft v1; numbered TAR-<year>-<nnn> per company. */
  async create(ctx: RequestContext, input: QuoteInput) {
    requireCompanyPermission(ctx, "commercial.manage");
    const data = parseInput(quoteSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const customer = await repo.findCustomer(data.customerId);
      if (!customer || customer.archivedAt) throw new ValidationError({ customerId: ["validation.invalidOption"] });
      if (data.opportunityId) {
        const o = await repo.findOpportunity(data.opportunityId);
        if (!o || o.customerId !== customer.id) throw new ValidationError({ opportunityId: ["validation.invalidOption"] });
      }
      if (data.projectId) {
        const p = await repo.findProject(data.projectId);
        if (!p || !canAccessProject(ctx, p.id)) throw new ValidationError({ projectId: ["validation.invalidOption"] });
      }
      const prefix = `TAR-${todayInDisplayZone().slice(0, 4)}-`;
      const n = (await repo.countQuotesWithPrefix(prefix)) + 1;
      let q;
      try {
        q = await repo.createQuote({ ...data, quoteNumber: `${prefix}${String(n).padStart(3, "0")}`, currency: ctx.company.defaultCurrency, createdById: ctx.user.id, updatedById: ctx.user.id });
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ _form: ["validation.tryAgain"] });
        throw e;
      }
      const v = await repo.createQuoteVersion({ quoteId: q.id, versionNumber: 1, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "quote.create", entityType: "quote", entityId: q.id, after: { ...q, versionId: v.id } });
      return q;
    });
  },

  async updateDraft(ctx: RequestContext, quoteId: string, input: QuoteDraftInput) {
    const data = parseInput(quoteDraftSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const q = await load(repo, ctx, quoteId);
      requireCompanyPermission(ctx, "commercial.manage");
      const open = openVersion(q);
      if (open?.status !== "DRAFT") throw new ValidationError({ _form: ["validation.versionNotDraft"] });
      const after = await repo.updateQuoteVersion(open.id, { ...data, updatedById: ctx.user.id });
      const { lines: _l, contract: _c, ...before } = open;
      await writeAudit(tx, ctx, { action: "quote.update", entityType: "quote_version", entityId: open.id, before, after, diff: true });
      return after;
    });
  },

  async addLine(ctx: RequestContext, quoteId: string, input: QuoteLineInput) {
    const data = parseInput(quoteLineSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const q = await load(repo, ctx, quoteId);
      requireCompanyPermission(ctx, "commercial.manage");
      const open = openVersion(q);
      if (open?.status !== "DRAFT") throw new ValidationError({ _form: ["validation.versionNotDraft"] });
      const line = await repo.createQuoteLine({ versionId: open.id, ...data, sortOrder: open.lines.length, createdById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "quote.line_add", entityType: "quote_version", entityId: open.id, after: { lineId: line.id, ...data } });
      return line;
    });
  },

  async removeLine(ctx: RequestContext, quoteId: string, lineId: string) {
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const q = await load(repo, ctx, quoteId);
      requireCompanyPermission(ctx, "commercial.manage");
      const open = openVersion(q);
      const line = open?.lines.find((l) => l.id === lineId);
      if (!open || !line) throw new NotFoundError();
      if (open.status !== "DRAFT") throw new ValidationError({ _form: ["validation.versionNotDraft"] });
      await repo.deleteQuoteLine(line.id);
      await writeAudit(tx, ctx, { action: "quote.line_remove", entityType: "quote_version", entityId: open.id, before: { lineId: line.id, description: line.description, quantity: line.quantity, unitCost: line.unitCost } });
    });
  },

  async submit(ctx: RequestContext, quoteId: string) {
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const q = await load(repo, ctx, quoteId);
      if (!can(ctx, q).submit) {
        if (openVersion(q)?.status === "DRAFT" && openVersion(q)!.lines.length === 0) throw new ValidationError({ _form: ["validation.quoteEmpty"] });
        throw new ForbiddenError("Cannot submit this quote");
      }
      const open = openVersion(q)!;
      await repo.updateQuoteVersion(open.id, { status: "SUBMITTED", submittedAt: new Date(), submittedById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "quote.submit", entityType: "quote_version", entityId: open.id, before: { status: "DRAFT" }, after: { status: "SUBMITTED", price: priceQuote(open.lines, open).price.toString() } });
    });
  },

  async returnToDraft(ctx: RequestContext, quoteId: string, input: { note?: string | null } = {}) {
    const data = parseInput(noteSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const q = await load(repo, ctx, quoteId);
      if (!can(ctx, q).returnToDraft) throw new ForbiddenError("Cannot return this quote");
      const open = openVersion(q)!;
      await repo.updateQuoteVersion(open.id, { status: "DRAFT", submittedAt: null, submittedById: null, decisionNote: data.note, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "quote.return", entityType: "quote_version", entityId: open.id, before: { status: "SUBMITTED" }, after: { status: "DRAFT", note: data.note } });
    });
  },

  /**
   * Approval by the Project Director (owner decision 3; commercial.approve,
   * also held by the CEO). Never by the author or submitter. Approving a
   * revision supersedes the earlier approved or sent version.
   */
  async decide(ctx: RequestContext, quoteId: string, input: DecisionInput) {
    const data = parseInput(decisionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const q = await load(repo, ctx, quoteId);
      requireCompanyPermission(ctx, "commercial.approve");
      const open = openVersion(q);
      if (open?.status !== "SUBMITTED") throw new ValidationError({ _form: ["validation.versionNotSubmitted"] });
      if (open.submittedById === ctx.user.id || open.createdById === ctx.user.id) throw new ValidationError({ _form: ["validation.commercialSelfApproval"] });
      if (data.decision === "APPROVE") {
        const live = liveVersion(q);
        if (live?.status === "WON") throw new ValidationError({ _form: ["validation.quoteClosed"] });
        if (live) await repo.updateQuoteVersion(live.id, { status: "SUPERSEDED", updatedById: ctx.user.id });
        await repo.updateQuoteVersion(open.id, { status: "APPROVED", decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: data.note, updatedById: ctx.user.id });
      } else {
        await repo.updateQuoteVersion(open.id, { status: "REJECTED", decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: data.note, updatedById: ctx.user.id });
      }
      await writeAudit(tx, ctx, {
        action: data.decision === "APPROVE" ? "quote.approve" : "quote.reject",
        entityType: "quote_version",
        entityId: open.id,
        before: { status: "SUBMITTED" },
        after: { status: data.decision === "APPROVE" ? "APPROVED" : "REJECTED", versionNumber: open.versionNumber, price: priceQuote(open.lines, open).price.toString(), note: data.note },
      });
      return { status: data.decision === "APPROVE" ? "APPROVED" : "REJECTED" };
    });
  },

  async markSent(ctx: RequestContext, quoteId: string) {
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const q = await load(repo, ctx, quoteId);
      if (!can(ctx, q).send) throw new ForbiddenError("Cannot send this quote");
      const live = liveVersion(q)!;
      await repo.updateQuoteVersion(live.id, { status: "SENT", sentAt: new Date(), updatedById: ctx.user.id });
      if (q.opportunity && ["LEAD", "QUALIFIED", "RFQ"].includes(q.opportunity.stage)) await repo.updateOpportunity(q.opportunity.id, { stage: "TENDER", updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "quote.send", entityType: "quote_version", entityId: live.id, before: { status: "APPROVED" }, after: { status: "SENT" } });
    });
  },

  /**
   * Customer's answer. A won quote becomes a contract on the chosen project
   * (value = quote price) and the opportunity is marked won.
   */
  async recordOutcome(ctx: RequestContext, quoteId: string, input: OutcomeInput) {
    const data = parseInput(outcomeSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const q = await load(repo, ctx, quoteId);
      if (!can(ctx, q).outcome) throw new ForbiddenError("Cannot record the outcome");
      const live = liveVersion(q)!;
      let contractId: string | null = null;
      if (data.outcome === "WON") {
        const project = await repo.findProject(data.projectId!);
        if (!project || !canAccessProject(ctx, project.id)) throw new ValidationError({ projectId: ["validation.invalidOption"] });
        const price = priceQuote(live.lines, live).price;
        try {
          const c = await repo.createContract({
            customerId: q.customer.id,
            projectId: project.id,
            quoteVersionId: live.id,
            contractNumber: data.contractNumber ?? q.quoteNumber.replace(/^TAR-/, "SOP-"),
            title: q.title,
            value: price,
            currency: q.currency,
            signedDate: data.signedDate,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          });
          contractId = c.id;
        } catch (e) {
          if (isUniqueViolation(e)) throw new ValidationError({ contractNumber: ["validation.codeTaken"] });
          throw e;
        }
        if (!project.customerId) await repo.updateProject(project.id, { customerId: q.customer.id, updatedById: ctx.user.id });
        if (!q.project) await repo.updateQuote(q.id, { projectId: project.id, updatedById: ctx.user.id });
      }
      await repo.updateQuoteVersion(live.id, { status: data.outcome, outcomeAt: new Date(), outcomeNote: data.note, updatedById: ctx.user.id });
      if (q.opportunity) await repo.updateOpportunity(q.opportunity.id, { stage: data.outcome, lostReason: data.outcome === "LOST" ? data.note : null, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: data.outcome === "WON" ? "quote.won" : "quote.lost", entityType: "quote_version", entityId: live.id, before: { status: "SENT" }, after: { status: data.outcome, contractId, note: data.note } });
      return { contractId };
    });
  },

  /** A change after submission is a new draft version copied from the latest. */
  async revise(ctx: RequestContext, quoteId: string, input: { reason: string }) {
    const data = parseInput(reasonSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const q = await load(repo, ctx, quoteId);
      if (!can(ctx, q).revise) throw new ForbiddenError("Cannot revise this quote");
      const src = q.versions[0];
      const v = await repo.createQuoteVersion({
        quoteId: q.id,
        versionNumber: src.versionNumber + 1,
        scope: src.scope,
        overheadPct: src.overheadPct,
        riskPct: src.riskPct,
        marginPct: src.marginPct,
        validUntil: src.validUntil,
        changeReason: data.reason,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      for (const l of src.lines) await repo.createQuoteLine({ versionId: v.id, category: l.category, description: l.description, quantity: l.quantity, unit: l.unit, unitCost: l.unitCost, sortOrder: l.sortOrder, createdById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "quote.revise", entityType: "quote_version", entityId: v.id, after: { versionNumber: v.versionNumber, from: src.versionNumber, reason: data.reason } });
      return v;
    });
  },
};

