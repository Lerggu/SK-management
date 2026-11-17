import { z } from "zod";
import { optionalDecimal, optionalText, optionalUuid, text, uuid } from "@/platform/http/validation";
import { ZOOMS } from "./calendar";
import { TASK_COLORS } from "./rules";

const emptyToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

export const SERVICE_TYPES = ["DELIVERY", "LIFT", "INTERNAL_MOVE", "WASTE_REMOVAL", "OTHER"] as const;

export const taskTypeSchema = z.object({
  name: text(80),
  serviceType: z.enum(SERVICE_TYPES).default("OTHER"),
  description: optionalText(500),
  color: z.enum(TASK_COLORS).default("slate"),
});
export type TaskTypeInput = z.input<typeof taskTypeSchema>;

export const taskRoleSchema = z
  .object({
    kind: z.enum(["PERSON", "EQUIPMENT"]),
    label: text(80),
    quantity: z.coerce.number().int().min(1).max(20).default(1),
    qualificationTypeId: optionalUuid(),
    areaId: optionalUuid(),
    minLevel: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(4).nullable()).default(null),
    trade: optionalText(80),
    equipmentTypeId: optionalUuid(),
    minWeightKg: optionalDecimal(8, 1),
    maxWeightKg: optionalDecimal(8, 1),
  })
  .superRefine((v, c) => {
    if (v.kind === "EQUIPMENT" && !v.equipmentTypeId) c.addIssue({ code: "custom", path: ["equipmentTypeId"], message: "validation.required" });
    if (v.areaId && !v.minLevel) c.addIssue({ code: "custom", path: ["minLevel"], message: "validation.required" });
    if (v.minWeightKg !== null && v.maxWeightKg !== null && Number(v.minWeightKg) > Number(v.maxWeightKg)) c.addIssue({ code: "custom", path: ["maxWeightKg"], message: "validation.tooSmall" });
  });
export type TaskRoleInput = z.input<typeof taskRoleSchema>;

export const setTaskTypeSchema = z.object({ taskTypeId: optionalUuid() });

const resourceRef = () => z.string().regex(/^(EMPLOYEE|EQUIPMENT):[0-9a-f-]{36}$/i, "validation.invalidOption");
export const assignSchema = z.object({ roleId: uuid(), resource: resourceRef() });
export type AssignInput = z.input<typeof assignSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const calendarSchema = z.object({
  zoom: z.preprocess((v) => (v === undefined || v === "" ? "week" : v), z.enum(ZOOMS)),
  date: z.preprocess(emptyToNull, z.string().regex(ISO_DATE, "validation.date").nullable()).default(null),
  siteId: optionalUuid(),
});
