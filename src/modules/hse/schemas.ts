import { z } from "zod";
import { parseLocalDateTime } from "@/platform/i18n/time";
import { dateOnly, optionalDate, optionalText, optionalUuid, text, uuid } from "@/platform/http/validation";
import { HSE_CATEGORIES, HSE_SEVERITIES, INCIDENT_SEVERITIES, INCIDENT_TYPES, INSPECTION_KINDS, OBSERVATION_KINDS, PERMIT_TYPES } from "./rules";

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

const int = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.trim())) : v), z.number().int().min(min).max(max));
const optionalInt = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v.trim()) : v), z.number().int().min(min).max(max).nullable()).default(null);

/** Report time may not be in the future (5 min clock skew allowed). */
const notFuture = (d: Date) => d.getTime() <= Date.now() + 5 * 60_000;

export const observationSchema = z.object({
  projectId: uuid(),
  siteId: optionalUuid(),
  kind: z.enum(OBSERVATION_KINDS),
  category: z.enum(HSE_CATEGORIES).default("OTHER"),
  severity: z.enum(HSE_SEVERITIES).default("LOW"),
  title: text(200),
  description: optionalText(4000),
  location: optionalText(200),
  occurredAt: localDateTime().refine(notFuture, "validation.notFuture"),
  liftPlanId: optionalUuid(),
});
export type ObservationInput = z.input<typeof observationSchema>;

export const observationTriageSchema = z.object({
  category: z.enum(HSE_CATEGORIES),
  severity: z.enum(HSE_SEVERITIES),
});
export type ObservationTriageInput = z.input<typeof observationTriageSchema>;

export const closeSchema = z.object({ note: optionalText(2000) });
export type CloseInput = z.input<typeof closeSchema>;

export const incidentSchema = z.object({
  projectId: uuid(),
  siteId: optionalUuid(),
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES),
  title: text(200),
  description: optionalText(4000),
  location: optionalText(200),
  occurredAt: localDateTime().refine(notFuture, "validation.notFuture"),
  liftPlanId: optionalUuid(),
  immediateActions: optionalText(2000),
});
export type IncidentInput = z.input<typeof incidentSchema>;

export const incidentTriageSchema = z.object({
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES),
  immediateActions: optionalText(2000),
});
export type IncidentTriageInput = z.input<typeof incidentTriageSchema>;

export const investigationSchema = z.object({
  rootCause: text(4000),
  lostDays: optionalInt(0, 3650),
});
export type InvestigationInput = z.input<typeof investigationSchema>;

export const incidentPersonSchema = z.object({
  personName: text(160),
  employeeId: optionalUuid(),
  employerName: optionalText(160),
  injuryDescription: optionalText(2000),
  bodyPart: optionalText(120),
  absenceDays: optionalInt(0, 3650),
});
export type IncidentPersonInput = z.input<typeof incidentPersonSchema>;

export const HSE_RECORD_TYPES = ["OBSERVATION", "INCIDENT", "INSPECTION", "RISK_ASSESSMENT"] as const;
export type HseRecordType = (typeof HSE_RECORD_TYPES)[number];

export const actionSchema = z.object({
  sourceType: z.enum(HSE_RECORD_TYPES),
  sourceId: uuid(),
  title: text(200),
  description: optionalText(2000),
  assigneeId: optionalUuid(),
  dueDate: optionalDate(),
});
export type ActionInput = z.input<typeof actionSchema>;

export const actionDoneSchema = z.object({ note: optionalText(2000) });

export const toolboxTalkSchema = z.object({
  projectId: uuid(),
  siteId: optionalUuid(),
  heldOn: dateOnly(),
  topic: text(200),
  presenter: optionalText(160),
  attendeeCount: int(0, 1000),
  notes: optionalText(2000),
});
export type ToolboxTalkInput = z.input<typeof toolboxTalkSchema>;

export const riskAssessmentSchema = z.object({
  projectId: uuid(),
  siteId: optionalUuid(),
  title: text(200),
  workDescription: optionalText(4000),
  liftPlanId: optionalUuid(),
});
export type RiskAssessmentInput = z.input<typeof riskAssessmentSchema>;

export const riskAssessmentUpdateSchema = riskAssessmentSchema.omit({ projectId: true });
export type RiskAssessmentUpdateInput = z.input<typeof riskAssessmentUpdateSchema>;

export const riskItemSchema = z.object({
  hazard: text(300),
  likelihood: int(1, 5),
  consequence: int(1, 5),
  controls: optionalText(2000),
  residualLikelihood: optionalInt(1, 5),
  residualConsequence: optionalInt(1, 5),
});
export type RiskItemInput = z.input<typeof riskItemSchema>;

export const permitSchema = z
  .object({
    projectId: uuid(),
    siteId: optionalUuid(),
    type: z.enum(PERMIT_TYPES),
    description: text(2000),
    location: optionalText(200),
    contractor: optionalText(160),
    precautions: optionalText(4000),
    validFrom: localDateTime(),
    validTo: localDateTime(),
    liftPlanId: optionalUuid(),
  })
  .refine((v) => v.validTo.getTime() > v.validFrom.getTime(), { path: ["validTo"], message: "validation.endAfterStart" })
  .refine((v) => v.validTo.getTime() - v.validFrom.getTime() <= 14 * 24 * 3600_000, { path: ["validTo"], message: "validation.permitTooLong" });
export type PermitInput = z.input<typeof permitSchema>;

export const permitDecisionSchema = z
  .object({ decision: z.enum(["APPROVE", "REJECT"]), note: optionalText(2000) })
  .refine((v) => v.decision === "APPROVE" || !!v.note, { path: ["note"], message: "validation.required" });
export type PermitDecisionInput = z.input<typeof permitDecisionSchema>;

export const inspectionSchema = z.object({
  projectId: uuid(),
  siteId: optionalUuid(),
  kind: z.enum(INSPECTION_KINDS),
  inspectedOn: dateOnly(),
  correctCount: int(0, 100000),
  incorrectCount: int(0, 100000),
  notes: optionalText(4000),
}).refine((v) => v.correctCount + v.incorrectCount > 0, { path: ["correctCount"], message: "validation.inspectionEmpty" });
export type InspectionInput = z.input<typeof inspectionSchema>;

export const photoTargetSchema = z.object({ recordType: z.enum(HSE_RECORD_TYPES), recordId: uuid() });
export type PhotoTargetInput = z.input<typeof photoTargetSchema>;
