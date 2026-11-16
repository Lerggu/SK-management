import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { isSmtpConfigured } from "@/platform/config/env";
import { requirePermission, type RequestContext } from "@/platform/authz";
import { HrRepo } from "./repo";
import { runExpiryReminders } from "./reminders";
import { loadViewer } from "./load";
import { SUGGESTED_COMPETENCE_AREAS, SUGGESTED_QUALIFICATION_TYPES } from "./rules";
import {
  competenceAreaSchema,
  hrSettingsSchema,
  jobProfileSchema,
  jobRequirementSchema,
  qualificationTypeSchema,
  type CompetenceAreaInput,
  type JobProfileInput,
  type JobRequirementInput,
  type QualificationTypeInput,
} from "./schemas";

/** HR administration needs hr.manage; external members never manage HR. */
function requireAdmin(ctx: RequestContext) {
  if (ctx.external) throw new ForbiddenError("External members cannot manage HR");
  requirePermission(ctx, "hr.manage");
}

/** Reading the catalogues needs some HR access (permission, supervisor or own card). */
async function requireCatalogueReader(ctx: RequestContext) {
  if (ctx.external) throw new ForbiddenError("External members have no HR access");
  if (ctx.permissions.has("hr.view") || ctx.permissions.has("hr.manage") || ctx.permissions.has("employee.view")) return;
  const viewer = await loadViewer(ctx);
  if (viewer.ownEmployeeIds.length === 0) throw new ForbiddenError("No HR access");
}

function conflictOn<T>(field: string, p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (isUniqueViolation(e)) throw new ConflictError("Already exists", field);
    throw e;
  });
}

export const hrSettingsService = {
  async get(ctx: RequestContext) {
    requireAdmin(ctx);
    const s = await new HrRepo(readClient(), ctx.company.id).settings();
    return { reminderEmail: s?.reminderEmail ?? null, mailConfigured: isSmtpConfigured() };
  },

  async update(ctx: RequestContext, input: { reminderEmail?: string | null }) {
    requireAdmin(ctx);
    const data = parseInput(hrSettingsSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HrRepo(tx, ctx.company.id);
      const before = await repo.settings();
      const after = await repo.upsertSettings(data.reminderEmail, ctx.user.id);
      await writeAudit(tx, ctx, { action: "hr_settings.update", entityType: "hr_settings", entityId: ctx.company.id, before: before ?? {}, after, diff: true });
      return { reminderEmail: after.reminderEmail };
    });
  },

  /** Runs this company's expiry reminders now (the schedule also runs them hourly). */
  async runReminders(ctx: RequestContext) {
    requireAdmin(ctx);
    const result = await runExpiryReminders({ companyId: ctx.company.id });
    await runInTransaction((tx) => writeAudit(tx, ctx, { action: "expiry_reminder.run", entityType: "expiry_reminder", metadata: { ...result } }));
    return result;
  },
};

export const competenceAreaService = {
  async list(ctx: RequestContext, input: { includeArchived?: boolean } = {}) {
    await requireCatalogueReader(ctx);
    return new HrRepo(readClient(), ctx.company.id).listAreas(Boolean(input.includeArchived) && ctx.permissions.has("hr.manage"));
  },

  async create(ctx: RequestContext, input: CompetenceAreaInput) {
    requireAdmin(ctx);
    const data = parseInput(competenceAreaSchema, input);
    return conflictOn(
      "name",
      runInTransaction(async (tx) => {
        const area = await new HrRepo(tx, ctx.company.id).createArea({ ...data, sortOrder: data.sortOrder ?? 0, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "competence_area.create", entityType: "competence_area", entityId: area.id, after: area });
        return area;
      }),
    );
  },

  async update(ctx: RequestContext, areaId: string, input: CompetenceAreaInput) {
    requireAdmin(ctx);
    const data = parseInput(competenceAreaSchema, input);
    return conflictOn(
      "name",
      runInTransaction(async (tx) => {
        const repo = new HrRepo(tx, ctx.company.id);
        const before = await repo.findArea(areaId);
        if (!before) throw new NotFoundError();
        const after = await repo.updateArea(before.id, { ...data, sortOrder: data.sortOrder ?? before.sortOrder, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "competence_area.update", entityType: "competence_area", entityId: after.id, before, after, diff: true });
        return after;
      }),
    );
  },

  /** Disables an area; its assessments stay in history. */
  async archive(ctx: RequestContext, areaId: string) {
    return setAreaArchived(ctx, areaId, true);
  },

  async restore(ctx: RequestContext, areaId: string) {
    return setAreaArchived(ctx, areaId, false);
  },

  /** Adds the suggested areas that do not exist yet (by category + name). */
  async addSuggested(ctx: RequestContext) {
    requireAdmin(ctx);
    return runInTransaction(async (tx) => {
      const repo = new HrRepo(tx, ctx.company.id);
      const existing = new Set((await repo.listAreas(true)).map((a) => `${a.category}\u0000${a.name}`));
      let added = 0;
      for (const [i, s] of SUGGESTED_COMPETENCE_AREAS.entries()) {
        if (existing.has(`${s.category}\u0000${s.name}`)) continue;
        await repo.createArea({ ...s, sortOrder: (i + 1) * 10, createdById: ctx.user.id, updatedById: ctx.user.id });
        added += 1;
      }
      await writeAudit(tx, ctx, { action: "competence_area.add_suggested", entityType: "competence_area", metadata: { added } });
      return { added };
    });
  },
};

