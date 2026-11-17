import type { Prisma, Tx } from "@/platform/db";

/** Company-scoped data access for teams (ADR 0029). */
export class TeamRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
  }

  list(includeArchived = false) {
    return this.tx.team.findMany({
      where: { ...this.c, ...(includeArchived ? {} : { archivedAt: null }) },
      include: {
        leader: { select: { id: true, firstName: true, lastName: true } },
        members: { where: { archivedAt: null }, select: { id: true, firstName: true, lastName: true, trade: true, status: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] },
      },
      orderBy: { name: "asc" },
    });
  }

  find(id: string) {
    return this.tx.team.findFirst({ where: { id, ...this.c } });
  }

  create(data: Omit<Prisma.TeamUncheckedCreateInput, "companyId">) {
    return this.tx.team.create({ data: { ...data, ...this.c } });
  }

  update(id: string, data: Prisma.TeamUncheckedUpdateInput) {
    return this.tx.team.update({ where: { id, ...this.c }, data });
  }

  findEmployees(ids: string[]) {
    return this.tx.employee.findMany({ where: { id: { in: ids }, ...this.c, archivedAt: null }, select: { id: true, teamId: true, team: true } });
  }

  /** Moves employees into a team (or out with null), keeping the cached name in sync. */
  setTeam(employeeIds: string[], team: { id: string; name: string } | null, userId: string) {
    return this.tx.employee.updateMany({ where: { id: { in: employeeIds }, ...this.c }, data: { teamId: team?.id ?? null, team: team?.name ?? null, updatedById: userId } });
  }

  renameMembers(teamId: string, name: string) {
    return this.tx.employee.updateMany({ where: { ...this.c, teamId }, data: { team: name } });
  }

  clearMembers(teamId: string, userId: string) {
    return this.tx.employee.updateMany({ where: { ...this.c, teamId }, data: { teamId: null, team: null, updatedById: userId } });
  }
}
