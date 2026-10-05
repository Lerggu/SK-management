import { readClient, runInTransaction, isCheckViolation, isUniqueViolation } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { canAccessProject, projectPermissions, type RequestContext } from "@/platform/authz";
import { renderLabelSheet, type Label } from "@/platform/labels";
import { canMoveMaterial, canPull, usedPct, type MaterialStatus } from "./rules";
import { materialPermissions, requireAccessoryRegister, requireMaterial, visibleMaterialProjects } from "./access";
import { LiftingRepo } from "./repo";
import {
  drumSchema,
  drumUpdateSchema,
  labelSchema,
  materialBatchSchema,
  materialListSchema,
  materialMoveSchema,
  pullSchema,
  scanSchema,
  type DrumInput,
  type DrumUpdateInput,
  type LabelInput,
  type MaterialBatchInput,
  type MaterialMoveInput,
  type PullInput,
} from "./schemas";

const str = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : d.toString());
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function siteFor(repo: LiftingRepo, ctx: RequestContext, siteId: string, permission: "material.view" | "material.manage") {
  const site = await repo.findSite(siteId);
  if (!site) throw new NotFoundError();
  requireMaterial(ctx, site.projectId, permission);
  return site;
}

async function checkRefs(repo: LiftingRepo, siteId: string, refs: { activityId?: string | null; locationId?: string | null; deliveryId?: string | null }) {
  if (refs.activityId) {
    const a = await repo.findActivity(refs.activityId);
    if (!a || a.siteId !== siteId) throw new ValidationError({ activityId: ["validation.invalidOption"] });
  }
  if (refs.locationId) {
    const l = await repo.findLocation(refs.locationId);
    if (!l || l.siteId !== siteId || l.archivedAt) throw new ValidationError({ locationId: ["validation.invalidOption"] });
  }
  if (refs.deliveryId) {
    const d = await repo.findDelivery(refs.deliveryId);
    if (!d || d.siteId !== siteId) throw new ValidationError({ deliveryId: ["validation.invalidOption"] });
  }
}

// ── material batches ─────────────────────────────────────────────────
export const materialBatchService = {
  /** Choices for material and drum forms on one site. */
  async options(ctx: RequestContext, siteId: string) {
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    const site = await siteFor(repo, ctx, siteId, "material.view");
    const [locations, activities, deliveries] = await Promise.all([repo.listLocations(site.id), repo.listActivities(site.id), repo.listDeliveries(site.id)]);
    return { site, locations, activities, deliveries, permissions: materialPermissions(ctx, site.projectId) };
  },

  async sites(ctx: RequestContext) {
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    return repo.listSites(visibleMaterialProjects(ctx));
  },

  async list(ctx: RequestContext, input: { siteId?: string | null; status?: string } = {}) {
    const data = parseInput(materialListSchema, input);
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    if (data.siteId) await siteFor(repo, ctx, data.siteId, "material.view");
    const rows = await repo.listBatches({ projectIds: visibleMaterialProjects(ctx), siteId: data.siteId ?? undefined, status: data.status });
    return rows.map((b) => ({ ...b, quantity: b.quantity.toString() }));
  },

  async get(ctx: RequestContext, batchId: string) {
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    const b = await repo.findBatch(batchId);
    if (!b) throw new NotFoundError();
    requireMaterial(ctx, b.projectId, "material.view");
    const users = await repo.findUsers([...new Set(b.movements.map((m) => m.movedById).filter((x): x is string => !!x))]);
    return { ...b, quantity: b.quantity.toString(), next: (["RECEIVED", "STORED", "AT_WORKFACE", "INSTALLED", "RETURNED"] as MaterialStatus[]).filter((to) => canMoveMaterial(b.status, to)), users, permissions: materialPermissions(ctx, b.projectId) };
  },

  /** Registers a batch (usually from a V4 delivery); the first movement row records its origin. */
  async create(ctx: RequestContext, input: MaterialBatchInput) {
    const data = parseInput(materialBatchSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const site = await siteFor(repo, ctx, data.siteId, "material.manage");
      if (site.archivedAt || site.project.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      await checkRefs(repo, site.id, data);
      let b;
      try {
        b = await repo.createBatch({ ...data, projectId: site.projectId, status: "RECEIVED", createdById: ctx.user.id, updatedById: ctx.user.id });
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ code: ["validation.codeTaken"] });
        throw e;
      }
      await repo.createMovement({ siteId: site.id, batchId: b.id, fromStatus: null, toStatus: "RECEIVED", locationId: data.locationId, activityId: data.activityId, note: null, movedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "material_batch.create", entityType: "material_batch", entityId: b.id, projectId: b.projectId, after: b });
      return b;
    });
  },

  /** delivery → storage → workface → installed; every move is an append-only movement row. */
  async move(ctx: RequestContext, batchId: string, input: MaterialMoveInput) {
    const data = parseInput(materialMoveSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const b = await repo.findBatch(batchId);
      if (!b) throw new NotFoundError();
      requireMaterial(ctx, b.projectId, "material.manage");
      if (b.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      if (!canMoveMaterial(b.status, data.to)) throw new ValidationError({ to: ["validation.invalidTransition"] });
      await checkRefs(repo, b.siteId, data);
      const activityId = data.activityId ?? b.activityId;
      if ((data.to === "AT_WORKFACE" || data.to === "INSTALLED") && !activityId) throw new ValidationError({ activityId: ["validation.activityRequired"] });
      const locationId = data.to === "STORED" ? (data.locationId ?? b.locationId) : data.locationId;
      if (data.to === "STORED" && !locationId) throw new ValidationError({ locationId: ["validation.required"] });
      const after = await repo.updateBatch(b.id, { status: data.to, activityId, locationId, updatedById: ctx.user.id });
      await repo.createMovement({ siteId: b.siteId, batchId: b.id, fromStatus: b.status, toStatus: data.to, locationId, activityId, note: data.note, movedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "material_batch.move", entityType: "material_batch", entityId: b.id, projectId: b.projectId, before: { status: b.status, locationId: b.locationId, activityId: b.activityId }, after: { status: data.to, locationId, activityId, note: data.note } });
      return after;
    });
  },
};

