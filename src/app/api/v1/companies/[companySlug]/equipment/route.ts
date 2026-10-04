import { equipmentService } from "@/modules/equipment/service";
import type { EquipmentInput } from "@/modules/equipment/schemas";
import { json, readJson, withCompany } from "../../../_lib/handler";

export const GET = withCompany(async (ctx, request) => {
  const url = new URL(request.url);
  return json({ data: await equipmentService.list(ctx, { q: url.searchParams.get("q"), includeArchived: url.searchParams.get("includeArchived") === "true", projectId: url.searchParams.get("projectId") }) });
});
export const POST = withCompany(async (ctx, r) => json({ data: await equipmentService.create(ctx, (await readJson(r)) as EquipmentInput) }, { status: 201 }));
