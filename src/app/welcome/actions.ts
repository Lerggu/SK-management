"use server";

import { redirect } from "next/navigation";
import { profileService, type RegistrationInput } from "@/modules/identity/service";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireUserContext } from "@/app/_lib/context";
import { safeNext } from "@/app/_lib/registration";

export async function registerAction(next: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const uctx = await requireUserContext();
  const r = await runAction(formData, () => profileService.register(uctx, formInput<RegistrationInput>(formData)).then(() => undefined));
  if (!r.ok) return r;
  redirect(safeNext(next));
}
