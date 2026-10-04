import { z } from "zod";
import { optionalDate, optionalEmail, optionalText, optionalUuid, text } from "@/platform/http/validation";

export const EMPLOYMENT_TYPES = ["EMPLOYEE", "CONTRACTOR", "TEMPORARY"] as const;
export const RESOURCE_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export const employeeSchema = z
  .object({
    employeeNumber: text(30),
    firstName: text(80),
    lastName: text(80),
    email: optionalEmail(),
    phone: optionalText(40),
    jobTitle: optionalText(120),
    trade: optionalText(120),
    employmentType: z.enum(EMPLOYMENT_TYPES).default("EMPLOYEE"),
    status: z.enum(RESOURCE_STATUSES).default("ACTIVE"),
    userId: optionalUuid(),
    startDate: optionalDate(),
    endDate: optionalDate(),
    notes: optionalText(2000),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { path: ["endDate"], message: "validation.endBeforeStart" });
export type EmployeeInput = z.input<typeof employeeSchema>;

export const employeeListSchema = z.object({
  q: optionalText(100),
  includeArchived: z.coerce.boolean().default(false),
});
