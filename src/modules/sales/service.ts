import { createHash } from "node:crypto";
import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { canAccessProject, hasPermission, type RequestContext } from "@/platform/authz";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { getStorage } from "@/platform/storage";
import { getMailer } from "@/platform/mail";
import { renderSalesDocumentPdf, type SalesPdfInput } from "@/platform/pdf/sales-document";
import { D } from "@/modules/finance/calculations";
import { SalesRepo, type SalesDocumentWithLines } from "./repo";
import { termsTemplates } from "./terms-templates";
import { addDays, documentTotals, finnishReference, finnishVatNumber, formatIban, formatReference, isValidBusinessId, lineAmount, parseEmailList, virtualBarcode, type SalesDocumentKind } from "./rules";
import {
  billingSettingsSchema,
  createSalesDocumentSchema,
  salesDocumentHeaderSchema,
  salesDocumentListSchema,
  salesLineSchema,
  sendSalesDocumentSchema,
  voidSchema,
  type BillingSettingsInput,
  type CreateSalesDocumentInput,
  type SalesDocumentHeaderInput,
  type SalesDocumentListInput,
  type SalesLineInput,
  type SendSalesDocumentInput,
  type VoidInput,
} from "./schemas";

/**
 * Order confirmations, invoices and credit notes (docs/adr/0033-sales-documents.md).
 * Owner decisions 2026-11-24: SK Management numbers the invoices; only companies
 * with billing set up (SK Infra) can issue and send documents.
 *
 * Access: `invoice.manage` (company-wide) for documents, `company.manage` to
 * change the seller details and number series.
 */
type Settings = NonNullable<Awaited<ReturnType<SalesRepo["findSettings"]>>>;

const s = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : d.toString());
const today = () => new Date(`${todayInDisplayZone()}T00:00:00.000Z`);
const series = (kind: SalesDocumentKind) => (kind === "ORDER_CONFIRMATION" ? "order" : "invoice");

function requireInvoicing(ctx: RequestContext) {
  if (!hasPermission(ctx, "invoice.manage")) throw new ForbiddenError("Missing permission invoice.manage");
}

function requireEnabled(settings: Settings | null): Settings {
  if (!settings || !settings.enabled) throw new ValidationError({ _form: ["sales.errors.notEnabled"] });
  return settings;
}

async function loadDocument(repo: SalesRepo, ctx: RequestContext, id: string) {
  requireInvoicing(ctx);
  const doc = await repo.findDocument(id);
  if (!doc || doc.archivedAt) throw new NotFoundError();
  return doc;
}

async function loadDraft(repo: SalesRepo, ctx: RequestContext, id: string) {
  const doc = await loadDocument(repo, ctx, id);
  if (doc.status !== "DRAFT") throw new ValidationError({ _form: ["sales.errors.notDraft"] });
  return doc;
}

async function checkProject(repo: SalesRepo, ctx: RequestContext, projectId: string | null) {
  if (!projectId) return;
  const p = await repo.findProject(projectId);
  if (!p || p.archivedAt || !canAccessProject(ctx, p.id)) throw new ValidationError({ projectId: ["validation.invalidOption"] });
}

function totalsOf(doc: Pick<SalesDocumentWithLines, "lines" | "vatMode">) {
  return documentTotals(doc.lines, doc.vatMode);
}

function presentTotals(t: ReturnType<typeof documentTotals>) {
  return { net: t.net.toFixed(2), vat: t.vat.toFixed(2), gross: t.gross.toFixed(2), groups: t.groups.map((g) => ({ rate: g.rate.toString(), net: g.net.toFixed(2), vat: g.vat.toFixed(2) })) };
}

/** The terms of a type as they are in the settings now (copied into the document). */
function termsFor(settings: Settings | null, type: "NONE" | "RENTAL" | "SALE") {
  if (type === "NONE" || !settings) return { termsType: "NONE" as const, termsTitle: null, terms: null };
  if (type === "RENTAL") return { termsType: type, termsTitle: settings.rentalTermsTitle, terms: settings.rentalTerms };
  return { termsType: type, termsTitle: settings.salesTermsTitle, terms: settings.salesTerms };
}

function defaultPaymentTerms(days: number, language: string) {
  return language === "en" ? `${days} days net` : `${days} pv netto`;
}

