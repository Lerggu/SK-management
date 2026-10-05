import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import type { RequestContext } from "@/platform/authz";
import { requireTakt, taktPermissions } from "./access";
import { TaktRepo } from "./repo";
import { areaSchema, areaUpdateSchema, buildingSchema, workPackageSchema, type AreaInput, type AreaUpdateInput, type BuildingInput, type WorkPackageInput } from "./schemas";

function uniqueOr(e: unknown, field: string): never {
  if (isUniqueViolation(e)) throw new ValidationError({ [field]: ["validation.codeTaken"] });
  throw e;
}

/** Takt structure: Site → Building/Area → Takt Area, and project work packages. */
export const taktStructureService = {
  async overview(ctx: RequestContext, projectId: string) {
    const repo = new TaktRepo(readClient(), ctx.company.id);
    const project = await repo.findProject(projectId);
    if (!project) throw new NotFoundError();
    requireTakt(ctx, project.id, "takt.view");
    const [sites, buildings, workPackages, plans, equipmentTypes] = await Promise.all([
      repo.listSites(project.id),
      repo.listBuildings(project.id),
      repo.listWorkPackages(project.id),
      repo.listPlans([project.id]),
      repo.listEquipmentTypes(),
    ]);
    return { project, sites, buildings, workPackages, plans, equipmentTypes, permissions: taktPermissions(ctx, project.id) };
  },

  async createBuilding(ctx: RequestContext, input: BuildingInput) {
    const data = parseInput(buildingSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const site = await repo.findSite(data.siteId);
      if (!site) throw new NotFoundError();
      requireTakt(ctx, site.projectId, "takt.manage");
      try {
        const b = await repo.createBuilding({ projectId: site.projectId, siteId: site.id, name: data.name, code: data.code, kind: data.kind, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "building.create", entityType: "building", entityId: b.id, projectId: b.projectId, after: b });
        return b;
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ name: ["validation.nameTaken"] });
        throw e;
      }
    });
  },

  async archiveBuilding(ctx: RequestContext, buildingId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await repo.findBuilding(buildingId);
      if (!before) throw new NotFoundError();
      requireTakt(ctx, before.projectId, "takt.manage");
      const after = await repo.updateBuilding(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "building.archive", entityType: "building", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },

  async createArea(ctx: RequestContext, input: AreaInput) {
    const data = parseInput(areaSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const building = await repo.findBuilding(data.buildingId);
      if (!building) throw new NotFoundError();
      requireTakt(ctx, building.projectId, "takt.manage");
      if (building.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      const sortOrder = data.sortOrder ?? (await repo.countAreas(building.id)) * 10;
      try {
        const a = await repo.createArea({ siteId: building.siteId, buildingId: building.id, code: data.code, name: data.name, sortOrder, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "takt_area.create", entityType: "takt_area", entityId: a.id, projectId: building.projectId, after: a });
        return a;
      } catch (e) {
        uniqueOr(e, "code");
      }
    });
  },

  async updateArea(ctx: RequestContext, areaId: string, input: AreaUpdateInput) {
    const data = parseInput(areaUpdateSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await repo.findArea(areaId);
      if (!before) throw new NotFoundError();
      requireTakt(ctx, before.building.projectId, "takt.manage");
      try {
        const after = await repo.updateArea(before.id, { code: data.code, name: data.name, ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "takt_area.update", entityType: "takt_area", entityId: after.id, projectId: before.building.projectId, before, after, diff: true });
        return after;
      } catch (e) {
        uniqueOr(e, "code");
      }
    });
  },

  async archiveArea(ctx: RequestContext, areaId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await repo.findArea(areaId);
      if (!before) throw new NotFoundError();
      requireTakt(ctx, before.building.projectId, "takt.manage");
      const after = await repo.updateArea(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "takt_area.archive", entityType: "takt_area", entityId: after.id, projectId: before.building.projectId, before, after, diff: true });
      return after;
    });
  },

  async createWorkPackage(ctx: RequestContext, projectId: string, input: WorkPackageInput) {
    const data = parseInput(workPackageSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const project = await repo.findProject(projectId);
      if (!project) throw new NotFoundError();
      requireTakt(ctx, project.id, "takt.manage");
      if (data.equipmentTypeId && !(await repo.findEquipmentType(data.equipmentTypeId))) throw new ValidationError({ equipmentTypeId: ["validation.invalidOption"] });
      const sortOrder = data.sortOrder ?? (await repo.countWorkPackages(project.id)) * 10;
      try {
        const wp = await repo.createWorkPackage({ projectId: project.id, ...data, equipmentCount: data.equipmentTypeId ? data.equipmentCount : 0, sortOrder, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "work_package.create", entityType: "work_package", entityId: wp.id, projectId: project.id, after: wp });
        return wp;
      } catch (e) {
        uniqueOr(e, "code");
      }
    });
  },

  async updateWorkPackage(ctx: RequestContext, workPackageId: string, input: WorkPackageInput) {
    const data = parseInput(workPackageSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await repo.findWorkPackage(workPackageId);
      if (!before) throw new NotFoundError();
      requireTakt(ctx, before.projectId, "takt.manage");
      if (data.equipmentTypeId && !(await repo.findEquipmentType(data.equipmentTypeId))) throw new ValidationError({ equipmentTypeId: ["validation.invalidOption"] });
      try {
        const after = await repo.updateWorkPackage(before.id, {
          ...data,
          sortOrder: data.sortOrder ?? before.sortOrder,
          equipmentCount: data.equipmentTypeId ? data.equipmentCount : 0,
          updatedById: ctx.user.id,
        });
        await writeAudit(tx, ctx, { action: "work_package.update", entityType: "work_package", entityId: after.id, projectId: after.projectId, before, after, diff: true });
        return after;
      } catch (e) {
        uniqueOr(e, "code");
      }
    });
  },

  async archiveWorkPackage(ctx: RequestContext, workPackageId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await repo.findWorkPackage(workPackageId);
      if (!before) throw new NotFoundError();
      requireTakt(ctx, before.projectId, "takt.manage");
      const after = await repo.updateWorkPackage(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "work_package.archive", entityType: "work_package", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },
};
