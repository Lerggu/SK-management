import type { Prisma, Tx } from "@/platform/db";

type Data<T> = Omit<T, "companyId">;

/** Company-scoped HR repository: every query carries the company id. */
export class HrRepo {
  constructor(
    private readonly tx: Tx,
    readonly companyId: string,
  ) {}

  private get c() {
    return { companyId: this.companyId };
  }

  // ── employees and relations ─────────────────────────────────────────
  findEmployee(id: string) {
    return this.tx.employee.findFirst({ where: { id, ...this.c } });
  }

  employeesOfUser(userId: string) {
    return this.tx.employee.findMany({ where: { ...this.c, userId, archivedAt: null }, select: { id: true } });
  }

  /** All employees with the fields needed for supervisor chains (small companies). */
  supervisorEdges() {
    return this.tx.employee.findMany({ where: this.c, select: { id: true, supervisorId: true } });
  }

  updateEmployee(id: string, data: Prisma.EmployeeUncheckedUpdateInput) {
    return this.tx.employee.update({ where: { id, ...this.c }, data });
  }

  listEmployees(where: Prisma.EmployeeWhereInput = {}) {
    return this.tx.employee.findMany({ where: { ...this.c, ...where }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  }

  /** Active and invited members of the company with their user. */
  companyMembers() {
    return this.tx.companyMembership.findMany({
      where: { ...this.c, status: { in: ["ACTIVE", "INVITED"] } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  employeeLinkedTo(userId: string, exceptEmployeeId: string) {
    return this.tx.employee.findFirst({ where: { ...this.c, userId, archivedAt: null, id: { not: exceptEmployeeId } } });
  }

  findUser(id: string) {
    return this.tx.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, locale: true } });
  }

  usersByIds(ids: string[]) {
    return ids.length ? this.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]);
  }

  // ── settings ────────────────────────────────────────────────────────
  settings() {
    return this.tx.hrSettings.findUnique({ where: { companyId: this.companyId } });
  }

  upsertSettings(reminderEmail: string | null, userId: string) {
    return this.tx.hrSettings.upsert({
      where: { companyId: this.companyId },
      create: { companyId: this.companyId, reminderEmail, createdById: userId, updatedById: userId },
      update: { reminderEmail, updatedById: userId },
    });
  }

  // ── competence areas ────────────────────────────────────────────────
  listAreas(includeArchived = false) {
    return this.tx.competenceArea.findMany({
      where: { ...this.c, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ sortOrder: "asc" }, { category: "asc" }, { name: "asc" }],
    });
  }

  findArea(id: string) {
    return this.tx.competenceArea.findFirst({ where: { id, ...this.c } });
  }

  createArea(data: Data<Prisma.CompetenceAreaUncheckedCreateInput>) {
    return this.tx.competenceArea.create({ data: { ...data, ...this.c } });
  }

  updateArea(id: string, data: Prisma.CompetenceAreaUncheckedUpdateInput) {
    return this.tx.competenceArea.update({ where: { id, ...this.c }, data });
  }

