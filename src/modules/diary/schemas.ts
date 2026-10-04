import { z } from "zod";
import { dateOnly, optionalDecimal, optionalText, optionalUuid, uuid } from "@/platform/http/validation";

export const ENTRY_KINDS = ["WORK", "EQUIPMENT", "DELAY", "INSTRUCTION"] as const;

export const openReportSchema = z.object({ siteId: uuid(), date: dateOnly() });

export const reportFieldsSchema = z.object({ weather: optionalText(200), summary: optionalText(4000) });

export const entrySchema = z
  .object({
    kind: z.enum(ENTRY_KINDS),
    description: optionalText(2000),
    equipmentId: optionalUuid(),
    hours: optionalDecimal(2, 2),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "EQUIPMENT") {
      if (!v.equipmentId) ctx.addIssue({ code: "custom", path: ["equipmentId"], message: "validation.required" });
      if (!v.hours || !(Number(v.hours) > 0 && Number(v.hours) <= 24)) ctx.addIssue({ code: "custom", path: ["hours"], message: "validation.hours" });
    } else if (!v.description) {
      ctx.addIssue({ code: "custom", path: ["description"], message: "validation.required" });
    }
  });
export type DiaryEntryInput = z.input<typeof entrySchema>;

export const listSchema = z.object({ projectId: uuid() });

export const attachmentMetaSchema = z.object({ caption: optionalText(300) });
