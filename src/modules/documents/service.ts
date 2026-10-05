import { v7 as uuidv7 } from "uuid";
import { readClient, runInTransaction, type Tx } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { uploadMaxBytes } from "@/platform/config/env";
import { getStorage } from "@/platform/storage";
import { checkRateLimit, RATE_LIMITS } from "@/platform/ratelimit";
import {
  canAccessProject,
  hasPermission,
  projectIdsWithPermission,
  projectPermissions,
  requirePermission,
  requireProjectPermission,
  type PermissionKey,
  type RequestContext,
} from "@/platform/authz";
import { DocumentRepo } from "./repo";
import {
  approvalSchema,
  createDocumentSchema,
  documentListSchema,
  documentMetadataSchema,
  documentSharingSchema,
  linkSchema,
  versionMetaSchema,
  type CreateDocumentInput,
  type DocumentMetadataInput,
  type DocumentSharingInput,
  type LinkInput,
  type UploadedFile,
  type VersionMetaInput,
} from "./schemas";
import { approvalTransitionPermission, nextVersionNumber, resolveContentType, sanitizeFileName, sha256Hex, storageKey } from "./versioning";

type DocumentRow = NonNullable<Awaited<ReturnType<DocumentRepo["find"]>>>;
type ShareFlags = Pick<DocumentRow, "projectId" | "sharedWithClient" | "sharedWithSubcontractors">;

/**
 * V7 external boundary: an external member sees a project document only when
 * it is shared with their party (client / subcontractors), and then only its
 * APPROVED versions. External members never manage documents.
 */
export function sharedWithMember(ctx: RequestContext, doc: ShareFlags): boolean {
  if (!ctx.external) return true;
  if (!doc.projectId) return false;
  return (doc.sharedWithClient && ctx.externalParties.has("CLIENT")) || (doc.sharedWithSubcontractors && ctx.externalParties.has("SUBCONTRACTOR"));
}

/**
 * Company-level documents (no project) are internal: they need company-level
 * `documents.view` and are never shown to external members (Client,
 * Subcontractor). Project documents follow project access.
 */
function documentPermissions(ctx: RequestContext, doc: Pick<DocumentRow, "projectId">): ReadonlySet<PermissionKey> {
  if (doc.projectId) return projectPermissions(ctx, doc.projectId);
  return ctx.external ? new Set() : ctx.permissions;
}

