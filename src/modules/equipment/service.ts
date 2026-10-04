import { readClient, runInTransaction, isUniqueViolation, type Tx } from "@/platform/db";
import { ConflictError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { hasPermission, requirePermission, type RequestContext } from "@/platform/authz";
import { currentRates, overlapsExisting, rateSchema, ratesToClose, type RateInput } from "@/modules/shared/rates";
import { EquipmentRepo } from "./repo";
import { equipmentListSchema, equipmentSchema, equipmentTypeSchema, type EquipmentInput, type EquipmentTypeInput } from "./schemas";

type EquipmentRow = NonNullable<Awaited<ReturnType<EquipmentRepo["find"]>>>;
type RateRow = Awaited<ReturnType<EquipmentRepo["listRates"]>>[number];

/** Output mapper: rates only with `equipment.rates.view`. */
function toEquipmentView(ctx: RequestContext, e: EquipmentRow, rates?: RateRow[]) {
  const { equipmentType, currentProject, currentSite, ...rest } = e;
  const base = { ...rest, equipmentType, currentProject, currentSite };
  if (!hasPermission(ctx, "equipment.rates.view") || !rates) return base;
  return { ...base, currentRates: currentRates(rates), rates };
}

/** Validates project/site placement inside the caller's company. */
async function checkPlacement(repo: EquipmentRepo, data: { currentProjectId: string | null; currentSiteId: string | null }) {
  if (data.currentProjectId && !(await repo.findProject(data.currentProjectId))) {
    throw new ValidationError({ currentProjectId: ["validation.invalidOption"] });
  }
  if (data.currentSiteId) {
    const site = await repo.findSite(data.currentSiteId);
    if (!site || site.projectId !== data.currentProjectId) throw new ValidationError({ currentSiteId: ["validation.invalidOption"] });
  }
}

async function checkType(repo: EquipmentRepo, typeId: string) {
  const type = await repo.findType(typeId);
  if (!type || type.archivedAt) throw new ValidationError({ equipmentTypeId: ["validation.invalidOption"] });
}

function conflictOn<T>(field: string, p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (isUniqueViolation(e)) throw new ConflictError("Already in use", field);
    throw e;
  });
}

async function reload(tx: Tx, ctx: RequestContext, id: string) {
  const row = await new EquipmentRepo(tx, ctx.company.id).find(id);
  if (!row) throw new NotFoundError();
  return toEquipmentView(ctx, row);
}

export const equipmentTypeService = {
  async list(ctx: RequestContext, input: { includeArchived?: boolean } = {}) {
    requirePermission(ctx, "equipment.view");
    const rows = await new EquipmentRepo(readClient(), ctx.company.id).listTypes(input.includeArchived ?? false);
    return rows.map(({ _count, ...t }) => ({ ...t, equipmentCount: _count.equipment }));
  },

  async create(ctx: RequestContext, input: EquipmentTypeInput) {
    requirePermission(ctx, "equipment.manage");
    const data = parseInput(equipmentTypeSchema, input);
    return conflictOn(
      "name",
      runInTransaction(async (tx) => {
        const type = await new EquipmentRepo(tx, ctx.company.id).createType({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "equipment_type.create", entityType: "equipment_type", entityId: type.id, after: type });
        return type;
      }),
    );
  },

  async update(ctx: RequestContext, typeId: string, input: EquipmentTypeInput) {
    requirePermission(ctx, "equipment.manage");
    const data = parseInput(equipmentTypeSchema, input);
    return conflictOn(
      "name",
      runInTransaction(async (tx) => {
        const repo = new EquipmentRepo(tx, ctx.company.id);
        const before = await repo.findType(typeId);
        if (!before) throw new NotFoundError();
        const after = await repo.updateType(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "equipment_type.update", entityType: "equipment_type", entityId: after.id, before, after, diff: true });
        return after;
      }),
    );
  },

  async archive(ctx: RequestContext, typeId: string) {
    requirePermission(ctx, "equipment.manage");
    return runInTransaction(async (tx) => {
      const repo = new EquipmentRepo(tx, ctx.company.id);
      const before = await repo.findType(typeId);
      if (!before) throw new NotFoundError();
      if (before.archivedAt) return before;
      const after = await repo.updateType(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "equipment_type.archive", entityType: "equipment_type", entityId: after.id, before, after, diff: true });
      return after;
    });
  },
};