// ── cable drums ──────────────────────────────────────────────────────
type Drum = NonNullable<Awaited<ReturnType<LiftingRepo["findDrum"]>>>;
const presentDrumNumbers = <T extends { originalLengthM: { toString(): string }; remainingM: { toString(): string }; weightKg: { toString(): string } | null; receivedDate: Date | null; nextInspectionDate: Date | null }>(d: T) => ({
  ...d,
  originalLengthM: d.originalLengthM.toString(),
  remainingM: d.remainingM.toString(),
  weightKg: str(d.weightKg),
  receivedDate: isoDate(d.receivedDate),
  nextInspectionDate: isoDate(d.nextInspectionDate),
  usedPct: usedPct(Number(d.originalLengthM.toString()), Number(d.remainingM.toString())),
});

export const cableDrumService = {
  async list(ctx: RequestContext, input: { siteId?: string | null } = {}) {
    const data = parseInput(materialListSchema.pick({ siteId: true }), input);
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    if (data.siteId) await siteFor(repo, ctx, data.siteId, "material.view");
    const rows = await repo.listDrums({ projectIds: visibleMaterialProjects(ctx), siteId: data.siteId ?? undefined });
    return rows.map(presentDrumNumbers);
  },

  async get(ctx: RequestContext, drumId: string) {
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    const d = await repo.findDrum(drumId);
    if (!d) throw new NotFoundError();
    requireMaterial(ctx, d.projectId, "material.view");
    const users = await repo.findUsers([...new Set(d.pulls.map((p) => p.createdById).filter((x): x is string => !!x))]);
    return { ...presentDrumNumbers(d), pulls: d.pulls.map((p: Drum["pulls"][number]) => ({ ...p, lengthM: p.lengthM.toString(), pulledOn: isoDate(p.pulledOn) })), users, permissions: materialPermissions(ctx, d.projectId) };
  },

  async create(ctx: RequestContext, input: DrumInput) {
    const data = parseInput(drumSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const site = await siteFor(repo, ctx, data.siteId, "material.manage");
      if (site.archivedAt || site.project.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      await checkRefs(repo, site.id, { activityId: data.reservedActivityId, locationId: data.locationId, deliveryId: data.deliveryId });
      try {
        // remaining_m is set to the original length by the database trigger.
        const d = await repo.createDrum({ ...data, projectId: site.projectId, remainingM: data.originalLengthM, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "cable_drum.create", entityType: "cable_drum", entityId: d.id, projectId: d.projectId, after: d });
        return d;
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ code: ["validation.codeTaken"] });
        throw e;
      }
    });
  },

  /** Location, reservation for a takt activity, inspection date, return to supplier. */
  async update(ctx: RequestContext, drumId: string, input: DrumUpdateInput) {
    const data = parseInput(drumUpdateSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const before = await repo.findDrum(drumId);
      if (!before) throw new NotFoundError();
      requireMaterial(ctx, before.projectId, "material.manage");
      if (before.archivedAt || before.status === "RETURNED") throw new ValidationError({ _form: ["validation.archived"] });
      await checkRefs(repo, before.siteId, { activityId: data.reservedActivityId, locationId: data.locationId });
      const after = await repo.updateDrum(before.id, {
        locationId: data.locationId,
        reservedActivityId: data.reservedActivityId,
        nextInspectionDate: data.nextInspectionDate,
        notes: data.notes,
        ...(data.returned ? { status: "RETURNED" as const } : {}),
        updatedById: ctx.user.id,
      });
      const { pulls: _p, site: _s, location: _l, reservedActivity: _r, delivery: _d, ...plain } = before;
      await writeAudit(tx, ctx, { action: data.returned ? "cable_drum.return" : "cable_drum.update", entityType: "cable_drum", entityId: after.id, projectId: after.projectId, before: plain, after, diff: true });
      return after;
    });
  },

  /**
   * Records a pull in metres (owner decision 2). The database decrements the
   * remaining length; a pull longer than what is left is refused here and,
   * as a last line, by the CHECK constraint.
   */
  async pull(ctx: RequestContext, drumId: string, input: PullInput) {
    const data = parseInput(pullSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new LiftingRepo(tx, ctx.company.id);
      const d = await repo.findDrum(drumId);
      if (!d) throw new NotFoundError();
      requireMaterial(ctx, d.projectId, "material.manage");
      if (d.archivedAt || d.status === "RETURNED" || d.status === "EMPTY") throw new ValidationError({ _form: ["validation.drumNotUsable"] });
      await checkRefs(repo, d.siteId, { activityId: data.activityId });
      if (!canPull(Number(d.remainingM.toString()), Number(data.lengthM))) throw new ValidationError({ lengthM: ["validation.pullExceedsRemaining"] });
      let p;
      try {
        p = await repo.createPull({ siteId: d.siteId, drumId: d.id, activityId: data.activityId ?? d.reservedActivityId, lengthM: data.lengthM, pulledOn: data.pulledOn, note: data.note, createdById: ctx.user.id });
      } catch (e) {
        if (isCheckViolation(e, "cable_drums_remaining")) throw new ValidationError({ lengthM: ["validation.pullExceedsRemaining"] });
        throw e;
      }
      const after = (await repo.findDrum(d.id))!;
      await writeAudit(tx, ctx, { action: "cable_drum.pull", entityType: "cable_drum", entityId: d.id, projectId: d.projectId, before: { remainingM: d.remainingM.toString() }, after: { pullId: p.id, lengthM: data.lengthM, activityId: p.activityId, remainingM: after.remainingM.toString(), status: after.status } });
      return { pull: p, remainingM: after.remainingM.toString(), status: after.status };
    });
  },
};

