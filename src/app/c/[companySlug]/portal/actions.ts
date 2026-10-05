"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientApprovalService } from "@/modules/commercial/client-approval.service";
import type { PortalDecisionInput } from "@/modules/commercial/schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
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
