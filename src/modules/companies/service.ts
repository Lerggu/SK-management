import { readClient, runInTransaction, isUniqueViolation, type Tx } from "@/platform/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import {
  EXTERNAL_ONLY_PERMISSIONS,
  EXTERNAL_TEMPLATE_KEYS,
  ROLE_TEMPLATES,
  SENSITIVE_PERMISSIONS,
  hasPermission,
  isPermissionKey,
  requirePermission,
  type Locale,
  type PermissionKey,
  type RequestContext,
  type UserContext,
} from "@/platform/authz";
import { CompanyScopedRepo } from "./repo";
import {
  auditFilterSchema,
  createCompanySchema,
  inviteMemberSchema,
  memberStatusSchema,
  updateCompanySchema,
  updateMemberRolesSchema,
  updateRolePermissionsSchema,
  type CreateCompanyInput,
  type InviteMemberInput,
  type UpdateCompanyInput,
} from "./schemas";

/**
 * Creates the company's roles from the system templates. Role names are
 * stored in the company's default locale; keys stay stable.
 */
async function instantiateRoleTemplates(tx: Tx, companyId: string, userId: string | null, locale: Locale) {
  const roles: { id: string; key: string }[] = [];
  for (const t of ROLE_TEMPLATES) {
    const role = await tx.role.create({
      data: {
        companyId,
        key: t.key,
        templateKey: t.key,
        name: t.name[locale],
        projectAccess: t.projectAccess,
        isSystem: true,
        createdById: userId,
        updatedById: userId,
      },
    });
    await tx.rolePermission.createMany({
      data: t.permissions.map((permissionKey) => ({ companyId, roleId: role.id, permissionKey, createdById: userId })),
    });
    roles.push({ id: role.id, key: t.key });
  }
  return roles;
}

export { instantiateRoleTemplates };

