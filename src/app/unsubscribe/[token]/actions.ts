"use server";

import { revalidatePath } from "next/cache";
import { unsubscribeByToken } from "@/modules/marketing/agents";
import type { ActionState } from "@/app/_lib/action";

/** Public opt-out (no sign-in): the token in the letter identifies the address. */
export async function unsubscribeAction(token: string): Promise<ActionState> {
  const r = await unsubscribeByToken(token);
  revalidatePath(`/unsubscribe/${token}`);
  return r.ok ? { ok: true } : { ok: false, message: "errors.notFound" };
}
