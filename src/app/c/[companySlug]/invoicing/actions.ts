"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { billingSettingsService, salesDocumentService } from "@/modules/sales/service";
import type { BillingSettingsInput, CreateSalesDocumentInput, SalesDocumentHeaderInput, SalesLineInput, SendSalesDocumentInput, VoidInput } from "@/modules/sales/schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const root = (slug: string) => `/c/${slug}/invoicing`;
const refresh = (slug: string) => revalidatePath(root(slug), "layout");

export async function createDocumentAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await salesDocumentService.create(ctx, formInput<CreateSalesDocumentInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`${root(slug)}/${id}`);
  return r;
}

export async function updateDocumentAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => salesDocumentService.update(ctx, id, formInput<SalesDocumentHeaderInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function addLineAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => salesDocumentService.addLine(ctx, id, formInput<SalesLineInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function updateLineAction(slug: string, id: string, lineId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => salesDocumentService.updateLine(ctx, lineId, formInput<SalesLineInput>(formData)).then(() => undefined));
  refresh(slug);
  if (r.ok) redirect(`${root(slug)}/${id}#lines`);
  return r;
}

export async function removeLineAction(slug: string, lineId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => salesDocumentService.removeLine(ctx, lineId));
  refresh(slug);
  return r;
}

export async function issueDocumentAction(slug: string, id: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => salesDocumentService.issue(ctx, id).then(() => undefined));
  refresh(slug);
  return r;
}

export async function sendDocumentAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => salesDocumentService.send(ctx, id, formInput<SendSalesDocumentInput>(formData)).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: "invoicing.sentOk" } : r;
}

export async function voidDocumentAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => salesDocumentService.void(ctx, id, formInput<VoidInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function invoiceFromOrderAction(slug: string, id: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let newId: string | null = null;
  const r = await runAction(null, async () => {
    newId = (await salesDocumentService.createInvoiceFromOrder(ctx, id)).id;
  });
  refresh(slug);
  if (r.ok && newId) redirect(`${root(slug)}/${newId}`);
  return r;
}

export async function creditNoteAction(slug: string, id: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let newId: string | null = null;
  const r = await runAction(null, async () => {
    newId = (await salesDocumentService.createCreditNote(ctx, id)).id;
  });
  refresh(slug);
  if (r.ok && newId) redirect(`${root(slug)}/${newId}`);
  return r;
}

export async function archiveDraftAction(slug: string, id: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => salesDocumentService.archiveDraft(ctx, id));
  refresh(slug);
  if (r.ok) redirect(root(slug));
  return r;
}

export async function updateBillingSettingsAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => billingSettingsService.update(ctx, formInput<BillingSettingsInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}
