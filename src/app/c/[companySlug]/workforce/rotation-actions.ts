"use server";

import { revalidatePath } from "next/cache";
import { rotationService } from "@/modules/workforce/rotation.service";
import type { ClearRangeInput, PatternInput, SetRangeInput } from "@/modules/workforce/rotation.schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

/** Rotation calendar: set a period from the dialog (ADR 0027); the service checks access. */
export async function rotationSetAction(slug: string, input: SetRangeInput): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => rotationService.setRange(ctx, input).then(() => undefined));
  revalidatePath(`/c/${slug}/workforce/rotation`);
  return r;
}

export async function rotationClearAction(slug: string, input: ClearRangeInput): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => rotationService.clearRange(ctx, input).then(() => undefined));
  revalidatePath(`/c/${slug}/workforce/rotation`);
  return r;
}

/** Work/off rhythm for several people (form). */
export async function rotationPatternAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let summary = { written: 0, kept: 0 };
  const r = await runAction(formData, async () => {
    summary = await rotationService.applyPattern(ctx, { ...formInput<PatternInput>(formData), employeeIds: formData.getAll("employeeIds").map(String) });
  });
  revalidatePath(`/c/${slug}/workforce/rotation`);
  return r.ok ? { ok: true, message: summary.kept ? "rotation.patternKept" : "rotation.patternDone" } : r;
}
