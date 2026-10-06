import { z } from "zod";
import { flag, optionalDate, optionalEmail, optionalText, optionalUuid, text, dateOnly, uuid } from "@/platform/http/validation";
import { LANGUAGE_LEVELS } from "./rules";

const emptyToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

/** Competence level 1–4; empty = "Ei arvioitu" (null). */
export const optionalLevel = () => z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(4).nullable()).default(null);

/** ISO 639-1 language codes offered in the UI (others can be typed). */
export const LANGUAGES = ["fi", "sv", "en", "et", "ru", "uk", "pl", "lt", "lv", "ro", "bg", "de", "es", "fr", "ar", "so", "fa", "tr", "vi", "th"] as const;
export const languageCode = () =>
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2,3}$/, "validation.invalidOption");
export const optionalLanguage = () => z.preprocess(emptyToNull, languageCode().nullable()).default(null);

export const ASSESSMENT_KINDS = ["SUPERVISOR", "SELF"] as const;
export const TRAINING_STATUSES = ["PLANNED", "COMPLETED"] as const;
export const ASSESSMENT_SOURCES = ["SELF", "SUPERVISOR"] as const;
export const ORIENTATION_SCOPES = ["COMPANY", "SITE", "EQUIPMENT"] as const;
export const ORIENTATION_STATUSES = ["IN_PROGRESS", "DONE"] as const;
export const ITEM_TYPES = ["PHONE", "COMPUTER", "HARNESS", "TOOL", "KEY", "OTHER"] as const;
export const ITEM_STATUSES = ["WITH_EMPLOYEE", "RETURNED", "LOST", "RETIRED"] as const;
export const FILE_KINDS = ["CERTIFICATE", "CARD_IMAGE", "TRAINING_CERTIFICATE", "ORIENTATION", "AUTHORIZATION", "ITEM", "OTHER"] as const;
export const FILE_TARGETS = ["QUALIFICATION", "TRAINING", "ORIENTATION", "AUTHORIZATION", "ITEM"] as const;
export const REQUIREMENT_KINDS = ["COMPETENCE", "QUALIFICATION", "ORIENTATION"] as const;
export const DRIVER_LICENCE_CLASSES = ["AM", "A1", "A2", "A", "B", "BE", "C1", "C1E", "C", "CE", "D1", "D1E", "D", "DE", "T", "LT"] as const;

const endAfter =
  <K extends string, L extends string>(start: K, end: L) =>
  (v: Record<K | L, Date | null>) =>
    !v[start] || !v[end] || v[end] >= v[start];

// ── settings ─────────────────────────────────────────────────────────
export const hrSettingsSchema = z.object({ reminderEmail: optionalEmail() });

export const competenceAreaSchema = z.object({
  category: text(80),
  name: text(120),
  description: optionalText(500),
  isKey: flag(),
  sortOrder: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(9999).nullable()).default(null),
});
export type CompetenceAreaInput = z.input<typeof competenceAreaSchema>;

export const qualificationTypeSchema = z.object({
  name: text(120),
  defaultIssuer: optionalText(160),
  defaultValidityMonths: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(600).nullable()).default(null),
});
export type QualificationTypeInput = z.input<typeof qualificationTypeSchema>;

export const jobProfileSchema = z.object({ name: text(120), description: optionalText(500) });
export type JobProfileInput = z.input<typeof jobProfileSchema>;

export const jobRequirementSchema = z
  .object({
    kind: z.enum(REQUIREMENT_KINDS),
    areaId: optionalUuid(),
    minLevel: optionalLevel(),
    qualificationTypeId: optionalUuid(),
    orientationScope: z.preprocess(emptyToNull, z.enum(ORIENTATION_SCOPES).nullable()).default(null),
    orientationTopic: optionalText(160),
  })
  .superRefine((v, c) => {
    if (v.kind === "COMPETENCE") {
      if (!v.areaId) c.addIssue({ code: "custom", path: ["areaId"], message: "validation.required" });
      if (!v.minLevel) c.addIssue({ code: "custom", path: ["minLevel"], message: "validation.required" });
    }
    if (v.kind === "QUALIFICATION" && !v.qualificationTypeId) c.addIssue({ code: "custom", path: ["qualificationTypeId"], message: "validation.required" });
    if (v.kind === "ORIENTATION") {
      if (!v.orientationScope) c.addIssue({ code: "custom", path: ["orientationScope"], message: "validation.required" });
      if (!v.orientationTopic) c.addIssue({ code: "custom", path: ["orientationTopic"], message: "validation.required" });
    }
  });
