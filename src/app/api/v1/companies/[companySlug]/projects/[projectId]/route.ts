import { projectService } from "@/modules/projects/service";
import type { ProjectInput } from "@/modules/projects/schemas";
import { json, readJson, withCompany } from "../../../../_lib/handler";

type P = { companySlug: string; projectId: string };

export const GET = withCompany<P>(async (ctx, _r, p) => json({ data: await projectService.get(ctx, p.projectId) }));
export const PUT = withCompany<P>(async (ctx, r, p) => json({ data: await projectService.update(ctx, p.projectId, (await readJson(r)) as ProjectInput) }));
/** Archives (never hard-deletes). */
export const DELETE = withCompany<P>(async (ctx, _r, p) => json({ data: await projectService.archive(ctx, p.projectId) }));