// ── traceability ─────────────────────────────────────────────────────
export const materialTraceService = {
  /** Lifts, material movements and cable pulls recorded against one takt activity. */
  async activity(ctx: RequestContext, activityId: string) {
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    const a = await repo.findActivity(activityId);
    if (!a) throw new NotFoundError();
    if (!canAccessProject(ctx, a.projectId)) throw new NotFoundError();
    const perms = projectPermissions(ctx, a.projectId);
    if (!perms.has("takt.view")) throw new NotFoundError();
    const [trace, lifts, batches, drums] = await Promise.all([
      perms.has("material.view") ? repo.activityTrace(a.id) : Promise.resolve({ pulls: [], movements: [] }),
      perms.has("logistics.view") ? repo.listPlans({ activityId: a.id }) : Promise.resolve([]),
      perms.has("material.view") ? repo.listBatches({ activityId: a.id }) : Promise.resolve([]),
      perms.has("material.view") ? repo.listDrums({ activityId: a.id }) : Promise.resolve([]),
    ]);
    return {
      lifts: lifts.map((p) => ({ id: p.id, title: p.title, status: p.status, plannedStart: p.plannedStart, approved: p.versions.some((v) => v.status === "APPROVED") })),
      batches: batches.map((b) => ({ id: b.id, code: b.code, material: b.material, quantity: b.quantity.toString(), unit: b.unit, status: b.status })),
      drums: drums.map((d) => ({ id: d.id, code: d.code, cableType: d.cableType, remainingM: d.remainingM.toString() })),
      pulls: trace.pulls.map((p) => ({ id: p.id, lengthM: p.lengthM.toString(), pulledOn: isoDate(p.pulledOn), drum: p.drum })),
      movements: trace.movements.map((m) => ({ id: m.id, toStatus: m.toStatus, movedAt: m.movedAt, batch: { ...m.batch, quantity: m.batch.quantity.toString() } })),
      totalPulledM: trace.pulls.reduce((s, p) => s + Math.round(Number(p.lengthM.toString()) * 10), 0) / 10,
      permissions: { material: perms.has("material.view"), lifts: perms.has("logistics.view") },
    };
  },
};

