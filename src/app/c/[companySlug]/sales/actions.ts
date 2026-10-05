"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customerService, opportunityService } from "@/modules/commercial/crm.service";
import { quoteService } from "@/modules/commercial/quote.service";
import type { ContactInput, CustomerInput, DecisionInput, OpportunityInput, OutcomeInput, QuoteDraftInput, QuoteInput, QuoteLineInput } from "@/modules/commercial/schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const root = (slug: string) => `/c/${slug}/sales`;
const refresh = (slug: string) => {
  revalidatePath(root(slug), "layout");
  revalidatePath(`/c/${slug}/projects`, "layout");
};
const done = (r: ActionState): ActionState => (r.ok ? { ok: true, message: r.message } : r);

export async function createCustomerAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await customerService.create(ctx, formInput<CustomerInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`${root(slug)}/customers/${id}`);
  return r;
}

export async function updateCustomerAction(slug: string, customerId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => customerService.update(ctx, customerId, formInput<CustomerInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function addContactAction(slug: string, customerId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => customerService.addContact(ctx, customerId, formInput<ContactInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function archiveContactAction(slug: string, contactId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => customerService.archiveContact(ctx, contactId));
  refresh(slug);
  return r;
}

export async function createOpportunityAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => opportunityService.create(ctx, formInput<OpportunityInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function updateOpportunityAction(slug: string, opportunityId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => opportunityService.update(ctx, opportunityId, formInput<OpportunityInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function createQuoteAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await quoteService.create(ctx, formInput<QuoteInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`${root(slug)}/quotes/${id}`);
  return r;
}

export async function updateQuoteDraftAction(slug: string, quoteId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => quoteService.updateDraft(ctx, quoteId, formInput<QuoteDraftInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function addQuoteLineAction(slug: string, quoteId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => quoteService.addLine(ctx, quoteId, formInput<QuoteLineInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function removeQuoteLineAction(slug: string, quoteId: string, lineId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => quoteService.removeLine(ctx, quoteId, lineId));
  refresh(slug);
  return r;
}

export async function submitQuoteAction(slug: string, quoteId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => quoteService.submit(ctx, quoteId));
  refresh(slug);
  return r;
}

export async function returnQuoteAction(slug: string, quoteId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => quoteService.returnToDraft(ctx, quoteId, formInput(formData)));
  refresh(slug);
  return r;
}

export async function decideQuoteAction(slug: string, quoteId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => quoteService.decide(ctx, quoteId, formInput<DecisionInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function sendQuoteAction(slug: string, quoteId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => quoteService.markSent(ctx, quoteId));
  refresh(slug);
  return r;
}

export async function quoteOutcomeAction(slug: string, quoteId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => quoteService.recordOutcome(ctx, quoteId, formInput<OutcomeInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function reviseQuoteAction(slug: string, quoteId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => quoteService.revise(ctx, quoteId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return r;
}
