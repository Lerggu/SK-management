"use server";

import { revalidatePath } from "next/cache";
import { assistantService } from "@/modules/assistant/service";
import { runAction } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

type Result = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]>; conversationId?: string | null };

/** Assistant turn and decisions (ADR 0031); the service checks access. */
export async function assistantSendAction(slug: string, conversationId: string | null, message: string): Promise<Result> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = conversationId;
  const r = await runAction(null, async () => {
    id = (await assistantService.converse(ctx, { conversationId, message })).conversationId;
  });
  return { ...r, conversationId: id };
}

export async function assistantConfirmAction(slug: string, actionId: string, confirmAmount: string | null): Promise<Result> {
  const ctx = await requireCompanyContext(slug);
  let failed: string | undefined;
  const r = await runAction(null, async () => {
    const res = await assistantService.confirm(ctx, actionId, { confirmAmount });
    if (res.status === "FAILED") failed = res.error;
  });
  revalidatePath(`/c/${slug}`, "layout");
  return failed ? { ok: false, message: failed } : r;
}

export async function assistantRejectAction(slug: string, actionId: string): Promise<Result> {
  const ctx = await requireCompanyContext(slug);
  return runAction(null, () => assistantService.reject(ctx, actionId).then(() => undefined));
}

export async function assistantConfirmAllAction(slug: string, conversationId: string): Promise<Result> {
  const ctx = await requireCompanyContext(slug);
  let failed = 0;
  const r = await runAction(null, async () => {
    failed = (await assistantService.confirmAll(ctx, conversationId)).results.filter((x) => x.status === "FAILED").length;
  });
  revalidatePath(`/c/${slug}`, "layout");
  return r.ok && failed ? { ok: false, message: "assistant.someFailed" } : r;
}

export async function assistantNewAction(slug: string): Promise<Result> {
  await requireCompanyContext(slug);
  return { ok: true, conversationId: null };
}
