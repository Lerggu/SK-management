import { Prisma } from "@prisma/client";
import type { Tx } from "@/platform/db";
import type { LeadStatus, MarketingCategory } from "./rules";

const leadListSelect = {
  id: true,
  title: true,
  category: true,
  stage: true,
  status: true,
  country: true,
  location: true,
  ownerOrg: true,
  timing: true,
  budget: true,
  currency: true,
  budgetText: true,
  fitScore: true,
  services: true,
  lastSeenAt: true,
  firstSeenAt: true,
  _count: { select: { contacts: { where: { archivedAt: null } }, messages: true, sources: true } },
} satisfies Prisma.MarketingLeadSelect;

/** Company-scoped data access of the marketing register (ADR 0032). */
export class MarketingRepo {
  constructor(
    private readonly tx: Tx,
    private readonly companyId: string,
  ) {}

  // ── settings ──
  getSettings() {
    return this.tx.marketingSettings.findUnique({ where: { companyId: this.companyId } });
  }

  upsertSettings(data: Omit<Prisma.MarketingSettingsUncheckedCreateInput, "companyId">) {
    return this.tx.marketingSettings.upsert({ where: { companyId: this.companyId }, create: { ...data, companyId: this.companyId }, update: data });
  }

  touchLastRun(at: Date) {
    return this.tx.marketingSettings.upsert({ where: { companyId: this.companyId }, create: { companyId: this.companyId, lastRunAt: at }, update: { lastRunAt: at } });
  }

  // ── leads ──
  listLeads(filter: { status?: LeadStatus | null; category?: MarketingCategory | null; q?: string | null; minScore?: number | null; includeClosed?: boolean }) {
    const where: Prisma.MarketingLeadWhereInput = { companyId: this.companyId, archivedAt: null };
    if (filter.status) where.status = filter.status;
    else if (!filter.includeClosed) where.status = { notIn: ["DISCARDED", "NOT_INTERESTED", "CONVERTED"] };
    if (filter.category) where.category = filter.category;
    if (filter.minScore) where.fitScore = { gte: filter.minScore };
    if (filter.q) where.OR = [{ title: { contains: filter.q, mode: "insensitive" } }, { ownerOrg: { contains: filter.q, mode: "insensitive" } }, { location: { contains: filter.q, mode: "insensitive" } }];
    return this.tx.marketingLead.findMany({ where, select: leadListSelect, orderBy: [{ fitScore: "desc" }, { lastSeenAt: "desc" }], take: 300 });
  }

  findLead(id: string) {
    return this.tx.marketingLead.findFirst({
      where: { id, companyId: this.companyId, archivedAt: null },
      include: {
        sources: { orderBy: { retrievedAt: "desc" } },
        contacts: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
        messages: { orderBy: { createdAt: "desc" }, include: { contact: { select: { name: true, email: true, phone: true } } } },
        opportunity: { select: { id: true, title: true, stage: true } },
      },
    });
  }

  findLeadByKey(dedupeKey: string) {
    return this.tx.marketingLead.findUnique({ where: { companyId_dedupeKey: { companyId: this.companyId, dedupeKey } } });
  }

  createLead(data: Omit<Prisma.MarketingLeadUncheckedCreateInput, "companyId">) {
    return this.tx.marketingLead.create({ data: { ...data, companyId: this.companyId } });
  }

  updateLead(id: string, data: Prisma.MarketingLeadUncheckedUpdateInput) {
    return this.tx.marketingLead.update({ where: { companyId_id: { companyId: this.companyId, id } }, data });
  }

  /** Titles of recent leads, so the web search can skip what we already know. */
  async knownTitles(limit = 60) {
    const rows = await this.tx.marketingLead.findMany({ where: { companyId: this.companyId, archivedAt: null }, select: { title: true }, orderBy: { lastSeenAt: "desc" }, take: limit });
    return rows.map((r) => r.title);
  }

  // ── sources ──
  findSource(kind: "TED" | "HILMA" | "GRID" | "WEB" | "MANUAL", externalId: string) {
    return this.tx.marketingLeadSource.findUnique({ where: { companyId_kind_externalId: { companyId: this.companyId, kind, externalId } } });
  }

  createSource(data: Omit<Prisma.MarketingLeadSourceUncheckedCreateInput, "companyId">) {
    return this.tx.marketingLeadSource.create({ data: { ...data, companyId: this.companyId } });
  }

  // ── contacts ──
  findContact(id: string) {
    return this.tx.marketingContact.findFirst({ where: { id, companyId: this.companyId, archivedAt: null } });
  }

  findContactByEmail(leadId: string, email: string) {
    return this.tx.marketingContact.findFirst({ where: { companyId: this.companyId, leadId, email, archivedAt: null } });
  }

  createContact(data: Omit<Prisma.MarketingContactUncheckedCreateInput, "companyId">) {
    return this.tx.marketingContact.create({ data: { ...data, companyId: this.companyId } });
  }

  updateContact(id: string, data: Prisma.MarketingContactUncheckedUpdateInput) {
    return this.tx.marketingContact.update({ where: { companyId_id: { companyId: this.companyId, id } }, data });
  }

  // ── messages ──
  findMessage(id: string) {
    return this.tx.marketingMessage.findFirst({
      where: { id, companyId: this.companyId },
      include: { contact: true, lead: { select: { id: true, title: true, status: true } } },
    });
  }

