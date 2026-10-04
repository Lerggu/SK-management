import { z } from "zod";
import { optionalDate, optionalDecimal, optionalText, text, uuid } from "@/platform/http/validation";

export const PROJECT_STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED"] as const;
export const SITE_STATUSES = ["ACTIVE", "CLOSED"] as const;

export const projectSchema = z
  .object({
    code: text(30),
    name: text(160),
    customerName: optionalText(160),
    description: optionalText(2000),
    status: z.enum(PROJECT_STATUSES).default("PLANNED"),
    startDate: optionalDate(),
    endDate: optionalDate(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { path: ["endDate"], message: "validation.endBeforeStart" });
export type ProjectInput = z.input<typeof projectSchema>;

export const siteSchema = z.object({
  code: optionalText(30),
  name: text(160),
  address: optionalText(200),
  postalCode: optionalText(10),
  city: optionalText(80),
  latitude: optionalDecimal(3, 6),
  longitude: optionalDecimal(3, 6),
  status: z.enum(SITE_STATUSES).default("ACTIVE"),
  notes: optionalText(2000),
});
export type SiteInput = z.input<typeof siteSchema>;

export const projectListSchema = z.object({
  q: optionalText(100),
  includeArchived: z.coerce.boolean().default(false),
});

export const assignMemberSchema = z.object({
  userId: uuid(),
  roleId: uuid(),
});
export type AssignMemberInput = z.input<typeof assignMemberSchema>;