/** Plain data for the PDF renderer; drafts carry a watermark and no number. */
function pdfInput(doc: SalesDocumentWithLines, settings: Settings, issue?: { number: string; referenceNumber: string | null; dueDate: Date | null }): SalesPdfInput {
  const totals = totalsOf(doc);
  const number = issue?.number ?? doc.number;
  const reference = issue ? issue.referenceNumber : doc.referenceNumber;
  const dueDate = issue ? issue.dueDate : doc.dueDate;
  const invoice = doc.kind === "INVOICE";
  return {
    language: doc.language === "en" ? "en" : "fi",
    kind: doc.kind,
    draft: doc.status === "DRAFT" && !issue,
    number,
    issueDate: doc.issueDate,
    dueDate: doc.kind === "ORDER_CONFIRMATION" ? null : dueDate,
    deliveryDate: doc.deliveryDate,
    seller: {
      legalName: settings.legalName,
      businessId: settings.businessId,
      vatNumber: settings.vatNumber ?? (isValidBusinessId(settings.businessId) ? finnishVatNumber(settings.businessId) : null),
      streetAddress: settings.streetAddress,
      postalCode: settings.postalCode,
      city: settings.city,
      country: settings.country,
      phone: settings.phone,
      email: settings.email,
      website: settings.website,
      iban: formatIban(settings.iban),
      bic: settings.bic,
      bankName: settings.bankName,
      penaltyInterest: settings.penaltyInterest,
      footerNote: settings.footerNote,
      domicile: settings.domicile,
      einvoiceAddress: settings.einvoiceAddress,
      einvoiceOperator: settings.einvoiceOperator,
      logo: settings.logo,
    },
    buyer: {
      customerNumber: doc.buyerCustomerNumber,
      name: doc.buyerName,
      businessId: doc.buyerBusinessId,
      vatNumber: doc.buyerVatNumber,
      address: doc.buyerAddress,
      postalCode: doc.buyerPostalCode,
      city: doc.buyerCity,
      country: doc.buyerCountry,
      contact: doc.buyerContact,
      email: doc.buyerEmail,
    },
    title: doc.title,
    buyerReference: doc.buyerReference,
    buyerOrderNumber: doc.buyerOrderNumber,
    orderMark: doc.orderMark,
    ourReference: doc.ourReference,
    salesperson: doc.salesperson,
    deliveryTerms: doc.deliveryTerms,
    deliveryMethod: doc.deliveryMethod,
    deliveryAddress: doc.deliveryAddress,
    deliveryInfo: doc.deliveryInfo,
    deliveryText: doc.deliveryText,
    paymentTerms: doc.kind === "ORDER_CONFIRMATION" && !doc.paymentTerms ? null : doc.paymentTerms,
    notes: doc.notes,
    termsTitle: doc.terms ? doc.termsTitle : null,
    terms: doc.terms,
    referenceNumber: reference ? formatReference(reference) : null,
    sourceNumber: doc.source?.number ?? null,
    currency: doc.currency,
    vatMode: doc.vatMode,
    lines: doc.lines.map((l) => ({
      productCode: l.productCode,
      name: l.name,
      description: l.description,
      quantity: l.quantity.toString(),
      unit: l.unit,
      unitPrice: l.unitPrice.toFixed(2),
      discountPct: l.discountPct.toString(),
      vatRate: l.vatRate.toString(),
      deliveryTime: l.deliveryTime,
      amount: l.amount.toFixed(2),
    })),
    totals: presentTotals(totals),
    virtualBarcode: invoice && reference && doc.currency === "EUR" ? virtualBarcode({ iban: settings.iban, amount: totals.gross, reference, dueDate }) : null,
  };
}

const KIND_LABEL = {
  fi: { ORDER_CONFIRMATION: "Tilausvahvistus", INVOICE: "Lasku", CREDIT_NOTE: "Hyvityslasku" },
  en: { ORDER_CONFIRMATION: "Order confirmation", INVOICE: "Invoice", CREDIT_NOTE: "Credit note" },
} as const;

function fileName(doc: { kind: SalesDocumentKind; number: string | null; language: string }) {
  const label = KIND_LABEL[doc.language === "en" ? "en" : "fi"][doc.kind].replace(/\s+/g, "-");
  return `${label}-${doc.number ?? "luonnos"}.pdf`;
}

