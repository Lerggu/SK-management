import { redirect } from "next/navigation";
import { getSessionUserId, requireUserContext } from "./_lib/context";
import { companyDirectoryService } from "@/modules/companies/service";
import { profileService } from "@/modules/identity/service";

/** Entry: last used company, the only company, or the company picker. */
export default async function Home() {
  if (!(await getSessionUserId())) redirect("/sign-in");
  const uctx = await requireUserContext();
  const [companies, profile] = await Promise.all([companyDirectoryService.listMyCompanies(uctx), profileService.getProfile(uctx)]);
  const last = companies.find((c) => c.id === profile.lastCompanyId);
  if (last) redirect(`/c/${last.slug}/dashboard`);
  if (companies.length === 1) redirect(`/c/${companies[0].slug}/dashboard`);
  redirect("/c");
}
