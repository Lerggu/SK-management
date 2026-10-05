"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { liftingAccessoryService, liftPlanService } from "@/modules/lifting/lift.service";
import { bookingService } from "@/modules/logistics/booking.service";
import type { AccessoryInput, AccessoryUpdateInput, LiftAccessoryInput, LiftDecisionInput, LiftPlanInput, LiftVersionInput } from "@/modules/lifting/schemas";
import type { BookingInput } from "@/modules/logistics/schemas";
import { formInput, formObject, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const root = (slug: string) => `/c/${slug}/lifting`;
function refresh(slug: string) {
  revalidatePath(root(slug), "layout");
  revalidatePath(`/c/${slug}/logistics`, "layout");
}

export async function createLiftPlanAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await liftPlanService.create(ctx, formInput<LiftPlanInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`${root(slug)}/${id}`);
  return r;
}

export async function updateLiftDraftAction(slug: string, planId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => liftPlanService.updateDraft(ctx, planId, formInput<LiftVersionInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function addLiftAccessoryAction(slug: string, planId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => liftPlanService.addAccessory(ctx, planId, formInput<LiftAccessoryInput>(formData)));
  refresh(slug);
  return r.ok ? { ok: true } : r;
}

export async function removeLiftAccessoryAction(slug: string, planId: string, accessoryId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => liftPlanService.removeAccessory(ctx, planId, accessoryId));
  refresh(slug);
  return r;
}

export async function submitLiftAction(slug: string, planId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => liftPlanService.submit(ctx, planId));
  refresh(slug);
  return r;
}

export async function returnLiftAction(slug: string, planId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => liftPlanService.returnToDraft(ctx, planId, formInput(formData)));
  refresh(slug);
  return r;
}

export async function decideLiftAction(slug: string, planId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => liftPlanService.decide(ctx, planId, formInput<LiftDecisionInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function reviseLiftAction(slug: string, planId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => liftPlanService.revise(ctx, planId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function completeLiftAction(slug: string, planId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => liftPlanService.complete(ctx, planId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function cancelLiftAction(slug: string, planId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => liftPlanService.cancel(ctx, planId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function bookLiftCrewAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const input = formObject(formData);
  const r = await runAction(formData, () => bookingService.create(ctx, { ...input, resources: formData.getAll("resources").map(String) } as unknown as BookingInput).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function createAccessoryAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => liftingAccessoryService.create(ctx, formInput<AccessoryInput>(formData)).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function updateAccessoryAction(slug: string, accessoryId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => liftingAccessoryService.update(ctx, accessoryId, formInput<AccessoryUpdateInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function archiveAccessoryAction(slug: string, accessoryId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => liftingAccessoryService.archive(ctx, accessoryId).then(() => undefined));
  refresh(slug);
  if (r.ok) redirect(`${root(slug)}/accessories`);
  return r;
}