/** Default e-mail text; the sender may replace the greeting part. */
function mailBody(doc: SalesDocumentWithLines, settings: Settings, senderName: string | null, message: string | null) {
  const en = doc.language === "en";
  const amount = `${new Intl.NumberFormat(en ? "en-GB" : "fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(doc.totalGross ?? 0))} ${doc.currency === "EUR" ? "€" : doc.currency}`;
  const date = (d: Date) => new Intl.DateTimeFormat(en ? "en-GB" : "fi-FI", { timeZone: "UTC" }).format(d);
  const label = KIND_LABEL[en ? "en" : "fi"][doc.kind];
  const intro =
    message ??
    (en
      ? `Hello,\n\nplease find attached our ${label.toLowerCase()} ${doc.number}.`
      : `Hei,\n\nliitteenä ${doc.kind === "ORDER_CONFIRMATION" ? "tilausvahvistuksemme" : doc.kind === "INVOICE" ? "laskumme" : "hyvityslaskumme"} ${doc.number}.`);
  const facts: string[] = [];
  facts.push(`${en ? "Total" : "Yhteensä"}: ${amount}`);
  if (doc.kind === "INVOICE") {
    if (doc.dueDate) facts.push(`${en ? "Due date" : "Eräpäivä"}: ${date(doc.dueDate)}`);
    facts.push(`${en ? "Account" : "Tilinumero"}: ${formatIban(settings.iban)}${settings.bic ? ` (${settings.bic})` : ""}`);
    if (doc.referenceNumber) facts.push(`${en ? "Reference number" : "Viitenumero"}: ${formatReference(doc.referenceNumber)}`);
  }
  if (doc.buyerReference) facts.push(`${en ? "Your reference" : "Viitteenne"}: ${doc.buyerReference}`);
  const signature = [en ? "Best regards," : "Ystävällisin terveisin,", senderName, settings.legalName, settings.phone, settings.email].filter(Boolean).join("\n");
  return `${intro}\n\n${facts.join("\n")}\n\n${signature}\n`;
}

async function audit(tx: SalesRepo["tx"], ctx: RequestContext, action: string, entityId: string, after: Record<string, unknown> | null, before: Record<string, unknown> | null = null) {
  await writeAudit(tx, ctx, { action, entityType: "sales_document", entityId, before, after, diff: !!before && !!after });
}

/** A line as stored: credit note lines are negative, the amount is always derived. */
function lineData(kind: SalesDocumentKind, input: ReturnType<typeof salesLineSchema.parse>) {
  const quantity = kind === "CREDIT_NOTE" ? D(input.quantity).negated() : D(input.quantity);
  return {
    productCode: input.productCode,
    name: input.name,
    description: input.description,
    quantity,
    unit: input.unit,
    unitPrice: D(input.unitPrice),
    discountPct: D(input.discountPct),
    vatRate: D(input.vatRate),
    deliveryTime: input.deliveryTime,
    amount: lineAmount({ quantity, unitPrice: input.unitPrice, discountPct: input.discountPct }),
  };
}

