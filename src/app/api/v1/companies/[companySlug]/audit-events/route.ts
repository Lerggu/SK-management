import { companyAdminService } from "@/modules/companies/service";
import { json, withCompany } from "../../../_lib/handler";

export const GET = withCompany(async (ctx, request) => {
  const url = new URL(request.url);
  return json({ data: await companyAdminService.listAuditEvents(ctx, { entityType: url.searchParams.get("entityType"), limit: Number(url.searchParams.get("limit") ?? 100) }) });
});
