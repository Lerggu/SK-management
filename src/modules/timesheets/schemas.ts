import { z } from "zod";
import { dateOnly, optionalText, optionalUuid, text, uuid } from "@/platform/http/validation";
import { hoursBetween, parseClock } from "./rules";

export const WORK_CLASSES = ["NORMAL", "OVERTIME_50", "OVERTIME_100", "TRAVEL"] as const;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const clock = z.preprocess(emptyToUndefined, z.string().optional()).refine((v) => v === undefined || parseClock(v) !== null, "validation.clock");
const hoursValue = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim().replace(",", ".")) : v),
  z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "validation.hours").optional(),
);

/**
 * Hours are given either as a number or as start/end clock times. The output
 * always carries `hours` (string, 2 decimals) for numeric(5,2).
 */
const hoursFields = z
  .object({ hours: hoursValue, startTime: clock, endTime: clock })
  .transform((v, ctx) => {
    if (v.startTime || v.endTime) {
      const start = v.startTime ? parseClock(v.startTime) : null;
      const end = v.endTime ? parseClock(v.endTime) : null;
      if (start === null || end === null || end <= start) {
        ctx.addIssue({ code: "custom", path: ["endTime"], message: "validation.timeRange" });
        return z.NEVER;
      }
      return { hours: hoursBetween(start, end).toFixed(2), startMinute: start, endMinute: end };
    }
    if (!v.hours) {
      ctx.addIssue({ code: "custom", path: ["hours"], message: "validation.required" });
      return z.NEVER;
    }
    const n = Number(v.hours);
    if (!(n > 0 && n <= 24)) {
      ctx.addIssue({ code: "custom", path: ["hours"], message: "validation.hours" });
      return z.NEVER;
    }
    return { hours: n.toFixed(2), startMinute: null, endMinute: null };
  });

const entryBase = z.object({
  projectId: uuid(),
  siteId: optionalUuid(),
  workDate: dateOnly(),
  workClass: z.enum(WORK_CLASSES).default("NORMAL"),
  note: optionalText(500),
});

export const timeEntrySchema = z.intersection(entryBase.extend({ employeeId: optionalUuid() }), hoursFields);
export type TimeEntryInput = z.input<typeof entryBase> & { employeeId?: string | null; hours?: string; startTime?: string; endTime?: string };

export const crewEntrySchema = z.intersection(entryBase.extend({ employeeIds: z.array(uuid()).min(1, "validation.selectPeople").max(50) }), hoursFields);
export type CrewEntryInput = z.input<typeof entryBase> & { employeeIds: string[]; hours?: string; startTime?: string; endTime?: string };

export const weekQuerySchema = z.object({ employeeId: optionalUuid(), date: dateOnly() });

export const submitWeekSchema = z.object({ employeeId: optionalUuid(), date: dateOnly() });

export const decisionSchema = z
  .object({
    entryIds: z.array(uuid()).min(1, "validation.selectEntries").max(500),
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: optionalText(500),
  })
  .refine((v) => v.decision === "APPROVE" || v.reason, { path: ["reason"], message: "validation.reasonRequired" });

export const correctionSchema = z.object({
  hours: z
    .string()
    .trim()
    .transform((s) => s.replace(",", "."))
    .refine((s) => /^-?\d{1,2}(\.\d{1,2})?$/.test(s) && Number(s) !== 0 && Math.abs(Number(s)) <= 24, "validation.correctionHours"),
  note: text(500),
});

export const exportSchema = z
  .object({ from: dateOnly(), to: dateOnly() })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "validation.endBeforeStart" });

export const approvalQuerySchema = z.object({ projectId: optionalUuid() });
