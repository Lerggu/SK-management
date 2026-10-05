import { z } from "zod";
import { optionalText, text } from "@/platform/http/validation";
import { AI_RESULT_KINDS, AI_SEVERITIES } from "@/platform/ai";

export const askSchema = z.object({
  question: text(1000).refine((s) => s.length >= 3, "validation.tooShort"),
});
export type AskInput = z.input<typeof askSchema>;

export const recommendationDecisionSchema = z.object({
  decision: z.enum(["ACCEPTED", "DISMISSED"]),
  note: optionalText(1000),
});
export type RecommendationDecisionInput = z.input<typeof recommendationDecisionSchema>;

export const budgetSchema = z.object({
  monthlyBudgetEur: z.preprocess((v) => (typeof v === "string" ? Number(v.replace(",", ".").trim()) : v), z.number().min(0).max(10_000)),
});
export type BudgetInput = z.input<typeof budgetSchema>;

/** The model's answer is untrusted output: validate shape and lengths before storing. */
export const insightResultSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  items: z
    .array(
      z.object({
        kind: z.enum(AI_RESULT_KINDS as [string, ...string[]]),
        severity: z.enum(AI_SEVERITIES as [string, ...string[]]),
        title: z.string().trim().min(1).max(200),
        detail: z.string().trim().min(1).max(2000),
        evidence: z.array(z.string().max(64)).max(10),
      }),
    )
    .max(20),
});
export type InsightResult = z.output<typeof insightResultSchema>;