/** Visibility check: invisible documents are 404, missing capability is 403. */
function requireDocumentPermission(ctx: RequestContext, doc: ShareFlags, permission: PermissionKey) {
  if (ctx.external) {
    if (!doc.projectId || !canAccessProject(ctx, doc.projectId) || !sharedWithMember(ctx, doc)) throw new NotFoundError();
    requireProjectPermission(ctx, doc.projectId, "documents.view");
    if (permission !== "documents.view") throw new ForbiddenError("External members cannot manage documents");
    return;
  }
  if (doc.projectId) {
    requireProjectPermission(ctx, doc.projectId, "documents.view");
    if (permission !== "documents.view") requireProjectPermission(ctx, doc.projectId, permission);
    return;
  }
  const perms = documentPermissions(ctx, doc);
  if (!perms.has("documents.view")) throw new NotFoundError();
  if (!perms.has(permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

/** Validates the file and writes it to object storage under a fresh key. */
async function storeFile(ctx: RequestContext, documentId: string, file: UploadedFile) {
  checkRateLimit(RATE_LIMITS.upload, ctx.user.id);
  const fileName = sanitizeFileName(file.fileName);
  const contentType = resolveContentType(fileName);
  if (!contentType) throw new ValidationError({ file: ["validation.fileType"] });
  if (file.bytes.byteLength === 0) throw new ValidationError({ file: ["validation.fileEmpty"] });
  if (file.bytes.byteLength > uploadMaxBytes()) throw new ValidationError({ file: ["validation.fileTooLarge"] });

  const versionId = uuidv7();
  const key = storageKey(ctx.company.id, documentId, versionId);
  // Written before the DB transaction; if the transaction fails the object is
  // orphaned but never referenced (see known limitations).
  await getStorage().put(key, file.bytes, contentType);
  return { versionId, key, fileName, contentType, size: file.bytes.byteLength, sha256: sha256Hex(file.bytes) };
}

async function createVersion(
  tx: Tx,
  ctx: RequestContext,
  repo: DocumentRepo,
  doc: DocumentRow,
  stored: Awaited<ReturnType<typeof storeFile>>,
  meta: { revisionLabel: string | null; changeNote: string | null; issueDate: Date | null },
) {
  await repo.lock(doc.id);
  const existing = await repo.listVersions(doc.id);
  const previous = existing.find((v) => v.status === "CURRENT") ?? null;
  await repo.supersedeCurrent(doc.id, ctx.user.id);
  const version = await repo.createVersion({
    id: stored.versionId,
    documentId: doc.id,
    versionNumber: nextVersionNumber(existing),
    revisionLabel: meta.revisionLabel,
    fileName: stored.fileName,
    contentType: stored.contentType,
    sizeBytes: BigInt(stored.size),
    sha256: stored.sha256,
    storageKey: stored.key,
    status: "CURRENT",
    approvalState: "DRAFT",
    issueDate: meta.issueDate,
    changeNote: meta.changeNote,
    createdById: ctx.user.id,
    updatedById: ctx.user.id,
  });
  await repo.update(doc.id, { updatedById: ctx.user.id });
  await writeAudit(tx, ctx, {
    action: "document_version.create",
    entityType: "document_version",
    entityId: version.id,
    projectId: doc.projectId,
    before: previous ? { supersededVersionId: previous.id, supersededVersionNumber: previous.versionNumber } : null,
    after: {
      documentId: doc.id,
      versionNumber: version.versionNumber,
      revisionLabel: version.revisionLabel,
      fileName: version.fileName,
      sizeBytes: version.sizeBytes,
      sha256: version.sha256,
      status: version.status,
    },
  });
  return version;
}

function serializeVersion<T extends { sizeBytes: bigint }>(v: T) {
  return { ...v, sizeBytes: Number(v.sizeBytes) };
}

export const documentService = {
  async list(ctx: RequestContext, input: { q?: string | null; projectId?: string | null; category?: string; includeArchived?: boolean } = {}) {
    const filter = parseInput(documentListSchema, input);
    const companyLevel = hasPermission(ctx, "documents.view") && !ctx.external;
    const projectIds = projectIdsWithPermission(ctx, "documents.view");
    if (filter.projectId && !canAccessProject(ctx, filter.projectId)) throw new NotFoundError();
    const repo = new DocumentRepo(readClient(), ctx.company.id);
    if (ctx.external) {
      const rows = await repo.listShared({ ...filter, projectIds: projectIds ?? [], client: ctx.externalParties.has("CLIENT"), subcontractors: ctx.externalParties.has("SUBCONTRACTOR") });
      return rows.filter((d) => d.versions.length > 0).map(({ versions, ...d }) => ({ ...d, currentVersion: versions[0] ?? null }));
    }
    const rows = await repo.list({ ...filter, companyLevel, projectIds });
    return rows.map(({ versions, ...d }) => ({ ...d, currentVersion: versions[0] ?? null }));
  },

  async get(ctx: RequestContext, documentId: string) {
    const doc = await new DocumentRepo(readClient(), ctx.company.id).findDetailed(documentId);
    if (!doc) throw new NotFoundError();
    requireDocumentPermission(ctx, doc, "documents.view");
    if (ctx.external) {
      const { links: _links, ...rest } = doc;
      void _links;
      const versions = doc.versions.filter((v) => v.approvalState === "APPROVED").map(serializeVersion);
      if (versions.length === 0) throw new NotFoundError();
      return { ...rest, links: [], versions, permissions: { manage: false, approve: false, share: false } };
    }
    const perms = documentPermissions(ctx, doc);
    return {
      ...doc,
      versions: doc.versions.map(serializeVersion),
      permissions: { manage: perms.has("documents.manage"), approve: perms.has("documents.approve"), share: !!doc.projectId && perms.has("documents.approve") },
    };
  },

  async create(ctx: RequestContext, input: CreateDocumentInput & VersionMetaInput, file: UploadedFile) {
    const data = parseInput(createDocumentSchema, input);
    const meta = parseInput(versionMetaSchema, input);
    if (ctx.external) throw new ForbiddenError("External members cannot manage documents");
    if (data.projectId) requireProjectPermission(ctx, data.projectId, "documents.manage");
    else requirePermission(ctx, "documents.manage");

    const readRepo = new DocumentRepo(readClient(), ctx.company.id);
    if (data.projectId) {
      const project = await readRepo.findProject(data.projectId);
      if (!project || project.archivedAt) throw new ValidationError({ projectId: ["validation.invalidOption"] });
    }
    if (data.siteId) {
      const site = await readRepo.findSite(data.siteId);
      if (!site || site.archivedAt || site.projectId !== data.projectId) throw new ValidationError({ siteId: ["validation.invalidOption"] });
    }

    const documentId = uuidv7();
    const stored = await storeFile(ctx, documentId, file);
    return runInTransaction(async (tx) => {
      const repo = new DocumentRepo(tx, ctx.company.id);
      const doc = await repo.create({
        id: documentId,
        title: data.title,
        documentNumber: data.documentNumber,
        category: data.category,
        description: data.description,
        projectId: data.projectId,
        siteId: data.siteId,
        ownerUserId: ctx.user.id,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: "document.create", entityType: "document", entityId: doc.id, projectId: doc.projectId, after: doc });
      const version = await createVersion(tx, ctx, repo, doc, stored, meta);
      return { ...doc, currentVersion: serializeVersion(version) };
    });
  },

  async updateMetadata(ctx: RequestContext, documentId: string, input: DocumentMetadataInput) {
    const data = parseInput(documentMetadataSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new DocumentRepo(tx, ctx.company.id);
      const before = await repo.find(documentId);
      if (!before) throw new NotFoundError();
      requireDocumentPermission(ctx, before, "documents.manage");
      if (before.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      const after = await repo.update(before.id, { ...data, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "document.update", entityType: "document", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },

  async archive(ctx: RequestContext, documentId: string) {
    return runInTransaction(async (tx) => {
      const repo = new DocumentRepo(tx, ctx.company.id);
      const before = await repo.find(documentId);
      if (!before) throw new NotFoundError();
      requireDocumentPermission(ctx, before, "documents.manage");
      if (before.archivedAt) return before;
      const after = await repo.update(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "document.archive", entityType: "document", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },

  /** Uploads a new version; the previous CURRENT version becomes SUPERSEDED. */
  async uploadVersion(ctx: RequestContext, documentId: string, input: VersionMetaInput, file: UploadedFile) {
    const meta = parseInput(versionMetaSchema, input);
    const doc = await new DocumentRepo(readClient(), ctx.company.id).find(documentId);
    if (!doc) throw new NotFoundError();
    requireDocumentPermission(ctx, doc, "documents.manage");
    if (doc.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
    const stored = await storeFile(ctx, doc.id, file);
    return runInTransaction(async (tx) => {
      const repo = new DocumentRepo(tx, ctx.company.id);
      const version = await createVersion(tx, ctx, repo, doc, stored, meta);
      return serializeVersion(version);
    });
  },

  /** Approval workflow on the CURRENT version. APPROVED is final. */
  async setVersionApproval(ctx: RequestContext, versionId: string, input: { state: string }) {
    const { state } = parseInput(approvalSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new DocumentRepo(tx, ctx.company.id);
      const version = await repo.findVersion(versionId);
      if (!version) throw new NotFoundError();
      const doc = await repo.find(version.documentId);
      if (!doc) throw new NotFoundError();
      requireDocumentPermission(ctx, doc, "documents.view");
      if (ctx.external) throw new ForbiddenError("External members cannot approve documents");
      if (version.status !== "CURRENT") throw new ValidationError({ _form: ["validation.versionNotCurrent"] });
      const needed = approvalTransitionPermission(version.approvalState, state);
      if (!needed) throw new ValidationError({ state: ["validation.invalidTransition"] });
      requireDocumentPermission(ctx, doc, needed);
      const approved = state === "APPROVED";
      const after = await repo.updateVersion(version.id, {
        approvalState: state,
        approvedById: approved ? ctx.user.id : null,
        approvedAt: approved ? new Date() : null,
        updatedById: ctx.user.id,
      });
      await writeAudit(tx, ctx, {
        action: "document_version.approval_update",
        entityType: "document_version",
        entityId: version.id,
        projectId: doc.projectId,
        before: { approvalState: version.approvalState },
        after: { approvalState: after.approvalState, documentId: doc.id, versionNumber: version.versionNumber },
      });
      return serializeVersion(after);
    });
  },

  /** Returns the file of a version after an authorization check. */
  async downloadVersion(ctx: RequestContext, versionId: string) {
    const repo = new DocumentRepo(readClient(), ctx.company.id);
    const version = await repo.findVersion(versionId);
    if (!version) throw new NotFoundError();
    const doc = await repo.find(version.documentId);
    if (!doc) throw new NotFoundError();
    requireDocumentPermission(ctx, doc, "documents.view");
    if (ctx.external && version.approvalState !== "APPROVED") throw new NotFoundError();
    const object = await getStorage().get(version.storageKey);
    if (!object) throw new NotFoundError("File missing from storage");
    return { fileName: version.fileName, contentType: version.contentType, body: object.body, sha256: version.sha256 };
  },

  async addLink(ctx: RequestContext, documentId: string, input: LinkInput) {
    const data = parseInput(linkSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new DocumentRepo(tx, ctx.company.id);
      const doc = await repo.find(documentId);
      if (!doc) throw new NotFoundError();
      requireDocumentPermission(ctx, doc, "documents.manage");

      // The target must exist in the same company (and be visible).
      let targetProjectId: string | null = null;
      switch (data.entityType) {
        case "PROJECT": {
          const p = await repo.findProject(data.entityId);
          targetProjectId = p?.id ?? null;
          if (!p || !canAccessProject(ctx, p.id)) throw new ValidationError({ entityId: ["validation.invalidOption"] });
          break;
        }
        case "SITE": {
          const s = await repo.findSite(data.entityId);
          targetProjectId = s?.projectId ?? null;
          if (!s || !canAccessProject(ctx, s.projectId)) throw new ValidationError({ entityId: ["validation.invalidOption"] });
          break;
        }
        case "EMPLOYEE":
          if (!hasPermission(ctx, "employee.view") || !(await repo.findEmployee(data.entityId)))
            throw new ValidationError({ entityId: ["validation.invalidOption"] });
          break;
        case "EQUIPMENT":
          if (!hasPermission(ctx, "equipment.view") || !(await repo.findEquipment(data.entityId)))
            throw new ValidationError({ entityId: ["validation.invalidOption"] });
          break;
      }
      const link = await repo.upsertLink(doc.id, data.entityType, data.entityId, ctx.user.id);
      await writeAudit(tx, ctx, {
        action: "document_link.create",
        entityType: "document_link",
        entityId: link.id,
        projectId: doc.projectId ?? targetProjectId,
        after: { documentId: doc.id, entityType: data.entityType, entityId: data.entityId },
      });
      return link;
    });
  },

  async removeLink(ctx: RequestContext, linkId: string) {
    return runInTransaction(async (tx) => {
      const repo = new DocumentRepo(tx, ctx.company.id);
      const link = await repo.findLink(linkId);
      if (!link) throw new NotFoundError();
      const doc = await repo.find(link.documentId);
      if (!doc) throw new NotFoundError();
      requireDocumentPermission(ctx, doc, "documents.manage");
      await repo.archiveLink(link.id, ctx.user.id);
      await writeAudit(tx, ctx, {
        action: "document_link.archive",
        entityType: "document_link",
        entityId: link.id,
        projectId: doc.projectId,
        before: { documentId: doc.id, entityType: link.entityType, entityId: link.entityId },
      });
    });
  },

  /**
   * V7: shares a project document with the client and/or subcontractors.
   * Externals then see its APPROVED versions only. Needs documents.approve.
   */
  async setSharing(ctx: RequestContext, documentId: string, input: DocumentSharingInput) {
    const data = parseInput(documentSharingSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new DocumentRepo(tx, ctx.company.id);
      const before = await repo.find(documentId);
      if (!before) throw new NotFoundError();
      requireDocumentPermission(ctx, before, "documents.view");
      if (!before.projectId) throw new ValidationError({ _form: ["validation.shareProjectOnly"] });
      requireDocumentPermission(ctx, before, "documents.approve");
      if (before.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      const after = await repo.update(before.id, { sharedWithClient: data.sharedWithClient, sharedWithSubcontractors: data.sharedWithSubcontractors, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, {
        action: "document.share_update",
        entityType: "document",
        entityId: after.id,
        projectId: after.projectId,
        before: { sharedWithClient: before.sharedWithClient, sharedWithSubcontractors: before.sharedWithSubcontractors },
        after: { sharedWithClient: after.sharedWithClient, sharedWithSubcontractors: after.sharedWithSubcontractors },
      });
      return after;
    });
  },

  /** Visible documents linked to an employee/equipment/project/site. */
  async listLinkedTo(ctx: RequestContext, input: LinkInput) {
    const data = parseInput(linkSchema, input);
    if (ctx.external) return [];
    const rows = await new DocumentRepo(readClient(), ctx.company.id).listLinkedTo(data.entityType, data.entityId);
    return rows.filter((r) => documentPermissions(ctx, r.document).has("documents.view")).map((r) => ({ linkId: r.id, ...r.document }));
  },
};
