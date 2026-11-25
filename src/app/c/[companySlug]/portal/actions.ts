"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientApprovalService } from "@/modules/commercial/client-approval.service";
import type { PortalDecisionInput } from "@/modules/commercial/schemas";
import { ValidationError } from "@/platform/errors";
import { documentService } from "@/modules/documents/service";
import { formInput, readFile, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

/** The client approver's decision on the frozen variation (hash posted back). */
export async function decideApprovalAction(slug: string, projectId: string, approvalId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => clientApprovalService.decide(ctx, approvalId, formInput<PortalDecisionInput>(formData)).then(() => undefined));
  revalidatePath(`/c/${slug}/portal`, "layout");
  revalidatePath(`/c/${slug}/projects`, "layout");
  if (r.ok) redirect(`/c/${slug}/portal/${projectId}?decided=1`);
  return r;
}

/** Subcontractor delivers a document to the project (ADR 0037); it waits for internal approval. */
export async function submitDocumentAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, async () => {
    const file = await readFile(formData);
    if (!file) throw new ValidationError({ file: ["validation.fileRequired"] });
    await documentService.submitExternal(ctx, projectId, formInput<{ title?: string; category?: string; description?: string }>(formData), file);
  });
  revalidatePath(`/c/${slug}/portal/${projectId}`);
  if (r.ok) redirect(`/c/${slug}/portal/${projectId}?delivered=1`);
  return r;
}
