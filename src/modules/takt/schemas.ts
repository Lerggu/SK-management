import { z } from "zod";
import { dateOnly, flag, optionalDate, optionalText, optionalUuid, text, uuid } from "@/platform/http/validation";

const int = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.trim())) : v), z.number().int().min(min).max(max));

export const DEPENDENCY_TYPES = ["FS", "SS", "FF", "SF"] as const;
export const CONSTRAINT_TYPES = ["DRAWINGS", "MATERIAL", "WORKFORCE", "EQUIPMENT", "PERMIT", "AREA", "OTHER"] as const;
export const BUILDING_KINDS = ["BUILDING", "AREA"] as const;
export const LOOKAHEAD_WEEKS = [2, 6, 12] as const;

export const buildingSchema = z.object({
  siteId: uuid(),
  name: text(120),
  code: optionalText(20),
  kind: z.enum(BUILDING_KINDS).default("BUILDING"),
});
export type BuildingInput = z.input<typeof buildingSchema>;

export const areaSchema = z.object({
  buildingId: uuid(),
  code: text(20),
  name: text(120),
  sortOrder: int(0, 9999).optional(),
});
export type AreaInput = z.input<typeof areaSchema>;

export const areaUpdateSchema = areaSchema.omit({ buildingId: true });
export type AreaUpdateInput = z.input<typeof areaUpdateSchema>;

export const workPackageSchema = z.object({
  code: text(20),
  name: text(120),
  trade: optionalText(80),
  color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "validation.color").default("#1E88A8"),
  defaultCrewSize: int(0, 500).default(2),
  defaultDurationCycles: int(1, 365).default(1),
  equipmentTypeId: optionalUuid(),
  equipmentCount: int(0, 100).default(0),
  sortOrder: int(0, 9999).optional(),
});
export type WorkPackageInput = z.input<typeof workPackageSchema>;

export const planSchema = z.object({
  siteId: uuid(),
  name: text(120),
  startDate: dateOnly(),
  cycleLengthDays: int(1, 20).default(1),
});
export type PlanInput = z.input<typeof planSchema>;

export const draftSchema = z.object({ reason: optionalText(500) });
export const versionStartSchema = z.object({ startDate: dateOnly(), reason: optionalText(500) });
export const returnSchema = z.object({ note: text(500) });

export const trainSchema = z.object({
  startCycle: int(0, 3650).default(0),
  bufferCycles: int(0, 30).default(0),
});
export type TrainInput = z.input<typeof trainSchema>;

export const assignmentSchema = z.object({
  startCycle: int(0, 3650),
  durationCycles: int(1, 365),
});
export type AssignmentInput = z.input<typeof assignmentSchema>;

export const shiftSchema = z.object({ days: int(-365, 365).refine((n) => n !== 0, "validation.nonZero") });

export const activitySchema = z.object({
  workPackageId: uuid(),
  taktAreaId: uuid(),
  name: optionalText(160),
});
export type ActivityInput = z.input<typeof activitySchema>;

export const activityUpdateSchema = z.object({
  name: text(160),
  crewTrade: optionalText(80),
  crewSize: int(0, 500),
  equipmentTypeId: optionalUuid(),
  equipmentCount: int(0, 100).default(0),
});
export type ActivityUpdateInput = z.input<typeof activityUpdateSchema>;

export const dependencySchema = z.object({
  predecessorId: uuid(),
  successorId: uuid(),
  type: z.enum(DEPENDENCY_TYPES).default("FS"),
  lagDays: int(-365, 365).default(0),
});
export type DependencyInput = z.input<typeof dependencySchema>;

export const constraintSchema = z.object({
  type: z.enum(CONSTRAINT_TYPES),
  description: text(300),
  dueDate: optionalDate(),
});
export type ConstraintInput = z.input<typeof constraintSchema>;

export const progressSchema = z.object({
  progressPct: int(0, 100),
  reportDate: dateOnly(),
  note: optionalText(500),
});
export type ProgressInput = z.input<typeof progressSchema>;

export const blockSchema = z
  .object({ blocked: flag(), delayReason: optionalText(300), recoveryAction: optionalText(500) })
  .refine((v) => !v.blocked || !!v.delayReason, { path: ["delayReason"], message: "validation.required" });
export type BlockInput = z.input<typeof blockSchema>;

export const holidaySchema = z.object({ date: dateOnly(), name: text(80) });
export const weekdaysSchema = z.object({ workingWeekdays: z.array(int(1, 7)).min(1).max(7) });
export const holidayYearSchema = z.object({ year: int(2000, 2100) });

export const lookaheadSchema = z.object({
  weeks: z.preprocess((v) => (v === undefined || v === "" ? 2 : Number(v)), z.union([z.literal(2), z.literal(6), z.literal(12)])),
  projectId: optionalUuid(),
  from: optionalDate(),
});
export type LookaheadInput = z.input<typeof lookaheadSchema>;

export const importOptionsSchema = z.object({
  buildingId: uuid(),
  areaLevel: int(1, 3).default(1),
});
export type ImportOptionsInput = z.input<typeof importOptionsSchema>;
