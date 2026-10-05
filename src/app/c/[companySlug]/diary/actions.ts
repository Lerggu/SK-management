"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ValidationError } from "@/platform/errors";
import { diaryService } from "@/modules/diary/service";
import type { DiaryEntryInput } from "@/modules/diary/schemas";
import { formInput, readFile, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const page = (slug: string, id: string) => `/c/${slug}/diary/${id}`;

/** Opens (or creates) a site's diary for a date and navigates to it. */
export async function openDiaryAction(slug: string, siteId: string, date: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id = "";
  const r = await runAction(null, async () => {
    id = (await diaryService.open(ctx, { siteId, date })).id;
  });
  if (r.ok) redirect(page(slug, id));
  return r;
}

export async function updateDiaryAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => diaryService.update(ctx, id, formInput(formData)).then(() => undefined));
  revalidatePath(page(slug, id));
  return r;
}

export async function addDiaryEntryAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => diaryService.addEntry(ctx, id, formInput<DiaryEntryInput>(formData)).then(() => undefined));
  revalidatePath(page(slug, id));
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function removeDiaryEntryAction(slug: string, id: string, entryId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => diaryService.removeEntry(ctx, entryId));
  revalidatePath(page(slug, id));
  return r;
}

export async function addPhotoAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, async () => {
    const file = await readFile(formData);
    if (!file) throw new ValidationError({ file: ["validation.fileRequired"] });
    await diaryService.addAttachment(ctx, id, { caption: String(formData.get("caption") ?? "") }, file);
  });
  revalidatePath(page(slug, id));
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function signDiaryAction(slug: string, id: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => diaryService.sign(ctx, id).then(() => undefined));
  revalidatePath(page(slug, id));
  return r;
}