  createMessage(data: Omit<Prisma.MarketingMessageUncheckedCreateInput, "companyId">) {
    return this.tx.marketingMessage.create({ data: { ...data, companyId: this.companyId } });
  }

  updateMessage(id: string, data: Prisma.MarketingMessageUncheckedUpdateInput) {
    return this.tx.marketingMessage.update({ where: { companyId_id: { companyId: this.companyId, id } }, data });
  }

  /** Atomically moves a message from one status to another; false when someone else got there first. */
  async claimMessage(id: string, from: ("APPROVED" | "FAILED" | "DRAFT")[], data: Prisma.MarketingMessageUncheckedUpdateInput) {
    const r = await this.tx.marketingMessage.updateMany({ where: { id, companyId: this.companyId, status: { in: from } }, data });
    return r.count === 1;
  }

  listMessages(statuses: ("DRAFT" | "APPROVED" | "SENDING" | "SENT" | "FAILED" | "REJECTED")[], take = 200) {
    return this.tx.marketingMessage.findMany({
      where: { companyId: this.companyId, status: { in: statuses } },
      include: { contact: { select: { name: true, role: true, organization: true, email: true, phone: true } }, lead: { select: { id: true, title: true, fitScore: true, country: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  /** Call list: sent letters whose contact has a phone number. */
  listCalls(take = 200) {
    return this.tx.marketingMessage.findMany({
      where: { companyId: this.companyId, status: "SENT", contact: { phone: { not: null }, archivedAt: null } },
      include: { contact: { select: { name: true, role: true, organization: true, email: true, phone: true } }, lead: { select: { id: true, title: true, status: true } } },
      orderBy: [{ callStatus: "asc" }, { sentAt: "desc" }],
      take,
    });
  }

  countSentSince(since: Date) {
    return this.tx.marketingMessage.count({ where: { companyId: this.companyId, sentAt: { gte: since } } });
  }

  approvedIds(take: number) {
    return this.tx.marketingMessage.findMany({ where: { companyId: this.companyId, status: { in: ["APPROVED", "FAILED"] }, attempts: { lt: 5 }, approvedAt: { not: null } }, select: { id: true }, orderBy: { approvedAt: "asc" }, take });
  }

  /**
   * Leads that need a letter: open, fit enough, with a contact that has an
   * e-mail address, is not suppressed and has no letter yet.
   */
  async contactsNeedingLetters(minScore: number, take: number) {
    const suppressed = (await this.tx.marketingSuppression.findMany({ where: { companyId: this.companyId }, select: { email: true } })).map((s) => s.email);
    return this.tx.marketingContact.findMany({
      where: {
        companyId: this.companyId,
        archivedAt: null,
        email: { not: null, ...(suppressed.length ? { notIn: suppressed } : {}) },
        messages: { none: {} },
        lead: { archivedAt: null, fitScore: { gte: minScore }, status: { in: ["NEW", "QUALIFIED"] } },
      },
      include: { lead: true },
      orderBy: { lead: { fitScore: "desc" } },
      take,
    });
  }

  // ── suppressions ──
  isSuppressed(email: string) {
    return this.tx.marketingSuppression.findUnique({ where: { companyId_email: { companyId: this.companyId, email } } }).then(Boolean);
  }

  suppress(email: string, reason: string) {
    return this.tx.marketingSuppression.upsert({ where: { companyId_email: { companyId: this.companyId, email } }, create: { companyId: this.companyId, email, reason }, update: {} });
  }

  listSuppressions() {
    return this.tx.marketingSuppression.findMany({ where: { companyId: this.companyId }, orderBy: { createdAt: "desc" }, take: 500 });
  }

  // ── runs and budget ──
  createRun(data: { kind: "DISCOVERY" | "DRAFT" | "SEND"; source?: string | null; startedById?: string | null }) {
    return this.tx.marketingRun.create({ data: { ...data, companyId: this.companyId } });
  }

  finishRun(id: string, data: Prisma.MarketingRunUncheckedUpdateInput) {
    return this.tx.marketingRun.update({ where: { companyId_id: { companyId: this.companyId, id } }, data: { ...data, finishedAt: new Date() } });
  }

  listRuns(take = 20) {
    return this.tx.marketingRun.findMany({ where: { companyId: this.companyId }, orderBy: { startedAt: "desc" }, take });
  }

  async costSinceUsd(since: Date) {
    const r = await this.tx.marketingRun.aggregate({ where: { companyId: this.companyId, startedAt: { gte: since } }, _sum: { costUsd: true } });
    return Number(r._sum.costUsd ?? 0);
  }

  // ── people ──
  /** Active members among `userIds` (reply recipients). */
  activeMembers(userIds: string[]) {
    if (!userIds.length) return Promise.resolve([]);
    return this.tx.companyMembership.findMany({ where: { companyId: this.companyId, userId: { in: userIds }, status: "ACTIVE" }, select: { user: { select: { id: true, name: true, email: true } } } });
  }

  listMembers() {
    return this.tx.companyMembership.findMany({ where: { companyId: this.companyId, status: { in: ["ACTIVE", "INVITED"] } }, select: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { email: "asc" } } });
  }

  getCompany() {
    return this.tx.company.findUnique({ where: { id: this.companyId }, select: { id: true, name: true, slug: true, organizationId: true } });
  }
}
