import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ConflictError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import {
  canAccessProject,
  projectIdsWithPermission,
  projectPermissions,
  requirePermission,
  requireProjectPermission,
  type RequestContext,
} from "@/platform/authz";
import { ProjectRepo } from "./repo";
import { assignMemberSchema, projectListSchema, projectSchema, siteSchema, type AssignMemberInput, type ProjectInput, type SiteInput } from "./schemas";

function conflictOnCode<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (isUniqueViolation(e)) throw new ConflictError("Code already in use", "code");
    throw e;
  });
}

export const projectService = {
  /** Projects visible to the member: all (ALL access) or assigned ones. */
  async list(ctx: RequestContext, input: { q?: string | null; includeArchived?: boolean } = {}) {
    const filter = parseInput(projectListSchema, input);
    const ids = projectIdsWithPermission(ctx, "project.view");
    const rows = await new ProjectRepo(readClient(), ctx.company.id).list({ ...filter, ids });
    return rows.map((p) => ({ ...p, siteCount: p._count.sites, canManage: projectPermissions(ctx, p.id).has("project.manage") }));
  },

  async get(ctx: RequestContext, projectId: string) {
    const repo = new ProjectRepo(readClient(), ctx.company.id);
    const project = await repo.find(projectId);
    if (!project) throw new NotFoundError();
    requireProjectPermission(ctx, project.id, "project.view");
    const perms = projectPermissions(ctx, project.id);
    return {
      ...project,
      permissions: {
        manage: perms.has("project.manage"),
        manageMembers: perms.has("project.members.manage"),
      },
    };
  },

  async create(ctx: RequestContext, input: ProjectInput) {
    requirePermission(ctx, "project.manage");
    const data = parseInput(projectSchema, input);
    return conflictOnCode(
      runInTransaction(async (tx) => {
        const repo = new ProjectRepo(tx, ctx.company.id);
        const project = await repo.create({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "project.create", entityType: "project", entityId: project.id, projectId: project.id, after: project });

        // Members with ASSIGNED access must be assigned to see what they created.
        if (ctx.projectAccess === "ASSIGNED") {
          const role = await repo.findMemberRoleWithPermission(ctx.membershipId, "project.manage");
          if (role) {
            const pm = await repo.upsertMember(project.id, ctx.user.id, role.id, ctx.user.id);
            await writeAudit(tx, ctx, {
              action: "project_member.assign",
              entityType: "project_membership",
              entityId: pm.id,
              projectId: project.id,
              after: { userId: ctx.user.id, role: role.key },
            });
          }
        }
        return project;
      }),
    );
  },

  async update(ctx: RequestContext, projectId: string, input: ProjectInput) {
    const data = parseInput(projectSchema, input);
    return conflictOnCode(
      runInTransaction(async (tx) => {
        const repo = new ProjectRepo(tx, ctx.company.id);
        const before = await repo.find(projectId);
        if (!before) throw new NotFoundError();
        requireProjectPermission(ctx, before.id, "project.manage");
        if (before.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
        const after = await repo.update(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "project.update", entityType: "project", entityId: after.id, projectId: after.id, before, after, diff: true });
        return after;
      }),
    );
  },

  async archive(ctx: RequestContext, projectId: string) {
    return runInTransaction(async (tx) => {
      const repo = new ProjectRepo(tx, ctx.company.id);
      const before = await repo.find(projectId);
      if (!before) throw new NotFoundError();
      requireProjectPermission(ctx, before.id, "project.manage");
      if (before.archivedAt) return before;
      const after = await repo.update(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "project.archive", entityType: "project", entityId: after.id, projectId: after.id, before, after, diff: true });
      return after;
    });
  },

  async listMembers(ctx: RequestContext, projectId: string) {
    const repo = new ProjectRepo(readClient(), ctx.company.id);
    const project = await repo.find(projectId);
    if (!project) throw new NotFoundError();
    requireProjectPermission(ctx, project.id, "project.view");
    return repo.listMembers(project.id);
  },

  async assignMember(ctx: RequestContext, projectId: string, input: AssignMemberInput) {
    const data = parseInput(assignMemberSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new ProjectRepo(tx, ctx.company.id);
      const project = await repo.find(projectId);
      if (!project) throw new NotFoundError();
      requireProjectPermission(ctx, project.id, "project.members.manage");
      const [member, role] = await Promise.all([repo.findActiveCompanyMember(data.userId), repo.findRole(data.roleId)]);
      if (!member) throw new ValidationError({ userId: ["validation.invalidOption"] });
      if (!role) throw new ValidationError({ roleId: ["validation.invalidOption"] });
      const existing = await repo.findMemberByUser(project.id, data.userId);
      const pm = await repo.upsertMember(project.id, data.userId, role.id, ctx.user.id);
      await writeAudit(tx, ctx, {
        action: "project_member.assign",
        entityType: "project_membership",
        entityId: pm.id,
        projectId: project.id,
        before: existing && !existing.archivedAt ? { userId: existing.userId, roleId: existing.roleId } : null,
        after: { userId: data.userId, roleId: role.id, role: role.key },
      });
      return pm;
    });
  },

  /** People and roles offered when assigning someone to the project. */
  async listAssignable(ctx: RequestContext, projectId: string) {
    const repo = new ProjectRepo(readClient(), ctx.company.id);
    const project = await repo.find(projectId);
    if (!project) throw new NotFoundError();
    requireProjectPermission(ctx, project.id, "project.members.manage");
    const [members, roles] = await Promise.all([repo.listAssignableUsers(), repo.listRoles()]);
    return { users: members.map((m) => m.user), roles };
  },

  async removeMember(ctx: RequestContext, projectMembershipId: string) {
    return runInTransaction(async (tx) => {
      const repo = new ProjectRepo(tx, ctx.company.id);
      const pm = await repo.findMember(projectMembershipId);
      if (!pm) throw new NotFoundError();
      requireProjectPermission(ctx, pm.projectId, "project.members.manage");
      await repo.archiveMember(pm.id, ctx.user.id);
      await writeAudit(tx, ctx, {
        action: "project_member.remove",
        entityType: "project_membership",
        entityId: pm.id,
        projectId: pm.projectId,
        before: { userId: pm.userId, roleId: pm.roleId },
      });
    });
  },
};

