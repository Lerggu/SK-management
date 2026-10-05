import { v7 as uuidv7 } from "uuid";
import { readClient, runInTransaction } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { uploadMaxBytes } from "@/platform/config/env";
import { getStorage } from "@/platform/storage";
import { checkRateLimit, RATE_LIMITS } from "@/platform/ratelimit";
import type { RequestContext } from "@/platform/authz";
import { sanitizeFileName, sha256Hex } from "@/modules/documents/versioning";
import { nextWorkingDay, parseIsoDate, toIsoDate, workingDaysBetween } from "./calendar";
import { requireTakt } from "./access";
import { workingCalendarFor } from "./plan.service";
import { TaktRepo } from "./repo";
import { importOptionsSchema, type ImportOptionsInput } from "./schemas";
import { activityKey, buildPreview, cyclePosition, type ImportPreview } from "./import/mapping";
import { parseMspdi } from "./import/mspdi";
import { decodeScheduleText, parseXer } from "./import/xer";
import { ScheduleParseError, type ParsedSchedule } from "./import/types";

const WP_COLORS = ["#1E88A8", "#0B2545", "#E07A1F", "#4C9F38", "#8E44AD", "#C0392B", "#16A085", "#B7950B"];

function detectAndParse(fileName: string, bytes: Uint8Array): ParsedSchedule {
  const text = decodeScheduleText(bytes);
  const lower = fileName.toLowerCase();
  try {
    if (lower.endsWith(".xer") || text.startsWith("ERMHDR")) return parseXer(text);
    if (lower.endsWith(".xml")) return parseMspdi(text);
  } catch (e) {
    if (e instanceof ScheduleParseError) throw new ValidationError({ file: ["validation.scheduleInvalid"] });
    throw e;
  }
  throw new ValidationError({ file: ["validation.scheduleFormat"] });
}

/** Short code from a name, unique within `taken` (case-insensitive). */
export function uniqueCode(name: string, taken: Set<string>, max = 20): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9ÅÄÖ]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max - 3) || "X";
  let code = base;
  for (let i = 2; taken.has(code.toLowerCase()); i++) code = `${base}-${i}`;
  taken.add(code.toLowerCase());
  return code;
}

/**
 * MS Project XML / Primavera P6 XER import. Step 1 stores the file and a
 * preview; step 2 applies it into a DRAFT version (never the baseline).
 */
