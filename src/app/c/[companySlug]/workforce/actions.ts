"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { employeeService } from "@/modules/workforce/service";
import type { EmployeeInput } from "@/modules/workforce/schemas";
import type { RateInput } from "@/modules/shared/rates";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const base = (slug: string) => `/c/${slug}/workforce`;

export async function createEmployeeAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id = "";
  const r = await runAction(formData, async () => {
    id = (await employeeService.create(ctx, formInput<EmployeeInput>(formData))).id;
  });
  if (r.ok) redirect(`${base(slug)}/${id}`);
  return r;
}

export async function updateEmployeeAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => employeeService.update(ctx, id, formInput<EmployeeInput>(formData)).then(() => undefined));
  if (r.ok) redirect(`${base(slug)}/${id}`);
  return r;
}

export async function archiveEmployeeAction(slug: string, id: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => employeeService.archive(ctx, id).then(() => undefined));
  if (r.ok) redirect(base(slug));
  return r;
}

export async function addEmployeeRateAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => employeeService.addRate(ctx, id, formInput<RateInput>(formData)).then(() => undefined));
  revalidatePath(`${base(slug)}/${id}`);
  return r;
}

export async function archiveEmployeeRateAction(slug: string, id: string, rateId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => employeeService.archiveRate(ctx, rateId).then(() => undefined));
  revalidatePath(`${base(slug)}/${id}`);
  return r;
}
