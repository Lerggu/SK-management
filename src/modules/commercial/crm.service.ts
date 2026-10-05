import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { hasPermission, type RequestContext } from "@/platform/authz";
import { D } from "@/modules/finance/calculations";
import { projectsWith, requireCompanyPermission } from "./access";
import { CommercialRepo } from "./repo";
import { OPPORTUNITY_STAGES, VARIATION_UNINVOICED_STATES, priceQuote, weightedPipeline } from "./rules";
import { contactSchema, customerListSchema, customerSchema, opportunityListSchema, opportunitySchema, type ContactInput, type CustomerInput, type OpportunityInput } from "./schemas";

const str = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : d.toString());

export const customerService = {
  async list(ctx: RequestContext, input: { q?: string | null; includeArchived?: boolean | string } = {}) {
    requireCompanyPermission(ctx, "crm.view");
    const data = parseInput(customerListSchema, input);
    return new CommercialRepo(readClient(), ctx.company.id).listCustomers(data);
  },

  async get(ctx: RequestContext, customerId: string) {
    requireCompanyPermission(ctx, "crm.view");
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    const c = await repo.findCustomer(customerId);
    if (!c) throw new NotFoundError();
    return { ...c, opportunities: c.opportunities.map((o) => ({ ...o, estimatedValue: str(o.estimatedValue) })), permissions: { manage: hasPermission(ctx, "crm.manage"), commercial: hasPermission(ctx, "commercial.view") } };
  },

  async create(ctx: RequestContext, input: CustomerInput) {
    requireCompanyPermission(ctx, "crm.manage");
    const data = parseInput(customerSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      try {
        const c = await repo.createCustomer({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "customer.create", entityType: "customer", entityId: c.id, after: c });
        return c;
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ name: ["validation.nameTaken"] });
        throw e;
      }
    });
  },

  async update(ctx: RequestContext, customerId: string, input: CustomerInput) {
    requireCompanyPermission(ctx, "crm.manage");
    const data = parseInput(customerSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const before = await repo.findCustomer(customerId);
      if (!before) throw new NotFoundError();
      try {
        const after = await repo.updateCustomer(before.id, { ...data, updatedById: ctx.user.id });
        const { contacts: _c, opportunities: _o, projects: _p, ...plain } = before;
        await writeAudit(tx, ctx, { action: "customer.update", entityType: "customer", entityId: after.id, before: plain, after, diff: true });
        return after;
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ name: ["validation.nameTaken"] });
        throw e;
      }
    });
  },

  async archive(ctx: RequestContext, customerId: string) {
    requireCompanyPermission(ctx, "crm.manage");
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const before = await repo.findCustomer(customerId);
      if (!before) throw new NotFoundError();
      const after = await repo.updateCustomer(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "customer.archive", entityType: "customer", entityId: after.id, before: { archivedAt: null }, after: { archivedAt: after.archivedAt } });
      return after;
    });
  },

  async addContact(ctx: RequestContext, customerId: string, input: ContactInput) {
    requireCompanyPermission(ctx, "crm.manage");
    const data = parseInput(contactSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const c = await repo.findCustomer(customerId);
      if (!c) throw new NotFoundError();
      const contact = await repo.createContact({ customerId: c.id, ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
      // Contact details are personal data: the audit keeps the name only.
      await writeAudit(tx, ctx, { action: "contact.create", entityType: "contact", entityId: contact.id, after: { customerId: c.id, name: contact.name } });
      return contact;
    });
  },

  async archiveContact(ctx: RequestContext, contactId: string) {
    requireCompanyPermission(ctx, "crm.manage");
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const before = await repo.findContact(contactId);
      if (!before) throw new NotFoundError();
      await repo.updateContact(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "contact.archive", entityType: "contact", entityId: before.id, before: { name: before.name } });
    });
  },
};

