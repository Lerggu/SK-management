"use server";

import { redirect } from "next/navigation";
import { companyDirectoryService } from "@/modules/companies/service";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireUserContext } from "@/app/_lib/context";

export async function createCompanyAction(_: ActionState | null, formData: FormData): Promise<ActionState> {
  const uctx = await requireUserContext();
  let slug = "";
  const result = await runAction(formData, async () => {
    const company = await companyDirectoryService.createCompany(uctx, formInput(formData));
    slug = company.slug;
  });
  if (result.ok) redirect(`/c/${slug}/dashboard`);
  return result;
}
