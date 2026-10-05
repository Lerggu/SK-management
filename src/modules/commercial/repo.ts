import type { Prisma, Tx } from "@/platform/db";

type Create<T> = Omit<T, "companyId">;

const versionInclude = { lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, contract: { select: { id: true, contractNumber: true, projectId: true } } } satisfies Prisma.QuoteVersionInclude;

/** Company-scoped V6 repository: every query carries company_id. */
export class CommercialRepo {
  constructor(
    readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
  }

  findCompany(id: string) {
    return this.tx.company.findUnique({ where: { id }, select: { id: true, name: true, businessId: true, organizationId: true, defaultCurrency: true } });
  }

  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, ...this.c }, include: { customer: { select: { id: true, name: true, businessId: true } } } });
  }

  listProjects(projectIds: string[] | undefined) {
    return this.tx.project.findMany({ where: { ...this.c, archivedAt: null, ...(projectIds ? { id: { in: projectIds } } : {}) }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, customerId: true } });
  }

  updateProject(id: string, data: Prisma.ProjectUncheckedUpdateInput) {
    return this.tx.project.update({ where: { id, companyId: this.companyId }, data });
  }

  findDocument(id: string) {
    return this.tx.document.findFirst({ where: { id, ...this.c, archivedAt: null } });
  }

  listDocuments(projectId: string) {
    return this.tx.document.findMany({ where: { ...this.c, archivedAt: null, projectId }, orderBy: { title: "asc" }, select: { id: true, title: true, documentNumber: true } });
  }

  findUsers(ids: string[]) {
    return this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  }

  // ── customers ─────────────────────────────────────────────────────
  listCustomers(where: { q?: string | null; includeArchived?: boolean }) {
    return this.tx.customer.findMany({
      where: { ...this.c, ...(where.includeArchived ? {} : { archivedAt: null }), ...(where.q ? { OR: [{ name: { contains: where.q, mode: "insensitive" } }, { businessId: { contains: where.q } }, { city: { contains: where.q, mode: "insensitive" } }] } : {}) },
      orderBy: { name: "asc" },
      include: { _count: { select: { opportunities: true, projects: true } } },
    });
  }

  findCustomer(id: string) {
    return this.tx.customer.findFirst({
      where: { id, ...this.c },
      include: {
        contacts: { where: { archivedAt: null }, orderBy: { name: "asc" } },
        opportunities: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
        projects: { where: { archivedAt: null }, select: { id: true, code: true, name: true, status: true } },
      },
    });
  }

  createCustomer(data: Create<Prisma.CustomerUncheckedCreateInput>) {
    return this.tx.customer.create({ data: { ...data, ...this.c } });
  }

  updateCustomer(id: string, data: Prisma.CustomerUncheckedUpdateInput) {
    return this.tx.customer.update({ where: { id, companyId: this.companyId }, data });
  }

  findContact(id: string) {
    return this.tx.contact.findFirst({ where: { id, ...this.c } });
  }

  createContact(data: Create<Prisma.ContactUncheckedCreateInput>) {
    return this.tx.contact.create({ data: { ...data, ...this.c } });
  }

  updateContact(id: string, data: Prisma.ContactUncheckedUpdateInput) {
    return this.tx.contact.update({ where: { id, companyId: this.companyId }, data });
  }

  // ── opportunities ─────────────────────────────────────────────────
  listOpportunities(where: { stage?: string; customerId?: string | null }) {
    return this.tx.opportunity.findMany({
      where: { ...this.c, archivedAt: null, ...(where.stage ? { stage: where.stage as never } : {}), ...(where.customerId ? { customerId: where.customerId } : {}) },
      orderBy: [{ expectedCloseDate: "asc" }, { createdAt: "desc" }],
      include: { customer: { select: { id: true, name: true } } },
    });
  }

  findOpportunity(id: string) {
    return this.tx.opportunity.findFirst({ where: { id, ...this.c }, include: { customer: { select: { id: true, name: true } }, quotes: { select: { id: true, quoteNumber: true, title: true } } } });
  }

  createOpportunity(data: Create<Prisma.OpportunityUncheckedCreateInput>) {
    return this.tx.opportunity.create({ data: { ...data, ...this.c } });
  }

  updateOpportunity(id: string, data: Prisma.OpportunityUncheckedUpdateInput) {
    return this.tx.opportunity.update({ where: { id, companyId: this.companyId }, data });
  }

  // ── quotes ────────────────────────────────────────────────────────
  listQuotes() {
    return this.tx.quote.findMany({
      where: { ...this.c, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { customer: { select: { id: true, name: true } }, project: { select: { id: true, code: true } }, versions: { orderBy: { versionNumber: "desc" }, include: { lines: true } } },
    });
  }

  findQuote(id: string) {
    return this.tx.quote.findFirst({
      where: { id, ...this.c },
      include: {
        customer: { select: { id: true, name: true, businessId: true } },
        opportunity: { select: { id: true, title: true, stage: true } },
        project: { select: { id: true, code: true, name: true } },
        versions: { orderBy: { versionNumber: "desc" }, include: versionInclude },
      },
    });
  }

  countQuotesWithPrefix(prefix: string) {
    return this.tx.quote.count({ where: { ...this.c, quoteNumber: { startsWith: prefix } } });
  }

  createQuote(data: Create<Prisma.QuoteUncheckedCreateInput>) {
    return this.tx.quote.create({ data: { ...data, ...this.c } });
  }

  updateQuote(id: string, data: Prisma.QuoteUncheckedUpdateInput) {
    return this.tx.quote.update({ where: { id, companyId: this.companyId }, data });
  }

  createQuoteVersion(data: Create<Prisma.QuoteVersionUncheckedCreateInput>) {
    return this.tx.quoteVersion.create({ data: { ...data, ...this.c } });
  }

  updateQuoteVersion(id: string, data: Prisma.QuoteVersionUncheckedUpdateInput) {
    return this.tx.quoteVersion.update({ where: { id, companyId: this.companyId }, data });
  }

  createQuoteLine(data: Create<Prisma.QuoteLineUncheckedCreateInput>) {
    return this.tx.quoteLine.create({ data: { ...data, ...this.c } });
  }

  findQuoteLine(id: string) {
    return this.tx.quoteLine.findFirst({ where: { id, ...this.c } });
  }

  deleteQuoteLine(id: string) {
    return this.tx.quoteLine.deleteMany({ where: { id, ...this.c } });
  }

  // ── contracts ─────────────────────────────────────────────────────
  listContracts(projectId: string) {
    return this.tx.contract.findMany({ where: { ...this.c, projectId }, orderBy: { createdAt: "asc" }, include: { customer: { select: { id: true, name: true } }, milestones: { orderBy: { dueDate: "asc" } } } });
  }

  findContract(id: string) {
    return this.tx.contract.findFirst({ where: { id, ...this.c }, include: { customer: { select: { id: true, name: true } }, milestones: { orderBy: { dueDate: "asc" } }, project: { select: { id: true, code: true, name: true } } } });
  }

  createContract(data: Create<Prisma.ContractUncheckedCreateInput>) {
    return this.tx.contract.create({ data: { ...data, ...this.c } });
  }

  updateContract(id: string, data: Prisma.ContractUncheckedUpdateInput) {
    return this.tx.contract.update({ where: { id, companyId: this.companyId }, data });
  }

  createMilestone(data: Create<Prisma.ContractMilestoneUncheckedCreateInput>) {
    return this.tx.contractMilestone.create({ data: { ...data, ...this.c } });
  }

  // ── variations ────────────────────────────────────────────────────
  listVariations(where: { projectId?: string; projectIds?: string[]; statuses?: readonly string[] }) {
    return this.tx.variation.findMany({
      where: { ...this.c, ...(where.projectId ? { projectId: where.projectId } : {}), ...(where.projectIds ? { projectId: { in: where.projectIds } } : {}), ...(where.statuses ? { status: { in: where.statuses as never } } : {}) },
      orderBy: [{ projectId: "asc" }, { number: "asc" }],
      include: { project: { select: { id: true, code: true, name: true } } },
    });
  }

  findVariation(id: string) {
    return this.tx.variation.findFirst({ where: { id, ...this.c }, include: { project: { select: { id: true, code: true, name: true } }, contract: { select: { id: true, contractNumber: true } }, evidenceDocument: { select: { id: true, title: true } } } });
  }

  async nextVariationNumber(projectId: string) {
    const agg = await this.tx.variation.aggregate({ where: { ...this.c, projectId }, _max: { number: true } });
    return (agg._max.number ?? 0) + 1;
  }

  createVariation(data: Create<Prisma.VariationUncheckedCreateInput>) {
    return this.tx.variation.create({ data: { ...data, ...this.c } });
  }

  updateVariation(id: string, data: Prisma.VariationUncheckedUpdateInput) {
    return this.tx.variation.update({ where: { id, companyId: this.companyId }, data });
  }

  // ── invoicing sources ─────────────────────────────────────────────
  billableTimeEntries(projectId: string, to: Date) {
    return this.tx.timeEntry.findMany({
      where: { ...this.c, projectId, status: { in: ["APPROVED", "EXPORTED"] }, workDate: { lte: to } },
      orderBy: [{ workDate: "asc" }],
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  billableEquipmentHours(projectId: string, to: Date) {
    return this.tx.dailyReportEntry.findMany({
      where: { ...this.c, kind: "EQUIPMENT", equipmentId: { not: null }, hours: { not: null }, dailyReport: { projectId, status: "SIGNED", reportDate: { lte: to } } },
      include: { equipment: { select: { id: true, assetNumber: true, name: true } }, dailyReport: { select: { reportDate: true } } },
    });
  }

  // ── V7: client approvals ──────────────────────────────────────────
  createClientApproval(data: Create<Prisma.VariationClientApprovalUncheckedCreateInput>) {
    return this.tx.variationClientApproval.create({ data: { ...data, ...this.c } });
  }

  findPendingClientApproval(variationId: string) {
    return this.tx.variationClientApproval.findFirst({ where: { ...this.c, variationId, decision: "PENDING" } });
  }

  findClientApproval(id: string) {
    return this.tx.variationClientApproval.findFirst({ where: { id, ...this.c }, include: { project: { select: { id: true, code: true, name: true } } } });
  }

  listClientApprovals(where: { projectId?: string; variationId?: string }) {
    return this.tx.variationClientApproval.findMany({ where: { ...this.c, ...where }, orderBy: { sentAt: "desc" }, include: { project: { select: { id: true, code: true, name: true } } } });
  }

  /** Decides a PENDING approval once (conditional update; the DB trigger enforces it too). */
  decideClientApproval(id: string, data: Prisma.VariationClientApprovalUncheckedUpdateManyInput) {
    return this.tx.variationClientApproval.updateMany({ where: { id, ...this.c, decision: "PENDING" }, data });
  }

  readyVariations(projectId: string) {
    return this.tx.variation.findMany({ where: { ...this.c, projectId, status: "READY_TO_INVOICE" }, orderBy: { number: "asc" } });
  }

  dueMilestones(projectId: string, to: Date) {
    return this.tx.contractMilestone.findMany({ where: { ...this.c, dueDate: { lte: to }, contract: { projectId } }, include: { contract: { select: { contractNumber: true, customerId: true } } } });
  }

  /** Approved bookings of this company's resources made by other group companies (owner decision 2). */
  internalBookings(to: Date) {
    return this.tx.resourceBooking.findMany({
      where: { ownerCompanyId: this.companyId, companyId: { not: this.companyId }, status: "APPROVED", endsAt: { lte: to } },
      orderBy: { startsAt: "asc" },
      include: {
        company: { select: { id: true, name: true } },
        project: { select: { code: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        equipment: { select: { id: true, assetNumber: true, name: true } },
      },
    });
  }

  employeeBillingRates(ids: string[]) {
    return this.tx.employeeRate.findMany({ where: { ...this.c, employeeId: { in: ids }, rateType: "BILLING", archivedAt: null } });
  }

  equipmentBillingRates(ids: string[]) {
    return this.tx.equipmentRate.findMany({ where: { ...this.c, equipmentId: { in: ids }, rateType: "BILLING", archivedAt: null } });
  }

  existingSources(sourceType: string, sourceIds: string[]) {
    return this.tx.invoiceCandidate.findMany({ where: { ...this.c, sourceType: sourceType as never, sourceId: { in: sourceIds }, status: { not: "VOID" } }, select: { sourceId: true } });
  }

  // ── candidates and exports ────────────────────────────────────────
  createCandidates(rows: Create<Prisma.InvoiceCandidateUncheckedCreateInput>[]) {
    return this.tx.invoiceCandidate.createMany({ data: rows.map((r) => ({ ...r, ...this.c })), skipDuplicates: true });
  }

  listCandidates(where: { projectId?: string; projectIds?: string[]; status?: string; internal: boolean; ids?: string[] }) {
    return this.tx.invoiceCandidate.findMany({
      where: {
        ...this.c,
        sourceType: where.internal ? "INTERNAL_BOOKING" : { not: "INTERNAL_BOOKING" },
        ...(where.projectId ? { projectId: where.projectId } : {}),
        ...(where.projectIds ? { projectId: { in: where.projectIds } } : {}),
        ...(where.status ? { status: where.status as never } : {}),
        ...(where.ids ? { id: { in: where.ids } } : {}),
      },
      orderBy: [{ periodDate: "asc" }, { createdAt: "asc" }],
      take: 2000,
      include: { project: { select: { id: true, code: true } }, customer: { select: { id: true, name: true, businessId: true } }, billToCompany: { select: { id: true, name: true, businessId: true } } },
    });
  }

  findCandidate(id: string) {
    return this.tx.invoiceCandidate.findFirst({ where: { id, ...this.c } });
  }

  updateCandidates(ids: string[], data: Prisma.InvoiceCandidateUncheckedUpdateManyInput) {
    return this.tx.invoiceCandidate.updateMany({ where: { id: { in: ids }, ...this.c }, data });
  }

  /** Candidates other group companies bill to this company (read-only view). */
  incomingInternal() {
    return this.tx.invoiceCandidate.findMany({
      where: { billToCompanyId: this.companyId, status: { not: "VOID" } },
      orderBy: { periodDate: "asc" },
      take: 500,
      select: { id: true, description: true, quantity: true, unit: true, unitPrice: true, amount: true, currency: true, periodDate: true, status: true, company: { select: { name: true } } },
    });
  }

  createExportBatch(data: Create<Prisma.InvoiceExportBatchUncheckedCreateInput>) {
    return this.tx.invoiceExportBatch.create({ data: { ...data, ...this.c } });
  }

  listExportBatches() {
    return this.tx.invoiceExportBatch.findMany({ where: this.c, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, kind: true, format: true, fileName: true, sha256: true, rowCount: true, total: true, currency: true, reexport: true, createdAt: true, createdById: true } });
  }

  findExportBatch(id: string) {
    return this.tx.invoiceExportBatch.findFirst({ where: { id, ...this.c }, include: { candidates: { select: { projectId: true } } } });
  }

  // ── forecast ──────────────────────────────────────────────────────
  latestEtc(projectId: string) {
    return this.tx.costForecast.findMany({ where: { ...this.c, projectId }, orderBy: { createdAt: "desc" } });
  }

  createEtc(data: Create<Prisma.CostForecastUncheckedCreateInput>) {
    return this.tx.costForecast.create({ data: { ...data, ...this.c } });
  }

  candidateTotals(projectId: string) {
    return this.tx.invoiceCandidate.groupBy({ by: ["status"], where: { ...this.c, projectId, sourceType: { not: "INTERNAL_BOOKING" } }, _sum: { amount: true } });
  }
}
