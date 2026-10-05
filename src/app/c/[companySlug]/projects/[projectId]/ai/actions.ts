"use server";

import { revalidatePath } from "next/cache";
import { aiProjectControllerService } from "@/modules/ai/service";
import type { AskInput, BudgetInput, RecommendationDecisionInput } from "@/modules/ai/schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const refresh = (slug: string, projectId: string) => revalidatePath(`/c/${slug}/projects/${projectId}/ai`);
const done = (r: ActionState): ActionState => (r.ok ? { ok: true } : r);

export async function reviewAction(slug: string, projectId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => aiProjectControllerService.review(ctx, projectId).then(() => undefined));
  refresh(slug, projectId);
  return done(r);
}

export async function askAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => aiProjectControllerService.ask(ctx, projectId, formInput<AskInput>(formData)).then(() => undefined));
  refresh(slug, projectId);
  return done(r);
}

export async function decideRecommendationAction(slug: string, projectId: string, recommendationId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => aiProjectControllerService.decideRecommendation(ctx, recommendationId, formInput<RecommendationDecisionInput>(formData)).then(() => undefined));
  refresh(slug, projectId);
  return done(r);
}

export async function setBudgetAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => aiProjectControllerService.setBudget(ctx, formInput<BudgetInput>(formData)).then(() => undefined));
  refresh(slug, projectId);
  return r;
}
