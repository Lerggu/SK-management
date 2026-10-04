import type { Prisma, Tx } from "@/platform/db";

/** Company-scoped project/site repository. */
export class ProjectRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  list(filter: { ids?: string[]; q: string | null; includeArchived: boolean }) {
    return this.tx.project.findMany({
      where: {
        companyId: this.companyId,
        ...(filter.ids ? { id: { in: filter.ids } } : {}),
        ...(filter.includeArchived ? {} : { archivedAt: null }),
        ...(filter.q
          ? {
              OR: [
                { name: { contains: filter.q, mode: "insensitive" } },
                { code: { contains: filter.q, mode: "insensitive" } },
                { customerName: { contains: filter.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { code: "asc" }],
      include: { _count: { select: { sites: { where: { archivedAt: null } } } } },
    });
  }

  find(id: string) {
    return this.tx.project.findFirst({ where: { id, companyId: this.companyId } });
  }

  create(data: Omit<Prisma.ProjectUncheckedCreateInput, "companyId">) {
    return this.tx.project.create({ data: { ...data, companyId: this.companyId } });
  }

  update(id: string, data: Prisma.ProjectUncheckedUpdateInput) {
    return this.tx.project.update({ where: { id, companyId: this.companyId }, data });
  }

  listSites(projectId: string, includeArchived = false) {
    return this.tx.site.findMany({
      where: { companyId: this.companyId, projectId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    });
  }

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, companyId: this.companyId } });
  }

  createSite(projectId: string, data: Omit<Prisma.SiteUncheckedCreateInput, "companyId" | "projectId">) {
    return this.tx.site.create({ data: { ...data, companyId: this.companyId, projectId } });
  }

  updateSite(id: string, data: Prisma.SiteUncheckedUpdateInput) {
    return this.tx.site.update({ where: { id, companyId: this.companyId }, data });
  }

  listMembers(projectId: string) {
    return this.tx.projectMembership.findMany({
      where: { companyId: this.companyId, projectId, archivedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        role: { select: { id: true, key: true, name: true } },
        membership: { select: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
  }

  findMember(id: string) {
    return this.tx.projectMembership.findFirst({ where: { id, companyId: this.companyId, archivedAt: null } });
  }

  findMemberByUser(projectId: string, userId: string) {
    return this.tx.projectMembership.findFirst({ where: { companyId: this.companyId, projectId, userId } });
  }

  findActiveCompanyMember(userId: string) {
    return this.tx.companyMembership.findFirst({ where: { companyId: this.companyId, userId, status: { in: ["ACTIVE", "INVITED"] } } });
  }

  listAssignableUsers() {
    return this.tx.companyMembership.findMany({
      where: { companyId: this.companyId, status: { in: ["ACTIVE", "INVITED"] } },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { email: "asc" } },
    });
  }

  listRoles() {
    return this.tx.role.findMany({ where: { companyId: this.companyId, archivedAt: null }, select: { id: true, key: true, name: true }, orderBy: { createdAt: "asc" } });
  }

  findRole(roleId: string) {
    return this.tx.role.findFirst({ where: { id: roleId, companyId: this.companyId, archivedAt: null } });
  }

  /** The caller's own company role granting project.manage (for auto-assignment). */
  findMemberRoleWithPermission(membershipId: string, permission: string) {
    return this.tx.role.findFirst({
      where: {
        companyId: this.companyId,
        archivedAt: null,
        membershipRoles: { some: { membershipId } },
        permissions: { some: { permissionKey: permission } },
      },
    });
  }

  upsertMember(projectId: string, userId: string, roleId: string, actorId: string) {
    return this.tx.projectMembership.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { companyId: this.companyId, projectId, userId, roleId, createdById: actorId, updatedById: actorId },
      update: { roleId, archivedAt: null, updatedById: actorId },
    });
  }

  archiveMember(id: string, actorId: string) {
    return this.tx.projectMembership.update({ where: { id, companyId: this.companyId }, data: { archivedAt: new Date(), updatedById: actorId } });
  }
}
