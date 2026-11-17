"use server";

import { revalidatePath } from "next/cache";
import { personalIdService } from "@/modules/workforce/personal-id.service";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

/** Personal identity code (ADR 0028); the service checks employee.pid.manage. */
export async function setPersonalIdAction(slug: string, employeeId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => personalIdService.set(ctx, employeeId, formInput<{ personalId?: string }>(formData)).then(() => undefined));
  revalidatePath(`/c/${slug}/workforce/${employeeId}`);
  return r.ok ? { ok: true, message: "workforce.pid.saved" } : r;
}

export async function clearPersonalIdAction(slug: string, employeeId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => personalIdService.clear(ctx, employeeId).then(() => undefined));
  revalidatePath(`/c/${slug}/workforce/${employeeId}`);
  return r;
}

/** Returns the full code once (audited); it is never put in the page markup. */
export async function revealPersonalIdAction(slug: string, employeeId: string): Promise<{ ok: boolean; personalId?: string; message?: string }> {
  const ctx = await requireCompanyContext(slug);
  let personalId: string | undefined;
  const r = await runAction(null, async () => {
    personalId = (await personalIdService.reveal(ctx, employeeId)).personalId;
  });
  return r.ok ? { ok: true, personalId } : { ok: false, message: r.fieldErrors?._form?.[0] ?? r.message };
}