async function setAreaArchived(ctx: RequestContext, areaId: string, archived: boolean) {
  requireAdmin(ctx);
  return runInTransaction(async (tx) => {
    const repo = new HrRepo(tx, ctx.company.id);
    const before = await repo.findArea(areaId);
    if (!before) throw new NotFoundError();
    if (Boolean(before.archivedAt) === archived) return before;
    const after = await repo.updateArea(before.id, { archivedAt: archived ? new Date() : null, updatedById: ctx.user.id });
    await writeAudit(tx, ctx, { action: archived ? "competence_area.archive" : "competence_area.restore", entityType: "competence_area", entityId: after.id, before, after, diff: true });
    return after;
  });
}

export const qualificationTypeService = {
  async list(ctx: RequestContext, input: { includeArchived?: boolean } = {}) {
    await requireCatalogueReader(ctx);
    return new HrRepo(readClient(), ctx.company.id).listTypes(Boolean(input.includeArchived) && ctx.permissions.has("hr.manage"));
  },

  async create(ctx: RequestContext, input: QualificationTypeInput) {
    requireAdmin(ctx);
    const data = parseInput(qualificationTypeSchema, input);
    return conflictOn(
      "name",
      runInTransaction(async (tx) => {
        const type = await new HrRepo(tx, ctx.company.id).createType({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "qualification_type.create", entityType: "qualification_type", entityId: type.id, after: type });
        return type;
      }),
    );
  },

  async update(ctx: RequestContext, typeId: string, input: QualificationTypeInput) {
    requireAdmin(ctx);
    const data = parseInput(qualificationTypeSchema, input);
    return conflictOn(
      "name",
      runInTransaction(async (tx) => {
        const repo = new HrRepo(tx, ctx.company.id);
        const before = await repo.findType(typeId);
        if (!before) throw new NotFoundError();
        const after = await repo.updateType(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "qualification_type.update", entityType: "qualification_type", entityId: after.id, before, after, diff: true });
        return after;
      }),
    );
  },

  async archive(ctx: RequestContext, typeId: string) {
    return setTypeArchived(ctx, typeId, true);
  },

  async restore(ctx: RequestContext, typeId: string) {
    return setTypeArchived(ctx, typeId, false);
  },

  async addSuggested(ctx: RequestContext) {
    requireAdmin(ctx);
    return runInTransaction(async (tx) => {
      const repo = new HrRepo(tx, ctx.company.id);
      const existing = new Set((await repo.listTypes(true)).map((t) => t.name));
      let added = 0;
      for (const [i, s] of SUGGESTED_QUALIFICATION_TYPES.entries()) {
        if (existing.has(s.name)) continue;
        await repo.createType({ ...s, sortOrder: (i + 1) * 10, createdById: ctx.user.id, updatedById: ctx.user.id });
        added += 1;
      }
      await writeAudit(tx, ctx, { action: "qualification_type.add_suggested", entityType: "qualification_type", metadata: { added } });
      return { added };
    });
  },
};

