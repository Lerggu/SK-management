import { z } from "zod";
import { optionalDate, optionalText, optionalUuid, text, uuid, flag } from "@/platform/http/validation";

export const DOCUMENT_CATEGORIES = [
  "CONTRACT",
  "DRAWING",
  "RAMS",
  "LIFT_PLAN",
  "ELECTRICAL_PLAN",
  "INSPECTION",
  "CERTIFICATE",
  "MANUAL",
  "OTHER",
] as const;
export const LINK_ENTITIES = ["PROJECT", "SITE", "EMPLOYEE", "EQUIPMENT"] as const;
export const APPROVAL_STATES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"] as const;

export const documentMetadataSchema = z.object({
  title: text(200),
  documentNumber: optionalText(60),
  category: z.enum(DOCUMENT_CATEGORIES).default("OTHER"),
  description: optionalText(2000),
});

export const createDocumentSchema = documentMetadataSchema
  .extend({
    projectId: optionalUuid(),
    siteId: optionalUuid(),
  })
  .refine((v) => !v.siteId || v.projectId, { path: ["siteId"], message: "validation.siteRequiresProject" });
export type CreateDocumentInput = z.input<typeof createDocumentSchema>;
export type DocumentMetadataInput = z.input<typeof documentMetadataSchema>;

export const versionMetaSchema = z.object({
  revisionLabel: optionalText(20),
  changeNote: optionalText(1000),
  issueDate: optionalDate(),
});
export type VersionMetaInput = z.input<typeof versionMetaSchema>;

export const approvalSchema = z.object({ state: z.enum(APPROVAL_STATES) });

export const linkSchema = z.object({ entityType: z.enum(LINK_ENTITIES), entityId: uuid() });
export type LinkInput = z.input<typeof linkSchema>;

export const documentListSchema = z.object({
  q: optionalText(100),
  projectId: optionalUuid(),
  category: z.preprocess((v) => (v === "" ? undefined : v), z.enum(DOCUMENT_CATEGORIES).optional()),
  includeArchived: flag(),
});

/** Uploaded file handed to the service by the UI/API layer. */
export interface UploadedFile {
  fileName: string;
  bytes: Uint8Array;
}