export const equipmentService = {
  async list(ctx: RequestContext, input: { q?: string | null; includeArchived?: boolean; projectId?: string | null } = {}) {
    requirePermission(ctx, "equipment.view");
    const filter = parseInput(equipmentListSchema, input);
    const repo = new EquipmentRepo(readClient(), ctx.company.id);
    const rows = await repo.list(filter);
    if (!hasPermission(ctx, "equipment.rates.view")) return rows.map((e) => toEquipmentView(ctx, e));
    const rates = await repo.listRates(rows.map((e) => e.id));
    return rows.map((e) => toEquipmentView(ctx, e, rates.filter((r) => r.equipmentId === e.id)));
  },

  async get(ctx: RequestContext, equipmentId: string) {
    requirePermission(ctx, "equipment.view");
    const repo = new EquipmentRepo(readClient(), ctx.company.id);
    const row = await repo.find(equipmentId);
    if (!row) throw new NotFoundError();
    const rates = hasPermission(ctx, "equipment.rates.view") ? await repo.listRates([row.id]) : undefined;
    return toEquipmentView(ctx, row, rates);
  },

  async create(ctx: RequestContext, input: EquipmentInput) {
    requirePermission(ctx, "equipment.manage");
    const data = parseInput(equipmentSchema, input);
    return conflictOn(
      "assetNumber",
      runInTransaction(async (tx) => {
        const repo = new EquipmentRepo(tx, ctx.company.id);
        await checkType(repo, data.equipmentTypeId);
        await checkPlacement(repo, data);
        const row = await repo.create({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, {
          action: "equipment.create",
          entityType: "equipment",
          entityId: row.id,
          projectId: row.currentProjectId,
          after: row,
        });
        return reload(tx, ctx, row.id);
      }),
    );
  },

  async update(ctx: RequestContext, equipmentId: string, input: EquipmentInput) {
    requirePermission(ctx, "equipment.manage");
    const data = parseInput(equipmentSchema, input);
    return conflictOn(
      "assetNumber",
      runInTransaction(async (tx) => {
        const repo = new EquipmentRepo(tx, ctx.company.id);
        const before = await repo.findRaw(equipmentId);
        if (!before) throw new NotFoundError();
        if (before.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
        if (data.equipmentTypeId !== before.equipmentTypeId) await checkType(repo, data.equipmentTypeId);
        await checkPlacement(repo, data);
        const after = await repo.update(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, {
          action: "equipment.update",
          entityType: "equipment",
          entityId: after.id,
          projectId: after.currentProjectId,
          before,
          after,
          diff: true,
        });
        return reload(tx, ctx, after.id);
      }),
    );
  },

  async archive(ctx: RequestContext, equipmentId: string) {
    requirePermission(ctx, "equipment.manage");
    return runInTransaction(async (tx) => {
      const repo = new EquipmentRepo(tx, ctx.company.id);
      const before = await repo.findRaw(equipmentId);
      if (!before) throw new NotFoundError();
      if (!before.archivedAt) {
        const after = await repo.update(before.id, { archivedAt: new Date(), status: "OUT_OF_SERVICE", updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "equipment.archive", entityType: "equipment", entityId: after.id, before, after, diff: true });
      }
      return reload(tx, ctx, before.id);
    });
  },

  async listRates(ctx: RequestContext, equipmentId: string) {
    requirePermission(ctx, "equipment.view");
    requirePermission(ctx, "equipment.rates.view");
    const repo = new EquipmentRepo(readClient(), ctx.company.id);
    const row = await repo.findRaw(equipmentId);
    if (!row) throw new NotFoundError();
    return repo.listRates([row.id]);
  },

  async addRate(ctx: RequestContext, equipmentId: string, input: RateInput) {
    requirePermission(ctx, "equipment.rates.manage");
    const data = parseInput(rateSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new EquipmentRepo(tx, ctx.company.id);
      const row = await repo.findRaw(equipmentId);
      if (!row) throw new NotFoundError();
      const existing = await repo.listRates([row.id]);
      const toClose = ratesToClose(existing, data);
      if (overlapsExisting(existing, data, new Set(toClose.map((c) => c.id)))) {
        throw new ValidationError({ validFrom: ["validation.rateOverlap"] });
      }
      for (const c of toClose) {
        const before = existing.find((r) => r.id === c.id)!;
        const after = await repo.updateRate(c.id, { validTo: c.validTo, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "equipment_rate.close", entityType: "equipment_rate", entityId: c.id, before, after, diff: true });
      }
      const rate = await repo.createRate({ ...data, equipmentId: row.id, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, {
        action: "equipment_rate.create",
        entityType: "equipment_rate",
        entityId: rate.id,
        after: rate,
        metadata: { equipmentId: row.id },
      });
      return rate;
    });
  },

  async archiveRate(ctx: RequestContext, rateId: string) {
    requirePermission(ctx, "equipment.rates.manage");
    return runInTransaction(async (tx) => {
      const repo = new EquipmentRepo(tx, ctx.company.id);
      const before = await repo.findRate(rateId);
      if (!before) throw new NotFoundError();
      if (before.archivedAt) return before;
      const after = await repo.updateRate(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "equipment_rate.archive", entityType: "equipment_rate", entityId: after.id, before, after, diff: true });
      return after;
    });
  },
};
