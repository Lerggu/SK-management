import { z } from "zod";
import { optionalDate, optionalDecimal, optionalEmail, optionalText, text, uuid } from "@/platform/http/validation";
import { CALL_STATUSES, LEAD_STATUSES, MARKETING_CATEGORIES, MARKETING_SERVICES, MARKETING_STAGES } from "./rules";
import { ISO2_TO_ISO3 } from "@/platform/integrations/ted";

const int = (min: number, max: number) => z.preprocess((v) => (typeof v === "string" ? Number(v.trim()) : v), z.number().int().min(min).max(max));
const optionalInt = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v.trim()) : v), z.number().int().min(min).max(max).nullable()).default(null);
const flag = () => z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());
const list = <T extends z.ZodType>(item: T) => z.preprocess((v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]), z.array(item));

export const settingsSchema = z.object({
  enabled: flag().default(false),
  autoSend: flag().default(false),
  countries: list(z.string().trim().toUpperCase().refine((c) => c in ISO2_TO_ISO3, "validation.invalidOption")).pipe(z.array(z.string()).min(1, "validation.required").max(40)),
  minScore: int(0, 100),
  dailySendLimit: int(0, 200),
  intervalHours: int(1, 168),
  aiMonthlyBudgetEur: z.preprocess((v) => (typeof v === "string" ? Number(v.replace(",", ".").trim()) : v), z.number().min(0).max(1000)),
  replyToUserIds: list(uuid()).pipe(z.array(z.string()).max(10)),
  senderName: optionalText(120),
  pitch: optionalText(1500),
});
export type SettingsInput = z.input<typeof settingsSchema>;

export const leadFilterSchema = z.object({
  status: z.preprocess((v) => (v === "" ? null : v), z.enum(LEAD_STATUSES).nullable()).default(null),
  category: z.preprocess((v) => (v === "" ? null : v), z.enum(MARKETING_CATEGORIES).nullable()).default(null),
  q: optionalText(100),
  minScore: optionalInt(0, 100),
  includeClosed: flag().default(false),
});
export type LeadFilterInput = z.input<typeof leadFilterSchema>;

export const leadSchema = z
  .object({
    title: text(300),
    summary: optionalText(2000),
    category: z.enum(MARKETING_CATEGORIES),
    stage: z.enum(MARKETING_STAGES),
    status: z.enum(LEAD_STATUSES),
    country: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null), z.string().regex(/^[A-Z]{2}$/, "validation.invalidFormat").nullable()).default(null),
    location: optionalText(200),
    ownerOrg: optionalText(200),
    timing: optionalText(200),
    startDate: optionalDate(),
    tenderDeadline: optionalDate(),
    budget: optionalDecimal(12, 2),
    currency: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null), z.string().regex(/^[A-Z]{3}$/, "validation.currency").nullable()).default(null),
    budgetText: optionalText(200),
    voltageKv: optionalInt(0, 1000),
    fitScore: int(0, 100),
    services: list(z.enum(MARKETING_SERVICES)).default([]),
    fitReason: optionalText(400),
  })
  .refine((v) => v.budget === null || v.currency !== null, { path: ["currency"], message: "validation.required" });
export type LeadInput = z.input<typeof leadSchema>;

export const manualLeadSchema = z.object({
  title: text(300),
  country: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null), z.string().regex(/^[A-Z]{2}$/, "validation.invalidFormat").nullable()).default(null),
  ownerOrg: optionalText(200),
  location: optionalText(200),
  summary: optionalText(2000),
  sourceUrl: optionalText(1000),
});
export type ManualLeadInput = z.input<typeof manualLeadSchema>;

export const contactSchema = z
  .object({
    name: optionalText(120),
    role: optionalText(120),
    organization: optionalText(200),
    responsibility: optionalText(300),
    email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), optionalEmail()),
    phone: optionalText(40),
    sourceUrl: optionalText(1000),
  })
  .refine((v) => v.name || v.email || v.phone, { path: ["name"], message: "validation.required" });
export type ContactInput = z.input<typeof contactSchema>;

export const messageEditSchema = z.object({
  subject: text(120),
  body: text(4000),
  callScript: optionalText(3000),
});
export type MessageEditInput = z.input<typeof messageEditSchema>;

export const callSchema = z.object({
  callStatus: z.enum(CALL_STATUSES),
  callNote: optionalText(500),
});
export type CallInput = z.input<typeof callSchema>;

export const suppressionSchema = z.object({
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.email().max(200)),
});
export type SuppressionInput = z.input<typeof suppressionSchema>;
