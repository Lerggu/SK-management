import { employeeService } from "@/modules/workforce/service";
import type { EmployeeInput } from "@/modules/workforce/schemas";
import { json, readJson, withCompany } from "../../../_lib/handler";

export const GET = withCompany(async (ctx, request) => {
  const url = new URL(request.url);
  return json({ data: await employeeService.list(ctx, { q: url.searchParams.get("q"), includeArchived: url.searchParams.get("includeArchived") === "true" }) });
});
export const POST = withCompany(async (ctx, r) => json({ data: await employeeService.create(ctx, (await readJson(r)) as EmployeeInput) }, { status: 201 }));
