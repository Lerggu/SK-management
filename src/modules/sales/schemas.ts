import { z } from "zod";
import { dateOnly, decimalString, flag, optionalDate, optionalEmail, optionalText, optionalUuid, text } from "@/platform/http/validation";
import { isValidBusinessId, isValidIban, SALES_VAT_MODES } from "./rules";

/** Percent 0–100 with two decimals ("12,5" accepted). */
const percent = () =>
  z
    .preprocess((v) => (v === "" || v === undefined || v === null ? "0" : typeof v === "number" ? String(v) : v), decimalString(3, 2))
    .refine((s) => Number(s) >= 0 && Number(s) <= 100, "validation.percent");
const money = () => z.preprocess((v) => (typeof v === "number" ? String(v) : v), decimalString(12, 2));
const days = () =>
  z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : typeof v === "string" ? Number(v.trim()) : v), z.number().int().min(0).max(365));

export const billingSettingsSchema = z
  .object({
    enabled: flag(),
    legalName: text(160),
    businessId: z
      .string()
      .trim()
      .refine((v) => isValidBusinessId(v), "validation.businessId"),
    vatNumber: optionalText(20),
    streetAddress: text(200),
    postalCode: text(10),
    city: text(80),
    country: z.preprocess((v) => (v === "" || v === undefined || v === null ? "Suomi" : v), text(80)),
    phone: optionalText(40),
    email: optionalEmail(),
    website: optionalText(120),
    iban: z
      .string()
      .trim()
      .refine((v) => isValidIban(v), "validation.iban")
      .transform((v) => v.replace(/\s/g, "").toUpperCase()),
    bic: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() || null : v ?? null), z.string().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "validation.bic").nullable()),
    bankName: optionalText(80),
    paymentTermDays: days().default(14),
    penaltyInterest: z.preprocess((v) => (v === "" || v === undefined || v === null ? "Viivästyskorko korkolain mukaan" : v), text(200)),
    defaultVatRate: percent().default("25.5"),
    logo: z.enum(["NONE", "SK_INFRA"]).default("NONE"),
    nextOrderNumber: z.preprocess((v) => (typeof v === "string" ? Number(v.trim()) : v), z.number().int().min(1).max(999_999_999)),
    /** At least 100, so the reference number base always has three digits. */
    nextInvoiceNumber: z.preprocess((v) => (typeof v === "string" ? Number(v.trim()) : v), z.number().int().min(100).max(999_999_999)),
    footerNote: optionalText(300),
    domicile: optionalText(80),
    einvoiceAddress: optionalText(40),
    einvoiceOperator: optionalText(40),
    rentalTermsTitle: z.preprocess((v) => (v === "" || v === undefined || v === null ? "VUOKRAUSEHDOT" : v), text(120)),
    rentalTerms: optionalText(20000),
    salesTermsTitle: z.preprocess((v) => (v === "" || v === undefined || v === null ? "MYYNTIEHDOT" : v), text(120)),
    salesTerms: optionalText(20000),
  });
export type BillingSettingsInput = z.input<typeof billingSettingsSchema>;

/** A new order confirmation or invoice (credit notes are made from an invoice). */
export const SALES_TERMS_TYPES = ["NONE", "RENTAL", "SALE"] as const;

export const createSalesDocumentSchema = z.object({
  kind: z.enum(["ORDER_CONFIRMATION", "INVOICE"]),
  /** Rental or sales terms are attached from the billing settings. */
  termsType: z.preprocess((v) => (v === "" || v === undefined || v === null ? "NONE" : v), z.enum(SALES_TERMS_TYPES)),
  customerId: optionalUuid(),
  projectId: optionalUuid(),
  /** Without a CRM customer the buyer name is typed in. */
  buyerName: optionalText(200),
  title: optionalText(200),
});
export type CreateSalesDocumentInput = z.input<typeof createSalesDocumentSchema>;

export const salesDocumentHeaderSchema = z
  .object({
    language: z.enum(["fi", "en"]).default("fi"),
    projectId: optionalUuid(),
    title: optionalText(200),
    buyerCustomerNumber: optionalText(40),
    buyerName: text(200),
    buyerBusinessId: optionalText(20),
    buyerVatNumber: optionalText(20),
    buyerAddress: optionalText(300),
    buyerPostalCode: optionalText(10),
    buyerCity: optionalText(80),
    buyerCountry: optionalText(80),
    buyerContact: optionalText(120),
    buyerEmail: optionalEmail(),
    buyerReference: optionalText(100),
    buyerOrderNumber: optionalText(100),
    orderMark: optionalText(100),
    ourReference: optionalText(120),
    salesperson: optionalText(120),
    issueDate: dateOnly(),
    dueDate: optionalDate(),
    deliveryDate: optionalDate(),
    deliveryTerms: optionalText(200),
    deliveryMethod: optionalText(120),
    deliveryAddress: optionalText(300),
    deliveryInfo: optionalText(200),
    deliveryText: optionalText(500),
    paymentTerms: optionalText(120),
    vatMode: z.enum(SALES_VAT_MODES).default("STANDARD"),
    notes: optionalText(2000),
    termsType: z.preprocess((v) => (v === "" || v === undefined || v === null ? "NONE" : v), z.enum(SALES_TERMS_TYPES)),
    termsTitle: optionalText(120),
    terms: optionalText(20000),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.issueDate, { path: ["dueDate"], message: "validation.dueBeforeIssue" })
  // Reverse charge needs the buyer's VAT number on the invoice (AVL 209 f §).
  .refine((v) => v.vatMode !== "REVERSE_CHARGE" || !!v.buyerVatNumber || !!v.buyerBusinessId, { path: ["buyerVatNumber"], message: "validation.reverseChargeVat" });
export type SalesDocumentHeaderInput = z.input<typeof salesDocumentHeaderSchema>;

export const salesLineSchema = z.object({
  productCode: optionalText(60),
  name: text(300),
  description: optionalText(1000),
  /** Always positive here; credit note lines are stored negative by the service. */
  quantity: z.preprocess((v) => (typeof v === "number" ? String(v) : v), decimalString(10, 3)).refine((s) => Number(s) > 0, "validation.positive"),
  unit: z.preprocess((v) => (v === "" || v === undefined || v === null ? "kpl" : v), text(20)),
  unitPrice: money(),
  discountPct: percent().default("0"),
  vatRate: percent(),
  deliveryTime: optionalText(80),
});
export type SalesLineInput = z.input<typeof salesLineSchema>;

export const sendSalesDocumentSchema = z.object({
  to: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.email().max(200)),
  /** Comma or semicolon separated. */
  cc: optionalText(600),
  subject: optionalText(200),
  message: optionalText(4000),
});
export type SendSalesDocumentInput = z.input<typeof sendSalesDocumentSchema>;

export const voidSchema = z.object({ reason: text(500) });
export type VoidInput = z.input<typeof voidSchema>;

export const salesDocumentListSchema = z.object({
  kind: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["ORDER_CONFIRMATION", "INVOICE", "CREDIT_NOTE"]).optional()),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["DRAFT", "ISSUED", "VOID"]).optional()),
  q: optionalText(100),
});
export type SalesDocumentListInput = z.input<typeof salesDocumentListSchema>;
