"use server";

import { revalidatePath } from "next/cache";
import { siteMapService } from "@/modules/production/sitemap.service";
import { deviationService } from "@/modules/production/deviation.service";
import type { CreateObjectInput, MoveObjectInput, PlaceTaskInput, UpdateObjectInput, UploadMapInput } from "@/modules/production/sitemap.schemas";
import { formInput, readFile, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

/** Site map operations (ADR 0034); the services check access. */
const refresh = (slug: string) => revalidatePath(`/c/${slug}/logistics`, "layout");

export async function uploadMapAction(slug: string, siteId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, async () => {
    const file = await readFile(formData, "file");
    await siteMapService.uploadMap(ctx, siteId, formInput<UploadMapInput>(formData), file ?? { fileName: "", bytes: new Uint8Array() });
  });
  refresh(slug);
  return r.ok ? { ok: true, message: "production.map.uploaded" } : r;
}

export async function createObjectAction(slug: string, siteId: string, input: CreateObjectInput): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => siteMapService.createObject(ctx, siteId, input).then(() => undefined));
  refresh(slug);
  return r;
}

export async function updateObjectAction(slug: string, objectId: string, input: UpdateObjectInput): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => siteMapService.updateObject(ctx, objectId, input).then(() => undefined));
  refresh(slug);
  return r;
}

export async function moveObjectAction(slug: string, objectId: string, input: MoveObjectInput): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => siteMapService.moveObject(ctx, objectId, input).then(() => undefined));
  refresh(slug);
  return r;
}

export async function archiveObjectAction(slug: string, objectId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => siteMapService.archiveObject(ctx, objectId));
  refresh(slug);
  return r;
}

export async function placeTaskAction(slug: string, taskId: string, input: PlaceTaskInput): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => siteMapService.placeTask(ctx, taskId, input).then(() => undefined));
  refresh(slug);
  return r;
}

export async function unplaceTaskAction(slug: string, taskId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => siteMapService.unplaceTask(ctx, taskId));
  refresh(slug);
  return r;
}

/** Deviation of a map object from the phone: type, optional photo and comment. */
export async function reportObjectDeviationAction(slug: string, objectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, async () => {
    await deviationService.reportOnObject(ctx, objectId, formInput(formData), await readFile(formData, "photo"));
  });
  refresh(slug);
  return r.ok ? { ok: true, message: "production.deviations.sent" } : r;
}