/** Operations available before a company is selected. */
export const companyDirectoryService = {
  /** Companies the user can enter (ACTIVE membership, non-archived company). */
  async listMyCompanies(uctx: UserContext) {
    const memberships = await readClient().companyMembership.findMany({
      where: { userId: uctx.user.id, status: "ACTIVE", company: { archivedAt: null } },
      select: { company: { select: { id: true, slug: true, name: true, organizationId: true } } },
      orderBy: { company: { name: "asc" } },
    });
    return memberships.map((m) => m.company);
  },

  /** Organizations in which the user may create companies (OWNER/ADMIN). */
  async listCreatableOrganizations(uctx: UserContext) {
    const rows = await readClient().organizationMembership.findMany({
      where: { userId: uctx.user.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] }, organization: { archivedAt: null } },
      select: { organization: { select: { id: true, name: true, slug: true } } },
    });
    return rows.map((r) => r.organization);
  },

  /**
   * Creates a company in an organization where the user is OWNER/ADMIN,
   * instantiates the 10 role templates and makes the creator CEO.
   * Unknown organization or no membership → 404; plain MEMBER → 403.
   */
  async createCompany(uctx: UserContext, input: CreateCompanyInput) {
    const data = parseInput(createCompanySchema, input);
    try {
      return await runInTransaction(async (tx) => {
        const orgMembership = await tx.organizationMembership.findFirst({
          where: { organizationId: data.organizationId, userId: uctx.user.id, status: "ACTIVE", organization: { archivedAt: null } },
        });
        if (!orgMembership) throw new NotFoundError();
        if (orgMembership.role !== "OWNER" && orgMembership.role !== "ADMIN") throw new ForbiddenError();

        const company = await tx.company.create({
          data: {
            organizationId: data.organizationId,
            name: data.name,
            slug: data.slug,
            businessId: data.businessId,
            defaultLocale: uctx.locale,
            createdById: uctx.user.id,
            updatedById: uctx.user.id,
          },
        });
        const roles = await instantiateRoleTemplates(tx, company.id, uctx.user.id, uctx.locale);
        const ceo = roles.find((r) => r.key === "CEO")!;
        const membership = await tx.companyMembership.create({
          data: {
            companyId: company.id,
            userId: uctx.user.id,
            status: "ACTIVE",
            acceptedAt: new Date(),
            createdById: uctx.user.id,
            updatedById: uctx.user.id,
            roles: { create: { roleId: ceo.id, createdById: uctx.user.id } },
          },
        });

        const scope = { companyId: company.id, organizationId: company.organizationId };
        await writeAudit(tx, uctx, { ...scope, action: "company.create", entityType: "company", entityId: company.id, after: company });
        await writeAudit(tx, uctx, {
          ...scope,
          action: "role.create_from_templates",
          entityType: "role",
          after: { roles: roles.map((r) => r.key) },
        });
        await writeAudit(tx, uctx, {
          ...scope,
          action: "membership.create",
          entityType: "company_membership",
          entityId: membership.id,
          after: { userId: uctx.user.id, status: "ACTIVE", roles: ["CEO"] },
        });
        return company;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError("Slug already in use", "slug");
      throw e;
    }
  },
};

/** Company administration (settings, members, roles, audit log). */
export const companyAdminService = {
  async getSettings(ctx: RequestContext) {
    const company = await new CompanyScopedRepo(readClient(), ctx.company.id).getCompany();
    if (!company) throw new NotFoundError();
    return company;
  },

  async updateSettings(ctx: RequestContext, input: UpdateCompanyInput) {
    requirePermission(ctx, "company.manage");
    const data = parseInput(updateCompanySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CompanyScopedRepo(tx, ctx.company.id);
      const before = await repo.getCompany();
      if (!before) throw new NotFoundError();
      const after = await repo.updateCompany(data, ctx.user.id);
      await writeAudit(tx, ctx, { action: "company.update", entityType: "company", entityId: after.id, before, after, diff: true });
      return after;
    });
  },

  async listMembers(ctx: RequestContext) {
    requirePermission(ctx, "company.members.manage");
    return new CompanyScopedRepo(readClient(), ctx.company.id).listMembers();
  },

  /**
   * Invitation-based access: creates (or reuses) the user by e-mail and an
   * INVITED membership. The membership becomes ACTIVE on first sign-in.
   */
  async inviteMember(ctx: RequestContext, input: InviteMemberInput) {
    requirePermission(ctx, "company.members.manage");
    const data = parseInput(inviteMemberSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CompanyScopedRepo(tx, ctx.company.id);
      const roles = await repo.findRolesByIds(data.roleIds);
      if (roles.length !== new Set(data.roleIds).size) throw new ValidationError({ roleIds: ["validation.invalidOption"] });

      const user =
        (await tx.user.findUnique({ where: { email: data.email } })) ??
        (await tx.user.create({ data: { email: data.email, name: data.name, createdById: ctx.user.id, updatedById: ctx.user.id } }));

      if (await repo.findMembershipByUser(user.id)) throw new ConflictError("Already a member", "email");

      await tx.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId: ctx.company.organizationId, userId: user.id } },
        create: { organizationId: ctx.company.organizationId, userId: user.id, role: "MEMBER", createdById: ctx.user.id },
        update: {},
      });
      const membership = await tx.companyMembership.create({
        data: {
          companyId: ctx.company.id,
          userId: user.id,
          status: "INVITED",
          invitedAt: new Date(),
          invitedById: ctx.user.id,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
      });
      await repo.replaceMembershipRoles(membership.id, data.roleIds, ctx.user.id);
      await writeAudit(tx, ctx, {
        action: "membership.invite",
        entityType: "company_membership",
        entityId: membership.id,
        after: { email: user.email, status: "INVITED", roles: roles.map((r) => r.key) },
      });
      return membership;
    });
  },

  async updateMemberRoles(ctx: RequestContext, membershipId: string, input: { roleIds: string[] }) {
    requirePermission(ctx, "company.members.manage");
    const data = parseInput(updateMemberRolesSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CompanyScopedRepo(tx, ctx.company.id);
      const membership = await repo.findMembership(membershipId);
      if (!membership) throw new NotFoundError();
      const roles = await repo.findRolesByIds(data.roleIds);
      if (roles.length !== new Set(data.roleIds).size) throw new ValidationError({ roleIds: ["validation.invalidOption"] });

      const beforeKeys = membership.roles.map((r) => r.role.key).sort();
      await repo.replaceMembershipRoles(membership.id, data.roleIds, ctx.user.id);
      await assertAdminsRemain(repo);
      await writeAudit(tx, ctx, {
        action: "membership.roles_update",
        entityType: "company_membership",
        entityId: membership.id,
        before: { roles: beforeKeys },
        after: { roles: roles.map((r) => r.key).sort() },
      });
    });
  },

  async setMemberStatus(ctx: RequestContext, membershipId: string, input: { status: "ACTIVE" | "DISABLED" }) {
    requirePermission(ctx, "company.members.manage");
    const data = parseInput(memberStatusSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CompanyScopedRepo(tx, ctx.company.id);
      const membership = await repo.findMembership(membershipId);
      if (!membership) throw new NotFoundError();
      if (membership.userId === ctx.user.id && data.status === "DISABLED") throw new ValidationError({ _form: ["validation.cannotDisableSelf"] });
      if (membership.status === "INVITED" && data.status === "ACTIVE") throw new ValidationError({ _form: ["validation.invitePending"] });
      await repo.setMembershipStatus(membership.id, data.status, ctx.user.id);
      await assertAdminsRemain(repo);
      await writeAudit(tx, ctx, {
        action: "membership.status_update",
        entityType: "company_membership",
        entityId: membership.id,
        before: { status: membership.status },
        after: { status: data.status },
      });
    });
  },

  async listRoles(ctx: RequestContext) {
    if (!hasPermission(ctx, "company.roles.manage") && !hasPermission(ctx, "company.members.manage")) throw new ForbiddenError();
    const roles = await new CompanyScopedRepo(readClient(), ctx.company.id).listRoles();
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      templateKey: r.templateKey,
      name: r.name,
      projectAccess: r.projectAccess,
      isSystem: r.isSystem,
      external: r.templateKey !== null && EXTERNAL_TEMPLATE_KEYS.has(r.templateKey),
      permissions: r.permissions.map((p) => p.permissionKey).filter(isPermissionKey),
    }));
  },

  /**
   * Replaces a role's permissions. External roles (Client, Subcontractor)
   * can never receive sensitive cost/rate permissions.
   */
  async updateRolePermissions(ctx: RequestContext, roleId: string, input: { permissionKeys: string[] }) {
    requirePermission(ctx, "company.roles.manage");
    const data = parseInput(updateRolePermissionsSchema, input);
    const unknown = data.permissionKeys.filter((k) => !isPermissionKey(k));
    if (unknown.length) throw new ValidationError({ permissionKeys: ["validation.invalidOption"] });
    const keys = [...new Set(data.permissionKeys)] as PermissionKey[];

    return runInTransaction(async (tx) => {
      const repo = new CompanyScopedRepo(tx, ctx.company.id);
      const role = await repo.findRole(roleId);
      if (!role) throw new NotFoundError();
      const externalRole = role.templateKey !== null && EXTERNAL_TEMPLATE_KEYS.has(role.templateKey);
      if (externalRole && keys.some((k) => SENSITIVE_PERMISSIONS.has(k))) {
        throw new ValidationError({ permissionKeys: ["validation.externalSensitive"] });
      }
      // V7: portal and client-approval permissions belong to external roles only.
      if (!externalRole && keys.some((k) => EXTERNAL_ONLY_PERMISSIONS.has(k))) {
        throw new ValidationError({ permissionKeys: ["validation.externalOnly"] });
      }
      const before = role.permissions.map((p) => p.permissionKey).sort();
      await repo.replaceRolePermissions(role.id, keys, ctx.user.id);
      await assertAdminsRemain(repo);
      await writeAudit(tx, ctx, {
        action: "role.permissions_update",
        entityType: "role",
        entityId: role.id,
        before: { key: role.key, permissions: before },
        after: { key: role.key, permissions: [...keys].sort() },
      });
    });
  },

  async listAuditEvents(ctx: RequestContext, input: { entityType?: string | null; limit?: number } = {}) {
    requirePermission(ctx, "audit.view");
    const filter = parseInput(auditFilterSchema, input);
    const repo = new CompanyScopedRepo(readClient(), ctx.company.id);
    const events = await repo.listAuditEvents(filter);
    const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((v): v is string => !!v))];
    const actors = new Map((await repo.findUsersByIds(actorIds)).map((u) => [u.id, u]));
    return events.map((e) => ({
      ...e,
      actor: e.actorUserId ? (actors.get(e.actorUserId) ?? null) : null,
    }));
  },

  /** Remembers the company as the user's last selection (for redirects). */
  async rememberCompany(ctx: RequestContext) {
    await readClient().user.update({ where: { id: ctx.user.id }, data: { lastCompanyId: ctx.company.id } });
  },
};

/** Prevents locking a company out of its own administration. */
async function assertAdminsRemain(repo: CompanyScopedRepo) {
  const [members, roles] = await Promise.all([
    repo.countActiveMembersWithPermission("company.members.manage"),
    repo.countActiveMembersWithPermission("company.roles.manage"),
  ]);
  if (members === 0 || roles === 0) throw new ValidationError({ _form: ["validation.lastAdmin"] });
}
