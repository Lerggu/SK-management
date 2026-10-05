import { z } from "zod";
import { parseLocalDateTime } from "@/platform/i18n/time";
import { dateOnly, flag, optionalDate, optionalDecimal, optionalText, optionalUuid, text, uuid } from "@/platform/http/validation";

const localDateTime = () =>
  z
    .string()
    .trim()
    .transform((s, c) => {
      const d = parseLocalDateTime(s);
      if (!d) c.addIssue({ code: "custom", message: "validation.dateTime" });
      return d ?? new Date(0);
    });

const int = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.trim())) : v), z.number().int().min(min).max(max));

/** Positive metres/kilograms with one decimal ("12,5" accepted). */
const positive = (maxInt = 8) =>
  z.preprocess(
    (v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().replace(",", ".") : v),
    z
      .string()
      .regex(new RegExp(`^\\d{1,${maxInt}}(\\.\\d)?$`), "validation.decimal")
      .refine((s) => Number(s) > 0, "validation.positive"),
  );

const code = () =>
  z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "validation.code")
    .transform((s) => s.toUpperCase());

export const ACCESSORY_KINDS = ["SLING", "CHAIN", "SHACKLE", "HOOK", "SPREADER_BEAM", "LIFTING_CLAMP", "OTHER"] as const;
export const MATERIAL_STATUSES = ["RECEIVED", "STORED", "AT_WORKFACE", "INSTALLED", "RETURNED"] as const;
export const DRUM_STATUSES = ["IN_STOCK", "IN_USE", "EMPTY", "RETURNED"] as const;
export const LABEL_KINDS = ["drum", "batch", "accessory"] as const;

export const accessorySchema = z.object({
  code: code(),
  name: text(120),
  kind: z.enum(ACCESSORY_KINDS),
  wllKg: positive(6),
  manufacturer: optionalText(120),
  serialNumber: optionalText(80),
  nextInspectionDate: optionalDate(),
  notes: optionalText(500),
});
export type AccessoryInput = z.input<typeof accessorySchema>;

export const accessoryUpdateSchema = accessorySchema.omit({ code: true }).extend({ status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE") });
export type AccessoryUpdateInput = z.input<typeof accessoryUpdateSchema>;

export const liftPlanSchema = z
  .object({
    siteId: uuid(),
    requestId: optionalUuid(),
    activityId: optionalUuid(),
    title: text(160),
    plannedStart: localDateTime(),
    plannedEnd: localDateTime(),
  })
  .refine((v) => v.plannedEnd > v.plannedStart, { path: ["plannedEnd"], message: "validation.endBeforeStart" });
export type LiftPlanInput = z.input<typeof liftPlanSchema>;

export const liftPlanListSchema = z.object({ siteId: optionalUuid(), status: z.enum(["OPEN", "COMPLETED", "CANCELLED"]).optional() });

export const liftVersionSchema = z.object({
  loadDescription: optionalText(500),
  loadWeightKg: optionalDecimal(8, 1),
  riggingWeightKg: optionalDecimal(8, 1),
  cogNotes: optionalText(500),
  craneId: optionalUuid(),
  radiusM: optionalDecimal(4, 2),
  craneCapacityKg: optionalDecimal(8, 1),
  areaDescription: optionalText(500),
  safetyDistanceM: optionalDecimal(4, 2),
  riskDocumentId: optionalUuid(),
});
export type LiftVersionInput = z.input<typeof liftVersionSchema>;

export const liftAccessorySchema = z.object({ accessoryId: uuid(), count: int(1, 100).default(1) });
export type LiftAccessoryInput = z.input<typeof liftAccessorySchema>;

export const liftDecisionSchema = z
  .object({ decision: z.enum(["APPROVE", "REJECT"]), note: optionalText(500), acknowledgeWarnings: flag() })
  .refine((v) => v.decision === "APPROVE" || !!v.note, { path: ["note"], message: "validation.required" });
export type LiftDecisionInput = z.input<typeof liftDecisionSchema>;

export const reasonSchema = z.object({ reason: text(500) });
export const noteSchema = z.object({ note: optionalText(500) });

export const materialBatchSchema = z.object({
  siteId: uuid(),
  code: code(),
  material: text(200),
  quantity: positive(10),
  unit: text(20),
  deliveryId: optionalUuid(),
  activityId: optionalUuid(),
  locationId: optionalUuid(),
  notes: optionalText(500),
});
export type MaterialBatchInput = z.input<typeof materialBatchSchema>;

export const materialMoveSchema = z.object({
  to: z.enum(MATERIAL_STATUSES),
  locationId: optionalUuid(),
  activityId: optionalUuid(),
  note: optionalText(300),
});
export type MaterialMoveInput = z.input<typeof materialMoveSchema>;

export const materialListSchema = z.object({ siteId: optionalUuid(), status: z.enum(MATERIAL_STATUSES).optional() });

export const drumSchema = z.object({
  siteId: uuid(),
  code: code(),
  manufacturer: optionalText(120),
  cableType: text(120),
  originalLengthM: positive(6),
  weightKg: optionalDecimal(8, 1),
  dimensions: optionalText(80),
  locationId: optionalUuid(),
  reservedActivityId: optionalUuid(),
  deliveryId: optionalUuid(),
  receivedDate: optionalDate(),
  nextInspectionDate: optionalDate(),
  notes: optionalText(500),
});
export type DrumInput = z.input<typeof drumSchema>;

export const drumUpdateSchema = z.object({
  locationId: optionalUuid(),
  reservedActivityId: optionalUuid(),
  nextInspectionDate: optionalDate(),
  returned: flag(),
  notes: optionalText(500),
});
export type DrumUpdateInput = z.input<typeof drumUpdateSchema>;

export const pullSchema = z.object({
  lengthM: positive(6),
  activityId: optionalUuid(),
  pulledOn: dateOnly(),
  note: optionalText(300),
});
export type PullInput = z.input<typeof pullSchema>;

export const labelSchema = z.object({
  kind: z.enum(LABEL_KINDS),
  siteId: optionalUuid(),
  ids: z.preprocess((v) => (typeof v === "string" ? (v ? v.split(",") : []) : v), z.array(z.uuid()).max(500)).default([]),
});
export type LabelInput = z.input<typeof labelSchema>;

export const scanSchema = z.object({ code: z.string().trim().min(1).max(200) });
