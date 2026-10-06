import { readClient, runInTransaction, type Tx } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { isSmtpConfigured } from "@/platform/config/env";
import { todayInDisplayZone } from "@/platform/i18n/config";
import type { RequestContext } from "@/platform/authz";
import type { HrAccess } from "./access";
import { HrRepo } from "./repo";
import { allowIf, loadEmployeeAccess, requireWork, supervisorChain, type EmployeeRow } from "./load";
import { isCurrentlyValid, isoDate, latestPublishedByArea, reminderDueDate, requirementGaps, validityState } from "./rules";
import {
  assessmentCommentSchema,
  assessmentSchema,
  authorizationSchema,
  clothingIssueSchema,
  companyItemSchema,
  drivingSchema,
  hrEmploymentSchema,
  hrPersonalSchema,
  languageSchema,
  orientationSchema,
  qualificationSchema,
  selfAssessmentSchema,
  trainingSchema,
  type AssessmentInput,
  type AuthorizationInput,
  type ClothingIssueInput,
  type CompanyItemInput,
  type DrivingInput,
  type HrEmploymentInput,
  type HrPersonalInput,
  type LanguageInput,
  type OrientationInput,
  type QualificationInput,
  type SelfAssessmentInput,
  type TrainingInput,
} from "./schemas";

type AssessmentRow = Awaited<ReturnType<HrRepo["listAssessments"]>>[number];