export type JobRequirementInput = z.input<typeof jobRequirementSchema>;

// ── card ─────────────────────────────────────────────────────────────
/** Employment fields of the card (employee.manage or hr.manage). */
export const hrEmploymentSchema = z.object({
  supervisorId: optionalUuid(),
  team: optionalText(80),
  location: optionalText(80),
  jobProfileId: optionalUuid(),
});
export type HrEmploymentInput = z.input<typeof hrEmploymentSchema>;

/** Fields the employee may edit on their own card (also the admin). */
export const hrPersonalSchema = z.object({
  phone: optionalText(40),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalText(40),
  preferredLanguage: optionalLanguage(),
  interpreterNeeded: flag(),
  jacketSize: optionalText(20),
  trousersSize: optionalText(20),
  shoeSize: optionalText(10),
});
export type HrPersonalInput = z.input<typeof hrPersonalSchema>;

const licenceClasses = z.preprocess(
  (v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]),
  z.array(z.enum(DRIVER_LICENCE_CLASSES)).max(DRIVER_LICENCE_CLASSES.length),
);

/** Driving licence classes and employer-granted driving rights (admin / supervisor). */
export const drivingSchema = z.object({ driverLicenceClasses: licenceClasses, drivingRights: optionalText(500) });
export type DrivingInput = z.input<typeof drivingSchema>;

// ── assessments ──────────────────────────────────────────────────────
export const assessmentSchema = z
  .object({
    areaId: uuid(),
    level: optionalLevel(),
    observations: optionalText(2000),
    strengths: optionalText(1000),
    developmentAreas: optionalText(1000),
    agreedActions: optionalText(1000),
    actionOwnerEmployeeId: optionalUuid(),
    actionDueOn: optionalDate(),
    assessedOn: dateOnly(),
    nextAssessmentOn: optionalDate(),
    publish: flag(),
  })
  .refine(endAfter("assessedOn", "nextAssessmentOn"), { path: ["nextAssessmentOn"], message: "validation.endBeforeStart" });
export type AssessmentInput = z.input<typeof assessmentSchema>;

export const selfAssessmentSchema = z.object({
  areaId: uuid(),
  level: optionalLevel(),
  observations: optionalText(2000),
  assessedOn: dateOnly(),
  publish: flag(),
});
export type SelfAssessmentInput = z.input<typeof selfAssessmentSchema>;

export const assessmentCommentSchema = z.object({ comment: text(2000) });

// ── trainings and qualifications ─────────────────────────────────────
export const trainingSchema = z
  .object({
    name: text(160),
    provider: optionalText(160),
    status: z.enum(TRAINING_STATUSES).default("COMPLETED"),
    plannedOn: optionalDate(),
    completedOn: optionalDate(),
    expiresOn: optionalDate(),
    remindBeforeExpiry: flag(),
    notes: optionalText(1000),
  })
  .refine((v) => v.status !== "COMPLETED" || v.completedOn, { path: ["completedOn"], message: "validation.required" })
  .refine(endAfter("completedOn", "expiresOn"), { path: ["expiresOn"], message: "validation.endBeforeStart" })
  .refine((v) => !v.remindBeforeExpiry || v.expiresOn, { path: ["expiresOn"], message: "validation.reminderNeedsExpiry" });
export type TrainingInput = z.input<typeof trainingSchema>;

export const qualificationSchema = z
  .object({
    typeId: optionalUuid(),
    name: optionalText(160),
    issuer: optionalText(160),
    cardNumber: optionalText(60),
    issuedOn: optionalDate(),
    expiresOn: optionalDate(),
    noExpiry: flag(),
    remindBeforeExpiry: flag(),
    notes: optionalText(1000),
  })
  .refine((v) => v.typeId || v.name, { path: ["name"], message: "validation.required" })
  .refine((v) => !(v.noExpiry && v.expiresOn), { path: ["expiresOn"], message: "validation.noExpiryConflict" })
  .refine((v) => v.noExpiry || v.expiresOn, { path: ["expiresOn"], message: "validation.expiryOrNoExpiry" })
  .refine(endAfter("issuedOn", "expiresOn"), { path: ["expiresOn"], message: "validation.endBeforeStart" })
  .refine((v) => !v.remindBeforeExpiry || v.expiresOn, { path: ["remindBeforeExpiry"], message: "validation.reminderNeedsExpiry" });