async function issueInTx(ctx: RequestContext, id: string) {
  return runInTransaction(async (tx) => {
    const repo = new SalesRepo(tx, ctx.company.id);
    const doc = await loadDraft(repo, ctx, id);
    const settings = requireEnabled(await repo.findSettings());
    if (doc.lines.length === 0) throw new ValidationError({ _form: ["sales.errors.noLines"] });
    const totals = totalsOf(doc);
    if (doc.kind === "CREDIT_NOTE" && !totals.gross.isNegative()) throw new ValidationError({ _form: ["sales.errors.creditNotNegative"] });
    if (doc.kind !== "CREDIT_NOTE" && totals.gross.isNegative()) throw new ValidationError({ _form: ["sales.errors.negativeTotal"] });

    const n = await repo.takeNumber(series(doc.kind));
    const number = String(n);
    const referenceNumber = doc.kind === "ORDER_CONFIRMATION" ? null : finnishReference(number.padStart(3, "0"));
    const dueDate = doc.kind === "ORDER_CONFIRMATION" ? doc.dueDate : (doc.dueDate ?? addDays(doc.issueDate, settings.paymentTermDays));
    const bytes = await renderSalesDocumentPdf(pdfInput(doc, settings, { number, referenceNumber, dueDate }));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `companies/${ctx.company.id}/sales-documents/${doc.id}/${fileName({ ...doc, number })}`;
    // Written inside the transaction: if anything fails the number is not used and the object is never referenced.
    await getStorage().put(storageKey, bytes, "application/pdf");
    let issued;
    try {
      issued = await repo.updateDocument(doc.id, {
        status: "ISSUED",
        number,
        referenceNumber,
        dueDate,
        totalNet: totals.net,
        totalVat: totals.vat,
        totalGross: totals.gross,
        pdfStorageKey: storageKey,
        pdfSha256: sha256,
        pdfSizeBytes: bytes.byteLength,
        issuedAt: new Date(),
        issuedById: ctx.user.id,
        updatedById: ctx.user.id,
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError({ _form: ["sales.errors.numberTaken"] });
      throw e;
    }
    await audit(tx, ctx, "salesDocument.issue", doc.id, { kind: doc.kind, number, referenceNumber, totalNet: totals.net, totalVat: totals.vat, totalGross: totals.gross, pdfSha256: sha256 });
    return issued;
  });
}

/** Copies a document into a new draft (order → invoice, invoice → credit note). */
async function copyToDraft(ctx: RequestContext, sourceId: string, from: SalesDocumentKind, to: SalesDocumentKind) {
  return runInTransaction(async (tx) => {
    const repo = new SalesRepo(tx, ctx.company.id);
    const src = await loadDocument(repo, ctx, sourceId);
    if (src.kind !== from || src.status !== "ISSUED") throw new ValidationError({ _form: ["validation.invalidTransition"] });
    const settings = requireEnabled(await repo.findSettings());
    const issueDate = today();
    const doc = await repo.createDocument({
      kind: to,
      language: src.language,
      customerId: src.customerId,
      projectId: src.projectId && canAccessProject(ctx, src.projectId) ? src.projectId : null,
      sourceDocumentId: src.id,
      title: src.title,
      buyerName: src.buyerName,
      buyerBusinessId: src.buyerBusinessId,
      buyerVatNumber: src.buyerVatNumber,
      buyerAddress: src.buyerAddress,
      buyerPostalCode: src.buyerPostalCode,
      buyerCity: src.buyerCity,
      buyerCountry: src.buyerCountry,
      buyerContact: src.buyerContact,
      buyerEmail: src.buyerEmail,
      buyerCustomerNumber: src.buyerCustomerNumber,
      buyerReference: src.buyerReference,
      buyerOrderNumber: src.buyerOrderNumber,
      orderMark: src.orderMark,
      ourReference: src.ourReference,
      salesperson: ctx.user.name ?? src.salesperson,
      issueDate,
      dueDate: to === "INVOICE" ? addDays(issueDate, settings.paymentTermDays) : null,
      deliveryDate: src.deliveryDate,
      deliveryTerms: src.deliveryTerms,
      deliveryMethod: src.deliveryMethod,
      deliveryAddress: src.deliveryAddress,
      deliveryInfo: src.deliveryInfo,
      deliveryText: src.deliveryText,
      paymentTerms: to === "INVOICE" ? (src.paymentTerms ?? defaultPaymentTerms(settings.paymentTermDays, src.language)) : null,
      vatMode: src.vatMode,
      notes: to === "CREDIT_NOTE" ? null : src.notes,
      currency: src.currency,
      createdById: ctx.user.id,
      updatedById: ctx.user.id,
    });
    if (src.lines.length) {
      await repo.createLines(
        src.lines.map((l, i) => {
          const quantity = to === "CREDIT_NOTE" ? l.quantity.negated() : l.quantity;
          return {
            documentId: doc.id,
            sortOrder: i,
            productCode: l.productCode,
            name: l.name,
            description: l.description,
            quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            vatRate: l.vatRate,
            deliveryTime: l.deliveryTime,
            amount: lineAmount({ quantity, unitPrice: l.unitPrice, discountPct: l.discountPct }),
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          };
        }),
      );
    }
    await audit(tx, ctx, to === "CREDIT_NOTE" ? "salesDocument.createCreditNote" : "salesDocument.createFromOrder", doc.id, { kind: to, sourceDocumentId: src.id, sourceNumber: src.number, lines: src.lines.length });
    return doc;
  });
}

function can(ctx: RequestContext, doc: SalesDocumentWithLines, settings: Settings | null) {
  const manage = hasPermission(ctx, "invoice.manage");
  const enabled = !!settings?.enabled;
  const draft = doc.status === "DRAFT";
  const issued = doc.status === "ISSUED";
  return {
    edit: manage && draft,
    issue: manage && enabled && draft && doc.lines.length > 0,
    send: manage && enabled && (draft ? doc.lines.length > 0 : issued),
    void: manage && issued && doc.kind === "ORDER_CONFIRMATION",
    invoiceFromOrder: manage && enabled && issued && doc.kind === "ORDER_CONFIRMATION",
    creditNote: manage && enabled && issued && doc.kind === "INVOICE",
    archive: manage && draft,
    mailConfigured: !!getMailer(),
  };
}

export const salesDocumentService = {
  async list(ctx: RequestContext, filter: SalesDocumentListInput = {}) {
    requireInvoicing(ctx);
    const f = parseInput(salesDocumentListSchema, filter);
    const rows = await new SalesRepo(readClient(), ctx.company.id).listDocuments(f);
    return rows.map(({ lines, vatMode, ...r }) => ({
      ...r,
      projectId: r.projectId && canAccessProject(ctx, r.projectId) ? r.projectId : null,
      total: r.totalGross ? r.totalGross.toFixed(2) : documentTotals(lines, vatMode).gross.toFixed(2),
      totalGross: s(r.totalGross),
    }));
  },

  /** Customers and projects for the create form, and whether documents can be made. */
  async options(ctx: RequestContext) {
    requireInvoicing(ctx);
    const repo = new SalesRepo(readClient(), ctx.company.id);
    const [settings, customers, projects] = await Promise.all([
      repo.findSettings(),
      repo.listCustomers(),
      repo.listProjects(),
    ]);
    return {
      enabled: !!settings?.enabled,
      canConfigure: hasPermission(ctx, "company.manage"),
      defaultVatRate: settings?.defaultVatRate.toString() ?? "25.5",
      customers,
      projects: projects.filter((p) => canAccessProject(ctx, p.id)),
    };
  },

  async get(ctx: RequestContext, id: string) {
    const repo = new SalesRepo(readClient(), ctx.company.id);
    const doc = await loadDocument(repo, ctx, id);
    const settings = await repo.findSettings();
    const userIds = [...new Set([doc.createdById, doc.issuedById, doc.voidedById, ...doc.sends.map((x) => x.sentById)].filter((x): x is string => !!x))];
    const [users, customer] = await Promise.all([repo.findUsers(userIds), doc.customerId ? repo.findCustomer(doc.customerId) : null]);
    const totals = totalsOf(doc);
    return {
      ...doc,
      issueDate: doc.issueDate,
      totalNet: s(doc.totalNet),
      totalVat: s(doc.totalVat),
      totalGross: s(doc.totalGross),
      project: doc.project && canAccessProject(ctx, doc.project.id) ? doc.project : null,
      lines: doc.lines.map((l) => ({
        ...l,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toFixed(2),
        discountPct: l.discountPct.toString(),
        vatRate: l.vatRate.toString(),
        amount: l.amount.toFixed(2),
        /** The quantity as typed in the form (credit note lines are shown positive there). */
        formQuantity: l.quantity.abs().toString(),
      })),
      totals: presentTotals(totals),
      referenceNumberFormatted: doc.referenceNumber ? formatReference(doc.referenceNumber) : null,
      contacts: (customer?.contacts ?? []).filter((c) => !!c.email).map((c) => ({ id: c.id, name: c.name, email: c.email! })),
      users,
      defaultVatRate: settings?.defaultVatRate.toString() ?? "25.5",
      settingsEnabled: !!settings?.enabled,
      can: can(ctx, doc, settings),
      fileName: fileName(doc),
      defaultSubject: doc.number && settings ? `${KIND_LABEL[doc.language === "en" ? "en" : "fi"][doc.kind]} ${doc.number} – ${settings.legalName}` : null,
    };
  },

  /** New draft; buyer details are copied from the CRM customer when one is chosen. */
  async create(ctx: RequestContext, input: CreateSalesDocumentInput) {
    requireInvoicing(ctx);
    const data = parseInput(createSalesDocumentSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new SalesRepo(tx, ctx.company.id);
      const settings = requireEnabled(await repo.findSettings());
      await checkProject(repo, ctx, data.projectId);
      let buyer: { name: string; businessId: string | null; address: string | null; postalCode: string | null; city: string | null; contact: string | null; email: string | null };
      if (data.customerId) {
        const c = await repo.findCustomer(data.customerId);
        if (!c || c.archivedAt) throw new ValidationError({ customerId: ["validation.invalidOption"] });
        const contact = c.contacts.find((x) => !!x.email) ?? c.contacts[0] ?? null;
        buyer = { name: c.name, businessId: c.businessId, address: c.address, postalCode: c.postalCode, city: c.city, contact: contact?.name ?? null, email: contact?.email ?? null };
      } else {
        if (!data.buyerName) throw new ValidationError({ buyerName: ["validation.required"] });
        buyer = { name: data.buyerName, businessId: null, address: null, postalCode: null, city: null, contact: null, email: null };
      }
      const issueDate = today();
      const invoice = data.kind === "INVOICE";
      const doc = await repo.createDocument({
        kind: data.kind,
        customerId: data.customerId,
        projectId: data.projectId,
        title: data.title,
        buyerName: buyer.name,
        buyerBusinessId: buyer.businessId,
        buyerVatNumber: buyer.businessId && isValidBusinessId(buyer.businessId) ? finnishVatNumber(buyer.businessId) : null,
        buyerAddress: buyer.address,
        buyerPostalCode: buyer.postalCode,
        buyerCity: buyer.city,
        buyerContact: buyer.contact,
        buyerEmail: buyer.email,
        salesperson: ctx.user.name,
        issueDate,
        dueDate: invoice ? addDays(issueDate, settings.paymentTermDays) : null,
        ...termsFor(settings, data.termsType),
        paymentTerms: invoice ? defaultPaymentTerms(settings.paymentTermDays, "fi") : null,
        currency: ctx.company.defaultCurrency,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      await audit(tx, ctx, "salesDocument.create", doc.id, { kind: doc.kind, buyerName: doc.buyerName, customerId: doc.customerId, projectId: doc.projectId });
      return doc;
    });
  },

  async update(ctx: RequestContext, id: string, input: SalesDocumentHeaderInput) {
    requireInvoicing(ctx);
    const data = parseInput(salesDocumentHeaderSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new SalesRepo(tx, ctx.company.id);
      const doc = await loadDraft(repo, ctx, id);
      await checkProject(repo, ctx, data.projectId);
      // Choosing another terms type attaches those terms; otherwise the edited text is kept.
      const terms =
        data.termsType === "NONE"
          ? termsFor(null, "NONE")
          : data.termsType !== doc.termsType
            ? termsFor(await repo.findSettings(), data.termsType)
            : { termsType: data.termsType, termsTitle: data.termsTitle, terms: data.terms };
      const after = await repo.updateDocument(doc.id, {
        ...data,
        ...terms,
        dueDate: doc.kind === "ORDER_CONFIRMATION" ? null : data.dueDate,
        updatedById: ctx.user.id,
      });
      const { lines: _l, sends: _s, customer: _c, project: _p, source: _src, derived: _d, ...beforeHeader } = doc;
      const { pdfStorageKey: _k, ...afterHeader } = after;
      await audit(tx, ctx, "salesDocument.update", doc.id, afterHeader, beforeHeader);
      return after;
    });
  },

  async addLine(ctx: RequestContext, documentId: string, input: SalesLineInput) {
    requireInvoicing(ctx);
    const data = parseInput(salesLineSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new SalesRepo(tx, ctx.company.id);
      const doc = await loadDraft(repo, ctx, documentId);
      if (doc.lines.length >= 300) throw new ValidationError({ _form: ["sales.errors.tooManyLines"] });
      const line = await repo.createLine({ documentId: doc.id, sortOrder: await repo.nextSortOrder(doc.id), ...lineData(doc.kind, data), createdById: ctx.user.id, updatedById: ctx.user.id });
      await audit(tx, ctx, "salesDocument.addLine", doc.id, { lineId: line.id, name: line.name, quantity: line.quantity, unitPrice: line.unitPrice, amount: line.amount });
      return line;
    });
  },

  async updateLine(ctx: RequestContext, lineId: string, input: SalesLineInput) {
    requireInvoicing(ctx);
    const data = parseInput(salesLineSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new SalesRepo(tx, ctx.company.id);
      const line = await repo.findLine(lineId);
      if (!line) throw new NotFoundError();
      const doc = await loadDraft(repo, ctx, line.documentId);
      const after = await repo.updateLine(line.id, { ...lineData(doc.kind, data), updatedById: ctx.user.id });
      await audit(tx, ctx, "salesDocument.updateLine", doc.id, { lineId: line.id, name: after.name, quantity: after.quantity, unitPrice: after.unitPrice, amount: after.amount }, { lineId: line.id, name: line.name, quantity: line.quantity, unitPrice: line.unitPrice, amount: line.amount });
      return after;
    });
  },

  async removeLine(ctx: RequestContext, lineId: string) {
    requireInvoicing(ctx);
    return runInTransaction(async (tx) => {
      const repo = new SalesRepo(tx, ctx.company.id);
      const line = await repo.findLine(lineId);
      if (!line) throw new NotFoundError();
      const doc = await loadDraft(repo, ctx, line.documentId);
      await repo.deleteLine(line.id);
      await audit(tx, ctx, "salesDocument.removeLine", doc.id, null, { lineId: line.id, name: line.name, quantity: line.quantity, amount: line.amount });
    });
  },

  /** The PDF: the stored bytes of an issued document, or a watermarked preview of a draft. */
  async pdf(ctx: RequestContext, id: string) {
    const repo = new SalesRepo(readClient(), ctx.company.id);
    const doc = await loadDocument(repo, ctx, id);
    if (doc.status !== "DRAFT") {
      const object = await getStorage().get(doc.pdfStorageKey!);
      if (!object) throw new NotFoundError("PDF missing from storage");
      return { fileName: fileName(doc), body: object.body, sha256: doc.pdfSha256 };
    }
    const settings = await repo.findSettings();
    if (!settings) throw new ValidationError({ _form: ["sales.errors.notEnabled"] });
    const body = await renderSalesDocumentPdf(pdfInput(doc, settings));
    return { fileName: fileName(doc), body, sha256: null };
  },

  /** Locks the document: takes the next number, stores the PDF as issued. */
  async issue(ctx: RequestContext, id: string) {
    requireInvoicing(ctx);
    return issueInTx(ctx, id);
  },

  /**
   * E-mails the PDF to the customer or any address (a draft is issued first).
   * Re-sending sends the same stored PDF. Replies go to the sender and the
   * billing e-mail.
   */
  async send(ctx: RequestContext, id: string, input: SendSalesDocumentInput) {
    requireInvoicing(ctx);
    const data = parseInput(sendSalesDocumentSchema, input);
    const cc = parseEmailList(data.cc);
    if (cc === null) throw new ValidationError({ cc: ["validation.email"] });
    const first = await loadDocument(new SalesRepo(readClient(), ctx.company.id), ctx, id);
    if (first.status === "VOID") throw new ValidationError({ _form: ["sales.errors.void"] });
    const mailer = getMailer();
    if (!mailer) throw new ValidationError({ _form: ["sales.errors.mailNotConfigured"] });
    if (first.status === "DRAFT") await issueInTx(ctx, id);

    const repo = new SalesRepo(readClient(), ctx.company.id);
    const doc = (await repo.findDocument(id))!;
    const settings = requireEnabled(await repo.findSettings());
    const object = await getStorage().get(doc.pdfStorageKey!);
    if (!object) throw new NotFoundError("PDF missing from storage");
    const subject = data.subject ?? `${KIND_LABEL[doc.language === "en" ? "en" : "fi"][doc.kind]} ${doc.number} – ${settings.legalName}`;
    const replyTo = [...new Set([ctx.user.email, settings.email].filter((x): x is string => !!x).map((x) => x.toLowerCase()))];
    try {
      await mailer.send({
        to: data.to,
        cc: cc.filter((x) => x !== data.to),
        subject,
        text: mailBody(doc, settings, ctx.user.name, data.message),
        replyTo,
        attachments: [{ filename: fileName(doc), content: object.body, contentType: "application/pdf" }],
      });
    } catch {
      throw new ValidationError({ _form: ["sales.errors.sendFailed"] });
    }
    return runInTransaction(async (tx) => {
      const r = new SalesRepo(tx, ctx.company.id);
      const now = new Date();
      await r.createSend({ documentId: doc.id, toEmail: data.to, ccEmails: cc.filter((x) => x !== data.to), subject, sentAt: now, sentById: ctx.user.id });
      const after = await r.updateDocument(doc.id, { sentAt: now, sendCount: { increment: 1 }, updatedById: ctx.user.id });
      await audit(tx, ctx, "salesDocument.send", doc.id, { number: doc.number, to: data.to, cc, subject, pdfSha256: doc.pdfSha256 });
      return after;
    });
  },

  /** Order confirmations only; invoices are corrected with a credit note. */
  async void(ctx: RequestContext, id: string, input: VoidInput) {
    requireInvoicing(ctx);
    const data = parseInput(voidSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new SalesRepo(tx, ctx.company.id);
      const doc = await loadDocument(repo, ctx, id);
      if (doc.kind !== "ORDER_CONFIRMATION" || doc.status !== "ISSUED") throw new ValidationError({ _form: ["validation.invalidTransition"] });
      const after = await repo.updateDocument(doc.id, { status: "VOID", voidedAt: new Date(), voidedById: ctx.user.id, voidReason: data.reason, updatedById: ctx.user.id });
      await audit(tx, ctx, "salesDocument.void", doc.id, { status: "VOID", reason: data.reason }, { status: doc.status });
      return after;
    });
  },

  async createInvoiceFromOrder(ctx: RequestContext, orderId: string) {
    requireInvoicing(ctx);
    return copyToDraft(ctx, orderId, "ORDER_CONFIRMATION", "INVOICE");
  },

  /** A draft credit note with the invoice's lines negated; lines can be removed or changed for a partial credit. */
  async createCreditNote(ctx: RequestContext, invoiceId: string) {
    requireInvoicing(ctx);
    return copyToDraft(ctx, invoiceId, "INVOICE", "CREDIT_NOTE");
  },

  /** Drafts are archived (never numbered, so no gap in the series). */
  async archiveDraft(ctx: RequestContext, id: string) {
    requireInvoicing(ctx);
    return runInTransaction(async (tx) => {
      const repo = new SalesRepo(tx, ctx.company.id);
      const doc = await loadDraft(repo, ctx, id);
      await repo.updateDocument(doc.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await audit(tx, ctx, "salesDocument.archive", doc.id, { archived: true });
    });
  },
};

