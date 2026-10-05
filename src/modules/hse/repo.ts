import type { Prisma, Tx } from "@/platform/db";

type Create<T> = Omit<T, "companyId">;

const roleSelect = { templateKey: true, projectAccess: true, permissions: { select: { permissionKey: true } } } as const;

/** Company-scoped V7 HSE repository: every query carries company_id. */
export class HseRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
  }

  findProject(id: string) {
    return this.tx.project.findFirst({ where: { id, ...this.c }, select: { id: true, code: true, name: true, archivedAt: true } });
  }

  listProjects(projectIds: string[] | undefined) {
    return this.tx.project.findMany({ where: { ...this.c, archivedAt: null, ...(projectIds ? { id: { in: projectIds } } : {}) }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
  }

  listSites(projectId: string) {
    return this.tx.site.findMany({ where: { ...this.c, projectId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  }

  findSite(id: string) {
    return this.tx.site.findFirst({ where: { id, ...this.c }, select: { id: true, projectId: true, archivedAt: true } });
  }

  findLiftPlan(id: string) {
    return this.tx.liftPlan.findFirst({ where: { id, ...this.c }, select: { id: true, projectId: true, title: true } });
  }

  listLiftPlans(projectId: string) {
    return this.tx.liftPlan.findMany({ where: { ...this.c, projectId }, orderBy: { plannedStart: "desc" }, take: 50, select: { id: true, title: true, plannedStart: true } });
  }

  findEmployee(id: string) {
    return this.tx.employee.findFirst({ where: { id, ...this.c }, select: { id: true } });
  }

  findUsers(ids: string[]) {
    return this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  }

  /** Serializes per-project numbering. */
  async lockProject(projectId: string) {
    await this.tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid AND company_id = ${this.companyId}::uuid FOR UPDATE`;
  }

  /** Approved hours (V2) of the company's own people in the project. */
  async approvedHours(projectId: string) {
    const agg = await this.tx.timeEntry.aggregate({ where: { ...this.c, projectId, status: { in: ["APPROVED", "EXPORTED"] }, archivedAt: null }, _sum: { hours: true } });
    return Number(agg._sum.hours ?? 0);
  }

  // ── observations ──────────────────────────────────────────────────
  async nextObservationNumber(projectId: string) {
    const agg = await this.tx.hseObservation.aggregate({ where: { ...this.c, projectId }, _max: { number: true } });
    return (agg._max.number ?? 0) + 1;
  }

  createObservation(data: Create<Prisma.HseObservationUncheckedCreateInput>) {
    return this.tx.hseObservation.create({ data: { ...data, ...this.c } });
  }

  findObservation(id: string) {
    return this.tx.hseObservation.findFirst({ where: { id, ...this.c }, include: { site: { select: { id: true, name: true } }, liftPlan: { select: { id: true, title: true } } } });
  }

  updateObservation(id: string, data: Prisma.HseObservationUncheckedUpdateInput) {
    return this.tx.hseObservation.update({ where: { id, companyId: this.companyId }, data });
  }

  listObservations(projectId: string, createdById?: string) {
    return this.tx.hseObservation.findMany({ where: { ...this.c, projectId, ...(createdById ? { createdById } : {}) }, orderBy: { occurredAt: "desc" }, take: 200 });
  }

  // ── incidents ─────────────────────────────────────────────────────
  async nextIncidentNumber(projectId: string) {
    const agg = await this.tx.incident.aggregate({ where: { ...this.c, projectId }, _max: { number: true } });
    return (agg._max.number ?? 0) + 1;
  }

  createIncident(data: Create<Prisma.IncidentUncheckedCreateInput>) {
    return this.tx.incident.create({ data: { ...data, ...this.c } });
  }

  findIncident(id: string) {
    return this.tx.incident.findFirst({ where: { id, ...this.c }, include: { site: { select: { id: true, name: true } }, liftPlan: { select: { id: true, title: true } } } });
  }

  updateIncident(id: string, data: Prisma.IncidentUncheckedUpdateInput) {
    return this.tx.incident.update({ where: { id, companyId: this.companyId }, data });
  }

  listIncidents(projectId: string, createdById?: string) {
    return this.tx.incident.findMany({ where: { ...this.c, projectId, ...(createdById ? { createdById } : {}) }, orderBy: { occurredAt: "desc" }, take: 200 });
  }

  listUrgentIncidents(projectIds: string[] | undefined) {
    return this.tx.incident.findMany({
      where: { ...this.c, status: { not: "CLOSED" }, severity: { in: ["LOST_TIME", "SERIOUS"] }, project: { archivedAt: null }, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
      orderBy: { occurredAt: "desc" },
      include: { project: { select: { id: true, code: true, name: true } } },
    });
  }

  listPersons(incidentId: string) {
    return this.tx.incidentPerson.findMany({ where: { ...this.c, incidentId }, orderBy: { createdAt: "asc" } });
  }

  createPerson(data: Create<Prisma.IncidentPersonUncheckedCreateInput>) {
    return this.tx.incidentPerson.create({ data: { ...data, ...this.c } });
  }

  // ── actions ───────────────────────────────────────────────────────
  createAction(data: Create<Prisma.HseActionUncheckedCreateInput>) {
    return this.tx.hseAction.create({ data: { ...data, ...this.c } });
  }

  findAction(id: string) {
    return this.tx.hseAction.findFirst({ where: { id, ...this.c } });
  }

  updateAction(id: string, data: Prisma.HseActionUncheckedUpdateInput) {
    return this.tx.hseAction.update({ where: { id, companyId: this.companyId }, data });
  }

  listActions(where: { projectId: string; sourceType?: Prisma.HseActionWhereInput["sourceType"]; sourceId?: string }) {
    return this.tx.hseAction.findMany({ where: { ...this.c, ...where }, orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }], include: { assignee: { select: { user: { select: { id: true, name: true, email: true } } } } } });
  }

  /** Active members of the company (assignee picker). */
  listMembers() {
    return this.tx.companyMembership.findMany({ where: { ...this.c, status: "ACTIVE" }, select: { userId: true, user: { select: { name: true, email: true } } }, orderBy: { user: { name: "asc" } } });
  }

  findMember(userId: string) {
    return this.tx.companyMembership.findFirst({ where: { ...this.c, userId, status: "ACTIVE" }, select: { userId: true } });
  }

  /** Members with their roles and their role in one project (notification recipients). */
  listMembersWithRoles(projectId: string) {
    return this.tx.companyMembership.findMany({
      where: { ...this.c, status: "ACTIVE", user: { status: "ACTIVE", archivedAt: null } },
      select: {
        userId: true,
        user: { select: { email: true, name: true, locale: true } },
        roles: { where: { role: { archivedAt: null } }, select: { role: { select: roleSelect } } },
        projectMemberships: { where: { projectId, archivedAt: null, role: { archivedAt: null } }, select: { projectId: true, role: { select: roleSelect } } },
      },
    });
  }

  // ── toolbox talks ─────────────────────────────────────────────────
  createToolboxTalk(data: Create<Prisma.ToolboxTalkUncheckedCreateInput>) {
    return this.tx.toolboxTalk.create({ data: { ...data, ...this.c } });
  }

  listToolboxTalks(projectId: string) {
    return this.tx.toolboxTalk.findMany({ where: { ...this.c, projectId }, orderBy: { heldOn: "desc" }, take: 200, include: { site: { select: { name: true } } } });
  }

  // ── risk assessments ──────────────────────────────────────────────
  createRiskAssessment(data: Create<Prisma.RiskAssessmentUncheckedCreateInput>) {
    return this.tx.riskAssessment.create({ data: { ...data, ...this.c } });
  }

  findRiskAssessment(id: string) {
    return this.tx.riskAssessment.findFirst({
      where: { id, ...this.c },
      include: { items: { orderBy: { position: "asc" } }, site: { select: { id: true, name: true } }, liftPlan: { select: { id: true, title: true } } },
    });
  }

  updateRiskAssessment(id: string, data: Prisma.RiskAssessmentUncheckedUpdateInput) {
    return this.tx.riskAssessment.update({ where: { id, companyId: this.companyId }, data });
  }

  listRiskAssessments(projectId: string) {
    return this.tx.riskAssessment.findMany({ where: { ...this.c, projectId }, orderBy: { createdAt: "desc" }, include: { _count: { select: { items: true } } } });
  }

  async nextItemPosition(riskAssessmentId: string) {
    const agg = await this.tx.riskAssessmentItem.aggregate({ where: { ...this.c, riskAssessmentId }, _max: { position: true } });
    return (agg._max.position ?? 0) + 1;
  }

  createRiskItem(data: Create<Prisma.RiskAssessmentItemUncheckedCreateInput>) {
    return this.tx.riskAssessmentItem.create({ data: { ...data, ...this.c } });
  }

  findRiskItem(id: string) {
    return this.tx.riskAssessmentItem.findFirst({ where: { id, ...this.c } });
  }

  deleteRiskItem(id: string) {
    return this.tx.riskAssessmentItem.delete({ where: { id, companyId: this.companyId } });
  }

  // ── permits ───────────────────────────────────────────────────────
  async nextPermitNumber(projectId: string) {
    const agg = await this.tx.workPermit.aggregate({ where: { ...this.c, projectId }, _max: { number: true } });
    return (agg._max.number ?? 0) + 1;
  }

  createPermit(data: Create<Prisma.WorkPermitUncheckedCreateInput>) {
    return this.tx.workPermit.create({ data: { ...data, ...this.c } });
  }

  findPermit(id: string) {
    return this.tx.workPermit.findFirst({ where: { id, ...this.c }, include: { site: { select: { id: true, name: true } }, liftPlan: { select: { id: true, title: true } } } });
  }

  updatePermit(id: string, data: Prisma.WorkPermitUncheckedUpdateInput) {
    return this.tx.workPermit.update({ where: { id, companyId: this.companyId }, data });
  }

  listPermits(projectId: string, createdById?: string) {
    return this.tx.workPermit.findMany({ where: { ...this.c, projectId, ...(createdById ? { createdById } : {}) }, orderBy: { validFrom: "desc" }, take: 200 });
  }

  // ── inspections ───────────────────────────────────────────────────
  createInspection(data: Create<Prisma.HseInspectionUncheckedCreateInput>) {
    return this.tx.hseInspection.create({ data: { ...data, ...this.c } });
  }

  findInspection(id: string) {
    return this.tx.hseInspection.findFirst({ where: { id, ...this.c } });
  }

  listInspections(projectId: string) {
    return this.tx.hseInspection.findMany({ where: { ...this.c, projectId }, orderBy: { inspectedOn: "desc" }, take: 200 });
  }

  // ── photos ────────────────────────────────────────────────────────
  createPhoto(data: Create<Prisma.HsePhotoUncheckedCreateInput>) {
    return this.tx.hsePhoto.create({ data: { ...data, ...this.c } });
  }

  findPhoto(id: string) {
    return this.tx.hsePhoto.findFirst({ where: { id, ...this.c } });
  }

  listPhotos(recordType: Prisma.HsePhotoWhereInput["recordType"], recordId: string) {
    return this.tx.hsePhoto.findMany({ where: { ...this.c, recordType, recordId }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true, createdById: true } });
  }
}
