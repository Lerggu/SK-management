/**
 * Marketing register, letters and call list (ADR 0032). Company-wide
 * capabilities: marketing.view (read), marketing.manage (settings, agents,
 * register), marketing.approve (approve and send letters, call list).
 */
import { readClient, runInTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { hasPermission, type PermissionKey, type RequestContext } from "@/platform/authz";
import { MarketingRepo } from "./repo";
import { draftLetters, marketingBudget, runDiscovery, sendApproved, type MarketingScope } from "./agents";
import { dedupeKey, normaliseEmail, safeUrl } from "./rules";
import {
  callSchema,
  contactSchema,
  leadFilterSchema,
  leadSchema,
  manualLeadSchema,
  messageEditSchema,
  settingsSchema,
  suppressionSchema,
  type CallInput,
  type ContactInput,
  type LeadFilterInput,
  type LeadInput,
  type ManualLeadInput,
  type MessageEditInput,
  type SettingsInput,
  type SuppressionInput,
} from "./schemas";

function require(ctx: RequestContext, permission: PermissionKey) {
  if (ctx.external) throw new ForbiddenError("External members have no marketing access");
  if (!hasPermission(ctx, permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

export function marketingAccess(ctx: RequestContext) {
  const ok = (p: PermissionKey) => !ctx.external && hasPermission(ctx, p);
  return { view: ok("marketing.view"), manage: ok("marketing.manage"), approve: ok("marketing.approve") };
}

const scopeOf = (ctx: RequestContext): MarketingScope => ({ companyId: ctx.company.id, organizationId: ctx.company.organizationId });

async function leadOr404(repo: MarketingRepo, id: string) {
  const lead = await repo.findLead(id);
  if (!lead) throw new NotFoundError();
  return lead;
}

/** Background runs started from the UI (discovery can take minutes). */
const background = new Set<Promise<unknown>>();
function inBackground(p: Promise<unknown>) {
  const tracked = p.catch((e) => console.error("marketing run failed", e instanceof Error ? e.message : e)).finally(() => background.delete(tracked));
  background.add(tracked);
}

/** Waits for background runs (tests). */
export async function settleMarketingRuns() {
  await Promise.all([...background]);
}

export const marketingService = {
  async overview(ctx: RequestContext) {
    require(ctx, "marketing.view");
    const repo = new MarketingRepo(readClient(), ctx.company.id);
    const [settings, budget, runs, drafts, calls] = await Promise.all([
      repo.getSettings(),
      marketingBudget(repo),
      repo.listRuns(10),
      repo.listMessages(["DRAFT"], 500),
      repo.listCalls(500),
    ]);
    return {
      enabled: settings?.enabled ?? false,
      autoSend: settings?.autoSend ?? false,
      lastRunAt: settings?.lastRunAt ?? null,
      budget,
      runs,
      pendingApprovals: drafts.length,
      openCalls: calls.filter((c) => !c.callStatus || c.callStatus === "TODO" || c.callStatus === "NO_ANSWER").length,
    };
  },

  async listLeads(ctx: RequestContext, input: LeadFilterInput = {}) {
    require(ctx, "marketing.view");
    const filter = parseInput(leadFilterSchema, input);
    return new MarketingRepo(readClient(), ctx.company.id).listLeads(filter);
  },

  async getLead(ctx: RequestContext, leadId: string) {
    require(ctx, "marketing.view");
    const lead = await leadOr404(new MarketingRepo(readClient(), ctx.company.id), leadId);
    // Letters and call notes are for those who send them.
    return hasPermission(ctx, "marketing.approve") ? lead : { ...lead, messages: lead.messages.map((m) => ({ ...m, body: "", callScript: null, callNote: null })) };
  },

  async createLead(ctx: RequestContext, input: ManualLeadInput) {
    require(ctx, "marketing.manage");
    const data = parseInput(manualLeadSchema, input);
    const url = data.sourceUrl ? safeUrl(data.sourceUrl) : null;
    if (data.sourceUrl && !url) throw new ValidationError({ sourceUrl: ["validation.invalidFormat"] });
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      const key = dedupeKey({ country: data.country, title: data.title });
      if (await repo.findLeadByKey(key)) throw new ValidationError({ title: ["marketing.errors.duplicate"] });
      const lead = await repo.createLead({ dedupeKey: key, title: data.title, country: data.country, ownerOrg: data.ownerOrg, location: data.location, summary: data.summary, createdById: ctx.user.id, updatedById: ctx.user.id });
      await repo.createSource({ leadId: lead.id, kind: "MANUAL", externalId: url ?? `manual:${lead.id}`, url, title: data.title });
      await writeAudit(tx, ctx, { action: "marketing_lead.create", entityType: "marketing_lead", entityId: lead.id, after: { title: lead.title } });
      return lead;
    });
  },

  async updateLead(ctx: RequestContext, leadId: string, input: LeadInput) {
    require(ctx, "marketing.manage");
    const data = parseInput(leadSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      const before = await leadOr404(repo, leadId);
      if (data.status === "CONVERTED" && !before.opportunityId) throw new ValidationError({ status: ["marketing.errors.convertFirst"] });
      const after = await repo.updateLead(leadId, { ...data, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, {
        action: "marketing_lead.update",
        entityType: "marketing_lead",
        entityId: leadId,
        before: { title: before.title, status: before.status, fitScore: before.fitScore, stage: before.stage },
        after: { title: after.title, status: after.status, fitScore: after.fitScore, stage: after.stage },
        diff: true,
      });
      return after;
    });
  },

  /** Interested lead → CRM customer (found by name or created) and opportunity. */
  async convertToOpportunity(ctx: RequestContext, leadId: string) {
    require(ctx, "marketing.manage");
    require(ctx, "crm.manage");
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      const lead = await leadOr404(repo, leadId);
      if (lead.opportunityId) return { opportunityId: lead.opportunityId };
      const name = (lead.ownerOrg ?? lead.title).slice(0, 160);
      const customer =
        (await tx.customer.findFirst({ where: { companyId: ctx.company.id, name, archivedAt: null } })) ??
        (await tx.customer.create({ data: { companyId: ctx.company.id, name, city: lead.location?.slice(0, 80) ?? null, createdById: ctx.user.id, updatedById: ctx.user.id } }));
      const opportunity = await tx.opportunity.create({
        data: {
          companyId: ctx.company.id,
          customerId: customer.id,
          title: lead.title.slice(0, 200),
          stage: "LEAD",
          estimatedValue: lead.currency === "EUR" ? lead.budget : null,
          ownerUserId: ctx.user.id,
          notes: [lead.summary, lead.sources[0]?.url].filter(Boolean).join("\n").slice(0, 1000) || null,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
      });
      for (const c of lead.contacts.filter((c) => c.name)) {
        await tx.contact.create({ data: { companyId: ctx.company.id, customerId: customer.id, name: c.name!, title: c.role, email: c.email, phone: c.phone, createdById: ctx.user.id, updatedById: ctx.user.id } });
      }
      await repo.updateLead(leadId, { opportunityId: opportunity.id, status: "CONVERTED", updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "marketing_lead.convert", entityType: "marketing_lead", entityId: leadId, after: { opportunityId: opportunity.id, customerId: customer.id } });
      return { opportunityId: opportunity.id };
    });
  },

  async addContact(ctx: RequestContext, leadId: string, input: ContactInput) {
    require(ctx, "marketing.manage");
    const data = parseInput(contactSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      await leadOr404(repo, leadId);
      const c = await repo.createContact({ leadId, ...data, email: normaliseEmail(data.email), sourceUrl: safeUrl(data.sourceUrl), createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "marketing_contact.create", entityType: "marketing_contact", entityId: c.id, after: { leadId, name: c.name, email: c.email } });
      return c;
    });
  },

  async updateContact(ctx: RequestContext, contactId: string, input: ContactInput) {
    require(ctx, "marketing.manage");
    const data = parseInput(contactSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      const before = await repo.findContact(contactId);
      if (!before) throw new NotFoundError();
      const after = await repo.updateContact(contactId, { ...data, email: normaliseEmail(data.email), sourceUrl: safeUrl(data.sourceUrl), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "marketing_contact.update", entityType: "marketing_contact", entityId: contactId, before: { name: before.name, email: before.email, phone: before.phone }, after: { name: after.name, email: after.email, phone: after.phone }, diff: true });
      return after;
    });
  },

  async archiveContact(ctx: RequestContext, contactId: string) {
    require(ctx, "marketing.manage");
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      const c = await repo.findContact(contactId);
      if (!c) throw new NotFoundError();
      await repo.updateContact(contactId, { archivedAt: new Date(), updatedById: ctx.user.id });
      await tx.marketingMessage.updateMany({ where: { companyId: ctx.company.id, contactId, status: { in: ["DRAFT", "APPROVED", "FAILED"] } }, data: { status: "REJECTED" } });
      await writeAudit(tx, ctx, { action: "marketing_contact.archive", entityType: "marketing_contact", entityId: contactId });
    });
  },

  /** Starts discovery and drafting in the background (they can take minutes). */
  async startDiscovery(ctx: RequestContext, opts: { wait?: boolean } = {}) {
    require(ctx, "marketing.manage");
    const scope = scopeOf(ctx);
    const job = runDiscovery(scope, { userId: ctx.user.id }).then(() => draftLetters(scope, { userId: ctx.user.id }));
    await runInTransaction((tx) => writeAudit(tx, ctx, { action: "marketing.run", entityType: "marketing_settings", entityId: ctx.company.id }));
    if (opts.wait) return job;
    inBackground(job);
    return { started: true };
  },

  /** Drafts letters for the contacts of one lead now (regardless of the score threshold). */
  async draftForLead(ctx: RequestContext, leadId: string) {
    require(ctx, "marketing.manage");
    await leadOr404(new MarketingRepo(readClient(), ctx.company.id), leadId);
    return draftLetters(scopeOf(ctx), { userId: ctx.user.id, leadId });
  },

  async listMessages(ctx: RequestContext, input: { status?: "DRAFT" | "SENT" | "FAILED" | "REJECTED" | "APPROVED" } = {}) {
    require(ctx, "marketing.approve");
    const status = input.status ?? "DRAFT";
    if (!["DRAFT", "SENT", "FAILED", "REJECTED", "APPROVED"].includes(status)) throw new ValidationError({ status: ["validation.invalidOption"] });
    return new MarketingRepo(readClient(), ctx.company.id).listMessages(status === "SENT" ? ["SENT"] : status === "APPROVED" ? ["APPROVED", "SENDING"] : [status]);
  },

  async getMessage(ctx: RequestContext, messageId: string) {
    require(ctx, "marketing.approve");
    const m = await new MarketingRepo(readClient(), ctx.company.id).findMessage(messageId);
    if (!m) throw new NotFoundError();
    return m;
  },

  async updateMessage(ctx: RequestContext, messageId: string, input: MessageEditInput) {
    require(ctx, "marketing.approve");
    const data = parseInput(messageEditSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      const m = await repo.findMessage(messageId);
      if (!m) throw new NotFoundError();
      if (m.status !== "DRAFT") throw new ValidationError({ _form: ["marketing.errors.notDraft"] });
      await repo.updateMessage(messageId, { ...data, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "marketing_message.edit", entityType: "marketing_message", entityId: messageId });
    });
  },

  /** A person approves the letter; it is sent at once (within the daily limit) or by the scheduler. */
  async approveMessage(ctx: RequestContext, messageId: string) {
    require(ctx, "marketing.approve");
    await runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      const m = await repo.findMessage(messageId);
      if (!m) throw new NotFoundError();
      if (!(await repo.claimMessage(messageId, ["DRAFT"], { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.user.id, updatedById: ctx.user.id }))) {
        throw new ValidationError({ _form: ["marketing.errors.notDraft"] });
      }
      await writeAudit(tx, ctx, { action: "marketing_message.approve", entityType: "marketing_message", entityId: messageId, after: { leadId: m.leadId } });
    });
    const sent = await sendApproved(scopeOf(ctx), { userId: ctx.user.id, messageId });
    return { sent: sent.sent === 1, error: sent.error ?? null };
  },

  async rejectMessage(ctx: RequestContext, messageId: string) {
    require(ctx, "marketing.approve");
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      if (!(await repo.findMessage(messageId))) throw new NotFoundError();
      if (!(await repo.claimMessage(messageId, ["DRAFT", "APPROVED", "FAILED"], { status: "REJECTED", updatedById: ctx.user.id }))) throw new ValidationError({ _form: ["marketing.errors.notDraft"] });
      await writeAudit(tx, ctx, { action: "marketing_message.reject", entityType: "marketing_message", entityId: messageId });
    });
  },

  async callList(ctx: RequestContext) {
    require(ctx, "marketing.approve");
    return new MarketingRepo(readClient(), ctx.company.id).listCalls();
  },

  /** Outcome of a call; a meeting marks the lead interested, a refusal not interested. */
  async recordCall(ctx: RequestContext, messageId: string, input: CallInput) {
    require(ctx, "marketing.approve");
    const data = parseInput(callSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      const m = await repo.findMessage(messageId);
      if (!m || m.status !== "SENT") throw new NotFoundError();
      await repo.updateMessage(messageId, { callStatus: data.callStatus, callNote: data.callNote, calledAt: new Date(), calledById: ctx.user.id, updatedById: ctx.user.id });
      const open = !["CONVERTED", "DISCARDED"].includes(m.lead.status);
      if (open && data.callStatus === "MEETING") await repo.updateLead(m.leadId, { status: "INTERESTED" });
      if (open && data.callStatus === "NOT_INTERESTED") await repo.updateLead(m.leadId, { status: "NOT_INTERESTED" });
      await writeAudit(tx, ctx, { action: "marketing_message.call", entityType: "marketing_message", entityId: messageId, after: { callStatus: data.callStatus } });
    });
  },

  async getSettings(ctx: RequestContext) {
    require(ctx, "marketing.manage");
    const repo = new MarketingRepo(readClient(), ctx.company.id);
    const [settings, members, budget] = await Promise.all([repo.getSettings(), repo.listMembers(), marketingBudget(repo)]);
    return {
      settings: settings ?? (await repo.upsertSettings({})),
      members: members.map((m) => m.user),
      budget,
    };
  },

  async updateSettings(ctx: RequestContext, input: SettingsInput) {
    require(ctx, "marketing.manage");
    const data = parseInput(settingsSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      const active = await repo.activeMembers(data.replyToUserIds);
      if (active.length !== new Set(data.replyToUserIds).size) throw new ValidationError({ replyToUserIds: ["validation.invalidOption"] });
      if (data.enabled && !data.replyToUserIds.length) throw new ValidationError({ replyToUserIds: ["marketing.errors.noReplyTo"] });
      const before = await repo.getSettings();
      const after = await repo.upsertSettings({ ...data, aiMonthlyBudgetEur: data.aiMonthlyBudgetEur.toFixed(2), updatedById: ctx.user.id });
      const view = (s: typeof after | null) => (s ? { enabled: s.enabled, autoSend: s.autoSend, countries: s.countries.join(","), minScore: s.minScore, dailySendLimit: s.dailySendLimit, intervalHours: s.intervalHours, aiMonthlyBudgetEur: String(s.aiMonthlyBudgetEur), replyTo: s.replyToUserIds.length } : null);
      await writeAudit(tx, ctx, { action: "marketing.settings_update", entityType: "marketing_settings", entityId: ctx.company.id, before: view(before), after: view(after), diff: !!before });
      return after;
    });
  },

  async listSuppressions(ctx: RequestContext) {
    require(ctx, "marketing.manage");
    return new MarketingRepo(readClient(), ctx.company.id).listSuppressions();
  },

  /** Adds an address to the do-not-contact list (e.g. a reply asking to stop). */
  async addSuppression(ctx: RequestContext, input: SuppressionInput) {
    require(ctx, "marketing.manage");
    const data = parseInput(suppressionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new MarketingRepo(tx, ctx.company.id);
      await repo.suppress(data.email, "MANUAL");
      await tx.marketingMessage.updateMany({ where: { companyId: ctx.company.id, status: { in: ["DRAFT", "APPROVED", "FAILED"] }, contact: { email: data.email } }, data: { status: "REJECTED", error: "marketing.errors.suppressed" } });
      await writeAudit(tx, ctx, { action: "marketing.suppress", entityType: "marketing_settings", entityId: ctx.company.id, after: { email: data.email } });
    });
  },
};