export const opportunityService = {
  /** The pipeline, with the weighted value of open opportunities. */
  async list(ctx: RequestContext, input: { stage?: string; customerId?: string | null } = {}) {
    requireCompanyPermission(ctx, "crm.view");
    const data = parseInput(opportunityListSchema, input);
    const rows = await new CommercialRepo(readClient(), ctx.company.id).listOpportunities(data);
    const byStage = OPPORTUNITY_STAGES.map((stage) => {
      const r = rows.filter((o) => o.stage === stage);
      return { stage, count: r.length, value: r.reduce((s, o) => s.plus(o.estimatedValue ?? 0), D(0)).toString() };
    });
    return {
      rows: rows.map((o) => ({ ...o, estimatedValue: str(o.estimatedValue) })),
      byStage,
      weighted: weightedPipeline(rows.map((o) => ({ stage: o.stage, estimatedValue: o.estimatedValue, probabilityPct: o.probabilityPct }))).toString(),
      permissions: { manage: hasPermission(ctx, "crm.manage") },
    };
  },

  async get(ctx: RequestContext, opportunityId: string) {
    requireCompanyPermission(ctx, "crm.view");
    const o = await new CommercialRepo(readClient(), ctx.company.id).findOpportunity(opportunityId);
    if (!o) throw new NotFoundError();
    return { ...o, estimatedValue: str(o.estimatedValue), permissions: { manage: hasPermission(ctx, "crm.manage") } };
  },

  async create(ctx: RequestContext, input: OpportunityInput) {
    requireCompanyPermission(ctx, "crm.manage");
    const data = parseInput(opportunitySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const customer = await repo.findCustomer(data.customerId);
      if (!customer || customer.archivedAt) throw new ValidationError({ customerId: ["validation.invalidOption"] });
      const o = await repo.createOpportunity({ ...data, currency: ctx.company.defaultCurrency, ownerUserId: ctx.user.id, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "opportunity.create", entityType: "opportunity", entityId: o.id, after: o });
      return o;
    });
  },

  async update(ctx: RequestContext, opportunityId: string, input: OpportunityInput) {
    requireCompanyPermission(ctx, "crm.manage");
    const data = parseInput(opportunitySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const before = await repo.findOpportunity(opportunityId);
      if (!before) throw new NotFoundError();
      if (data.customerId !== before.customerId) {
        const customer = await repo.findCustomer(data.customerId);
        if (!customer) throw new ValidationError({ customerId: ["validation.invalidOption"] });
      }
      const after = await repo.updateOpportunity(before.id, { ...data, lostReason: data.stage === "LOST" ? data.lostReason : null, updatedById: ctx.user.id });
      const { customer: _c, quotes: _q, ...plain } = before;
      await writeAudit(tx, ctx, { action: before.stage !== after.stage ? "opportunity.stage" : "opportunity.update", entityType: "opportunity", entityId: after.id, before: plain, after, diff: true });
      return after;
    });
  },
};

export const commercialDashboardService = {
  /**
   * Company commercial overview: weighted pipeline, quote stock (sent,
   * awaiting decision), approved-but-uninvoiced variations (§21) and open
   * invoice candidates. Money figures need commercial.view.
   */
  async summary(ctx: RequestContext) {
    requireCompanyPermission(ctx, "crm.view");
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    const opportunities = await repo.listOpportunities({});
    const result: {
      openOpportunities: number;
      weightedPipeline: string;
      quotes: { sentCount: number; sentValue: string; awaitingApproval: number } | null;
      uninvoicedVariations: { count: number; value: string } | null;
    } = {
      openOpportunities: opportunities.filter((o) => o.stage !== "WON" && o.stage !== "LOST").length,
      weightedPipeline: weightedPipeline(opportunities).toString(),
      quotes: null,
      uninvoicedVariations: null,
    };
    if (hasPermission(ctx, "commercial.view")) {
      const quotes = await repo.listQuotes();
      const sent = quotes.map((q) => q.versions.find((v) => v.status === "SENT")).filter((v): v is NonNullable<typeof v> => !!v);
      result.quotes = {
        sentCount: sent.length,
        sentValue: sent.reduce((s, v) => s.plus(priceQuote(v.lines, v).price), D(0)).toString(),
        awaitingApproval: quotes.filter((q) => q.versions.some((v) => v.status === "SUBMITTED")).length,
      };
      const variations = await repo.listVariations({ statuses: VARIATION_UNINVOICED_STATES, projectIds: projectsWith(ctx, "commercial.view") });
      result.uninvoicedVariations = { count: variations.length, value: variations.reduce((s, v) => s.plus(v.salesPrice), D(0)).toString() };
    }
    return result;
  },
};
