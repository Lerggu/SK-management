import { siteService } from "@/modules/projects/service";
import type { SiteInput } from "@/modules/projects/schemas";
import { json, readJson, withCompany } from "../../../../../_lib/handler";

type P = { companySlug: string; projectId: string };

export const GET = withCompany<P>(async (ctx, _r, p) => json({ data: await siteService.list(ctx, p.projectId) }));
export const POST = withCompany<P>(async (ctx, r, p) => json({ data: await siteService.create(ctx, p.projectId, (await readJson(r)) as SiteInput) }, { status: 201 }));
