"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { invoiceService } from "@/modules/commercial/invoice.service";
import type { ExportInput, GenerateInput, MarkInvoicedInput } from "@/modules/commercial/schemas";
import { formInput, formObject, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const refresh = (slug: string) => {
  revalidatePath(`/c/${slug}/billing`, "layout");
  revalidatePath(`/c/${slug}/projects`, "layout");
};

export async function generateAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let message = "billing.generated";
  const r = await runAction(formData, async () => {
    const res = await invoiceService.generate(ctx, formInput<GenerateInput>(formData));
    message = res.unpriced.length ? "billing.generatedWithUnpriced" : "billing.generated";
  });
  refresh(slug);
  return r.ok ? { ok: true, message } : r;
}

export async function generateInternalAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let message = "billing.generated";
  const r = await runAction(formData, async () => {
    const res = await invoiceService.generateInternal(ctx, formInput(formData));
    message = res.unpriced.length ? "billing.generatedWithUnpriced" : "billing.generated";
  });
  refresh(slug);
  return r.ok ? { ok: true, message } : r;
}

export async function exportAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await invoiceService.export(ctx, formInput<ExportInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`/c/${slug}/billing?exported=${id}`);
  return r;
}

export async function voidCandidateAction(slug: string, candidateId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => invoiceService.void(ctx, candidateId));
  refresh(slug);
  return r;
}

export async function markInvoicedAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const input = formObject(formData);
  const r = await runAction(formData, () => invoiceService.markInvoiced(ctx, { ...input, ids: formData.getAll("ids").map(String) } as unknown as MarkInvoicedInput).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: r.message } : r;
}