// ── QR labels and scanning ───────────────────────────────────────────
export type ScanKind = "drum" | "batch" | "accessory";

/** Internal URL with the opaque record id only (owner decision 3, ADR 0017). */
export const scanPath = (companySlug: string, id: string) => `/c/${companySlug}/scan/${id}`;

export const materialLabelService = {
  /** A4 PDF label sheet; the QR codes hold internal URLs only. */
  async pdf(ctx: RequestContext, input: LabelInput, origin: string, strings: { title: string; footer: string }) {
    const data = parseInput(labelSchema, input);
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    const { slug } = await repo.findCompanySlug();
    const url = (id: string) => `${origin.replace(/\/$/, "")}${scanPath(slug, id)}`;
    let labels: Label[] = [];
    if (data.kind === "accessory") {
      requireAccessoryRegister(ctx);
      const rows = data.ids.length ? await repo.findAccessoriesByIds(data.ids) : await repo.listAccessories();
      if (data.ids.length && rows.length !== new Set(data.ids).size) throw new NotFoundError();
      labels = rows.map((a) => ({ url: url(a.id), code: a.code, lines: [a.name, `WLL ${a.wllKg.toString()} kg`] }));
    } else {
      const site = data.siteId ? await siteFor(repo, ctx, data.siteId, "material.view") : null;
      if (!site && !data.ids.length) throw new ValidationError({ siteId: ["validation.required"] });
      if (data.kind === "drum") {
        const rows = data.ids.length ? await repo.findDrumsByIds(data.ids) : await repo.listDrums({ siteId: site!.id });
        if (data.ids.length && rows.length !== new Set(data.ids).size) throw new NotFoundError();
        for (const r of rows) requireMaterial(ctx, r.projectId, "material.view");
        labels = rows.map((d) => ({ url: url(d.id), code: d.code, lines: [d.cableType, `${d.originalLengthM.toString()} m`, d.manufacturer ?? ""].filter(Boolean) }));
      } else {
        const rows = data.ids.length ? await repo.findBatchesByIds(data.ids) : await repo.listBatches({ siteId: site!.id });
        if (data.ids.length && rows.length !== new Set(data.ids).size) throw new NotFoundError();
        for (const r of rows) requireMaterial(ctx, r.projectId, "material.view");
        labels = rows.map((b) => ({ url: url(b.id), code: b.code, lines: [b.material, `${b.quantity.toString()} ${b.unit}`] }));
      }
    }
    if (!labels.length) throw new ValidationError({ _form: ["validation.nothingToLabel"] });
    return renderLabelSheet(labels, strings);
  },
};

export const scanService = {
  /**
   * Resolves a scanned URL, an opaque id or a typed code to a record the
   * member may open. Unknown or invisible records are 404 alike.
   */
  async resolve(ctx: RequestContext, input: { code: string }): Promise<{ kind: ScanKind; id: string }> {
    const { code } = parseInput(scanSchema, input);
    const repo = new LiftingRepo(readClient(), ctx.company.id);
    const idMatch = code.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const id = idMatch?.[0].toLowerCase();
    const typed = code.trim().toUpperCase();
    const drum = id ? await repo.findDrum(id) : await repo.findDrumByCode(typed);
    if (drum) {
      requireMaterial(ctx, drum.projectId, "material.view");
      return { kind: "drum", id: drum.id };
    }
    const batch = id ? await repo.findBatch(id) : await repo.findBatchByCode(typed);
    if (batch) {
      requireMaterial(ctx, batch.projectId, "material.view");
      return { kind: "batch", id: batch.id };
    }
    const acc = id ? await repo.findAccessory(id) : await repo.findAccessoryByCode(typed);
    if (acc) {
      try {
        requireAccessoryRegister(ctx);
      } catch (e) {
        if (e instanceof ForbiddenError) throw new NotFoundError();
        throw e;
      }
      return { kind: "accessory", id: acc.id };
    }
    throw new NotFoundError();
  },
};

