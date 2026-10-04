import { createHash } from "node:crypto";

/**
 * Pure document-control rules (unit tested).
 *
 * - Versions are append-only: a new upload creates version n+1, which becomes
 *   CURRENT; the previous CURRENT becomes SUPERSEDED. Nothing is overwritten.
 * - An APPROVED version is final. Changing an approved document means
 *   uploading a new version, which is visible as such.
 */
export type ApprovalState = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export function nextVersionNumber(existing: readonly { versionNumber: number }[]): number {
  return existing.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
}

/** Allowed approval transitions and the capability each one needs. */
const TRANSITIONS: Record<ApprovalState, Partial<Record<ApprovalState, "documents.manage" | "documents.approve">>> = {
  DRAFT: { PENDING_APPROVAL: "documents.manage", APPROVED: "documents.approve", REJECTED: "documents.approve" },
  PENDING_APPROVAL: { DRAFT: "documents.manage", APPROVED: "documents.approve", REJECTED: "documents.approve" },
  REJECTED: { PENDING_APPROVAL: "documents.manage", DRAFT: "documents.manage" },
  APPROVED: {},
};

export function approvalTransitionPermission(from: ApprovalState, to: ApprovalState): "documents.manage" | "documents.approve" | null {
  return TRANSITIONS[from][to] ?? null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Extensions accepted for upload. Active content (html, svg, js) is refused. */
const ALLOWED: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  dwg: "application/acad",
  dxf: "application/dxf",
  ifc: "application/x-step",
  zip: "application/zip",
};

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_")
    .trim()
    .slice(0, 180);
  return cleaned || "file";
}

/** Returns the normalized content type for an allowed file, or null. */
export function resolveContentType(fileName: string): string | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (!fileName.includes(".")) return null;
  return ALLOWED[ext] ?? null;
}

export function storageKey(companyId: string, documentId: string, versionId: string): string {
  return `companies/${companyId}/documents/${documentId}/versions/${versionId}`;
}
