import { z } from "zod";
import { parseClockTime, parseLocalDateTime } from "@/platform/i18n/time";
import { dateOnly, flag, optionalDecimal, optionalText, optionalUuid, text, uuid } from "@/platform/http/validation";

const int = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.trim())) : v), z.number().int().min(min).max(max));

/** "HH:MM" → minute of day. */
const clock = () =>
  z
    .string()
    .trim()
    .transform((s, c) => {
      const m = parseClockTime(s);
      if (m === null) c.addIssue({ code: "custom", message: "validation.time" });
      return m ?? 0;
    });

/** datetime-local in Europe/Helsinki → UTC Date. */
const localDateTime = () =>
  z
    .string()
    .trim()
    .transform((s, c) => {
      const d = parseLocalDateTime(s);
      if (!d) c.addIssue({ code: "custom", message: "validation.dateTime" });
      return d ?? new Date(0);
    });

export const LOCATION_KINDS = ["GATE", "UNLOADING", "STORAGE"] as const;
export const SERVICE_TYPES = ["DELIVERY", "LIFT", "INTERNAL_MOVE", "WASTE_REMOVAL", "OTHER"] as const;
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export const REQUEST_STATUSES = ["DRAFT", "REQUESTED", "REVIEW", "APPROVED", "SCHEDULED", "IN_PROGRESS", "COMPLETE", "CANCELLED"] as const;
export const DELIVERY_STATUSES = ["PLANNED", "CONFIRMED", "ARRIVED_GATE", "CHECKED_IN", "UNLOADING", "STORED", "MOVED_TO_WORKFACE", "INSTALLED", "CANCELLED"] as const;

export const locationSchema = z
  .object({
    siteId: uuid(),
    kind: z.enum(LOCATION_KINDS),
    name: text(80),
    opens: z.preprocess((v) => (v === "" || v === undefined ? null : v), clock().nullable()).default(null),
    closes: z.preprocess((v) => (v === "" || v === undefined ? null : v), clock().nullable()).default(null),
    notes: optionalText(300),
  })
  .superRefine((v, c) => {
    if (v.kind !== "GATE") return;
    if (v.opens === null) c.addIssue({ code: "custom", path: ["opens"], message: "validation.required" });
    if (v.closes === null) c.addIssue({ code: "custom", path: ["closes"], message: "validation.required" });
    if (v.opens !== null && v.closes !== null && (v.opens % 30 !== 0 || v.closes % 30 !== 0)) c.addIssue({ code: "custom", path: ["opens"], message: "validation.slotAlignment" });
    if (v.opens !== null && v.closes !== null && v.closes <= v.opens) c.addIssue({ code: "custom", path: ["closes"], message: "validation.endBeforeStart" });
  });
export type LocationInput = z.input<typeof locationSchema>;

const resourceRef = () => z.string().regex(/^(EMPLOYEE|EQUIPMENT):[0-9a-f-]{36}$/i, "validation.invalidOption");
const bookingBase = z.object({
  projectId: uuid(),
  siteId: optionalUuid(),
  activityId: optionalUuid(),
  requirementId: optionalUuid(),
  /** V5: crew booked for a lift plan (riggers, crane operators). */
  liftPlanId: optionalUuid(),
  startsAt: localDateTime(),
  endsAt: localDateTime(),
  note: optionalText(300),
});
const endAfterStart = { path: ["endsAt"], message: "validation.endBeforeStart" };

/** One or more resources ("EMPLOYEE:<id>" / "EQUIPMENT:<id>"); several = a crew. */
export const bookingSchema = bookingBase
  .extend({ resources: z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(resourceRef()).min(1).max(50)) })
  .refine((v) => v.endsAt > v.startsAt, endAfterStart);
export type BookingInput = z.input<typeof bookingSchema>;

export const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: optionalText(300),
  acceptConflicts: flag(),
});
export type DecisionInput = z.input<typeof decisionSchema>;

export const bookingListSchema = z.object({ projectId: optionalUuid(), from: dateOnly().optional(), to: dateOnly().optional() });

export const requestSchema = z
  .object({
    siteId: uuid(),
    activityId: optionalUuid(),
    serviceType: z.enum(SERVICE_TYPES),
    title: text(160),
    requestedStart: localDateTime(),
    requestedEnd: localDateTime(),
    loadDescription: optionalText(500),
    weightKg: optionalDecimal(8, 1),
    dimensions: optionalText(120),
    pickup: optionalText(160),
    destination: optionalText(160),
    equipmentTypeId: optionalUuid(),
    priority: z.enum(PRIORITIES).default("NORMAL"),
    note: optionalText(500),
    submit: flag(),
  })
  .refine((v) => v.requestedEnd > v.requestedStart, { path: ["requestedEnd"], message: "validation.endBeforeStart" });
export type RequestInput = z.input<typeof requestSchema>;

export const transitionSchema = z.object({ to: z.enum(REQUEST_STATUSES), note: optionalText(300) });
export type TransitionInput = z.input<typeof transitionSchema>;

export const requestListSchema = z.object({ siteId: optionalUuid(), status: z.enum(REQUEST_STATUSES).optional() });

export const deliverySchema = z.object({
  siteId: uuid(),
  gateId: uuid(),
  unloadingId: optionalUuid(),
  storageId: optionalUuid(),
  requestId: optionalUuid(),
  activityId: optionalUuid(),
  supplier: text(120),
  carrier: optionalText(120),
  vehicle: optionalText(40),
  material: text(200),
  quantity: optionalText(80),
  weightKg: optionalDecimal(8, 1),
  date: dateOnly(),
  startTime: clock(),
  slots: int(1, 24).default(1),
  notes: optionalText(500),
});
export type DeliveryInput = z.input<typeof deliverySchema>;

export const rescheduleSchema = z.object({ gateId: uuid(), date: dateOnly(), startTime: clock(), slots: int(1, 24) });
export type RescheduleInput = z.input<typeof rescheduleSchema>;

export const advanceSchema = z.object({ to: z.enum(DELIVERY_STATUSES) });

export const boardSchema = z.object({ siteId: uuid(), date: dateOnly() });
