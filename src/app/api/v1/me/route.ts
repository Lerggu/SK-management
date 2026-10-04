import { companyDirectoryService } from "@/modules/companies/service";
import { profileService } from "@/modules/identity/service";
import { json, withUser } from "../_lib/handler";

/** GET /api/v1/me — profile and accessible companies. */
export const GET = withUser(async (uctx) => {
  const [profile, companies] = await Promise.all([profileService.getProfile(uctx), companyDirectoryService.listMyCompanies(uctx)]);
  return json({ data: { ...profile, companies } });
});
