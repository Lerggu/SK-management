import type { Prisma, Tx } from "@/platform/db";

/** Company-scoped documents repository. */
export class DocumentRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  list(filter: {
    companyLevel: boolean;
    projectIds: string[] | undefined;
    projectId: string | null;
    category?: string;
    q: string | null;
    includeArchived: boolean;
  }) {
    const scope: Prisma.DocumentWhereInput[] = [];
    if (filter.companyLevel) scope.push({ projectId: null });
    scope.push(filter.projectIds ? { projectId: { in: filter.projectIds } } : { projectId: { not: null } });
    // Visibility scope and text search are combined with AND so that a search
    // can never widen what the member is allowed to see.
    const and: Prisma.DocumentWhereInput[] = [{ OR: scope }];
    if (filter.q) {
      and.push({
        OR: [
          { title: { contains: filter.q, mode: "insensitive" } },
          { documentNumber: { contains: filter.q, mode: "insensitive" } },
        ],
      });
    }
    return this.tx.document.findMany({
      where: {
        companyId: this.companyId,
        AND: and,
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        ...(filter.category ? { category: filter.category as Prisma.DocumentWhereInput["category"] } : {}),
        ...(filter.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "desc" }],
      include: {
        project: { select: { id: true, code: true, name: true } },
        site: { select: { id: true, name: true } },
        versions: { where: { status: "CURRENT" }, select: { id: true, versionNumber: true, revisionLabel: true, approvalState: true, fileName: true } },
      },
    });
  }

  find(id: string) {
    return this.tx.document.findFirst({ where: { id, companyId: this.companyId } });
  }

  findDetailed(id: string) {
    return this.tx.document.findFirst({
      where: { id, companyId: this.companyId },
      include: {
        project: { select: { id: true, code: true, name: true } },
        site: { select: { id: true, name: true } },
        versions: { orderBy: { versionNumber: "desc" } },
        links: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
      },
    });
  }

  /** Serializes concurrent version uploads for one document. */
  async lock(id: string) {
    await this.tx.$queryRaw`SELECT id FROM documents WHERE id = ${id}::uuid AND company_id = ${this.companyId}::uuid FOR UPDATE`;
  }

  create(data: Omit<Prisma.DocumentUncheckedCreateInput, "companyId">) {
    return this.tx.document.create({ data: { ...data, companyId: this.companyId } });
  }

  update(id: string, data: Prisma.DocumentUncheckedUpdateInput) {
    return this.tx.document.update({ where: { id, companyId: this.companyId }, data });
  }

  listVersions(documentId: string) {
    return this.tx.documentVersion.findMany({ where: { companyId: this.companyId, documentId }, orderBy: { versionNumber: "desc" } });
  }

  findVersion(id: string) {
    return this.tx.documentVersion.findFirst({ where: { id, companyId: this.companyId } });
  }

  supersedeCurrent(documentId: string, userId: string) {
    return this.tx.documentVersion.updateMany({
      where: { companyId: this.companyId, documentId, status: "CURRENT" },
      data: { status: "SUPERSEDED", updatedById: userId },
    });
  }

  createVersion(data: Omit<Prisma.DocumentVersionUncheckedCreateInput, "companyId">) {
    return this.tx.documentVersion.create({ data: { ...data, companyId: this.companyId } });
  }

  updateVersion(id: string, data: Prisma.DocumentVersionUncheckedUpdateInput) {
    return this.tx.documentVersion.update({ where: { id, companyId: this.companyId }, data });
  }

  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, companyId: this.companyId } });
  }

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, companyId: this.companyId } });
  }

  findEmployee(id: string) {
    return this.tx.employee.findFirst({ where: { id, companyId: this.companyId } });
  }

  findEquipment(id: string) {
    return this.tx.equipment.findFirst({ where: { id, companyId: this.companyId } });
  }

  upsertLink(documentId: string, entityType: Prisma.DocumentLinkUncheckedCreateInput["entityType"], entityId: string, userId: string) {
    return this.tx.documentLink.upsert({
      where: { documentId_entityType_entityId: { documentId, entityType, entityId } },
      create: { companyId: this.companyId, documentId, entityType, entityId, createdById: userId, updatedById: userId },
      update: { archivedAt: null, updatedById: userId },
    });
  }

  findLink(id: string) {
    return this.tx.documentLink.findFirst({ where: { id, companyId: this.companyId, archivedAt: null } });
  }

  archiveLink(id: string, userId: string) {
    return this.tx.documentLink.update({ where: { id, companyId: this.companyId }, data: { archivedAt: new Date(), updatedById: userId } });
  }

  /** Documents linked to an entity (for employee/equipment detail pages). */
  listLinkedTo(entityType: Prisma.DocumentLinkUncheckedCreateInput["entityType"], entityId: string) {
    return this.tx.documentLink.findMany({
      where: { companyId: this.companyId, entityType, entityId, archivedAt: null, document: { archivedAt: null } },
      select: { id: true, document: { select: { id: true, title: true, category: true, projectId: true } } },
    });
  }
}
