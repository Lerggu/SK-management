"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ValidationError } from "@/platform/errors";
import { documentService } from "@/modules/documents/service";
import type { CreateDocumentInput, DocumentMetadataInput, DocumentSharingInput, LinkInput, VersionMetaInput } from "@/modules/documents/schemas";
import { formInput, readFile, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const base = (slug: string) => `/c/${slug}/documents`;

async function requireFile(formData: FormData) {
  const file = await readFile(formData);
  if (!file) throw new ValidationError({ file: ["validation.fileRequired"] });
  return file;
}

export async function createDocumentAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id = "";
  const r = await runAction(formData, async () => {
    const input = formInput<CreateDocumentInput & VersionMetaInput & { location?: string }>(formData);
    const [kind, projectId, siteId] = String(input.location ?? "").split(":");
    delete input.location;
    const doc = await documentService.create(ctx, { ...input, projectId: kind ? projectId : null, siteId: kind === "s" ? siteId : null }, await requireFile(formData));
    id = doc.id;
  });
  if (r.ok) redirect(`${base(slug)}/${id}`);
  return r;
}

export async function updateDocumentAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => documentService.updateMetadata(ctx, id, formInput<DocumentMetadataInput>(formData)).then(() => undefined));
  revalidatePath(`${base(slug)}/${id}`);
  return r;
}

export async function archiveDocumentAction(slug: string, id: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => documentService.archive(ctx, id).then(() => undefined));
  if (r.ok) redirect(base(slug));
  return r;
}

export async function uploadVersionAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, async () => {
    await documentService.uploadVersion(ctx, id, formInput<VersionMetaInput>(formData), await requireFile(formData));
  });
  revalidatePath(`${base(slug)}/${id}`);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function setApprovalAction(slug: string, documentId: string, versionId: string, state: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => documentService.setVersionApproval(ctx, versionId, { state }).then(() => undefined));
  revalidatePath(`${base(slug)}/${documentId}`);
  return r;
}

export async function addLinkAction(slug: string, documentId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, async () => {
    const [entityType, entityId] = String(formData.get("target") ?? "").split(":");
    await documentService.addLink(ctx, documentId, { entityType, entityId } as LinkInput);
  });
  revalidatePath(`${base(slug)}/${documentId}`);
  return r;
}

export async function removeLinkAction(slug: string, documentId: string, linkId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => documentService.removeLink(ctx, linkId));
  revalidatePath(`${base(slug)}/${documentId}`);
  return r;
}

export async function setSharingAction(slug: string, documentId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => documentService.setSharing(ctx, documentId, formInput<DocumentSharingInput>(formData)).then(() => undefined));
  revalidatePath(`/c/${slug}/documents`, "layout");
  revalidatePath(`/c/${slug}/portal`, "layout");
  return r;
}
