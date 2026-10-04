"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import type { EquipmentInput, EquipmentTypeInput } from "@/modules/equipment/schemas";
import type { RateInput } from "@/modules/shared/rates";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const base = (slug: string) => `/c/${slug}/equipment`;

/** The form sends one "location" value: "", "p:<projectId>" or "s:<projectId>:<siteId>". */
function equipmentInput(formData: FormData): EquipmentInput {
  const input = formInput<EquipmentInput & { location?: string }>(formData);
  const [kind, projectId, siteId] = String(input.location ?? "").split(":");
  delete input.location;
  return { ...input, currentProjectId: kind ? projectId : null, currentSiteId: kind === "s" ? siteId : null };
}

export async function createEquipmentAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id = "";
  const r = await runAction(formData, async () => {
    id = (await equipmentService.create(ctx, equipmentInput(formData))).id;
  });
  if (r.ok) redirect(`${base(slug)}/${id}`);
  return r;
}

export async function updateEquipmentAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => equipmentService.update(ctx, id, equipmentInput(formData)).then(() => undefined));
  if (r.ok) redirect(`${base(slug)}/${id}`);
  return r;
}

export async function archiveEquipmentAction(slug: string, id: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => equipmentService.archive(ctx, id).then(() => undefined));
  if (r.ok) redirect(base(slug));
  return r;
}

export async function addEquipmentRateAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => equipmentService.addRate(ctx, id, formInput<RateInput>(formData)).then(() => undefined));
  revalidatePath(`${base(slug)}/${id}`);
  return r;
}

export async function archiveEquipmentRateAction(slug: string, id: string, rateId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => equipmentService.archiveRate(ctx, rateId).then(() => undefined));
  revalidatePath(`${base(slug)}/${id}`);
  return r;
}

export async function createTypeAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => equipmentTypeService.create(ctx, formInput<EquipmentTypeInput>(formData)).then(() => undefined));
  revalidatePath(`${base(slug)}/types`);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function archiveTypeAction(slug: string, typeId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => equipmentTypeService.archive(ctx, typeId).then(() => undefined));
  revalidatePath(`${base(slug)}/types`);
  return r;
}
