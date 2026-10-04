import { projectService } from "@/modules/projects/service";
import type { ProjectInput } from "@/modules/projects/schemas";
import { json, readJson, withCompany } from "../../../_lib/handler";

export const GET = withCompany(async (ctx, request) => {
  const url = new URL(request.url);
  return json({ data: await projectService.list(ctx, { q: url.searchParams.get("q"), includeArchived: url.searchParams.get("includeArchived") === "true" }) });
});

export const POST = withCompany(async (ctx, request) => json({ data: await projectService.create(ctx, (await readJson(request)) as ProjectInput) }, { status: 201 }));
