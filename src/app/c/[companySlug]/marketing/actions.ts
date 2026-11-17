"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { marketingService } from "@/modules/marketing/service";
import type { CallInput, ContactInput, LeadInput, ManualLeadInput, MessageEditInput, SettingsInput, SuppressionInput } from "@/modules/marketing/schemas";
import { formInput, formObject, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const root = (slug: string) => `/c/${slug}/marketing`;
const refresh = (slug: string) => revalidatePath(root(slug), "layout");

export async function updateSettingsAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => marketingService.updateSettings(ctx, formObject(formData) as unknown as SettingsInput).then(() => undefined));
  refresh(slug);
  return r;
}

export async function startDiscoveryAction(slug: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => marketingService.startDiscovery(ctx).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: "marketing.runStarted" } : r;
}

export async function createLeadAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await marketingService.createLead(ctx, formInput<ManualLeadInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`${root(slug)}/${id}`);
  return r;
}

export async function updateLeadAction(slug: string, leadId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => marketingService.updateLead(ctx, leadId, formObject(formData) as unknown as LeadInput).then(() => undefined));
  refresh(slug);
  return r;
}

export async function convertLeadAction(slug: string, leadId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let opportunityId: string | null = null;
  const r = await runAction(null, async () => {
    opportunityId = (await marketingService.convertToOpportunity(ctx, leadId)).opportunityId;
  });
  refresh(slug);
  revalidatePath(`/c/${slug}/sales`, "layout");
  if (r.ok && opportunityId) redirect(`/c/${slug}/sales/opportunities/${opportunityId}`);
  return r;
}

export async function addContactAction(slug: string, leadId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => marketingService.addContact(ctx, leadId, formInput<ContactInput>(formData)).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: "common.saved" } : r;
}

export async function archiveContactAction(slug: string, contactId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => marketingService.archiveContact(ctx, contactId));
  refresh(slug);
  return r;
}

export async function draftForLeadAction(slug: string, leadId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let drafted = 0;
  let error: string | undefined;
  const r = await runAction(null, async () => {
    const res = await marketingService.draftForLead(ctx, leadId);
    drafted = res.drafted;
    error = res.error;
  });
  refresh(slug);
  if (!r.ok) return r;
  if (error) return { ok: false, message: error };
  return { ok: true, message: drafted ? "marketing.drafted" : "marketing.nothingToDraft" };
}

export async function updateMessageAction(slug: string, messageId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => marketingService.updateMessage(ctx, messageId, formInput<MessageEditInput>(formData)));
  refresh(slug);
  return r;
}

export async function approveMessageAction(slug: string, messageId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let out: { sent: boolean; error: string | null } = { sent: false, error: null };
  const r = await runAction(null, async () => {
    out = await marketingService.approveMessage(ctx, messageId);
  });
  refresh(slug);
  if (!r.ok) return r;
  // The letter leaves the draft list, so the outcome is shown on the page.
  const notice = out.sent ? "sent" : out.error?.startsWith("marketing.errors.") ? out.error.slice("marketing.".length) : "approvedQueued";
  redirect(`${root(slug)}/approvals?notice=${encodeURIComponent(notice)}`);
}

export async function rejectMessageAction(slug: string, messageId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => marketingService.rejectMessage(ctx, messageId));
  refresh(slug);
  return r;
}

export async function recordCallAction(slug: string, messageId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => marketingService.recordCall(ctx, messageId, formInput<CallInput>(formData)));
  refresh(slug);
  return r;
}

export async function addSuppressionAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => marketingService.addSuppression(ctx, formInput<SuppressionInput>(formData)));
  refresh(slug);
  return r;
}