/** Runs a change for one employee with the caller's HR access checked first. */
async function forEmployee<T>(ctx: RequestContext, employeeId: string, check: (a: HrAccess, e: EmployeeRow) => boolean, fn: (tx: Tx, repo: HrRepo, employee: EmployeeRow, access: HrAccess) => Promise<T>): Promise<T> {
  const { employee, access } = await loadEmployeeAccess(ctx, employeeId);
  requireWork(access);
  allowIf(check(access, employee));
  if (employee.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
  return runInTransaction((tx) => fn(tx, new HrRepo(tx, ctx.company.id), employee, access));
}

/** Loads a child record, then checks access to its employee (404 when invisible). */
async function forRecord<R extends { employeeId: string }, T>(
  ctx: RequestContext,
  find: (repo: HrRepo) => Promise<R | null>,
  check: (a: HrAccess, record: R, e: EmployeeRow) => boolean,
  fn: (tx: Tx, repo: HrRepo, record: R, employee: EmployeeRow, access: HrAccess) => Promise<T>,
): Promise<T> {
  const record = await find(new HrRepo(readClient(), ctx.company.id));
  if (!record) throw new NotFoundError();
  const { employee, access } = await loadEmployeeAccess(ctx, record.employeeId);
  requireWork(access);
  allowIf(check(access, record, employee));
  if (employee.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
  return runInTransaction((tx) => fn(tx, new HrRepo(tx, ctx.company.id), record, employee, access));
}

const today = () => todayInDisplayZone();
const ymd = (d: Date | null) => (d ? isoDate(d) : null);

/** Own entries the employee added and nobody has verified yet stay editable by them. */
const ownUnverified = (ctx: RequestContext, a: HrAccess, r: { createdById: string | null; verifiedAt: Date | null }) => a.self && !r.verifiedAt && r.createdById === ctx.user.id;

function ownerEmail(employee: { email: string | null }, user: { email: string } | null) {
  return employee.email ?? user?.email ?? null;
}

// ── card ─────────────────────────────────────────────────────────────
export const hrCardService = {
  /** The employee record linked to the signed-in user, if any ("Oma henkilöstökortti"). */
  async myEmployeeId(ctx: RequestContext) {
    if (ctx.external) return null;
    const own = await new HrRepo(readClient(), ctx.company.id).employeesOfUser(ctx.user.id);
    return own[0]?.id ?? null;
  },

  /** The personnel card, reduced to what the caller may see. */
  async get(ctx: RequestContext, employeeId: string) {
    const repo = new HrRepo(readClient(), ctx.company.id);
    const { employee: e, access } = await loadEmployeeAccess(ctx, employeeId, repo);
    const t = today();
    const supervisorRow = e.supervisorId ? await repo.findEmployee(e.supervisorId) : null;
    const base = {
      id: e.id,
      employeeNumber: e.employeeNumber,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email,
      phone: e.phone,
      jobTitle: e.jobTitle,
      trade: e.trade,
      status: e.status,
      startDate: e.startDate,
      endDate: e.endDate,
      archivedAt: e.archivedAt,
      team: e.team,
      location: e.location,
      jobProfileId: e.jobProfileId,
      supervisor: supervisorRow ? { id: supervisorRow.id, name: `${supervisorRow.firstName} ${supervisorRow.lastName}` } : null,
      photoFileId: e.photoFileId,
      userId: e.userId,
    };
    const can = {
      editEmployment: access.editEmployment && !e.archivedAt,
      editPersonal: access.editPersonal && !e.archivedAt,
      supervise: access.supervise && !e.archivedAt,
      selfService: access.self && !e.archivedAt,
      admin: access.admin && !e.archivedAt,
      uploadPhoto: (access.admin || access.editEmployment || access.self) && !e.archivedAt,
    };
    if (!access.work) return { employee: base, access, can, work: null };

    const [areas, assessments, trainings, qualifications, orientations, authorizations, languages, profile, linkedUser, settings, equipmentTypes] = await Promise.all([
      repo.listAreas(true),
      repo.listAssessments([e.id]),
      repo.listTrainings([e.id]),
      repo.listQualifications({ employeeId: e.id }),
      repo.listOrientations([e.id]),
      repo.listAuthorizations([e.id]),
      repo.listLanguages([e.id]),
      e.jobProfileId ? repo.findProfile(e.jobProfileId) : Promise.resolve(null),
      e.userId ? repo.findUser(e.userId) : Promise.resolve(null),
      access.admin || access.supervise ? repo.settings() : Promise.resolve(null),
      repo.listEquipmentTypes(),
    ]);

    const visibleAssessments = assessments.filter((a) => assessmentVisible(ctx, access, a));
    const latestSupervisor = latestPublishedByArea(assessments, "SUPERVISOR");
    const latestSelf = latestPublishedByArea(visibleAssessments, "SELF");
    const users = await repo.usersByIds([...new Set([...visibleAssessments.map((a) => a.assessorUserId), ...authorizations.map((a) => a.grantedByUserId)])]);
    const userName = (id: string) => {
      const u = users.find((x) => x.id === id);
      return u ? (u.name ?? u.email) : null;
    };
    const ownerIds = [...new Set(visibleAssessments.map((a) => a.actionOwnerEmployeeId).filter((x): x is string => !!x))];
    const owners = ownerIds.length ? await repo.listEmployees({ id: { in: ownerIds } }) : [];
    const ownerName = (id: string | null) => {
      const o = owners.find((x) => x.id === id);
      return o ? `${o.firstName} ${o.lastName}` : null;
    };

    const competence = areas
      .filter((a) => !a.archivedAt || latestSupervisor.has(a.id) || latestSelf.has(a.id))
      .map((a) => {
        const sup = latestSupervisor.get(a.id);
        const self = latestSelf.get(a.id);
        return {
          area: a,
          supervisor: sup ? { level: sup.level, assessedOn: sup.assessedOn, nextAssessmentOn: sup.nextAssessmentOn, id: sup.id } : null,
          self: self ? { level: self.level, assessedOn: self.assessedOn, id: self.id } : null,
        };
      });

    const owner = ownerEmail(e, linkedUser);
    const maintenance = settings?.reminderEmail ?? null;
    const reminderRows = await Promise.all([repo.remindersFor("QUALIFICATION", qualifications.map((q) => q.id)), repo.remindersFor("TRAINING", trainings.map((x) => x.id))]);
    const reminderInfo = (sourceType: "QUALIFICATION" | "TRAINING", r: { id: string; expiresOn: Date | null; remindBeforeExpiry: boolean }) => {
      if (!r.remindBeforeExpiry || !r.expiresOn) return null;
      const rows = (sourceType === "QUALIFICATION" ? reminderRows[0] : reminderRows[1]).filter((x) => x.sourceId === r.id && isoDate(x.expiresOn) === isoDate(r.expiresOn!));
      return {
        dueOn: reminderDueDate(isoDate(r.expiresOn)),
        missingOwnerEmail: !owner,
        missingMaintenanceEmail: access.admin || access.supervise ? !maintenance : false,
        mailConfigured: isSmtpConfigured(),
        deliveries: rows.map((x) => ({ recipientKind: x.recipientKind, status: x.status, sentAt: x.sentAt })),
      };
    };

    const validTypes = new Set(qualifications.filter((q) => !q.replacedAt && q.typeId && isCurrentlyValid(ymd(q.expiresOn), q.noExpiry, t)).map((q) => q.typeId!));
    const gaps = profile
      ? requirementGaps(profile.requirements, {
          levels: new Map([...latestSupervisor].map(([k, v]) => [k, v.level])),
          validQualificationTypes: validTypes,
          orientations: orientations.filter((o) => o.status === "DONE").map((o) => ({ scope: o.scope, topic: o.topic })),
        })
      : [];

    const work = {
      jobProfile: profile ? { id: profile.id, name: profile.name, requirements: profile.requirements } : null,
      gaps,
      preferredLanguage: e.preferredLanguage,
      interpreterNeeded: e.interpreterNeeded,
      driverLicenceClasses: e.driverLicenceClasses,
      drivingRights: e.drivingRights,
      competence,
      assessments: visibleAssessments.map((a) => ({
        ...a,
        assessorName: userName(a.assessorUserId),
        actionOwnerName: ownerName(a.actionOwnerEmployeeId),
        areaName: areas.find((x) => x.id === a.areaId)?.name ?? "",
        editable: a.status === "DRAFT" && !e.archivedAt && (a.kind === "SUPERVISOR" ? access.supervise : access.self && a.assessorUserId === ctx.user.id),
        commentable: a.kind === "SUPERVISOR" && a.status === "PUBLISHED" && access.self && !e.archivedAt,
      })),
      trainings: trainings.map((x) => ({
        ...x,
        validity: x.status === "COMPLETED" ? validityState(ymd(x.expiresOn), !x.expiresOn, t) : null,
        reminder: reminderInfo("TRAINING", x),
        editable: !e.archivedAt && (access.supervise || ownUnverified(ctx, access, x)),
      })),
      qualifications: qualifications.map((q) => ({
        ...q,
        validity: validityState(ymd(q.expiresOn), q.noExpiry, t),
        reminder: reminderInfo("QUALIFICATION", q),
        editable: !e.archivedAt && !q.replacedAt && (access.supervise || ownUnverified(ctx, access, q)),
      })),
      orientations,
      authorizations: authorizations.map((a) => ({ ...a, grantedByName: userName(a.grantedByUserId), validity: validityState(ymd(a.expiresOn), !a.expiresOn, t) })),
      languages,
      equipmentTypes,
      emergency: access.emergency ? { name: e.emergencyContactName, phone: e.emergencyContactPhone } : null,
    };

    const equipment = access.equipment
      ? {
          sizes: { jacket: e.jacketSize, trousers: e.trousersSize, shoe: e.shoeSize },
          clothing: await repo.listClothing(e.id),
          items: await repo.listItems({ employeeId: e.id }),
        }
      : null;
    return { employee: base, access, can, work, equipment };
  },

  /** Updates the employment fields that are given (absent fields keep their value). */
  async updateEmployment(ctx: RequestContext, employeeId: string, input: HrEmploymentInput) {
    const parsed = parseInput(hrEmploymentSchema, input);
    const given = new Set(Object.keys(input ?? {}));
    const data = Object.fromEntries(Object.entries(parsed).filter(([k]) => given.has(k))) as Partial<typeof parsed>;
    const { employee, access, viewer } = await loadEmployeeAccess(ctx, employeeId);
    allowIf(access.editEmployment);
    if (employee.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
    return runInTransaction(async (tx) => {
      const repo = new HrRepo(tx, ctx.company.id);
      if (data.supervisorId) {
        if (data.supervisorId === employee.id) throw new ValidationError({ supervisorId: ["validation.supervisorSelf"] });
        const sup = await repo.findEmployee(data.supervisorId);
        if (!sup || sup.archivedAt) throw new ValidationError({ supervisorId: ["validation.invalidOption"] });
        if (supervisorChain(sup.id, viewer.edges).includes(employee.id)) throw new ValidationError({ supervisorId: ["validation.supervisorCycle"] });
      }
      if (data.userId) {
        const members = await repo.companyMembers();
        if (!members.some((m) => m.userId === data.userId)) throw new ValidationError({ userId: ["validation.invalidOption"] });
        if (await repo.employeeLinkedTo(data.userId, employee.id)) throw new ValidationError({ userId: ["validation.userAlreadyLinked"] });
      }
      if (data.jobProfileId) {
        const p = await repo.findProfile(data.jobProfileId);
        if (!p || p.archivedAt) throw new ValidationError({ jobProfileId: ["validation.invalidOption"] });
      }
      const after = await repo.updateEmployee(employee.id, { ...data, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "employee.hr_employment_update", entityType: "employee", entityId: employee.id, before: employee, after, diff: true });
      return { id: after.id };
    });
  },

  /** Company members that can be linked to a card (employee.manage / hr.manage). */
  async linkableUsers(ctx: RequestContext) {
    if (ctx.external || !(ctx.permissions.has("employee.manage") || ctx.permissions.has("hr.manage"))) throw new ForbiddenError("Missing permission employee.manage");
    const repo = new HrRepo(readClient(), ctx.company.id);
    const [members, employees] = await Promise.all([repo.companyMembers(), repo.listEmployees({ archivedAt: null, userId: { not: null } })]);
    return members.map((m) => ({ id: m.user.id, name: m.user.name ?? m.user.email, email: m.user.email, linkedEmployeeId: employees.find((e) => e.userId === m.user.id)?.id ?? null }));
  },

  async updatePersonal(ctx: RequestContext, employeeId: string, input: HrPersonalInput) {
    const data = parseInput(hrPersonalSchema, input);
    return forEmployee(
      ctx,
      employeeId,
      (a) => a.editPersonal,
      async (tx, repo, employee) => {
        const after = await repo.updateEmployee(employee.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "employee.hr_personal_update", entityType: "employee", entityId: employee.id, before: employee, after, diff: true });
        return { id: after.id };
      },
    );
  },

  async updateDriving(ctx: RequestContext, employeeId: string, input: DrivingInput) {
    const data = parseInput(drivingSchema, input);
    return forEmployee(
      ctx,
      employeeId,
      (a) => a.supervise,
      async (tx, repo, employee) => {
        const after = await repo.updateEmployee(employee.id, { driverLicenceClasses: data.driverLicenceClasses, drivingRights: data.drivingRights, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "employee.driving_update", entityType: "employee", entityId: employee.id, before: employee, after, diff: true });
        return { id: after.id };
      },
    );
  },
};

/**
 * Assessment visibility: admins and the supervisor chain see everything
 * (including drafts); the employee sees published supervisor assessments and
 * their own self-assessments; hr.view readers see published supervisor
 * assessments only.
 */
function assessmentVisible(ctx: RequestContext, access: HrAccess, a: AssessmentRow) {
  if (access.drafts) return a.kind === "SUPERVISOR" || a.status === "PUBLISHED" || a.assessorUserId === ctx.user.id;
  if (access.self) return (a.kind === "SUPERVISOR" && a.status === "PUBLISHED") || (a.kind === "SELF" && a.assessorUserId === ctx.user.id);
  return a.kind === "SUPERVISOR" && a.status === "PUBLISHED";
}

// ── competence assessments ───────────────────────────────────────────
async function validArea(repo: HrRepo, areaId: string) {
  const area = await repo.findArea(areaId);
  if (!area || area.archivedAt) throw new ValidationError({ areaId: ["validation.invalidOption"] });
  return area;
}

async function validActionOwner(repo: HrRepo, id: string | null) {
  if (!id) return;
  const o = await repo.findEmployee(id);
  if (!o || o.archivedAt) throw new ValidationError({ actionOwnerEmployeeId: ["validation.invalidOption"] });
}

function assessmentAudit(a: { id: string; kind: string; status: string; level: number | null; areaId: string; employeeId: string; assessedOn: Date }) {
  return { kind: a.kind, status: a.status, level: a.level, areaId: a.areaId, employeeId: a.employeeId, assessedOn: a.assessedOn };
}

export const assessmentService = {
  /** Supervisor (or admin) assessment of a subordinate; saved as a draft or published. */
  async create(ctx: RequestContext, employeeId: string, input: AssessmentInput) {
    const { publish, ...data } = parseInput(assessmentSchema, input);
    return forEmployee(
      ctx,
      employeeId,
      (a) => a.supervise,
      async (tx, repo, employee) => {
        await validArea(repo, data.areaId);
        await validActionOwner(repo, data.actionOwnerEmployeeId);
        const now = new Date();
        const a = await repo.createAssessment({
          ...data,
          employeeId: employee.id,
          kind: "SUPERVISOR",
          status: publish ? "PUBLISHED" : "DRAFT",
          publishedAt: publish ? now : null,
          assessorUserId: ctx.user.id,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        });
        await writeAudit(tx, ctx, { action: publish ? "competence_assessment.publish" : "competence_assessment.create", entityType: "competence_assessment", entityId: a.id, after: assessmentAudit(a) });
        return a;
      },
    );
  },

  /** Edits a draft. Published assessments are final (database trigger). */
  async update(ctx: RequestContext, assessmentId: string, input: AssessmentInput) {
    const { publish, ...data } = parseInput(assessmentSchema, input);
    return forRecord(
      ctx,
      (repo) => repo.findAssessment(assessmentId),
      (a, r) => a.supervise && r.kind === "SUPERVISOR",
      async (tx, repo, before) => {
        if (before.status !== "DRAFT" || before.archivedAt) throw new ValidationError({ _form: ["validation.assessmentPublished"] });
        await validArea(repo, data.areaId);
        await validActionOwner(repo, data.actionOwnerEmployeeId);
        const after = await repo.updateAssessment(before.id, {
          ...data,
          status: publish ? "PUBLISHED" : "DRAFT",
          publishedAt: publish ? new Date() : null,
          assessorUserId: ctx.user.id,
          updatedById: ctx.user.id,
        });
        await writeAudit(tx, ctx, { action: publish ? "competence_assessment.publish" : "competence_assessment.update", entityType: "competence_assessment", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },

  async publish(ctx: RequestContext, assessmentId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findAssessment(assessmentId),
      (a, r) => (r.kind === "SUPERVISOR" ? a.supervise : a.self && r.assessorUserId === ctx.user.id),
      async (tx, repo, before) => {
        if (before.status !== "DRAFT" || before.archivedAt) throw new ValidationError({ _form: ["validation.assessmentPublished"] });
        const after = await repo.updateAssessment(before.id, { status: "PUBLISHED", publishedAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "competence_assessment.publish", entityType: "competence_assessment", entityId: after.id, before: assessmentAudit(before), after: assessmentAudit(after), diff: true });
        return after;
      },
    );
  },

  /** Removes a draft from view (drafts are archived, never deleted). */
  async discardDraft(ctx: RequestContext, assessmentId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findAssessment(assessmentId),
      (a, r) => (r.kind === "SUPERVISOR" ? a.supervise : a.self && r.assessorUserId === ctx.user.id),
      async (tx, repo, before) => {
        if (before.status !== "DRAFT") throw new ValidationError({ _form: ["validation.assessmentPublished"] });
        if (before.archivedAt) return before;
        const after = await repo.updateAssessment(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "competence_assessment.discard", entityType: "competence_assessment", entityId: after.id, before: assessmentAudit(before) });
        return after;
      },
    );
  },

  /** The employee's own comment on a published supervisor assessment. */
  async comment(ctx: RequestContext, assessmentId: string, input: { comment?: string }) {
    const data = parseInput(assessmentCommentSchema, input);
    return forRecord(
      ctx,
      (repo) => repo.findAssessment(assessmentId),
      (a, r) => a.self && r.kind === "SUPERVISOR" && r.status === "PUBLISHED" && !r.archivedAt,
      async (tx, repo, before) => {
        const after = await repo.updateAssessment(before.id, { employeeComment: data.comment, employeeCommentAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "competence_assessment.comment", entityType: "competence_assessment", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },

  /** Marks the agreed development action done (supervisor chain / admin). */
  async completeAction(ctx: RequestContext, assessmentId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findAssessment(assessmentId),
      (a, r) => a.supervise && r.kind === "SUPERVISOR",
      async (tx, repo, before) => {
        if (before.status !== "PUBLISHED" || !before.agreedActions) throw new ValidationError({ _form: ["validation.invalidTransition"] });
        if (before.actionDoneAt) return before;
        const after = await repo.updateAssessment(before.id, { actionDoneAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "competence_assessment.action_done", entityType: "competence_assessment", entityId: after.id });
        return after;
      },
    );
  },

  /** The employee's self-assessment on the same scale. */
  async createSelf(ctx: RequestContext, employeeId: string, input: SelfAssessmentInput) {
    const { publish, ...data } = parseInput(selfAssessmentSchema, input);
    return forEmployee(
      ctx,
      employeeId,
      (a) => a.self,
      async (tx, repo, employee) => {
        await validArea(repo, data.areaId);
        const a = await repo.createAssessment({
          ...data,
          employeeId: employee.id,
          kind: "SELF",
          status: publish ? "PUBLISHED" : "DRAFT",
          publishedAt: publish ? new Date() : null,
          assessorUserId: ctx.user.id,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        });
        await writeAudit(tx, ctx, { action: "competence_assessment.self", entityType: "competence_assessment", entityId: a.id, after: assessmentAudit(a) });
        return a;
      },
    );
  },
};

// ── trainings ────────────────────────────────────────────────────────
function trainingData(data: ReturnType<typeof trainingSchema.parse>) {
  return {
    ...data,
    completedOn: data.status === "COMPLETED" ? data.completedOn : null,
    expiresOn: data.status === "COMPLETED" ? data.expiresOn : null,
    remindBeforeExpiry: data.status === "COMPLETED" && data.remindBeforeExpiry,
  };
}

export const trainingService = {
  /** Supervisor/admin entries are verified; the employee's own entries wait for verification. */
  async add(ctx: RequestContext, employeeId: string, input: TrainingInput) {
    const data = trainingData(parseInput(trainingSchema, input));
    return forEmployee(
      ctx,
      employeeId,
      (a) => a.supervise || a.self,
      async (tx, repo, employee, access) => {
        const verified = access.supervise;
        const t = await repo.createTraining({ ...data, employeeId: employee.id, verifiedAt: verified ? new Date() : null, verifiedById: verified ? ctx.user.id : null, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "training.create", entityType: "training", entityId: t.id, after: t });
        return t;
      },
    );
  },

  async update(ctx: RequestContext, trainingId: string, input: TrainingInput) {
    const data = trainingData(parseInput(trainingSchema, input));
    return forRecord(
      ctx,
      (repo) => repo.findTraining(trainingId),
      (a, r) => !r.archivedAt && (a.supervise || ownUnverified(ctx, a, r)),
      async (tx, repo, before) => {
        const after = await repo.updateTraining(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "training.update", entityType: "training", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },

  async verify(ctx: RequestContext, trainingId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findTraining(trainingId),
      (a, r) => a.supervise && !r.archivedAt,
      async (tx, repo, before) => {
        if (before.verifiedAt) return before;
        const after = await repo.updateTraining(before.id, { verifiedAt: new Date(), verifiedById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "training.verify", entityType: "training", entityId: after.id });
        return after;
      },
    );
  },

  async archive(ctx: RequestContext, trainingId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findTraining(trainingId),
      (a, r) => a.admin || ownUnverified(ctx, a, r),
      async (tx, repo, before) => {
        if (before.archivedAt) return before;
        const after = await repo.updateTraining(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "training.archive", entityType: "training", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },
};

// ── cards and qualifications ─────────────────────────────────────────
async function qualificationData(repo: HrRepo, data: ReturnType<typeof qualificationSchema.parse>) {
  let name = data.name;
  if (data.typeId) {
    const type = await repo.findType(data.typeId);
    if (!type || type.archivedAt) throw new ValidationError({ typeId: ["validation.invalidOption"] });
    name ??= type.name;
  }
  return { ...data, name: name!, expiresOn: data.noExpiry ? null : data.expiresOn, remindBeforeExpiry: !data.noExpiry && data.remindBeforeExpiry };
}

export const qualificationService = {
  async add(ctx: RequestContext, employeeId: string, input: QualificationInput) {
    const parsed = parseInput(qualificationSchema, input);
    return forEmployee(
      ctx,
      employeeId,
      (a) => a.supervise || a.self,
      async (tx, repo, employee, access) => {
        const data = await qualificationData(repo, parsed);
        const verified = access.supervise;
        const q = await repo.createQualification({ ...data, employeeId: employee.id, verifiedAt: verified ? new Date() : null, verifiedById: verified ? ctx.user.id : null, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "qualification.create", entityType: "qualification", entityId: q.id, after: q });
        return q;
      },
    );
  },

  /** A changed expiry date starts a new reminder cycle (reminders are keyed by the date). */
  async update(ctx: RequestContext, qualificationId: string, input: QualificationInput) {
    const parsed = parseInput(qualificationSchema, input);
    return forRecord(
      ctx,
      (repo) => repo.findQualification(qualificationId),
      (a, r) => !r.archivedAt && !r.replacedAt && (a.supervise || ownUnverified(ctx, a, r)),
      async (tx, repo, before) => {
        const data = await qualificationData(repo, parsed);
        const after = await repo.updateQualification(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "qualification.update", entityType: "qualification", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },

  /**
   * Renewal: a new record replaces the old one. A renewal entered by the
   * employee replaces the old card only once it is verified.
   */
  async renew(ctx: RequestContext, qualificationId: string, input: QualificationInput) {
    const parsed = parseInput(qualificationSchema, input);
    return forRecord(
      ctx,
      (repo) => repo.findQualification(qualificationId),
      (a, r) => !r.archivedAt && !r.replacedAt && (a.supervise || a.self),
      async (tx, repo, old, employee, access) => {
        const data = await qualificationData(repo, { ...parsed, typeId: parsed.typeId ?? old.typeId });
        const verified = access.supervise;
        const q = await repo.createQualification({
          ...data,
          employeeId: employee.id,
          renewsId: old.id,
          verifiedAt: verified ? new Date() : null,
          verifiedById: verified ? ctx.user.id : null,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        });
        if (verified) await repo.updateQualification(old.id, { replacedAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "qualification.renew", entityType: "qualification", entityId: q.id, after: q, metadata: { renews: old.id, replaced: verified } });
        return q;
      },
    );
  },

  async verify(ctx: RequestContext, qualificationId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findQualification(qualificationId),
      (a, r) => a.supervise && !r.archivedAt,
      async (tx, repo, before) => {
        if (before.verifiedAt) return before;
        const after = await repo.updateQualification(before.id, { verifiedAt: new Date(), verifiedById: ctx.user.id, updatedById: ctx.user.id });
        if (before.renewsId) {
          const old = await repo.findQualification(before.renewsId);
          if (old && !old.replacedAt) await repo.updateQualification(old.id, { replacedAt: new Date(), updatedById: ctx.user.id });
        }
        await writeAudit(tx, ctx, { action: "qualification.verify", entityType: "qualification", entityId: after.id, metadata: { renews: before.renewsId } });
        return after;
      },
    );
  },

  async archive(ctx: RequestContext, qualificationId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findQualification(qualificationId),
      (a, r) => a.admin || ownUnverified(ctx, a, r),
      async (tx, repo, before) => {
        if (before.archivedAt) return before;
        const after = await repo.updateQualification(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "qualification.archive", entityType: "qualification", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },
};

// ── orientations ─────────────────────────────────────────────────────
export const orientationService = {
  async add(ctx: RequestContext, employeeId: string, input: OrientationInput) {
    const data = parseInput(orientationSchema, input);
    return forEmployee(
      ctx,
      employeeId,
      (a) => a.supervise,
      async (tx, repo, employee) => {
        const o = await repo.createOrientation({ ...data, employeeId: employee.id, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "orientation.create", entityType: "orientation", entityId: o.id, after: o });
        return o;
      },
    );
  },

  async update(ctx: RequestContext, orientationId: string, input: OrientationInput) {
    const data = parseInput(orientationSchema, input);
    return forRecord(
      ctx,
      (repo) => repo.findOrientation(orientationId),
      (a, r) => a.supervise && !r.archivedAt,
      async (tx, repo, before) => {
        const after = await repo.updateOrientation(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "orientation.update", entityType: "orientation", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },

  /** The employee's acknowledgement ("kuittaus"). */
  async acknowledge(ctx: RequestContext, orientationId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findOrientation(orientationId),
      (a, r) => a.self && !r.archivedAt,
      async (tx, repo, before) => {
        if (before.acknowledgedAt) return before;
        const after = await repo.updateOrientation(before.id, { acknowledgedAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "orientation.acknowledge", entityType: "orientation", entityId: after.id });
        return after;
      },
    );
  },

  async archive(ctx: RequestContext, orientationId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findOrientation(orientationId),
      (a) => a.admin,
      async (tx, repo, before) => {
        if (before.archivedAt) return before;
        const after = await repo.updateOrientation(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "orientation.archive", entityType: "orientation", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },
};

// ── equipment authorizations ─────────────────────────────────────────
async function validEquipmentType(repo: HrRepo, id: string | null) {
  if (!id) return;
  const t = await repo.findEquipmentType(id);
  if (!t || t.archivedAt) throw new ValidationError({ equipmentTypeId: ["validation.invalidOption"] });
}

export const authorizationService = {
  /** Employer-granted permit to operate; the granter is the signed-in user. */
  async add(ctx: RequestContext, employeeId: string, input: AuthorizationInput) {
    const data = parseInput(authorizationSchema, input);
    return forEmployee(
      ctx,
      employeeId,
      (a) => a.supervise,
      async (tx, repo, employee) => {
        await validEquipmentType(repo, data.equipmentTypeId);
        const p = await repo.createAuthorization({ ...data, employeeId: employee.id, grantedByUserId: ctx.user.id, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "equipment_authorization.create", entityType: "equipment_authorization", entityId: p.id, after: p });
        return p;
      },
    );
  },

  async update(ctx: RequestContext, authorizationId: string, input: AuthorizationInput) {
    const data = parseInput(authorizationSchema, input);
    return forRecord(
      ctx,
      (repo) => repo.findAuthorization(authorizationId),
      (a, r) => a.supervise && !r.archivedAt,
      async (tx, repo, before) => {
        await validEquipmentType(repo, data.equipmentTypeId);
        const after = await repo.updateAuthorization(before.id, { ...data, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "equipment_authorization.update", entityType: "equipment_authorization", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },

  async archive(ctx: RequestContext, authorizationId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findAuthorization(authorizationId),
      (a) => a.supervise,
      async (tx, repo, before) => {
        if (before.archivedAt) return before;
        const after = await repo.updateAuthorization(before.id, { archivedAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "equipment_authorization.archive", entityType: "equipment_authorization", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },
};

// ── languages ────────────────────────────────────────────────────────
export const languageService = {
  /** Saves one language entry per source: the employee's own or the supervisor's assessment. */
  async save(ctx: RequestContext, employeeId: string, input: LanguageInput) {
    const data = parseInput(languageSchema, input);
    return forEmployee(
      ctx,
      employeeId,
      (a) => (data.source === "SELF" ? a.self : a.supervise),
      async (tx, repo, employee) => {
        const before = await repo.findLanguageEntry(employee.id, data.language, data.source);
        const after = before
          ? await repo.updateLanguage(before.id, { ...data, updatedById: ctx.user.id })
          : await repo.createLanguage({ ...data, employeeId: employee.id, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: before ? "employee_language.update" : "employee_language.create", entityType: "employee_language", entityId: after.id, before, after, diff: Boolean(before) });
        return after;
      },
    );
  },

  async remove(ctx: RequestContext, languageId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findLanguage(languageId),
      (a, r) => (r.source === "SELF" ? a.self || a.admin : a.supervise),
      async (tx, repo, before) => {
        await repo.deleteLanguage(before.id);
        await writeAudit(tx, ctx, { action: "employee_language.delete", entityType: "employee_language", entityId: before.id, before });
        return { id: before.id };
      },
    );
  },
};

// ── work clothing and company items ──────────────────────────────────
export const clothingService = {
  async issue(ctx: RequestContext, employeeId: string, input: ClothingIssueInput) {
    const data = parseInput(clothingIssueSchema, input);
    return forEmployee(
      ctx,
      employeeId,
      (a) => a.admin,
      async (tx, repo, employee) => {
        const c = await repo.createClothing({ ...data, employeeId: employee.id, createdById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "clothing_issue.create", entityType: "clothing_issue", entityId: c.id, after: c });
        return c;
      },
    );
  },

  /** Cancels a mistaken entry; it stays visible in the history. */
  async cancel(ctx: RequestContext, issueId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findClothing(issueId),
      (a) => a.admin,
      async (tx, repo, before) => {
        if (before.archivedAt) return before;
        const after = await repo.cancelClothing(before.id, ctx.user.id);
        await writeAudit(tx, ctx, { action: "clothing_issue.cancel", entityType: "clothing_issue", entityId: after.id });
        return after;
      },
    );
  },
};

/** Company items are hidden (404) from everyone but the admin and the employee. */
function equipmentAccess(a: HrAccess, allowed: boolean) {
  if (!a.equipment) throw new NotFoundError();
  return allowed;
}

export const companyItemService = {
  async add(ctx: RequestContext, employeeId: string, input: CompanyItemInput) {
    const data = parseInput(companyItemSchema, input);
    return forEmployee(
      ctx,
      employeeId,
      (a) => equipmentAccess(a, a.admin),
      async (tx, repo, employee) => {
        const item = await repo.createItem({ ...data, returnedOn: data.status === "WITH_EMPLOYEE" ? null : data.returnedOn, employeeId: employee.id, createdById: ctx.user.id, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "company_item.create", entityType: "company_item", entityId: item.id, after: item });
        return item;
      },
    );
  },

  async update(ctx: RequestContext, itemId: string, input: CompanyItemInput) {
    const data = parseInput(companyItemSchema, input);
    return forRecord(
      ctx,
      (repo) => repo.findItem(itemId),
      (a) => equipmentAccess(a, a.admin),
      async (tx, repo, before) => {
        const after = await repo.updateItem(before.id, { ...data, returnedOn: data.status === "WITH_EMPLOYEE" ? null : data.returnedOn, updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "company_item.update", entityType: "company_item", entityId: after.id, before, after, diff: true });
        return after;
      },
    );
  },

  /** The employee's receipt of the item. */
  async acknowledge(ctx: RequestContext, itemId: string) {
    return forRecord(
      ctx,
      (repo) => repo.findItem(itemId),
      (a) => equipmentAccess(a, a.self),
      async (tx, repo, before) => {
        if (before.acknowledgedAt) return before;
        const after = await repo.updateItem(before.id, { acknowledgedAt: new Date(), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "company_item.acknowledge", entityType: "company_item", entityId: after.id });
        return after;
      },
    );
  },
};

