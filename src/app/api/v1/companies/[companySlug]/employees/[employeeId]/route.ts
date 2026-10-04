import { employeeService } from "@/modules/workforce/service";
import type { EmployeeInput } from "@/modules/workforce/schemas";
import { json, readJson, withCompany } from "../../../../_lib/handler";

type P = { companySlug: string; employeeId: string };

export const GET = withCompany<P>(async (ctx, _r, p) => json({ data: await employeeService.get(ctx, p.employeeId) }));
export const PUT = withCompany<P>(async (ctx, r, p) => json({ data: await employeeService.update(ctx, p.employeeId, (await readJson(r)) as EmployeeInput) }));
export const DELETE = withCompany<P>(async (ctx, _r, p) => json({ data: await employeeService.archive(ctx, p.employeeId) }));
