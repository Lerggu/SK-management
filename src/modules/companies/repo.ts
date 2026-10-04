import type { Tx } from "@/platform/db";
import type { PermissionKey } from "@/platform/authz";

/**
 * Company-scoped repository: every query is filtered by the company id given
 * at construction time (taken from the RequestContext, never from input).
 */
export class CompanyScopedRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  getCompany() {
    return this.tx.company.findFirst({ where: { id: this.companyId, archivedAt: null } });
  }

  updateCompany(data: { name: string; businessId: string | null; defaultLocale: string }, userId: string) {
    return this.tx.company.update({ where: { id: this.companyId }, data: { ...data, updatedById: userId } });
  }

  listMembers() {
    return this.tx.companyMembership.findMany({
      where: { companyId: this.companyId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        invitedAt: true,
        acceptedAt: true,
        user: { select: { id: true, email: true, name: true, lastSignInAt: true } },
        roles: { select: { role: { select: { id: true, key: true, name: true } } } },
      },
    });
  }

  findMembership(membershipId: string) {
    return this.tx.companyMembership.findFirst({
      where: { id: membershipId, companyId: this.companyId },
      include: { roles: { include: { role: true } }, user: { select: { id: true, email: true } } },
    });
  }

  findMembershipByUser(userId: string) {
    return this.tx.companyMembership.findFirst({ where: { companyId: this.companyId, userId } });
  }

  listRoles() {
    return this.tx.role.findMany({
      where: { companyId: this.companyId, archivedAt: null },
      orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
      include: { permissions: { select: { permissionKey: true } } },
    });
  }

  findRolesByIds(roleIds: string[]) {
    return this.tx.role.findMany({ where: { companyId: this.companyId, id: { in: roleIds }, archivedAt: null } });
  }

  findRole(roleId: string) {
    return this.tx.role.findFirst({
      where: { id: roleId, companyId: this.companyId, archivedAt: null },
      include: { permissions: { select: { permissionKey: true } } },
    });
  }

  async replaceMembershipRoles(membershipId: string, roleIds: string[], userId: string) {
    await this.tx.membershipRole.deleteMany({ where: { companyId: this.companyId, membershipId } });
    await this.tx.membershipRole.createMany({
      data: roleIds.map((roleId) => ({ companyId: this.companyId, membershipId, roleId, createdById: userId })),
    });
  }

  async replaceRolePermissions(roleId: string, keys: PermissionKey[], userId: string) {
    await this.tx.rolePermission.deleteMany({ where: { companyId: this.companyId, roleId } });
    await this.tx.rolePermission.createMany({
      data: keys.map((permissionKey) => ({ companyId: this.companyId, roleId, permissionKey, createdById: userId })),
    });
  }

  setMembershipStatus(membershipId: string, status: "ACTIVE" | "DISABLED", userId: string) {
    return this.tx.companyMembership.update({ where: { id: membershipId }, data: { status, updatedById: userId } });
  }

  /** Active members holding `permission` through any company role. */
  countActiveMembersWithPermission(permission: PermissionKey) {
    return this.tx.companyMembership.count({
      where: {
        companyId: this.companyId,
        status: "ACTIVE",
        roles: { some: { role: { archivedAt: null, permissions: { some: { permissionKey: permission } } } } },
      },
    });
  }

  listAuditEvents(filter: { entityType: string | null; limit: number }) {
    return this.tx.auditEvent.findMany({
      where: { companyId: this.companyId, ...(filter.entityType ? { entityType: filter.entityType } : {}) },
      orderBy: { occurredAt: "desc" },
      take: filter.limit,
    });
  }

  findUsersByIds(ids: string[]) {
    return this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  }
}