export const billingSettingsService = {
  async get(ctx: RequestContext) {
    if (!hasPermission(ctx, "invoice.manage") && !hasPermission(ctx, "company.manage")) throw new ForbiddenError("Missing permission invoice.manage");
    const settings = await new SalesRepo(readClient(), ctx.company.id).findSettings();
    return {
      settings: settings ? { ...settings, defaultVatRate: settings.defaultVatRate.toString(), ibanFormatted: formatIban(settings.iban) } : null,
      canEdit: hasPermission(ctx, "company.manage"),
      /** Starting texts for rental and sales terms (filled in the form when none are saved). */
      templates: termsTemplates(settings?.legalName ?? ctx.company.name),
    };
  },

  async update(ctx: RequestContext, input: BillingSettingsInput) {
    if (!hasPermission(ctx, "company.manage")) throw new ForbiddenError("Missing permission company.manage");
    const data = parseInput(billingSettingsSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new SalesRepo(tx, ctx.company.id);
      const before = await repo.findSettings();
      // A series can never restart below a number already issued.
      const issued = await repo.listIssuedNumbers();
      const maxOf = (kinds: SalesDocumentKind[]) => issued.filter((d) => kinds.includes(d.kind)).reduce((m, d) => Math.max(m, Number(d.number) || 0), 0);
      if (data.nextOrderNumber <= maxOf(["ORDER_CONFIRMATION"])) throw new ValidationError({ nextOrderNumber: ["sales.errors.numberBelowIssued"] });
      if (data.nextInvoiceNumber <= maxOf(["INVOICE", "CREDIT_NOTE"])) throw new ValidationError({ nextInvoiceNumber: ["sales.errors.numberBelowIssued"] });
      const after = await repo.upsertSettings({
        ...data,
        vatNumber: data.vatNumber ?? finnishVatNumber(data.businessId),
        defaultVatRate: D(data.defaultVatRate),
        updatedById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: before ? "billingSettings.update" : "billingSettings.create", entityType: "billing_settings", entityId: ctx.company.id, before, after, diff: !!before });
      return after;
    });
  },
};
