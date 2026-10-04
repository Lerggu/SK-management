import type { Prisma, Tx } from "@/platform/db";

/** Company-scoped equipment repository. */
export class EquipmentRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  listTypes(includeArchived = false) {
    return this.tx.equipmentType.findMany({
      where: { companyId: this.companyId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: { name: "asc" },
      include: { _count: { select: { equipment: { where: { archivedAt: null } } } } },
    });
  }

  findType(id: string) {
    return this.tx.equipmentType.findFirst({ where: { id, companyId: this.companyId } });
  }

  createType(data: Omit<Prisma.EquipmentTypeUncheckedCreateInput, "companyId">) {
    return this.tx.equipmentType.create({ data: { ...data, companyId: this.companyId } });
  }

  updateType(id: string, data: Prisma.EquipmentTypeUncheckedUpdateInput) {
    return this.tx.equipmentType.update({ where: { id, companyId: this.companyId }, data });
  }

  list(filter: { q: string | null; includeArchived: boolean; projectId: string | null }) {
    return this.tx.equipment.findMany({
      where: {
        companyId: this.companyId,
        ...(filter.includeArchived ? {} : { archivedAt: null }),
        ...(filter.projectId ? { currentProjectId: filter.projectId } : {}),
        ...(filter.q
          ? {
              OR: [
                { name: { contains: filter.q, mode: "insensitive" } },
                { assetNumber: { contains: filter.q, mode: "insensitive" } },
                { manufacturer: { contains: filter.q, mode: "insensitive" } },
                { model: { contains: filter.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { assetNumber: "asc" }],
      include: {
        equipmentType: { select: { id: true, name: true, category: true } },
        currentProject: { select: { id: true, code: true, name: true } },
        currentSite: { select: { id: true, name: true } },
      },
    });
  }

  find(id: string) {
    return this.tx.equipment.findFirst({
      where: { id, companyId: this.companyId },
      include: {
        equipmentType: { select: { id: true, name: true, category: true } },
        currentProject: { select: { id: true, code: true, name: true } },
        currentSite: { select: { id: true, name: true } },
      },
    });
  }

  findRaw(id: string) {
    return this.tx.equipment.findFirst({ where: { id, companyId: this.companyId } });
  }

  create(data: Omit<Prisma.EquipmentUncheckedCreateInput, "companyId">) {
    return this.tx.equipment.create({ data: { ...data, companyId: this.companyId } });
  }

  update(id: string, data: Prisma.EquipmentUncheckedUpdateInput) {
    return this.tx.equipment.update({ where: { id, companyId: this.companyId }, data });
  }

  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, companyId: this.companyId, archivedAt: null } });
  }

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, companyId: this.companyId, archivedAt: null } });
  }

  listRates(equipmentIds: string[]) {
    return this.tx.equipmentRate.findMany({
      where: { companyId: this.companyId, equipmentId: { in: equipmentIds } },
      orderBy: [{ rateType: "asc" }, { validFrom: "desc" }],
    });
  }

  findRate(id: string) {
    return this.tx.equipmentRate.findFirst({ where: { id, companyId: this.companyId } });
  }

  createRate(data: Omit<Prisma.EquipmentRateUncheckedCreateInput, "companyId">) {
    return this.tx.equipmentRate.create({ data: { ...data, companyId: this.companyId } });
  }

  updateRate(id: string, data: Prisma.EquipmentRateUncheckedUpdateInput) {
    return this.tx.equipmentRate.update({ where: { id, companyId: this.companyId }, data });
  }
}
