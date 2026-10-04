"use server";

import { revalidatePath } from "next/cache";
import { budgetService, costService } from "@/modules/finance/service";
import type { BudgetLineInput, CostEntryInput } from "@/modules/finance/schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const page = (slug: string, projectId: string) => `/c/${slug}/projects/${projectId}/finance`;

export async function createBudgetAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => budgetService.createVersion(ctx, projectId, formInput(formData)).then(() => undefined));
  revalidatePath(page(slug, projectId));
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function addBudgetLineAction(slug: string, projectId: string, budgetId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => budgetService.addLine(ctx, budgetId, formInput<BudgetLineInput>(formData)).then(() => undefined));
  revalidatePath(page(slug, projectId));
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function removeBudgetLineAction(slug: string, projectId: string, lineId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => budgetService.removeLine(ctx, lineId));
  revalidatePath(page(slug, projectId));
  return r;
}

export async function activateBudgetAction(slug: string, projectId: string, budgetId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => budgetService.activate(ctx, budgetId).then(() => undefined));
  revalidatePath(page(slug, projectId));
  return r;
}

export async function discardBudgetAction(slug: string, projectId: string, budgetId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => budgetService.discardDraft(ctx, budgetId));
  revalidatePath(page(slug, projectId));
  return r;
}

export async function addCostAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => costService.create(ctx, projectId, formInput<CostEntryInput>(formData)).then(() => undefined));
  revalidatePath(page(slug, projectId));
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function archiveCostAction(slug: string, projectId: string, costId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => costService.archive(ctx, costId).then(() => undefined));
  revalidatePath(page(slug, projectId));
  return r;
}
