"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cableDrumService, materialBatchService, scanService } from "@/modules/lifting/material.service";
import type { DrumInput, DrumUpdateInput, MaterialBatchInput, MaterialMoveInput, PullInput } from "@/modules/lifting/schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const root = (slug: string) => `/c/${slug}/materials`;
function refresh(slug: string) {
  revalidatePath(root(slug), "layout");
  revalidatePath(`/c/${slug}/takt`, "layout");
}

export async function createBatchAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await materialBatchService.create(ctx, formInput<MaterialBatchInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`${root(slug)}/batches/${id}`);
  return r;
}

export async function moveBatchAction(slug: string, batchId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => materialBatchService.move(ctx, batchId, formInput<MaterialMoveInput>(formData)).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function createDrumAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await cableDrumService.create(ctx, formInput<DrumInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`${root(slug)}/drums/${id}`);
  return r;
}

export async function updateDrumAction(slug: string, drumId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => cableDrumService.update(ctx, drumId, formInput<DrumUpdateInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function pullCableAction(slug: string, drumId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => cableDrumService.pull(ctx, drumId, formInput<PullInput>(formData)).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: r.message } : r;
}

const HREF = { drum: "materials/drums", batch: "materials/batches", accessory: "lifting/accessories" } as const;

/** Manual code entry (fallback when the camera cannot be used). */
export async function scanAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let target: string | null = null;
  const r = await runAction(formData, async () => {
    const hit = await scanService.resolve(ctx, { code: String(formData.get("code") ?? "") });
    target = `/c/${slug}/${HREF[hit.kind]}/${hit.id}`;
  });
  if (r.ok && target) redirect(target);
  return r.message === "errors.notFound" ? { ...r, message: "materials.scanNotFound" } : r;
}
