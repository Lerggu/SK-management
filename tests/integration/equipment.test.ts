import { describe, expect, it } from "vitest";
import { MASK } from "@/platform/audit";
import { ValidationError } from "@/platform/errors";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { projectService, siteService } from "@/modules/projects/service";
import { auditFor, createMember, createTenant } from "../helpers/fixtures";

describe("equipment", () => {
  it("equipment CRUD with placement, meter hours and inspection date; audited", async () => {
    const t = await createTenant("Eq");
    const type = await equipmentTypeService.create(t.ownerCtx, { name: "Mobile crane", category: "CRANE" });
    const p = await projectService.create(t.ownerCtx, { code: "P", name: "P" });
    const s = await siteService.create(t.ownerCtx, p.id, { name: "Hall" });
    const eq = await equipmentService.create(t.ownerCtx, {
      equipmentTypeId: type.id,
      assetNumber: "EQ-1",
      name: "Crane 100 t",
      currentProjectId: p.id,
      currentSiteId: s.id,
      meterHours: "1234,5",
      nextInspectionDate: "2026-12-01",
    });
    expect(eq.currentSite?.name).toBe("Hall");
    expect(eq.meterHours?.toString()).toBe("1234.5");
    const updated = await equipmentService.update(t.ownerCtx, eq.id, { equipmentTypeId: type.id, assetNumber: "EQ-1", name: "Crane 100 t", status: "MAINTENANCE" });
    expect(updated.currentProject).toBeNull();
    await equipmentService.archive(t.ownerCtx, eq.id);
    expect((await auditFor(t.companyId, eq.id)).map((e) => e.action)).toEqual(["equipment.create", "equipment.update", "equipment.archive"]);
  });

  it("rejects a site that does not belong to the chosen project", async () => {
    const t = await createTenant("Place");
    const type = await equipmentTypeService.create(t.ownerCtx, { name: "Forklift" });
    const p1 = await projectService.create(t.ownerCtx, { code: "1", name: "1" });
    const p2 = await projectService.create(t.ownerCtx, { code: "2", name: "2" });
    const s2 = await siteService.create(t.ownerCtx, p2.id, { name: "S2" });
    await expect(
      equipmentService.create(t.ownerCtx, { equipmentTypeId: type.id, assetNumber: "X", name: "X", currentProjectId: p1.id, currentSiteId: s2.id }),
    ).rejects.toMatchObject({ fieldErrors: { currentSiteId: ["validation.invalidOption"] } });
    await expect(equipmentService.create(t.ownerCtx, { equipmentTypeId: type.id, assetNumber: "X", name: "X", currentSiteId: s2.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rates are permissioned and masked in audit", async () => {
    const t = await createTenant("EqRates");
    const type = await equipmentTypeService.create(t.ownerCtx, { name: "Telehandler" });
    const eq = await equipmentService.create(t.ownerCtx, { equipmentTypeId: type.id, assetNumber: "T", name: "T" });
    const rate = await equipmentService.addRate(t.ownerCtx, eq.id, { rateType: "COST", unit: "DAY", amount: "350", validFrom: "2026-01-01" });
    expect((await auditFor(t.companyId, rate.id))[0].after).toMatchObject({ amount: MASK, unit: "DAY" });
    const logistics = await createMember(t, "LOGISTICS_COORDINATOR");
    expect(await equipmentService.get(logistics, eq.id)).not.toHaveProperty("rates");
    const pd = await createMember(t, "PROJECT_DIRECTOR");
    expect((await equipmentService.get(pd, eq.id)) as { currentRates?: { cost: unknown } }).toHaveProperty("currentRates.cost");
    await equipmentService.archiveRate(t.ownerCtx, rate.id);
  });

  it("equipment types are unique per company", async () => {
    const t = await createTenant("Types");
    await equipmentTypeService.create(t.ownerCtx, { name: "Crane" });
    await expect(equipmentTypeService.create(t.ownerCtx, { name: "Crane" })).rejects.toMatchObject({ field: "name" });
    const other = await createTenant("Types2");
    await expect(equipmentTypeService.create(other.ownerCtx, { name: "Crane" })).resolves.toBeTruthy();
  });
});
