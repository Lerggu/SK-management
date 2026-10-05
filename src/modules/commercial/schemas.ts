import { z } from "zod";
import { dateOnly, decimalString, flag, optionalDate, optionalDecimal, optionalEmail, optionalText, optionalUuid, text, uuid } from "@/platform/http/validation";
import { OPPORTUNITY_STAGES, QUOTE_LINE_CATEGORIES } from "./rules";

const optionalInt = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v.trim()) : v), z.number().int().min(min).max(max).nullable()).default(null);
/** Percent 0–100 with two decimals ("12,5" accepted). */
const percent = (max = 100) =>
  z
    .preprocess((v) => (v === "" || v === undefined || v === null ? "0" : typeof v === "number" ? String(v) : v), decimalString(4, 2))
    .refine((s) => Number(s) >= 0 && Number(s) <= max, "validation.percent");
const money = () => z.preprocess((v) => (typeof v === "number" ? String(v) : v), decimalString(12, 2));
const optionalMoney = () => optionalDecimal(12, 2);

export const customerSchema = z.object({
  name: text(160),
  businessId: optionalText(20),
  address: optionalText(200),
  postalCode: optionalText(10),
  city: optionalText(80),
  notes: optionalText(1000),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const contactSchema = z.object({
  name: text(120),
  title: optionalText(120),
  email: optionalEmail(),
  phone: optionalText(40),
});
export type ContactInput = z.input<typeof contactSchema>;

export const customerListSchema = z.object({ q: optionalText(100), includeArchived: flag() });

export const opportunitySchema = z
  .object({
    customerId: uuid(),
    title: text(200),
    stage: z.enum(OPPORTUNITY_STAGES).default("LEAD"),
    estimatedValue: optionalMoney(),
    probabilityPct: optionalInt(0, 100),
    expectedCloseDate: optionalDate(),
    lostReason: optionalText(500),
    notes: optionalText(1000),
  })
  .refine((v) => v.stage !== "LOST" || !!v.lostReason, { path: ["lostReason"], message: "validation.required" });
export type OpportunityInput = z.input<typeof opportunitySchema>;

export const opportunityListSchema = z.object({ stage: z.enum(OPPORTUNITY_STAGES).optional(), customerId: optionalUuid() });

export const quoteSchema = z.object({
  customerId: uuid(),
  opportunityId: optionalUuid(),
  projectId: optionalUuid(),
  title: text(200),
});
export type QuoteInput = z.input<typeof quoteSchema>;

export const quoteDraftSchema = z.object({
  scope: optionalText(4000),
  overheadPct: percent(),
  riskPct: percent(),
  marginPct: percent(99.99),
  validUntil: optionalDate(),
});
export type QuoteDraftInput = z.input<typeof quoteDraftSchema>;

export const quoteLineSchema = z.object({
  category: z.enum(QUOTE_LINE_CATEGORIES),
  description: text(300),
  quantity: z.preprocess((v) => (typeof v === "number" ? String(v) : v), decimalString(10, 2)).refine((s) => Number(s) > 0, "validation.positive"),
  unit: text(20),
  unitCost: money(),
});
export type QuoteLineInput = z.input<typeof quoteLineSchema>;

export const decisionSchema = z
  .object({ decision: z.enum(["APPROVE", "REJECT"]), note: optionalText(500) })
  .refine((v) => v.decision === "APPROVE" || !!v.note, { path: ["note"], message: "validation.required" });
export type DecisionInput = z.input<typeof decisionSchema>;

export const reasonSchema = z.object({ reason: text(500) });
export const noteSchema = z.object({ note: optionalText(500) });

export const outcomeSchema = z
  .object({
    outcome: z.enum(["WON", "LOST"]),
    note: optionalText(500),
    projectId: optionalUuid(),
    contractNumber: optionalText(40),
    signedDate: optionalDate(),
  })
  .superRefine((v, c) => {
    if (v.outcome === "LOST" && !v.note) c.addIssue({ code: "custom", path: ["note"], message: "validation.required" });
    if (v.outcome === "WON" && !v.projectId) c.addIssue({ code: "custom", path: ["projectId"], message: "validation.required" });
  });
export type OutcomeInput = z.input<typeof outcomeSchema>;

export const contractSchema = z.object({
  projectId: uuid(),
  customerId: uuid(),
  contractNumber: text(40),
  title: text(200),
  value: money(),
  signedDate: optionalDate(),
  retentionNote: optionalText(500),
});
export type ContractInput = z.input<typeof contractSchema>;

export const contractUpdateSchema = z.object({
  title: text(200),
  signedDate: optionalDate(),
  retentionNote: optionalText(500),
  closed: flag(),
});
export type ContractUpdateInput = z.input<typeof contractUpdateSchema>;

export const milestoneSchema = z.object({ title: text(200), amount: money().refine((s) => Number(s) > 0, "validation.positive"), dueDate: dateOnly() });
export type MilestoneInput = z.input<typeof milestoneSchema>;

export const variationSchema = z.object({
  projectId: uuid(),
  contractId: optionalUuid(),
  title: text(200),
  description: optionalText(4000),
  cause: optionalText(1000),
  clientReference: optionalText(200),
});
export type VariationInput = z.input<typeof variationSchema>;

export const variationDraftSchema = z.object({
  title: text(200),
  description: optionalText(4000),
  cause: optionalText(1000),
  clientReference: optionalText(200),
  laborCost: money().default("0"),
  equipmentCost: money().default("0"),
  materialsCost: money().default("0"),
  subcontractCost: money().default("0"),
  otherCost: money().default("0"),
  markupPct: percent(1000),
  evidenceDocumentId: optionalUuid(),
});
export type VariationDraftInput = z.input<typeof variationDraftSchema>;

export const clientDecisionSchema = z
  .object({ decision: z.enum(["APPROVED", "REJECTED"]), clientReference: optionalText(200), evidenceDocumentId: optionalUuid(), note: optionalText(500) })
  .refine((v) => v.decision === "REJECTED" || !!v.clientReference || !!v.evidenceDocumentId, { path: ["clientReference"], message: "validation.approvalEvidence" });
export type ClientDecisionInput = z.input<typeof clientDecisionSchema>;

export const generateSchema = z.object({ projectId: uuid(), to: dateOnly() });
export type GenerateInput = z.input<typeof generateSchema>;
export const generateInternalSchema = z.object({ to: dateOnly() });

export const CANDIDATE_STATUSES = ["OPEN", "EXPORTED", "INVOICED", "VOID"] as const;
export const candidateListSchema = z.object({ projectId: optionalUuid(), status: z.enum(CANDIDATE_STATUSES).optional(), kind: z.enum(["CUSTOMER", "INTERNAL"]).default("CUSTOMER") });

export const exportSchema = z.object({
  kind: z.enum(["CUSTOMER", "INTERNAL"]),
  format: z.enum(["CSV", "JSON"]).default("CSV"),
  projectId: optionalUuid(),
  includeExported: flag(),
});
export type ExportInput = z.input<typeof exportSchema>;

export const markInvoicedSchema = z.object({
  ids: z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.uuid()).min(1).max(500)),
  invoiceReference: text(80),
});
export type MarkInvoicedInput = z.input<typeof markInvoicedSchema>;

export const etcSchema = z.object({
  category: z.enum(["LABOR", "EQUIPMENT", "MATERIALS", "SUBCONTRACT", "OTHER"]),
  etcAmount: money(),
  note: optionalText(300),
});
export type EtcInput = z.input<typeof etcSchema>;