export const siteService = {
  async list(ctx: RequestContext, projectId: string, input: { includeArchived?: boolean } = {}) {
    const repo = new ProjectRepo(readClient(), ctx.company.id);
    const project = await repo.find(projectId);
    if (!project) throw new NotFoundError();
    requireProjectPermission(ctx, project.id, "project.view");
    return repo.listSites(project.id, input.includeArchived ?? false);
  },

  async get(ctx: RequestContext, siteId: string) {
    const repo = new ProjectRepo(readClient(), ctx.company.id);
    const site = await repo.findSite(siteId);
    if (!site || !canAccessProject(ctx, site.projectId)) throw new NotFoundError();
    requireProjectPermission(ctx, site.projectId, "project.view");
    return site;
  },

  async create(ctx: RequestContext, projectId: string, input: SiteInput) {
    const data = parseInput(siteSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new ProjectRepo(tx, ctx.company.id);
      const project = await repo.find(projectId);
      if (!project) throw new NotFoundError();
      requireProjectPermission(ctx, project.id, "project.manage");
      if (project.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      const site = await repo.createSite(project.id, { ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "site.create", entityType: "site", entityId: site.id, projectId: project.id, after: site });
      return site;
    });
  },

  async update(ctx: RequestContext, siteId: string, input: SiteInput) {
    const data = parseInput(siteSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new ProjectRepo(tx, ctx.company.id);
      const before = await repo.findSite(siteId);
      if (!before) throw new NotFoundError();
      requireProjectPermission(ctx, before.projectId, "project.manage");
      if (before.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      const after = await repo.updateSite(before.id, { ...data, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "site.update", entityType: "site", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },

  async archive(ctx: RequestContext, siteId: string) {
    return runInTransaction(async (tx) => {
      const repo = new ProjectRepo(tx, ctx.company.id);
      const before = await repo.findSite(siteId);
      if (!before) throw new NotFoundError();
      requireProjectPermission(ctx, before.projectId, "project.manage");
      if (before.archivedAt) return before;
      const after = await repo.updateSite(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "site.archive", entityType: "site", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },
};
