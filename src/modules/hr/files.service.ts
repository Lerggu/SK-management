import { v7 as uuidv7 } from "uuid";
import { readClient, runInTransaction } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { uploadMaxBytes } from "@/platform/config/env";
import { getStorage } from "@/platform/storage";
import { checkRateLimit, RATE_LIMITS } from "@/platform/ratelimit";
import type { RequestContext } from "@/platform/authz";
import { sanitizeFileName, sha256Hex } from "@/modules/documents/versioning";
import type { HrAccess } from "./access";
import { HrRepo } from "./repo";
import { allowIf, loadEmployeeAccess } from "./load";
import { fileRenameSchema, fileUploadSchema, type FileUploadInput } from "./schemas";

/** Personnel-card attachments: images and PDF only, checked by content. */
const TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
} as const;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const HR_FILE_EXTENSIONS = Object.keys(TYPES);
const HR_FILE_MAX_BYTES = 20 * 1024 * 1024;

export function hrFileMaxBytes() {
  return Math.min(uploadMaxBytes(), HR_FILE_MAX_BYTES);
}

/** Detects the type from the first bytes; the extension alone is never trusted. */
export function sniffContentType(bytes: Uint8Array): string | null {
  const b = (i: number) => bytes[i];
  if (bytes.length >= 4 && b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return "application/pdf";
  if (bytes.length >= 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) return "image/png";
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Validates name, size and content; returns the stored content type. */
export function validateHrFile(file: { fileName: string; bytes: Uint8Array }, imagesOnly: boolean) {
  const fileName = sanitizeFileName(file.fileName);
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const declared = (TYPES as Record<string, string>)[ext];
  if (file.bytes.byteLength === 0) throw new ValidationError({ file: ["validation.fileEmpty"] });
  if (file.bytes.byteLength > hrFileMaxBytes()) throw new ValidationError({ file: ["validation.fileTooLarge"] });
  const actual = sniffContentType(file.bytes);
  if (!declared || !actual || declared !== actual) throw new ValidationError({ file: [imagesOnly ? "validation.imageOnly" : "validation.hrFileType"] });
  if (imagesOnly && !IMAGE_TYPES.has(actual)) throw new ValidationError({ file: ["validation.imageOnly"] });
  return { fileName, contentType: actual };
}

type Target = "QUALIFICATION" | "TRAINING" | "ORIENTATION" | "AUTHORIZATION" | "ITEM" | null;

/** Who may see a file: the section it belongs to. */
function canSeeFile(a: HrAccess, f: { kind: string; targetType: Target }) {
  if (f.kind === "PROFILE_PHOTO") return a.basics;
  if (f.targetType === "ITEM") return a.equipment;
  if (f.targetType) return a.work;
  return a.otherFiles;
}

/** Who may add a file to a section of the card. */
function canUpload(a: HrAccess, target: Target) {
  switch (target) {
    case "QUALIFICATION":
    case "TRAINING":
    case "ORIENTATION":
      return a.supervise || a.self;
    case "AUTHORIZATION":
      return a.supervise;
    case "ITEM":
      return a.admin;
    default:
      return a.admin || a.self;
  }
}

async function targetBelongsTo(repo: HrRepo, employeeId: string, type: Target, id: string | null) {
  if (!type || !id) return true;
  const record =
    type === "QUALIFICATION"
      ? await repo.findQualification(id)
      : type === "TRAINING"
        ? await repo.findTraining(id)
        : type === "ORIENTATION"
          ? await repo.findOrientation(id)
          : type === "AUTHORIZATION"
            ? await repo.findAuthorization(id)
            : await repo.findItem(id);
  return !!record && record.employeeId === employeeId;
}

async function storeAndRecord(ctx: RequestContext, employeeId: string, file: { fileName: string; bytes: Uint8Array }, meta: { kind: string; targetType: Target; targetId: string | null; displayName: string | null }, imagesOnly: boolean) {
  checkRateLimit(RATE_LIMITS.upload, ctx.user.id);
  const { fileName, contentType } = validateHrFile(file, imagesOnly);
  const id = uuidv7();
  const storageKey = `companies/${ctx.company.id}/employees/${employeeId}/files/${id}`;
  // Written before the DB transaction; if it fails the object is orphaned but never referenced.
  await getStorage().put(storageKey, file.bytes, contentType);
  return {
    id,
    employeeId,
    kind: meta.kind as "OTHER",
    targetType: meta.targetType,
    targetId: meta.targetId,
    displayName: meta.displayName ?? fileName,
    fileName,
    contentType,
    sizeBytes: BigInt(file.bytes.byteLength),
    sha256: sha256Hex(file.bytes),
    storageKey,
    createdById: ctx.user.id,
    updatedById: ctx.user.id,
  };
}

const view = <T extends { sizeBytes: bigint }>(f: T) => ({ ...f, sizeBytes: Number(f.sizeBytes) });

export const employeeFileService = {
  /** Files of a card the caller may see, with the uploader's name. */
  async list(ctx: RequestContext, employeeId: string) {
    const repo = new HrRepo(readClient(), ctx.company.id);
    const { employee, access } = await loadEmployeeAccess(ctx, employeeId, repo);
    const files = (await repo.listFiles(employee.id)).filter((f) => f.kind !== "PROFILE_PHOTO" && canSeeFile(access, f));
    const users = await repo.usersByIds([...new Set(files.map((f) => f.createdById).filter((x): x is string => !!x))]);
    return files.map((f) => {
      const u = users.find((x) => x.id === f.createdById);
      return {
        ...view(f),
        createdByName: u ? (u.name ?? u.email) : null,
        canManage: !employee.archivedAt && (access.admin || (f.createdById === ctx.user.id && canUpload(access, f.targetType))),
      };
    });
  },

  async upload(ctx: RequestContext, employeeId: string, input: FileUploadInput, file: { fileName: string; bytes: Uint8Array }) {
    const meta = parseInput(fileUploadSchema, input);
    const { employee, access } = await loadEmployeeAccess(ctx, employeeId);
    if (!canSeeFile(access, { kind: meta.kind, targetType: meta.targetType })) throw new NotFoundError();
    allowIf(canUpload(access, meta.targetType));
    if (employee.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
    if (!(await targetBelongsTo(new HrRepo(readClient(), ctx.company.id), employee.id, meta.targetType, meta.targetId))) throw new ValidationError({ targetId: ["validation.invalidOption"] });
    const data = await storeAndRecord(ctx, employee.id, file, meta, false);
    return runInTransaction(async (tx) => {
      const f = await new HrRepo(tx, ctx.company.id).createFile(data);
      await writeAudit(tx, ctx, { action: "employee_file.upload", entityType: "employee_file", entityId: f.id, after: { employeeId: employee.id, kind: f.kind, targetType: f.targetType, targetId: f.targetId, fileName: f.fileName, sha256: f.sha256 } });
      return view(f);
    });
  },

  /** Profile photo (images only); replaces the previous photo, which stays archived. */
  async uploadPhoto(ctx: RequestContext, employeeId: string, file: { fileName: string; bytes: Uint8Array }) {
    const { employee, access } = await loadEmployeeAccess(ctx, employeeId);
    allowIf(access.admin || access.editEmployment || access.self);
    if (employee.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
    const data = await storeAndRecord(ctx, employee.id, file, { kind: "PROFILE_PHOTO", targetType: null, targetId: null, displayName: null }, true);
    return runInTransaction(async (tx) => {
      const repo = new HrRepo(tx, ctx.company.id);
      const f = await repo.createFile({ ...data, kind: "PROFILE_PHOTO" });
      if (employee.photoFileId) await repo.updateFile(employee.photoFileId, { archivedAt: new Date(), archivedById: ctx.user.id });
      await repo.updateEmployee(employee.id, { photoFileId: f.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "employee.photo_update", entityType: "employee", entityId: employee.id, metadata: { fileId: f.id, previous: employee.photoFileId } });
      return view(f);
    });
  },

  async rename(ctx: RequestContext, fileId: string, input: { displayName?: string }) {
    const data = parseInput(fileRenameSchema, input);
    return manageFile(ctx, fileId, async (repo, f) => {
      const after = await repo.updateFile(f.id, { displayName: data.displayName, updatedById: ctx.user.id });
      return { after, action: "employee_file.rename", before: { displayName: f.displayName }, afterData: { displayName: after.displayName } };
    });
  },

  /** Removes a file from the card (kept in storage, marked archived). */
  async archive(ctx: RequestContext, fileId: string) {
    return manageFile(ctx, fileId, async (repo, f) => {
      const after = await repo.updateFile(f.id, { archivedAt: new Date(), archivedById: ctx.user.id });
      if (f.kind === "PROFILE_PHOTO") await repo.updateEmployee(f.employeeId, { photoFileId: null, updatedById: ctx.user.id });
      return { after, action: "employee_file.archive", before: { displayName: f.displayName }, afterData: { archived: true } };
    });
  },

  /** Authorized download; invisible or removed files are 404. */
  async download(ctx: RequestContext, fileId: string) {
    const repo = new HrRepo(readClient(), ctx.company.id);
    const f = await repo.findFile(fileId);
    if (!f || f.archivedAt) throw new NotFoundError();
    const { access } = await loadEmployeeAccess(ctx, f.employeeId, repo);
    if (!canSeeFile(access, f)) throw new NotFoundError();
    const object = await getStorage().get(f.storageKey);
    if (!object) throw new NotFoundError("File missing from storage");
    return { fileName: f.fileName, displayName: f.displayName, contentType: f.contentType, body: object.body };
  },
};

async function manageFile<T extends { id: string }>(
  ctx: RequestContext,
  fileId: string,
  fn: (repo: HrRepo, f: NonNullable<Awaited<ReturnType<HrRepo["findFile"]>>>) => Promise<{ after: T; action: string; before: Record<string, unknown>; afterData: Record<string, unknown> }>,
) {
  const f = await new HrRepo(readClient(), ctx.company.id).findFile(fileId);
  if (!f || f.archivedAt) throw new NotFoundError();
  const { employee, access } = await loadEmployeeAccess(ctx, f.employeeId);
  if (!canSeeFile(access, f)) throw new NotFoundError();
  const own = f.createdById === ctx.user.id && (f.kind === "PROFILE_PHOTO" ? access.self || access.editEmployment : canUpload(access, f.targetType));
  allowIf(access.admin || own);
  if (employee.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
  return runInTransaction(async (tx) => {
    const { after, action, before, afterData } = await fn(new HrRepo(tx, ctx.company.id), f);
    await writeAudit(tx, ctx, { action, entityType: "employee_file", entityId: f.id, before, after: afterData, metadata: { employeeId: f.employeeId } });
    return { id: after.id };
  });
}
