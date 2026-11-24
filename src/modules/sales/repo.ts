import type { Prisma, Tx } from "@/platform/db";

const documentInclude = {
  lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  sends: { orderBy: { sentAt: "desc" } },
  customer: { select: { id: true, name: true, businessId: true } },
  project: { select: { id: true, code: true, name: true } },
  source: { select: { id: true, kind: true, number: true, status: true } },
  derived: { select: { id: true, kind: true, number: true, status: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.SalesDocumentInclude;

export type SalesDocumentWithLines = Prisma.SalesDocumentGetPayload<{ include: typeof documentInclude }>;

/** Company-scoped repository for order confirmations and invoices: every query carries company_id. */
export class SalesRepo {
  constructor(
    readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
  }

  // ── settings ──────────────────────────────────────────────────────
  findSettings() {
    return this.tx.billingSettings.findUnique({ where: { companyId: this.companyId } });
  }

  upsertSettings(data: Omit<Prisma.BillingSettingsUncheckedCreateInput, "companyId">) {
    return this.tx.billingSettings.upsert({ where: { companyId: this.companyId }, create: { ...data, companyId: this.companyId }, update: data });
  }

  /** Takes the next number of a series atomically (the row lock serializes concurrent issues). */
  async takeNumber(series: "order" | "invoice"): Promise<number> {
    const s = await this.tx.billingSettings.update({
      where: { companyId: this.companyId },
      data: series === "order" ? { nextOrderNumber: { increment: 1 } } : { nextInvoiceNumber: { increment: 1 } },
      select: { nextOrderNumber: true, nextInvoiceNumber: true },
    });
    return (series === "order" ? s.nextOrderNumber : s.nextInvoiceNumber) - 1;
  }

  // ── lookups ───────────────────────────────────────────────────────
  findCustomer(id: string) {
    return this.tx.customer.findFirst({ where: { id, ...this.c }, include: { contacts: { where: { archivedAt: null }, orderBy: { name: "asc" } } } });
  }

  listCustomers() {
    return this.tx.customer.findMany({ where: { ...this.c, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, businessId: true } });
  }

  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, ...this.c }, select: { id: true, code: true, name: true, archivedAt: true, customerId: true } });
  }

  listProjects() {
    return this.tx.project.findMany({ where: { ...this.c, archivedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
  }

  listIssuedNumbers() {
    return this.tx.salesDocument.findMany({ where: { ...this.c, number: { not: null } }, select: { kind: true, number: true } });
  }

  findUsers(ids: string[]) {
    return this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  }

  // ── documents ─────────────────────────────────────────────────────
  listDocuments(where: { kind?: Prisma.SalesDocumentWhereInput["kind"]; status?: Prisma.SalesDocumentWhereInput["status"]; q?: string | null }) {
    return this.tx.salesDocument.findMany({
      where: {
        ...this.c,
        archivedAt: null,
        ...(where.kind ? { kind: where.kind } : {}),
        ...(where.status ? { status: where.status } : {}),
        ...(where.q ? { OR: [{ buyerName: { contains: where.q, mode: "insensitive" } }, { number: { contains: where.q } }, { title: { contains: where.q, mode: "insensitive" } }, { buyerReference: { contains: where.q, mode: "insensitive" } }] } : {}),
      },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: 500,
      select: {
        id: true,
        kind: true,
        status: true,
        number: true,
        title: true,
        buyerName: true,
        issueDate: true,
        dueDate: true,
        currency: true,
        totalGross: true,
        sentAt: true,
        sendCount: true,
        projectId: true,
        lines: { select: { quantity: true, unitPrice: true, discountPct: true, vatRate: true } },
        vatMode: true,
      },
    });
  }

  findDocument(id: string) {
    return this.tx.salesDocument.findFirst({ where: { id, ...this.c }, include: documentInclude });
  }

  createDocument(data: Omit<Prisma.SalesDocumentUncheckedCreateInput, "companyId">) {
    return this.tx.salesDocument.create({ data: { ...data, companyId: this.companyId } });
  }

  updateDocument(id: string, data: Prisma.SalesDocumentUncheckedUpdateInput) {
    return this.tx.salesDocument.update({ where: { id, companyId: this.companyId }, data });
  }

  // ── lines ─────────────────────────────────────────────────────────
  findLine(id: string) {
    return this.tx.salesDocumentLine.findFirst({ where: { id, ...this.c } });
  }

  nextSortOrder(documentId: string) {
    return this.tx.salesDocumentLine.aggregate({ where: { ...this.c, documentId }, _max: { sortOrder: true } }).then((r) => (r._max.sortOrder ?? -1) + 1);
  }

  createLine(data: Omit<Prisma.SalesDocumentLineUncheckedCreateInput, "companyId">) {
    return this.tx.salesDocumentLine.create({ data: { ...data, companyId: this.companyId } });
  }

  createLines(data: Omit<Prisma.SalesDocumentLineUncheckedCreateInput, "companyId">[]) {
    return this.tx.salesDocumentLine.createMany({ data: data.map((d) => ({ ...d, companyId: this.companyId })) });
  }

  updateLine(id: string, data: Prisma.SalesDocumentLineUncheckedUpdateInput) {
    return this.tx.salesDocumentLine.update({ where: { id, companyId: this.companyId }, data });
  }

  deleteLine(id: string) {
    return this.tx.salesDocumentLine.delete({ where: { id, companyId: this.companyId } });
  }

  // ── sends ─────────────────────────────────────────────────────────
  createSend(data: Omit<Prisma.SalesDocumentSendUncheckedCreateInput, "companyId">) {
    return this.tx.salesDocumentSend.create({ data: { ...data, companyId: this.companyId } });
  }
}
