"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contractService, forecastService, variationService } from "@/modules/commercial/project.service";
import type { ClientDecisionInput, ContractInput, ContractUpdateInput, DecisionInput, EtcInput, MilestoneInput, VariationDraftInput, VariationInput } from "@/modules/commercial/schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const root = (slug: string, projectId: string) => `/c/${slug}/projects/${projectId}/commercial`;
const refresh = (slug: string) => {
  revalidatePath(`/c/${slug}/projects`, "layout");
  revalidatePath(`/c/${slug}/sales`, "layout");
  revalidatePath(`/c/${slug}/billing`, "layout");
};
const done = (r: ActionState): ActionState => (r.ok ? { ok: true, message: r.message } : r);

export async function createContractAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => contractService.create(ctx, formInput<ContractInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function updateContractAction(slug: string, contractId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => contractService.update(ctx, contractId, formInput<ContractUpdateInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function addMilestoneAction(slug: string, contractId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => contractService.addMilestone(ctx, contractId, formInput<MilestoneInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function setEtcAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => forecastService.setEtc(ctx, projectId, formInput<EtcInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function createVariationAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await variationService.create(ctx, { ...formInput<VariationInput>(formData), projectId })).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`${root(slug, projectId)}/variations/${id}`);
  return r;
}

export async function updateVariationAction(slug: string, variationId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => variationService.updateDraft(ctx, variationId, formInput<VariationDraftInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function variationStepAction(slug: string, variationId: string, step: "submit" | "execute" | "ready"): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const fn = step === "submit" ? variationService.submitForReview : step === "execute" ? variationService.markExecuted : variationService.markReadyToInvoice;
  const r = await runAction(null, () => fn(ctx, variationId));
  refresh(slug);
  return r;
}

export async function publishToClientAction(slug: string, variationId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => variationService.publishToClient(ctx, variationId).then(() => undefined));
  refresh(slug);
  revalidatePath(`/c/${slug}/portal`, "layout");
  return r;
}

export async function returnVariationAction(slug: string, variationId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => variationService.returnToDraft(ctx, variationId, formInput(formData)));
  refresh(slug);
  return r;
}

export async function approveVariationAction(slug: string, variationId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => variationService.approveInternal(ctx, variationId, formInput<DecisionInput>(formData)));
  refresh(slug);
  return r;
}

export async function clientDecisionAction(slug: string, variationId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => variationService.recordClientDecision(ctx, variationId, formInput<ClientDecisionInput>(formData)));
  refresh(slug);
  return r;
}
