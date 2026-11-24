/**
 * Order confirmations, invoices and credit notes (ADR 0033) against real
 * PostgreSQL: billing settings, drafts with lines, issuing with a gap-free
 * number series and a stored PDF, e-mail with the PDF attached, immutability
 * after issue (service and database), order → invoice, credit notes,
 * voiding, the number series guard and permissions.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { MemoryMailer, setMailerForTests } from "@/platform/mail";
import { customerService } from "@/modules/commercial/crm.service";
import { billingSettingsService, salesDocumentService } from "@/modules/sales/service";
import { isValidFinnishReference } from "@/modules/sales/rules";
import { auditFor, createMember, createTenant, type Tenant } from "../helpers/fixtures";

let t: Tenant;
let customerId: string;

const settings = {
  enabled: "on",
  legalName: "SK Infra Demo Oy",
  businessId: "0112038-9",
  streetAddress: "Teollisuuskatu 1",
  postalCode: "00510",
  city: "Helsinki",
  phone: "+358 40 123 4567",
  email: "laskutus@skinfra.example.test",
  iban: "FI21 1234 5600 0007 85",
  bic: "NDEAFIHH",
  paymentTermDays: "14",
  logo: "SK_INFRA" as const,
  nextOrderNumber: "1001",
  nextInvoiceNumber: "10001",
  rentalTerms: "1. VUOKRA-AIKA\nVuokra-aika alkaa noutopäivästä.",
  salesTerms: "1. TOIMITUS\nToimitus varastolta.",
};

const line = (over: Record<string, string> = {}) => ({ productCode: "KH-600", name: "Kaapelihylly 600 mm", quantity: "12", unit: "kpl", unitPrice: "145.00", vatRate: "25.5", deliveryTime: "vko 50", ...over });

let mailer: MemoryMailer;

beforeAll(async () => {
  t = await createTenant("Sales");
  const c = await customerService.create(t.ownerCtx, { name: "Nordic Data Center Demo Oy", businessId: "0112038-9", address: "Konesalitie 5", postalCode: "02100", city: "Espoo" });
  customerId = c.id;
  await customerService.addContact(t.ownerCtx, customerId, { name: "Matti Ostaja", email: "matti@ndc.example.test" });
});
afterEach(() => setMailerForTests(undefined));

function useMailer() {
  mailer = new MemoryMailer();
  setMailerForTests(mailer);
  return mailer;
}

describe("billing settings", () => {
  it("cannot create documents before billing is set up", async () => {
    await expect(salesDocumentService.create(t.ownerCtx, { kind: "INVOICE", customerId })).rejects.toBeInstanceOf(ValidationError);
    expect((await salesDocumentService.options(t.ownerCtx)).enabled).toBe(false);
  });

  it("validates the business ID and IBAN", async () => {
    await expect(billingSettingsService.update(t.ownerCtx, { ...settings, businessId: "1234567-2" })).rejects.toBeInstanceOf(ValidationError);
    await expect(billingSettingsService.update(t.ownerCtx, { ...settings, iban: "FI21 1234 5600 0007 86" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("saves the seller details, derives the VAT number and audits", async () => {
    const s = await billingSettingsService.update(t.ownerCtx, settings);
    expect(s.iban).toBe("FI2112345600000785");
    expect(s.vatNumber).toBe("FI01120389");
    expect(s.logo).toBe("SK_INFRA");
    expect((await auditFor(t.companyId, t.companyId)).some((e) => e.action === "billing_settings.create")).toBe(true);
  });

  it("is changed only with company.manage", async () => {
    const pm = await createMember(t, "PROJECT_MANAGER");
    await expect(billingSettingsService.update(pm, settings)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await billingSettingsService.get(pm)).canEdit).toBe(false);
  });
});

describe("order confirmation → invoice → credit note", () => {
  let orderId: string;
  let invoiceId: string;

  it("creates a draft with the customer's details and computes lines", async () => {
    const doc = await salesDocumentService.create(t.ownerCtx, { kind: "ORDER_CONFIRMATION", customerId, title: "Kaapelointi, sali B" });
    orderId = doc.id;
    expect(doc.status).toBe("DRAFT");
    expect(doc.number).toBeNull();
    expect(doc.buyerName).toBe("Nordic Data Center Demo Oy");
    expect(doc.buyerVatNumber).toBe("FI01120389");
    expect(doc.buyerEmail).toBe("matti@ndc.example.test");

    await salesDocumentService.addLine(t.ownerCtx, orderId, line());
    const l2 = await salesDocumentService.addLine(t.ownerCtx, orderId, line({ productCode: "", name: "AXAL-TT PRO 3x240", quantity: "1250,5", unit: "m", unitPrice: "18,40", discountPct: "5", vatRate: "25.5" }));
    expect(l2.amount.toFixed(2)).toBe("21858.74");
    await salesDocumentService.updateLine(t.ownerCtx, l2.id, line({ name: "AXAL-TT PRO 3x240", quantity: "1000", unit: "m", unitPrice: "18.40", discountPct: "0" }));

    const got = await salesDocumentService.get(t.ownerCtx, orderId);
    expect(got.lines.map((l) => l.amount)).toEqual(["1740.00", "18400.00"]);
    expect(got.totals).toMatchObject({ net: "20140.00", vat: "5135.70", gross: "25275.70" });
    expect(got.can.issue).toBe(true);
    expect(got.contacts).toEqual([expect.objectContaining({ email: "matti@ndc.example.test" })]);
  });

  it("previews a draft as a watermarked PDF without a number", async () => {
    const pdf = await salesDocumentService.pdf(t.ownerCtx, orderId);
    expect(pdf.sha256).toBeNull();
    expect(pdf.fileName).toBe("Tilausvahvistus-luonnos.pdf");
    expect((await PDFDocument.load(pdf.body)).getPageCount()).toBe(1);
  });

  it("issues and sends with the PDF attached; re-sending sends the same bytes", async () => {
    const m = useMailer();
    await salesDocumentService.send(t.ownerCtx, orderId, { to: "Matti@NDC.example.test", cc: "pm@ndc.example.test, matti@ndc.example.test" });
    const doc = await salesDocumentService.get(t.ownerCtx, orderId);
    expect(doc.status).toBe("ISSUED");
    expect(doc.number).toBe("1001");
    expect(doc.referenceNumber).toBeNull();
    expect(doc.totalGross).toBe("25275.7");
    expect(doc.sendCount).toBe(1);
    expect(m.sent).toHaveLength(1);
    const sent = m.sent[0];
    expect(sent.to).toBe("matti@ndc.example.test");
    expect(sent.cc).toEqual(["pm@ndc.example.test"]);
    expect(sent.subject).toBe("Tilausvahvistus 1001 – SK Infra Demo Oy");
    expect(sent.replyTo).toEqual([t.owner.user.email.toLowerCase(), "laskutus@skinfra.example.test"]);
    expect(sent.attachments?.[0]).toMatchObject({ filename: "Tilausvahvistus-1001.pdf", contentType: "application/pdf" });
    expect(sent.text).toContain("Yhteensä: 25");

    const stored = await salesDocumentService.pdf(t.ownerCtx, orderId);
    expect(stored.sha256).toBe(doc.pdfSha256);
    expect(Buffer.from(stored.body).equals(Buffer.from(sent.attachments![0].content))).toBe(true);

    await salesDocumentService.send(t.ownerCtx, orderId, { to: "other@example.test", subject: "Tilausvahvistus uudelleen", message: "Hei, tässä vielä uudelleen." });
    expect(m.sent).toHaveLength(2);
    expect(Buffer.from(m.sent[1].attachments![0].content).equals(Buffer.from(stored.body))).toBe(true);
    expect(m.sent[1].text.startsWith("Hei, tässä vielä uudelleen.")).toBe(true);
    const again = await salesDocumentService.get(t.ownerCtx, orderId);
    expect(again.sendCount).toBe(2);
    expect(again.sends.map((x) => x.toEmail).sort()).toEqual(["matti@ndc.example.test", "other@example.test"]);
    const actions = (await auditFor(t.companyId, orderId)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["sales_document.create", "sales_document.line_add", "sales_document.line_update", "sales_document.issue", "sales_document.send"]));
  });

  it("keeps an issued document immutable in the service and in the database", async () => {
    const doc = await salesDocumentService.get(t.ownerCtx, orderId);
    await expect(salesDocumentService.addLine(t.ownerCtx, orderId, line())).rejects.toBeInstanceOf(ValidationError);
    await expect(salesDocumentService.updateLine(t.ownerCtx, doc.lines[0].id, line())).rejects.toBeInstanceOf(ValidationError);
    await expect(salesDocumentService.removeLine(t.ownerCtx, doc.lines[0].id)).rejects.toBeInstanceOf(ValidationError);
    await expect(salesDocumentService.archiveDraft(t.ownerCtx, orderId)).rejects.toBeInstanceOf(ValidationError);
    await expect(db.salesDocument.update({ where: { id: orderId }, data: { buyerName: "Changed" } })).rejects.toThrow(/immutable/);
    await expect(db.salesDocumentLine.update({ where: { id: doc.lines[0].id }, data: { name: "Changed" } })).rejects.toThrow(/immutable/);
    await expect(db.salesDocument.delete({ where: { id: orderId } })).rejects.toThrow(/never deleted/);
    await expect(db.salesDocumentSend.deleteMany({ where: { documentId: orderId } })).rejects.toThrow(/append-only/);
  });

  it("makes an invoice from the order with a reference number and payment details", async () => {
    const inv = await salesDocumentService.createInvoiceFromOrder(t.ownerCtx, orderId);
    invoiceId = inv.id;
    expect(inv.kind).toBe("INVOICE");
    expect(inv.sourceDocumentId).toBe(orderId);
    expect(inv.paymentTerms).toBe("14 pv netto");
    expect(inv.dueDate!.getTime() - inv.issueDate.getTime()).toBe(14 * 86_400_000);

    const issued = await salesDocumentService.issue(t.ownerCtx, invoiceId);
    expect(issued.number).toBe("10001");
    expect(isValidFinnishReference(issued.referenceNumber!)).toBe(true);
    expect(issued.totalGross!.toFixed(2)).toBe("25275.70");
    const got = await salesDocumentService.get(t.ownerCtx, invoiceId);
    expect(got.source).toMatchObject({ id: orderId, number: "1001" });
    expect(got.can.creditNote).toBe(true);
    expect(got.can.void).toBe(false);
    await expect(salesDocumentService.void(t.ownerCtx, invoiceId, { reason: "virhe" })).rejects.toBeInstanceOf(ValidationError);
    const pdf = await salesDocumentService.pdf(t.ownerCtx, invoiceId);
    expect(pdf.fileName).toBe("Lasku-10001.pdf");
    expect((await PDFDocument.load(pdf.body)).getTitle()).toContain("LASKU 10001");
  });

  it("credits an invoice with negative lines from the same number series", async () => {
    const cn = await salesDocumentService.createCreditNote(t.ownerCtx, invoiceId);
    const draft = await salesDocumentService.get(t.ownerCtx, cn.id);
    expect(draft.lines.map((l) => l.quantity)).toEqual(["-12", "-1000"]);
    // Partial credit: remove the cable line, credit the trays only.
    await salesDocumentService.removeLine(t.ownerCtx, draft.lines[1].id);
    const added = await salesDocumentService.addLine(t.ownerCtx, cn.id, line({ name: "Rahtihyvitys", productCode: "", quantity: "1", unitPrice: "50" }));
    expect(added.quantity.toString()).toBe("-1");
    const issued = await salesDocumentService.issue(t.ownerCtx, cn.id);
    expect(issued.number).toBe("10002");
    expect(issued.totalNet!.toFixed(2)).toBe("-1790.00");
    expect(issued.totalGross!.toFixed(2)).toBe("-2246.45");
  });

  it("voids an order confirmation with a reason; a void document cannot be sent", async () => {
    useMailer();
    const o = await salesDocumentService.create(t.ownerCtx, { kind: "ORDER_CONFIRMATION", buyerName: "Kertaostaja Oy" });
    await salesDocumentService.addLine(t.ownerCtx, o.id, line());
    await salesDocumentService.issue(t.ownerCtx, o.id);
    await expect(salesDocumentService.void(t.ownerCtx, o.id, { reason: "" })).rejects.toBeInstanceOf(ValidationError);
    const v = await salesDocumentService.void(t.ownerCtx, o.id, { reason: "Asiakas perui tilauksen" });
    expect(v.status).toBe("VOID");
    expect(v.number).toBe("1002");
    await expect(salesDocumentService.send(t.ownerCtx, o.id, { to: "a@example.test" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("rental and sales terms", () => {
  it("offers starting texts with the seller's name", async () => {
    const { templates } = await billingSettingsService.get(t.ownerCtx);
    expect(templates.rental).toContain("SK Infra Demo Oy (Vuokranantaja)");
    expect(templates.sales).toContain("SK Infra Demo Oy:n (Myyjä)");
    expect(templates.rental).not.toContain("{{yritys}}");
  });

  it("attaches rental or sales terms, keeps edits and removes them", async () => {
    const d = await salesDocumentService.create(t.ownerCtx, { kind: "ORDER_CONFIRMATION", customerId, termsType: "RENTAL" });
    expect(d).toMatchObject({ termsType: "RENTAL", termsTitle: "VUOKRAUSEHDOT", terms: settings.rentalTerms });
    const header = { buyerName: d.buyerName, issueDate: "2026-11-24" };
    // Same type: the edited text is kept.
    const edited = await salesDocumentService.update(t.ownerCtx, d.id, { ...header, termsType: "RENTAL", termsTitle: "VUOKRAUSEHDOT", terms: "Muokatut ehdot" });
    expect(edited.terms).toBe("Muokatut ehdot");
    // Another type: those terms are attached from the settings.
    const sale = await salesDocumentService.update(t.ownerCtx, d.id, { ...header, termsType: "SALE", termsTitle: "VUOKRAUSEHDOT", terms: "Muokatut ehdot" });
    expect(sale).toMatchObject({ termsType: "SALE", termsTitle: "MYYNTIEHDOT", terms: settings.salesTerms });
    const none = await salesDocumentService.update(t.ownerCtx, d.id, { ...header, termsType: "NONE", terms: "x" });
    expect(none).toMatchObject({ termsType: "NONE", termsTitle: null, terms: null });
  });

  it("prints the chosen terms in the PDF", async () => {
    const d = await salesDocumentService.create(t.ownerCtx, { kind: "ORDER_CONFIRMATION", customerId, termsType: "SALE" });
    await salesDocumentService.addLine(t.ownerCtx, d.id, line());
    const withTerms = (await salesDocumentService.pdf(t.ownerCtx, d.id)).body.byteLength;
    await salesDocumentService.update(t.ownerCtx, d.id, { buyerName: d.buyerName, issueDate: "2026-11-24", termsType: "NONE" });
    expect((await salesDocumentService.pdf(t.ownerCtx, d.id)).body.byteLength).toBeLessThan(withTerms);
  });
});

describe("drafts, numbering and validation", () => {
  it("numbers only issued documents: an archived draft leaves no gap", async () => {
    const a = await salesDocumentService.create(t.ownerCtx, { kind: "INVOICE", buyerName: "Gap Oy" });
    await salesDocumentService.addLine(t.ownerCtx, a.id, line());
    await salesDocumentService.archiveDraft(t.ownerCtx, a.id);
    await expect(salesDocumentService.get(t.ownerCtx, a.id)).rejects.toBeInstanceOf(NotFoundError);
    const b = await salesDocumentService.create(t.ownerCtx, { kind: "INVOICE", buyerName: "Gap Oy" });
    await salesDocumentService.addLine(t.ownerCtx, b.id, line());
    expect((await salesDocumentService.issue(t.ownerCtx, b.id)).number).toBe("10003");
  });

  it("issues concurrently without duplicate numbers", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = await salesDocumentService.create(t.ownerCtx, { kind: "INVOICE", buyerName: `Rinnakkain ${i} Oy` });
      await salesDocumentService.addLine(t.ownerCtx, d.id, line());
      ids.push(d.id);
    }
    const numbers = (await Promise.all(ids.map((id) => salesDocumentService.issue(t.ownerCtx, id)))).map((d) => d.number).sort();
    expect(numbers).toEqual(["10004", "10005", "10006", "10007"]);
  });

  it("cannot move a series below an issued number", async () => {
    await expect(billingSettingsService.update(t.ownerCtx, { ...settings, nextInvoiceNumber: "10005" })).rejects.toBeInstanceOf(ValidationError);
    await expect(billingSettingsService.update(t.ownerCtx, { ...settings, nextOrderNumber: "1002" })).rejects.toBeInstanceOf(ValidationError);
    await billingSettingsService.update(t.ownerCtx, { ...settings, nextInvoiceNumber: "20001", nextOrderNumber: "5001" });
    const d = await salesDocumentService.create(t.ownerCtx, { kind: "INVOICE", buyerName: "Uusi sarja Oy" });
    await salesDocumentService.addLine(t.ownerCtx, d.id, line());
    expect((await salesDocumentService.issue(t.ownerCtx, d.id)).number).toBe("20001");
  });

  it("validates header and lines", async () => {
    const d = await salesDocumentService.create(t.ownerCtx, { kind: "INVOICE", buyerName: "Validointi Oy" });
    await expect(salesDocumentService.issue(t.ownerCtx, d.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(salesDocumentService.addLine(t.ownerCtx, d.id, line({ quantity: "0" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(salesDocumentService.addLine(t.ownerCtx, d.id, line({ discountPct: "101" }))).rejects.toBeInstanceOf(ValidationError);
    const header = { buyerName: "Validointi Oy", issueDate: "2026-11-24", vatMode: "STANDARD" as const };
    await expect(salesDocumentService.update(t.ownerCtx, d.id, { ...header, dueDate: "2026-11-20" })).rejects.toBeInstanceOf(ValidationError);
    await expect(salesDocumentService.update(t.ownerCtx, d.id, { ...header, vatMode: "REVERSE_CHARGE" })).rejects.toBeInstanceOf(ValidationError);
    const u = await salesDocumentService.update(t.ownerCtx, d.id, { ...header, vatMode: "REVERSE_CHARGE", buyerVatNumber: "FI01120389", language: "en", buyerReference: "PO-4471" });
    expect(u.vatMode).toBe("REVERSE_CHARGE");
    await salesDocumentService.addLine(t.ownerCtx, d.id, line());
    const got = await salesDocumentService.get(t.ownerCtx, d.id);
    expect(got.totals).toMatchObject({ net: "1740.00", vat: "0.00", gross: "1740.00" });
    expect(got.fileName).toBe("Invoice-luonnos.pdf");
    await expect(salesDocumentService.send(t.ownerCtx, d.id, { to: "a@example.test", cc: "not an address" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to send when no e-mail is configured, without issuing", async () => {
    setMailerForTests(null);
    const d = await salesDocumentService.create(t.ownerCtx, { kind: "INVOICE", buyerName: "Ei postia Oy" });
    await salesDocumentService.addLine(t.ownerCtx, d.id, line());
    await expect(salesDocumentService.send(t.ownerCtx, d.id, { to: "a@example.test" })).rejects.toBeInstanceOf(ValidationError);
    expect((await salesDocumentService.get(t.ownerCtx, d.id)).status).toBe("DRAFT");
  });
});

describe("permissions", () => {
  it("project managers can invoice; other roles cannot", async () => {
    const pm = await createMember(t, "PROJECT_MANAGER");
    const d = await salesDocumentService.create(pm, { kind: "ORDER_CONFIRMATION", customerId });
    expect(d.salesperson).toContain("PROJECT_MANAGER");
    for (const role of ["SITE_MANAGER", "SUPERVISOR", "EMPLOYEE", "HSE", "LOGISTICS_COORDINATOR"] as const) {
      const ctx = await createMember(t, role);
      await expect(salesDocumentService.list(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(salesDocumentService.get(ctx, d.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const role of ["CLIENT", "SUBCONTRACTOR"] as const) {
      const ctx = await createMember(t, role);
      await expect(salesDocumentService.list(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(billingSettingsService.get(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
