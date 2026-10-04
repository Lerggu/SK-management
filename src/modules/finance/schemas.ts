import { z } from "zod";
import { currency, dateOnly, decimalString, optionalText, optionalUuid, text } from "@/platform/http/validation";

export const CATEGORIES = ["LABOR", "EQUIPMENT", "MATERIALS", "SUBCONTRACT", "OTHER"] as const;

export const createBudgetSchema = z.object({ note: optionalText(500), copyFromCurrent: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(true) });

export const budgetLineSchema = z.object({
  category: z.enum(CATEGORIES),
  description: text(200),
  amount: decimalString(12, 2),
});
export type BudgetLineInput = z.input<typeof budgetLineSchema>;

/** Credit notes may be negative; zero is rejected. */
const signedAmount = () =>
  z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s ]/g, "").replace(",", "."))
    .refine((s) => /^-?\d{1,12}(\.\d{1,2})?$/.test(s) && Number(s) !== 0, "validation.amountNonZero");

export const costEntrySchema = z.object({
  category: z.enum(CATEGORIES),
  entryDate: dateOnly(),
  description: text(200),
  supplier: optionalText(120),
  reference: optionalText(60),
  amount: signedAmount(),
  currency: currency(),
  siteId: optionalUuid(),
});
export type CostEntryInput = z.input<typeof costEntrySchema>;