export const scheduleImportService = {
  async preview(ctx: RequestContext, planId: string, input: ImportOptionsInput, file: { fileName: string; bytes: Uint8Array }) {
    const options = parseInput(importOptionsSchema, input);
    const repo = new TaktRepo(readClient(), ctx.company.id);
    const plan = await repo.findPlan(planId);
    if (!plan) throw new NotFoundError();
    requireTakt(ctx, plan.projectId, "takt.manage");
    const building = await repo.findBuilding(options.buildingId);
    if (!building || building.siteId !== plan.siteId || building.archivedAt) throw new ValidationError({ buildingId: ["validation.invalidOption"] });
    checkRateLimit(RATE_LIMITS.upload, ctx.user.id);
    if (file.bytes.byteLength === 0) throw new ValidationError({ file: ["validation.fileEmpty"] });
    if (file.bytes.byteLength > uploadMaxBytes()) throw new ValidationError({ file: ["validation.fileTooLarge"] });
    const fileName = sanitizeFileName(file.fileName);
    const parsed = detectAndParse(fileName, file.bytes);
    const cal = await workingCalendarFor(repo, plan);
    const preview = buildPreview(cal, parsed, { areaLevel: options.areaLevel, cycleLengthDays: plan.cycleLengthDays });
    if (preview.activities.length === 0) throw new ValidationError({ file: ["validation.scheduleNoTasks"] });
    const id = uuidv7();
    const storageKey = `companies/${ctx.company.id}/takt-plans/${plan.id}/imports/${id}`;
    await getStorage().put(storageKey, file.bytes, parsed.format === "XER" ? "text/plain" : "application/xml");
    return runInTransaction(async (tx) => {
      const txRepo = new TaktRepo(tx, ctx.company.id);
      const row = await txRepo.createImport({
        id,
        planId: plan.id,
        format: parsed.format,
        fileName,
        sizeBytes: BigInt(file.bytes.byteLength),
        sha256: sha256Hex(file.bytes),
        storageKey,
        options,
        preview: preview as unknown as object,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: "schedule_import.preview", entityType: "schedule_import", entityId: row.id, projectId: plan.projectId, after: { fileName, format: parsed.format, sha256: row.sha256, ...preview.counts } });
      return { id: row.id };
    });
  },

  async get(ctx: RequestContext, importId: string) {
    const repo = new TaktRepo(readClient(), ctx.company.id);
    const row = await repo.findImport(importId);
    if (!row) throw new NotFoundError();
    const plan = (await repo.findPlan(row.planId))!;
    requireTakt(ctx, plan.projectId, "takt.manage");
    const options = row.options as { buildingId: string; areaLevel: number };
    const [building, open] = await Promise.all([repo.findBuilding(options.buildingId), repo.findOpenVersion(plan.id)]);
    return { ...row, sizeBytes: Number(row.sizeBytes), preview: row.preview as unknown as ImportPreview, options, building, plan, openVersion: open };
  },

  async download(ctx: RequestContext, importId: string) {
    const repo = new TaktRepo(readClient(), ctx.company.id);
    const row = await repo.findImport(importId);
    if (!row) throw new NotFoundError();
    const plan = (await repo.findPlan(row.planId))!;
    requireTakt(ctx, plan.projectId, "takt.manage");
    const object = await getStorage().get(row.storageKey);
    if (!object) throw new NotFoundError("File missing from storage");
    return { fileName: row.fileName, contentType: row.format === "XER" ? "text/plain" : "application/xml", body: object.body };
  },

  async discard(ctx: RequestContext, importId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const row = await repo.findImport(importId);
      if (!row) throw new NotFoundError();
      const plan = (await repo.findPlan(row.planId))!;
      requireTakt(ctx, plan.projectId, "takt.manage");
      if (row.status !== "PREVIEW") throw new ValidationError({ _form: ["validation.importNotPending"] });
      await repo.updateImport(row.id, { status: "DISCARDED", updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "schedule_import.discard", entityType: "schedule_import", entityId: row.id, projectId: plan.projectId, before: { status: "PREVIEW" }, after: { status: "DISCARDED" } });
    });
  },

  /**
   * Applies a previewed import into the open DRAFT (or a new draft copied from
   * the baseline): creates missing takt areas and work packages, activities,
   * assignments and dependencies. The version start moves earlier if the
   * schedule starts before it; existing assignments shift to keep their dates.
   */
  async apply(ctx: RequestContext, importId: string) {
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const row = await repo.findImport(importId);
      if (!row) throw new NotFoundError();
      const plan = (await repo.findPlan(row.planId))!;
      requireTakt(ctx, plan.projectId, "takt.manage");
      if (row.status !== "PREVIEW") throw new ValidationError({ _form: ["validation.importNotPending"] });
      const options = row.options as { buildingId: string; areaLevel: number };
      const preview = row.preview as unknown as ImportPreview;
      const building = await repo.findBuilding(options.buildingId);
      if (!building || building.archivedAt) throw new ValidationError({ buildingId: ["validation.invalidOption"] });
      const cal = await workingCalendarFor(repo, plan);

      // Target version: the open draft, or a new draft copied from the baseline.
      let version = await repo.findOpenVersion(plan.id);
      if (version?.status === "PROPOSED") throw new ValidationError({ _form: ["validation.versionProposed"] });
      if (!version) {
        const baseline = await repo.findBaseline(plan.id);
        version = await repo.createVersion({ planId: plan.id, versionNumber: await repo.nextVersionNumber(plan.id), startDate: baseline?.startDate ?? parseIsoDate(preview.earliestStart!), reason: `Import: ${row.fileName}`, basedOnId: baseline?.id ?? null, createdById: ctx.user.id, updatedById: ctx.user.id });
        if (baseline) {
          const rows = await repo.listAssignments(baseline.id);
          if (rows.length) await repo.createAssignments(rows.map((r) => ({ planId: plan.id, versionId: version!.id, activityId: r.activityId, startCycle: r.startCycle, durationCycles: r.durationCycles })));
        }
      }
      const earliest = nextWorkingDay(cal, parseIsoDate(preview.earliestStart!));
      if (earliest < version.startDate) {
        const shift = Math.ceil(workingDaysBetween(cal, earliest, version.startDate) / plan.cycleLengthDays);
        for (const a of await repo.listAssignments(version.id)) await repo.updateAssignment(a.id, { startCycle: a.startCycle + shift });
        version = await repo.updateVersion(version.id, { startDate: earliest, updatedById: ctx.user.id });
      }

      // Takt areas (in the chosen building) and work packages, matched by name or code.
      const buildings = await repo.listBuildingsForSite(plan.siteId);
      const siteAreas = buildings.flatMap((b) => b.taktAreas);
      const areaCodes = new Set(buildings.find((b) => b.id === building.id)?.taktAreas.map((a) => a.code.toLowerCase()) ?? []);
      const areaByName = new Map<string, string>();
      let areasCreated = 0;
      for (const name of preview.areaNames) {
        const match = siteAreas.find((a) => a.name.toLowerCase() === name.toLowerCase() || a.code.toLowerCase() === name.toLowerCase());
        if (match) {
          areaByName.set(name.toLowerCase(), match.id);
          continue;
        }
        const created = await repo.createArea({ siteId: plan.siteId, buildingId: building.id, code: uniqueCode(name, areaCodes), name, sortOrder: (await repo.countAreas(building.id)) * 10, createdById: ctx.user.id, updatedById: ctx.user.id });
        areaByName.set(name.toLowerCase(), created.id);
        areasCreated++;
      }
      const wps = await repo.listWorkPackages(plan.projectId);
      const wpCodes = new Set(wps.map((w) => w.code.toLowerCase()));
      const wpByName = new Map<string, (typeof wps)[number] | Awaited<ReturnType<TaktRepo["createWorkPackage"]>>>();
      let wpsCreated = 0;
      for (const name of preview.workPackageNames) {
        const match = wps.find((w) => w.name.toLowerCase() === name.toLowerCase() || w.code.toLowerCase() === name.toLowerCase());
        if (match) {
          wpByName.set(name.toLowerCase(), match);
          continue;
        }
        const count = await repo.countWorkPackages(plan.projectId);
        const created = await repo.createWorkPackage({ projectId: plan.projectId, code: uniqueCode(name, wpCodes), name, color: WP_COLORS[count % WP_COLORS.length], sortOrder: count * 10, createdById: ctx.user.id, updatedById: ctx.user.id });
        wpByName.set(name.toLowerCase(), created);
        wpsCreated++;
      }

      // Activities and assignments.
      const activityByKey = new Map<string, string>();
      let activitiesCreated = 0;
      for (const m of preview.activities) {
        const areaId = areaByName.get(m.areaName.toLowerCase())!;
        const wp = wpByName.get(m.workPackageName.toLowerCase())!;
        let activity = await repo.findActivityByPair(plan.id, wp.id, areaId);
        if (!activity) {
          activity = await repo.createActivity({
            projectId: plan.projectId,
            siteId: plan.siteId,
            planId: plan.id,
            taktAreaId: areaId,
            workPackageId: wp.id,
            name: m.name,
            crewTrade: wp.trade,
            crewSize: wp.defaultCrewSize,
            equipmentTypeId: wp.equipmentTypeId,
            equipmentCount: wp.equipmentCount,
            externalRef: m.uids.join(",").slice(0, 200),
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          });
          activitiesCreated++;
        } else if (activity.archivedAt) {
          activity = await repo.updateActivity(activity.id, { archivedAt: null, updatedById: ctx.user.id });
        }
        activityByKey.set(activityKey(m.areaName, m.workPackageName), activity.id);
        await repo.upsertAssignment(plan.id, version.id, activity.id, cyclePosition(cal, version.startDate, m, plan.cycleLengthDays));
      }

      // Dependencies (only those that do not create a cycle).
      const existing = await repo.listDependencies(plan.id);
      const edges = existing.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId }));
      const reach = (from: string, to: string) => {
        const stack = [from];
        const seen = new Set<string>();
        while (stack.length) {
          const cur = stack.pop()!;
          if (cur === to) return true;
          if (seen.has(cur)) continue;
          seen.add(cur);
          for (const e of edges) if (e.predecessorId === cur) stack.push(e.successorId);
        }
        return false;
      };
      let depsCreated = 0;
      let depsSkipped = 0;
      for (const l of preview.links) {
        const predecessorId = activityByKey.get(l.predecessorKey);
        const successorId = activityByKey.get(l.successorKey);
        if (!predecessorId || !successorId) continue;
        if (edges.some((e) => e.predecessorId === predecessorId && e.successorId === successorId)) continue;
        if (reach(successorId, predecessorId)) {
          depsSkipped++;
          continue;
        }
        await repo.createDependency({ planId: plan.id, predecessorId, successorId, type: l.type, lagDays: Math.max(-365, Math.min(365, l.lagDays)), createdById: ctx.user.id });
        edges.push({ predecessorId, successorId });
        depsCreated++;
      }

      await repo.updateImport(row.id, { status: "APPLIED", resultVersionId: version.id, updatedById: ctx.user.id });
      const result = { versionId: version.id, versionNumber: version.versionNumber, startDate: toIsoDate(version.startDate), areasCreated, workPackagesCreated: wpsCreated, activitiesCreated, assignments: preview.activities.length, dependenciesCreated: depsCreated, dependenciesSkipped: depsSkipped };
      await writeAudit(tx, ctx, { action: "schedule_import.apply", entityType: "schedule_import", entityId: row.id, projectId: plan.projectId, after: { fileName: row.fileName, sha256: row.sha256, ...result } });
      return result;
    });
  },
};