async function setTypeArchived(ctx: RequestContext, typeId: string, archived: boolean) {
  requireAdmin(ctx);
  return runInTransaction(async (tx) => {
    const repo = new HrRepo(tx, ctx.company.id);
    const before = await repo.findType(typeId);
    if (!before) throw new NotFoundError();
    if (Boolean(before.archivedAt) === archived) return before;
    const after = await repo.updateType(before.id, { archivedAt: archived ? new Date() : null, updatedById: ctx.user.id });
    await writeAudit(tx, ctx, { action: archived ? "qualification_type.archive" : "qualification_type.restore", entityType: "qualification_type", entityId: after.id, before, after, diff: true });
    return after;
  });
}

export const jobProfileService = {
  async list(ctx: RequestContext) {
    await requireCatalogueReader(ctx);
    return new HrRepo(readClient(), ctx.company.id).listProfiles();
  },

  async create(ctx: RequestContext, input: JobProfileInput) {
    requireAdmin(ctx);
    const data = parseInput(jobProfileSchema, input);
    return conflictOn(
      "name",
      runInTransaction(async (tx) => {
        const profile = await new HrRepo(tx, ctx.company.id).createProfile({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "job_profile.create", entityType: "job_profile", entityId: profile.id, after: profile });
        return profile;
      }),
    );
  },

  async update(ctx: RequestContext, profileId: string, input: JobProfileInput) {
    requireAdmin(ctx);
    const data = parseInput(jobProfileSchema, input);
    return conflictOn(
      "name",
      runInTransaction(async (tx) => {
        const repo = new HrRepo(tx, ctx.company.id);
        const before = await repo.findProfile(profileId);
        if (!before) throw new NotFoundError();
        const after = await repo.updateProfile(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "job_profile.update", entityType: "job_profile", entityId: after.id, before: { name: before.name, description: before.description }, after, diff: true });
        return after;
      }),
    );
  },

  async archive(ctx: RequestContext, profileId: string) {
    requireAdmin(ctx);
    return runInTransaction(async (tx) => {
      const repo = new HrRepo(tx, ctx.company.id);
      const before = await repo.findProfile(profileId);
      if (!before) throw new NotFoundError();
      if (before.archivedAt) return before;
      const after = await repo.updateProfile(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "job_profile.archive", entityType: "job_profile", entityId: after.id });
      return after;
    });
  },

  async addRequirement(ctx: RequestContext, profileId: string, input: JobRequirementInput) {
    requireAdmin(ctx);
    const data = parseInput(jobRequirementSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HrRepo(tx, ctx.company.id);
      const profile = await repo.findProfile(profileId);
      if (!profile || profile.archivedAt) throw new NotFoundError();
      if (data.kind === "COMPETENCE") {
        const area = await repo.findArea(data.areaId!);
        if (!area || area.archivedAt) throw new ValidationError({ areaId: ["validation.invalidOption"] });
      }
      if (data.kind === "QUALIFICATION") {
        const type = await repo.findType(data.qualificationTypeId!);
        if (!type || type.archivedAt) throw new ValidationError({ qualificationTypeId: ["validation.invalidOption"] });
      }
      const requirement = await repo.createRequirement({
        profileId: profile.id,
        kind: data.kind,
        areaId: data.kind === "COMPETENCE" ? data.areaId : null,
        minLevel: data.kind === "COMPETENCE" ? data.minLevel : null,
        qualificationTypeId: data.kind === "QUALIFICATION" ? data.qualificationTypeId : null,
        orientationScope: data.kind === "ORIENTATION" ? data.orientationScope : null,
        orientationTopic: data.kind === "ORIENTATION" ? data.orientationTopic : null,
        createdById: ctx.user.id,
      });
      await writeAudit(tx, ctx, { action: "job_requirement.create", entityType: "job_requirement", entityId: requirement.id, after: requirement, metadata: { profileId: profile.id } });
      return requirement;
    });
  },

  async removeRequirement(ctx: RequestContext, requirementId: string) {
    requireAdmin(ctx);
    return runInTransaction(async (tx) => {
      const repo = new HrRepo(tx, ctx.company.id);
      const before = await repo.findRequirement(requirementId);
      if (!before) throw new NotFoundError();
      if (before.archivedAt) return before;
      const after = await repo.updateRequirement(before.id, { archivedAt: new Date() });
      await writeAudit(tx, ctx, { action: "job_requirement.archive", entityType: "job_requirement", entityId: after.id, before, after, diff: true });
      return after;
    });
  },
};
