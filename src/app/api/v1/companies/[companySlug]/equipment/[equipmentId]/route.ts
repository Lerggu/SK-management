import { equipmentService } from "@/modules/equipment/service";
import type { EquipmentInput } from "@/modules/equipment/schemas";
import { json, readJson, withCompany } from "../../../../_lib/handler";

type P = { companySlug: string; equipmentId: string };

export const GET = withCompany<P>(async (ctx, _r, p) => json({ data: await equipmentService.get(ctx, p.equipmentId) }));
export const PUT = withCompany<P>(async (ctx, r, p) => json({ data: await equipmentService.update(ctx, p.equipmentId, (await readJson(r)) as EquipmentInput) }));
export const DELETE = withCompany<P>(async (ctx, _r, p) => json({ data: await equipmentService.archive(ctx, p.equipmentId) }));