export type QualificationInput = z.input<typeof qualificationSchema>;

export const qualificationListSchema = z.object({
  employeeId: optionalUuid(),
  typeId: optionalUuid(),
  validity: z.preprocess(emptyToNull, z.enum(["VALID", "EXPIRING", "EXPIRED", "NO_EXPIRY"]).nullable()).default(null),
});

// ── orientations, authorizations, languages ──────────────────────────
export const orientationSchema = z
  .object({
    scope: z.enum(ORIENTATION_SCOPES),
    topic: text(160),
    target: optionalText(160),
    instructorName: text(120),
    completedOn: optionalDate(),
    status: z.enum(ORIENTATION_STATUSES).default("IN_PROGRESS"),
    renewalDueOn: optionalDate(),
  })
  .refine((v) => v.status !== "DONE" || v.completedOn, { path: ["completedOn"], message: "validation.required" })
  .refine(endAfter("completedOn", "renewalDueOn"), { path: ["renewalDueOn"], message: "validation.endBeforeStart" });
export type OrientationInput = z.input<typeof orientationSchema>;

export const authorizationSchema = z
  .object({
    target: text(160),
    equipmentTypeId: optionalUuid(),
    grantedOn: dateOnly(),
    expiresOn: optionalDate(),
    notes: optionalText(1000),
  })
  .refine(endAfter("grantedOn", "expiresOn"), { path: ["expiresOn"], message: "validation.endBeforeStart" });
export type AuthorizationInput = z.input<typeof authorizationSchema>;

const languageLevel = () => z.enum(LANGUAGE_LEVELS).default("NOT_ASSESSED");
export const languageSchema = z.object({
  language: languageCode(),
  speaking: languageLevel(),
  understanding: languageLevel(),
  reading: languageLevel(),
  writing: languageLevel(),
  source: z.enum(ASSESSMENT_SOURCES),
  notes: optionalText(500),
});
export type LanguageInput = z.input<typeof languageSchema>;

// ── clothing and company items ───────────────────────────────────────
export const clothingIssueSchema = z.object({
  product: text(120),
  size: optionalText(20),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
  issuedOn: dateOnly(),
  notes: optionalText(500),
});
export type ClothingIssueInput = z.input<typeof clothingIssueSchema>;

export const companyItemSchema = z
  .object({
    name: text(120),
    itemType: z.enum(ITEM_TYPES),
    brand: optionalText(80),
    model: optionalText(80),
    serialNumber: optionalText(80),
    issuedOn: dateOnly(),
    conditionAtIssue: optionalText(200),
    status: z.enum(ITEM_STATUSES).default("WITH_EMPLOYEE"),
    returnedOn: optionalDate(),
    nextInspectionOn: optionalDate(),
    notes: optionalText(1000),
  })
  .refine((v) => v.status !== "RETURNED" || v.returnedOn, { path: ["returnedOn"], message: "validation.required" })
  .refine(endAfter("issuedOn", "returnedOn"), { path: ["returnedOn"], message: "validation.endBeforeStart" });
export type CompanyItemInput = z.input<typeof companyItemSchema>;

// ── files ────────────────────────────────────────────────────────────
export const fileUploadSchema = z
  .object({
    kind: z.enum(FILE_KINDS).default("OTHER"),
    displayName: optionalText(160),
    targetType: z.preprocess(emptyToNull, z.enum(FILE_TARGETS).nullable()).default(null),
    targetId: optionalUuid(),
  })
  .refine((v) => (v.targetType === null) === (v.targetId === null), { path: ["targetId"], message: "validation.invalidOption" });
export type FileUploadInput = z.input<typeof fileUploadSchema>;

export const fileRenameSchema = z.object({ displayName: text(160) });

// ── search ───────────────────────────────────────────────────────────
export const hrSearchSchema = z.object({
  q: optionalText(100),
  jobProfileId: optionalUuid(),
  team: optionalText(80),
  location: optionalText(80),
  areaId: optionalUuid(),
  minLevel: optionalLevel(),
  language: optionalLanguage(),
  languageLevel: z.preprocess(emptyToNull, z.enum(LANGUAGE_LEVELS).nullable()).default(null),
  qualificationTypeId: optionalUuid(),
  includeInactive: flag(),
});
export type HrSearchInput = z.input<typeof hrSearchSchema>;

export const matrixSchema = z.object({ allAreas: flag(), team: optionalText(80), jobProfileId: optionalUuid() });
