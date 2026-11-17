import { z } from "zod";
import { flag, optionalText, optionalUuid, uuid } from "@/platform/http/validation";
import { MAX_RANGE_DAYS, ROTATION_STATUSES, toDay } from "./rotation";

const isoDay = () =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date")
    .refine((s) => !Number.isNaN(toDay(s).getTime()) && toDay(s).toISOString().startsWith(s), "validation.date");

/** until on or after from, and at most MAX_RANGE_DAYS days. */
function checkRange(d: { from: string; until: string }, ctx: z.RefinementCtx) {
  if (d.until < d.from) ctx.addIssue({ code: "custom", path: ["until"], message: "validation.endBeforeStart" });
  else if ((toDay(d.until).getTime() - toDay(d.from).getTime()) / 86_400_000 >= MAX_RANGE_DAYS) ctx.addIssue({ code: "custom", path: ["until"], message: "validation.tooBig" });
}

const int = (min: number, max: number) => z.preprocess((v) => (typeof v === "string" ? Number(v.trim()) : v), z.number().int().min(min).max(max));

export const boardSchema = z.object({
  date: isoDay().optional(),
  weeks: z.preprocess((v) => (v === undefined || v === "" ? 2 : Number(v)), z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6)])).default(2),
  trade: optionalText(80),
});

export const setRangeSchema = z
  .object({ from: isoDay(), until: isoDay(), employeeId: uuid(), status: z.enum(ROTATION_STATUSES), siteId: optionalUuid(), note: optionalText(200) })
  .superRefine(checkRange)
  .refine((d) => d.status === "WORK" || !d.siteId, { path: ["siteId"], message: "validation.invalidOption" });
export type SetRangeInput = z.input<typeof setRangeSchema>;

export const clearRangeSchema = z.object({ from: isoDay(), until: isoDay(), employeeId: uuid() }).superRefine(checkRange);
export type ClearRangeInput = z.input<typeof clearRangeSchema>;

export const patternSchema = z
  .object({
    from: isoDay(),
    until: isoDay(),
    employeeIds: z.array(uuid()).min(1, "validation.selectPeople").max(100),
    siteId: optionalUuid(),
    workDays: int(1, 60),
    offDays: int(0, 60),
    overwrite: flag(),
  })
  .superRefine(checkRange);
export type PatternInput = z.input<typeof patternSchema>;