  // ── qualification types ─────────────────────────────────────────────
  listTypes(includeArchived = false) {
    return this.tx.qualificationType.findMany({ where: { ...this.c, ...(includeArchived ? {} : { archivedAt: null }) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  }

  findType(id: string) {
    return this.tx.qualificationType.findFirst({ where: { id, ...this.c } });
  }

  createType(data: Data<Prisma.QualificationTypeUncheckedCreateInput>) {
    return this.tx.qualificationType.create({ data: { ...data, ...this.c } });
  }

  updateType(id: string, data: Prisma.QualificationTypeUncheckedUpdateInput) {
    return this.tx.qualificationType.update({ where: { id, ...this.c }, data });
  }

  // ── job profiles ────────────────────────────────────────────────────
  listProfiles(includeArchived = false) {
    return this.tx.jobProfile.findMany({
      where: { ...this.c, ...(includeArchived ? {} : { archivedAt: null }) },
      include: { requirements: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } } },
      orderBy: { name: "asc" },
    });
  }

  findProfile(id: string) {
    return this.tx.jobProfile.findFirst({ where: { id, ...this.c }, include: { requirements: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } } } });
  }

  createProfile(data: Data<Prisma.JobProfileUncheckedCreateInput>) {
    return this.tx.jobProfile.create({ data: { ...data, ...this.c } });
  }

  updateProfile(id: string, data: Prisma.JobProfileUncheckedUpdateInput) {
    return this.tx.jobProfile.update({ where: { id, ...this.c }, data });
  }

  findRequirement(id: string) {
    return this.tx.jobRequirement.findFirst({ where: { id, ...this.c } });
  }

  createRequirement(data: Data<Prisma.JobRequirementUncheckedCreateInput>) {
    return this.tx.jobRequirement.create({ data: { ...data, ...this.c } });
  }

  updateRequirement(id: string, data: Prisma.JobRequirementUncheckedUpdateInput) {
    return this.tx.jobRequirement.update({ where: { id, ...this.c }, data });
  }

  // ── assessments ─────────────────────────────────────────────────────
  listAssessments(employeeIds: string[]) {
    return this.tx.competenceAssessment.findMany({
      where: { ...this.c, employeeId: { in: employeeIds }, archivedAt: null },
      orderBy: [{ assessedOn: "desc" }, { createdAt: "desc" }],
    });
  }

  findAssessment(id: string) {
    return this.tx.competenceAssessment.findFirst({ where: { id, ...this.c } });
  }

  createAssessment(data: Data<Prisma.CompetenceAssessmentUncheckedCreateInput>) {
    return this.tx.competenceAssessment.create({ data: { ...data, ...this.c } });
  }

  updateAssessment(id: string, data: Prisma.CompetenceAssessmentUncheckedUpdateInput) {
    return this.tx.competenceAssessment.update({ where: { id, ...this.c }, data });
  }

  // ── trainings ───────────────────────────────────────────────────────
  listTrainings(employeeIds: string[]) {
    return this.tx.training.findMany({ where: { ...this.c, employeeId: { in: employeeIds }, archivedAt: null }, orderBy: [{ completedOn: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }] });
  }

  findTraining(id: string) {
    return this.tx.training.findFirst({ where: { id, ...this.c } });
  }

  createTraining(data: Data<Prisma.TrainingUncheckedCreateInput>) {
    return this.tx.training.create({ data: { ...data, ...this.c } });
  }

  updateTraining(id: string, data: Prisma.TrainingUncheckedUpdateInput) {
    return this.tx.training.update({ where: { id, ...this.c }, data });
  }

  // ── qualifications ──────────────────────────────────────────────────
  listQualifications(where: Prisma.EmployeeQualificationWhereInput) {
    return this.tx.employeeQualification.findMany({
      where: { ...this.c, archivedAt: null, ...where },
      include: { type: { select: { id: true, name: true } } },
      orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }, { name: "asc" }],
    });
  }

  findQualification(id: string) {
    return this.tx.employeeQualification.findFirst({ where: { id, ...this.c } });
  }

  createQualification(data: Data<Prisma.EmployeeQualificationUncheckedCreateInput>) {
    return this.tx.employeeQualification.create({ data: { ...data, ...this.c } });
  }

  updateQualification(id: string, data: Prisma.EmployeeQualificationUncheckedUpdateInput) {
    return this.tx.employeeQualification.update({ where: { id, ...this.c }, data });
  }

  // ── authorizations, orientations, languages ─────────────────────────
  listAuthorizations(employeeIds: string[]) {
    return this.tx.equipmentAuthorization.findMany({ where: { ...this.c, employeeId: { in: employeeIds }, archivedAt: null }, orderBy: { grantedOn: "desc" } });
  }

  findAuthorization(id: string) {
    return this.tx.equipmentAuthorization.findFirst({ where: { id, ...this.c } });
  }

  createAuthorization(data: Data<Prisma.EquipmentAuthorizationUncheckedCreateInput>) {
    return this.tx.equipmentAuthorization.create({ data: { ...data, ...this.c } });
  }

  updateAuthorization(id: string, data: Prisma.EquipmentAuthorizationUncheckedUpdateInput) {
    return this.tx.equipmentAuthorization.update({ where: { id, ...this.c }, data });
  }

  findEquipmentType(id: string) {
    return this.tx.equipmentType.findFirst({ where: { id, ...this.c } });
  }

  listEquipmentTypes() {
    return this.tx.equipmentType.findMany({ where: { ...this.c, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  }

  listOrientations(employeeIds: string[]) {
    return this.tx.orientation.findMany({ where: { ...this.c, employeeId: { in: employeeIds }, archivedAt: null }, orderBy: [{ completedOn: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }] });
  }

  findOrientation(id: string) {
    return this.tx.orientation.findFirst({ where: { id, ...this.c } });
  }

  createOrientation(data: Data<Prisma.OrientationUncheckedCreateInput>) {
    return this.tx.orientation.create({ data: { ...data, ...this.c } });
  }

  updateOrientation(id: string, data: Prisma.OrientationUncheckedUpdateInput) {
    return this.tx.orientation.update({ where: { id, ...this.c }, data });
  }

  listLanguages(employeeIds: string[]) {
    return this.tx.employeeLanguage.findMany({ where: { ...this.c, employeeId: { in: employeeIds } }, orderBy: [{ language: "asc" }, { source: "asc" }] });
  }

  findLanguage(id: string) {
    return this.tx.employeeLanguage.findFirst({ where: { id, ...this.c } });
  }

  findLanguageEntry(employeeId: string, language: string, source: "SELF" | "SUPERVISOR") {
    return this.tx.employeeLanguage.findFirst({ where: { ...this.c, employeeId, language, source } });
  }

  createLanguage(data: Data<Prisma.EmployeeLanguageUncheckedCreateInput>) {
    return this.tx.employeeLanguage.create({ data: { ...data, ...this.c } });
  }

  updateLanguage(id: string, data: Prisma.EmployeeLanguageUncheckedUpdateInput) {
    return this.tx.employeeLanguage.update({ where: { id, ...this.c }, data });
  }

  deleteLanguage(id: string) {
    return this.tx.employeeLanguage.delete({ where: { id, ...this.c } });
  }

  // ── clothing and items ──────────────────────────────────────────────
  listClothing(employeeId: string) {
    return this.tx.clothingIssue.findMany({ where: { ...this.c, employeeId }, orderBy: [{ issuedOn: "desc" }, { createdAt: "desc" }] });
  }

  findClothing(id: string) {
    return this.tx.clothingIssue.findFirst({ where: { id, ...this.c } });
  }

  createClothing(data: Data<Prisma.ClothingIssueUncheckedCreateInput>) {
    return this.tx.clothingIssue.create({ data: { ...data, ...this.c } });
  }

  cancelClothing(id: string, userId: string) {
    return this.tx.clothingIssue.update({ where: { id, ...this.c }, data: { archivedAt: new Date(), archivedById: userId } });
  }

  listItems(where: Prisma.CompanyItemWhereInput) {
    return this.tx.companyItem.findMany({ where: { ...this.c, ...where }, orderBy: [{ issuedOn: "desc" }, { createdAt: "desc" }] });
  }

  findItem(id: string) {
    return this.tx.companyItem.findFirst({ where: { id, ...this.c } });
  }

  createItem(data: Data<Prisma.CompanyItemUncheckedCreateInput>) {
    return this.tx.companyItem.create({ data: { ...data, ...this.c } });
  }

  updateItem(id: string, data: Prisma.CompanyItemUncheckedUpdateInput) {
    return this.tx.companyItem.update({ where: { id, ...this.c }, data });
  }

  // ── files ───────────────────────────────────────────────────────────
  listFiles(employeeId: string) {
    return this.tx.employeeFile.findMany({ where: { ...this.c, employeeId, archivedAt: null }, orderBy: { createdAt: "desc" } });
  }

  findFile(id: string) {
    return this.tx.employeeFile.findFirst({ where: { id, ...this.c } });
  }

  createFile(data: Data<Prisma.EmployeeFileUncheckedCreateInput>) {
    return this.tx.employeeFile.create({ data: { ...data, ...this.c } });
  }

  updateFile(id: string, data: Prisma.EmployeeFileUncheckedUpdateInput) {
    return this.tx.employeeFile.update({ where: { id, ...this.c }, data });
  }

  // ── reminders ───────────────────────────────────────────────────────
  remindersFor(sourceType: "QUALIFICATION" | "TRAINING", sourceIds: string[]) {
    return sourceIds.length ? this.tx.expiryReminder.findMany({ where: { ...this.c, sourceType, sourceId: { in: sourceIds } }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]);
  }
}
