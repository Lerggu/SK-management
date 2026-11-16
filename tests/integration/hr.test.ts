/**
 * HR: personnel card, competence assessments, cards and expiry reminders
 * (ADR 0025). Real PostgreSQL; reminders use an in-memory mailer.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { MASK } from "@/platform/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { MemoryMailer, type MailMessage, type Mailer } from "@/platform/mail";
import { setStorageForTests, MemoryObjectStorage } from "@/platform/storage";
import type { RequestContext } from "@/platform/authz";
import { employeeService } from "@/modules/workforce/service";
import { competenceAreaService, hrSettingsService, jobProfileService, qualificationTypeService } from "@/modules/hr/settings.service";
import {
  assessmentService,
  clothingService,
  companyItemService,
  hrCardService,
  languageService,
  orientationService,
  qualificationService,
  trainingService,
} from "@/modules/hr/card.service";
import { employeeFileService } from "@/modules/hr/files.service";
import { hrOverviewService } from "@/modules/hr/overview.service";
import { runExpiryReminders } from "@/modules/hr/reminders";
import { auditFor, createMember, createTenant, type Tenant } from "../helpers/fixtures";

const PDF = (body = "test") => ({ fileName: "todistus.pdf", bytes: new TextEncoder().encode(`%PDF-1.4\n${body}\n%%EOF`) });
const PNG = () => ({ fileName: "kuva.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]) });

interface World {
  t: Tenant;
  admin: RequestContext;
  supervisorCtx: RequestContext;
  workerCtx: RequestContext;
  otherCtx: RequestContext;
  viewer: RequestContext;
  supervisor: string;
  worker: string;
  other: string;
  area: string;
  area2: string;
}

let w: World;

async function linkedEmployee(t: Tenant, ctx: RequestContext, number: string, first: string, extra: Record<string, unknown> = {}) {
  return employeeService.create(t.ownerCtx, { employeeNumber: number, firstName: first, lastName: "Testi", userId: ctx.user.id, ...extra });
}

beforeAll(async () => {
  setStorageForTests(new MemoryObjectStorage());
  const t = await createTenant("HR");
  const admin = await createMember(t, "HR_ADMIN");
  const supervisorCtx = await createMember(t, "SUPERVISOR");
  const workerCtx = await createMember(t, "EMPLOYEE");
  const otherCtx = await createMember(t, "EMPLOYEE");
  const viewer = await createMember(t, "SITE_MANAGER");
  const supervisor = (await linkedEmployee(t, supervisorCtx, "S-1", "Sanna")).id;
  const worker = (await linkedEmployee(t, workerCtx, "W-1", "Ville", { email: "ville@example.test" })).id;
  const other = (await linkedEmployee(t, otherCtx, "W-2", "Olli")).id;
  await hrCardService.updateEmployment(admin, worker, { supervisorId: supervisor, team: "Putkitiimi", location: "Vantaa" });
  const area = (await competenceAreaService.create(admin, { category: "Maanrakennus", name: "Kaivannot", isKey: true })).id;
  const area2 = (await competenceAreaService.create(admin, { category: "Mittaus", name: "Koneohjaus", isKey: true })).id;
  w = { t, admin, supervisorCtx, workerCtx, otherCtx, viewer, supervisor, worker, other, area, area2 };
});

describe("HR access", () => {
  it("employee sees own card, not a colleague's", async () => {
    const own = await hrCardService.get(w.workerCtx, w.worker);
    expect(own.work).not.toBeNull();
    expect(own.equipment).not.toBeNull();
    expect(own.work?.emergency).not.toBeNull();
    await expect(hrCardService.get(w.workerCtx, w.other)).rejects.toBeInstanceOf(NotFoundError);
    expect(await hrCardService.myEmployeeId(w.workerCtx)).toBe(w.worker);
  });

  it("supervisor sees the subordinate's work data and emergency contact, not clothing or items", async () => {
    const card = await hrCardService.get(w.supervisorCtx, w.worker);
    expect(card.access.supervisor).toBe(true);
    expect(card.work?.emergency).not.toBeNull();
    expect(card.equipment).toBeNull();
    // Not their subordinate: basic data only (employee.view), no HR data.
    const notMine = await hrCardService.get(w.supervisorCtx, w.other);
    expect(notMine.work).toBeNull();
  });

  it("hr.view reader sees work data without the emergency contact", async () => {
    const card = await hrCardService.get(w.viewer, w.worker);
    expect(card.work).not.toBeNull();
    expect(card.work?.emergency).toBeNull();
    expect(card.equipment).toBeNull();
  });

  it("external members get no HR access", async () => {
    const client = await createMember(w.t, "CLIENT");
    await expect(hrCardService.get(client, w.worker)).rejects.toBeInstanceOf(NotFoundError);
    await expect(hrOverviewService.matrix(client)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("employee edits allowed fields only; emergency contact is masked in audit", async () => {
    await hrCardService.updatePersonal(w.workerCtx, w.worker, { phone: "040 123", emergencyContactName: "Maija", emergencyContactPhone: "050 999", jacketSize: "L", shoeSize: "43" });
    await expect(hrCardService.updateEmployment(w.workerCtx, w.worker, { supervisorId: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(hrCardService.updateDriving(w.workerCtx, w.worker, { driverLicenceClasses: ["B"] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(hrCardService.updatePersonal(w.supervisorCtx, w.worker, { phone: "1" })).rejects.toBeInstanceOf(ForbiddenError);
    const events = await auditFor(w.t.companyId, w.worker);
    const personal = events.find((e) => e.action === "employee.hr_personal_update")!;
    expect(personal.after).toMatchObject({ emergencyContactName: MASK, emergencyContactPhone: MASK, jacketSize: "L" });
    expect(personal.actorUserId).toBe(w.workerCtx.user.id);
  });

  it("rejects supervisor cycles", async () => {
    await expect(hrCardService.updateEmployment(w.admin, w.supervisor, { supervisorId: w.worker })).rejects.toMatchObject({ fieldErrors: { supervisorId: ["validation.supervisorCycle"] } });
    await expect(hrCardService.updateEmployment(w.admin, w.worker, { supervisorId: w.worker, team: "Putkitiimi" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("competence assessments", () => {
  it("draft → published; employee sees only published, comments, cannot change it", async () => {
    const draft = await assessmentService.create(w.supervisorCtx, w.worker, {
      areaId: w.area,
      level: "2",
      observations: "Tekee tuennat ohjattuna",
      strengths: "Huolellinen",
      developmentAreas: "Kaivannon luiskat",
      agreedActions: "Kaivantotyökoulutus",
      actionOwnerEmployeeId: w.supervisor,
      actionDueOn: "2026-12-31",
      assessedOn: "2026-09-01",
      nextAssessmentOn: "2027-03-01",
    });
    expect(draft.status).toBe("DRAFT");
    let card = await hrCardService.get(w.workerCtx, w.worker);
    expect(card.work!.assessments.some((a) => a.id === draft.id)).toBe(false);
    expect(card.work!.competence.find((c) => c.area.id === w.area)?.supervisor).toBeNull();

    await assessmentService.publish(w.supervisorCtx, draft.id);
    card = await hrCardService.get(w.workerCtx, w.worker);
    const published = card.work!.assessments.find((a) => a.id === draft.id)!;
    expect(published.status).toBe("PUBLISHED");
    expect(published.commentable).toBe(true);
    expect(card.work!.competence.find((c) => c.area.id === w.area)?.supervisor?.level).toBe(2);

    await assessmentService.comment(w.workerCtx, draft.id, { comment: "Samaa mieltä, koulutus sopii" });
    await expect(assessmentService.update(w.workerCtx, draft.id, { areaId: w.area, level: "4", assessedOn: "2026-09-01" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assessmentService.update(w.supervisorCtx, draft.id, { areaId: w.area, level: "3", assessedOn: "2026-09-01" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.assessmentPublished"] } });
    await expect(assessmentService.create(w.workerCtx, w.worker, { areaId: w.area, level: "4", assessedOn: "2026-09-02" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assessmentService.comment(w.supervisorCtx, draft.id, { comment: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the database refuses to change or delete a published assessment", async () => {
    const a = await db.competenceAssessment.findFirstOrThrow({ where: { companyId: w.t.companyId, status: "PUBLISHED", employeeId: w.worker } });
    await expect(db.competenceAssessment.update({ where: { id: a.id }, data: { level: 4 } })).rejects.toThrow(/cannot be changed/);
    await expect(db.competenceAssessment.delete({ where: { id: a.id } })).rejects.toThrow(/never deleted/);
  });

  it("a new assessment keeps the history; the matrix shows the latest with its date", async () => {
    await assessmentService.create(w.supervisorCtx, w.worker, { areaId: w.area, level: "3", assessedOn: "2026-10-01", publish: "on" });
    const card = await hrCardService.get(w.supervisorCtx, w.worker);
    const history = card.work!.assessments.filter((a) => a.areaId === w.area && a.kind === "SUPERVISOR" && a.status === "PUBLISHED");
    expect(history.map((h) => h.level)).toEqual([3, 2]);
    const m = await hrOverviewService.matrix(w.admin);
    const row = m.rows.find((r) => r.employee.id === w.worker)!;
    expect(row.cells[w.area]).toMatchObject({ level: 3 });
    expect(row.cells[w.area]!.assessedOn.toISOString().slice(0, 10)).toBe("2026-10-01");
    // Missing assessment is distinct from a low level.
    expect(row.cells[w.area2]).toBeNull();
    await assessmentService.create(w.supervisorCtx, w.worker, { areaId: w.area2, level: "", assessedOn: "2026-10-01", publish: "on" });
    const m2 = await hrOverviewService.matrix(w.admin);
    expect(m2.rows.find((r) => r.employee.id === w.worker)!.cells[w.area2]).toMatchObject({ level: null });
  });

  it("self-assessment is shown next to the supervisor's", async () => {
    await assessmentService.createSelf(w.workerCtx, w.worker, { areaId: w.area, level: "4", observations: "Osaan itsenäisesti", assessedOn: "2026-10-02", publish: "on" });
    await expect(assessmentService.createSelf(w.supervisorCtx, w.worker, { areaId: w.area, level: "1", assessedOn: "2026-10-02" })).rejects.toBeInstanceOf(ForbiddenError);
    const card = await hrCardService.get(w.workerCtx, w.worker);
    const row = card.work!.competence.find((c) => c.area.id === w.area)!;
    expect(row.self?.level).toBe(4);
    expect(row.supervisor?.level).toBe(3);
    // The matrix never uses the self-assessment.
    const m = await hrOverviewService.matrix(w.admin);
    expect(m.rows.find((r) => r.employee.id === w.worker)!.cells[w.area]?.level).toBe(3);
  });

  it("archived areas keep their history", async () => {
    const area = await competenceAreaService.create(w.admin, { category: "Nosto", name: "Merkinanto", isKey: false });
    await assessmentService.create(w.supervisorCtx, w.worker, { areaId: area.id, level: "2", assessedOn: "2026-10-01", publish: "on" });
    await competenceAreaService.archive(w.admin, area.id);
    const card = await hrCardService.get(w.admin, w.worker);
    expect(card.work!.competence.find((c) => c.area.id === area.id)?.supervisor?.level).toBe(2);
    expect((await competenceAreaService.list(w.admin)).some((a) => a.id === area.id)).toBe(false);
    await expect(assessmentService.create(w.supervisorCtx, w.worker, { areaId: area.id, level: "3", assessedOn: "2026-10-05" })).rejects.toBeInstanceOf(ValidationError);
    await expect(competenceAreaService.create(w.supervisorCtx, { category: "X", name: "Y" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("trainings and qualifications", () => {
  it("employee entries wait for verification and stay editable only until verified", async () => {
    const q = await qualificationService.add(w.workerCtx, w.worker, { name: "Tulityökortti", issuedOn: "2025-01-01", expiresOn: "2030-01-01" });
    expect(q.verifiedAt).toBeNull();
    await qualificationService.update(w.workerCtx, q.id, { name: "Tulityökortti", issuedOn: "2025-01-02", expiresOn: "2030-01-01" });
    await expect(qualificationService.verify(w.workerCtx, q.id)).rejects.toBeInstanceOf(ForbiddenError);
    await qualificationService.verify(w.supervisorCtx, q.id);
    await expect(qualificationService.update(w.workerCtx, q.id, { name: "Muutettu", noExpiry: "on" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(qualificationService.add(w.otherCtx, w.worker, { name: "X", noExpiry: "on" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("requires an expiry date or 'no expiry'", async () => {
    await expect(qualificationService.add(w.admin, w.worker, { name: "EA1" })).rejects.toMatchObject({ fieldErrors: { expiresOn: ["validation.expiryOrNoExpiry"] } });
    await expect(qualificationService.add(w.admin, w.worker, { name: "EA1", noExpiry: "on", expiresOn: "2030-01-01" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("renewal replaces the old card (immediately for the supervisor, after verification for the employee)", async () => {
    const old = await qualificationService.add(w.supervisorCtx, w.worker, { name: "Työturvallisuuskortti", issuedOn: "2022-01-01", expiresOn: "2027-01-01" });
    const renewed = await qualificationService.renew(w.supervisorCtx, old.id, { name: "Työturvallisuuskortti", issuedOn: "2026-10-01", expiresOn: "2031-10-01" });
    expect(renewed.renewsId).toBe(old.id);
    expect((await db.employeeQualification.findUniqueOrThrow({ where: { id: old.id } })).replacedAt).not.toBeNull();

    const own = await qualificationService.add(w.supervisorCtx, w.worker, { name: "Tieturva 1", expiresOn: "2027-06-01" });
    const selfRenewal = await qualificationService.renew(w.workerCtx, own.id, { name: "Tieturva 1", expiresOn: "2032-06-01" });
    expect((await db.employeeQualification.findUniqueOrThrow({ where: { id: own.id } })).replacedAt).toBeNull();
    await qualificationService.verify(w.supervisorCtx, selfRenewal.id);
    expect((await db.employeeQualification.findUniqueOrThrow({ where: { id: own.id } })).replacedAt).not.toBeNull();
  });

  it("qualification list shows validity with filters", async () => {
    const type = await qualificationTypeService.create(w.admin, { name: "Ensiapu EA1", defaultValidityMonths: "36" });
    await qualificationService.add(w.admin, w.other, { typeId: type.id, expiresOn: "2020-01-01", issuedOn: "2017-01-01" });
    const all = await hrOverviewService.qualifications(w.admin, { typeId: type.id });
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0].name).toBe("Ensiapu EA1");
    expect(all.rows[0].validity).toBe("EXPIRED");
    expect((await hrOverviewService.qualifications(w.admin, { validity: "EXPIRED" })).rows.every((r) => r.validity === "EXPIRED")).toBe(true);
    // A supervisor sees only their area of responsibility.
    const mine = await hrOverviewService.qualifications(w.supervisorCtx);
    expect(mine.rows.every((r) => r.employee.id === w.worker || r.employee.id === w.supervisor)).toBe(true);
  });

  it("trainings: planned trainings and open development actions appear in the overview", async () => {
    await trainingService.add(w.supervisorCtx, w.worker, { name: "Kaivantotyökoulutus", status: "PLANNED", plannedOn: "2026-11-15" });
    await expect(trainingService.add(w.admin, w.worker, { name: "X", status: "COMPLETED" })).rejects.toMatchObject({ fieldErrors: { completedOn: ["validation.required"] } });
    const o = await hrOverviewService.overview(w.admin);
    expect(o.plannedTrainings.some((p) => p.name === "Kaivantotyökoulutus")).toBe(true);
    expect(o.openActions.some((a) => a.agreedActions === "Kaivantotyökoulutus")).toBe(true);
    const action = o.openActions.find((a) => a.agreedActions === "Kaivantotyökoulutus")!;
    await assessmentService.completeAction(w.supervisorCtx, action.id);
    expect((await hrOverviewService.overview(w.admin)).openActions.some((a) => a.id === action.id)).toBe(false);
  });
});

describe("expiry reminders", () => {
  class FlakyMailer implements Mailer {
    readonly kind = "test" as const;
    readonly sent: MailMessage[] = [];
    failNext = 0;
    async send(m: MailMessage) {
      if (this.failNext > 0) {
        this.failNext -= 1;
        throw new Error("SMTP 451 temporary failure");
      }
      this.sent.push(m);
    }
  }

  let t: Tenant;
  let admin: RequestContext;
  let employee: string;

  beforeAll(async () => {
    t = await createTenant("Remind");
    admin = t.ownerCtx;
    employee = (await employeeService.create(admin, { employeeNumber: "R-1", firstName: "Riikka", lastName: "Muistutus", email: "riikka@example.test" })).id;
    await hrSettingsService.update(admin, { reminderEmail: "huolto@example.test" });
  });

  const run = (now: string, mailer: Mailer | null) => runExpiryReminders({ now: new Date(now), companyId: t.companyId, mailer });

  it("sends once per recipient on the due date (31.3. → 28.2.), never twice", async () => {
    const q = await qualificationService.add(admin, employee, { name: "Tulityökortti", expiresOn: "2027-03-31", remindBeforeExpiry: "on" });
    const mailer = new FlakyMailer();
    expect((await run("2027-02-27T10:00:00Z", mailer)).sent).toBe(0);
    const first = await run("2027-02-28T07:00:00Z", mailer);
    expect(first.sent).toBe(2);
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(["huolto@example.test", "riikka@example.test"]);
    expect(mailer.sent[0].subject).toContain("Tulityökortti");
    expect(mailer.sent[0].text).toContain("31.3.2027");
    expect((await run("2027-02-28T08:00:00Z", mailer)).sent).toBe(0);
    // Parallel runs (two instances) do not duplicate.
    await Promise.all([run("2027-03-01T08:00:00Z", mailer), run("2027-03-01T08:00:00Z", mailer)]);
    expect(mailer.sent).toHaveLength(2);
    const rows = await db.expiryReminder.findMany({ where: { sourceId: q.id } });
    expect(rows.map((r) => [r.recipientKind, r.status]).sort()).toEqual([
      ["MAINTENANCE", "SENT"],
      ["OWNER", "SENT"],
    ]);
    expect(rows.every((r) => r.sentAt && r.dueOn.toISOString().startsWith("2027-02-28"))).toBe(true);
  });

  it("a changed expiry date starts a new cycle; renewal too", async () => {
    const q = await qualificationService.add(admin, employee, { name: "EA1", expiresOn: "2027-05-15", remindBeforeExpiry: "on" });
    const mailer = new FlakyMailer();
    expect((await run("2027-04-15T08:00:00Z", mailer)).sent).toBe(2);
    await qualificationService.update(admin, q.id, { name: "EA1", expiresOn: "2027-06-30", remindBeforeExpiry: "on" });
    expect((await run("2027-04-16T08:00:00Z", mailer)).sent).toBe(0);
    expect((await run("2027-05-30T08:00:00Z", mailer)).sent).toBe(2);
    const renewed = await qualificationService.renew(admin, q.id, { name: "EA1", expiresOn: "2027-07-10", remindBeforeExpiry: "on" });
    expect((await run("2027-06-10T08:00:00Z", mailer)).sent).toBe(2);
    expect(await db.expiryReminder.count({ where: { sourceId: renewed.id, status: "SENT" } })).toBe(2);
    // The replaced card is no longer reminded.
    expect(await db.expiryReminder.count({ where: { sourceId: q.id } })).toBe(4);
  });

  it("a card added after the due date but before expiry is reminded in the next run", async () => {
    const mailer = new FlakyMailer();
    await qualificationService.add(admin, employee, { name: "Tieturva 1", expiresOn: "2027-08-20", remindBeforeExpiry: "on" });
    expect((await run("2027-08-05T08:00:00Z", mailer)).sent).toBe(2);
    await qualificationService.add(admin, employee, { name: "Vanha kortti", expiresOn: "2027-08-01", remindBeforeExpiry: "on" });
    expect((await run("2027-08-05T09:00:00Z", mailer)).sent).toBe(0);
  });

  it("failed sends are not marked sent and are retried; no mailer → nothing is marked sent", async () => {
    const q = await qualificationService.add(admin, employee, { name: "Vesityökortti", expiresOn: "2027-10-31", remindBeforeExpiry: "on" });
    expect((await run("2027-09-30T08:00:00Z", null)).mailNotConfigured).toBe(2);
    expect(await db.expiryReminder.count({ where: { sourceId: q.id, status: "SENT" } })).toBe(0);
    const mailer = new FlakyMailer();
    mailer.failNext = 1;
    const r = await run("2027-10-01T08:00:00Z", mailer);
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(1);
    const failed = await db.expiryReminder.findFirstOrThrow({ where: { sourceId: q.id, status: "FAILED" } });
    expect(failed.lastError).toContain("451");
    expect(failed.sentAt).toBeNull();
    expect((await run("2027-10-02T08:00:00Z", mailer)).sent).toBe(1);
    expect(await db.expiryReminder.count({ where: { sourceId: q.id, status: "SENT" } })).toBe(2);
  });

  it("missing addresses are recorded and the card shows a warning; sent once the address exists", async () => {
    const e2 = (await employeeService.create(admin, { employeeNumber: "R-2", firstName: "Eino", lastName: "Osoitteeton" })).id;
    const q = await qualificationService.add(admin, e2, { name: "Hätäensiapu", expiresOn: "2027-12-15", remindBeforeExpiry: "on" });
    const card = await hrCardService.get(admin, e2);
    expect(card.work!.qualifications.find((x) => x.id === q.id)!.reminder).toMatchObject({ missingOwnerEmail: true, missingMaintenanceEmail: false, dueOn: "2027-11-15" });
    const mailer = new MemoryMailer();
    const r = await runExpiryReminders({ now: new Date("2027-11-15T08:00:00Z"), companyId: t.companyId, mailer });
    expect(r.noAddress).toBe(1);
    expect(await db.expiryReminder.findFirstOrThrow({ where: { sourceId: q.id, recipientKind: "OWNER" } })).toMatchObject({ status: "NO_ADDRESS" });
    await employeeService.update(admin, e2, { employeeNumber: "R-2", firstName: "Eino", lastName: "Osoitteeton", email: "eino@example.test" });
    await runExpiryReminders({ now: new Date("2027-11-16T08:00:00Z"), companyId: t.companyId, mailer });
    expect(await db.expiryReminder.findFirstOrThrow({ where: { sourceId: q.id, recipientKind: "OWNER" } })).toMatchObject({ status: "SENT", recipientEmail: "eino@example.test" });
  });

  it("fixed-term trainings use the same reminder", async () => {
    await trainingService.add(admin, employee, { name: "Sähkötyöturvallisuus", completedOn: "2022-12-31", expiresOn: "2027-12-31", remindBeforeExpiry: "on" });
    const mailer = new FlakyMailer();
    expect((await run("2027-11-30T08:00:00Z", mailer)).sent).toBe(2);
    expect(mailer.sent.some((m) => m.subject.includes("Sähkötyöturvallisuus"))).toBe(true);
  });

  it("only the HR admin can run reminders on demand", async () => {
    const sup = await createMember(t, "SUPERVISOR");
    await expect(hrSettingsService.runReminders(sup)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("attachments", () => {
  it("checks content, enforces section visibility and supports rename and removal", async () => {
    const q = await qualificationService.add(w.supervisorCtx, w.worker, { name: "Nostokortti", noExpiry: "on" });
    const f = await employeeFileService.upload(w.workerCtx, w.worker, { kind: "CARD_IMAGE", targetType: "QUALIFICATION", targetId: q.id }, PDF());
    expect(f.contentType).toBe("application/pdf");
    await expect(employeeFileService.upload(w.workerCtx, w.worker, { kind: "OTHER" }, { fileName: "virus.pdf", bytes: new TextEncoder().encode("<html>") })).rejects.toMatchObject({ fieldErrors: { file: ["validation.hrFileType"] } });
    await expect(employeeFileService.upload(w.workerCtx, w.worker, { kind: "OTHER" }, { fileName: "a.svg", bytes: new TextEncoder().encode("<svg/>") })).rejects.toBeInstanceOf(ValidationError);
    await expect(employeeFileService.upload(w.workerCtx, w.other, { kind: "OTHER" }, PDF())).rejects.toBeInstanceOf(NotFoundError);
    await expect(employeeFileService.upload(w.workerCtx, w.worker, { kind: "CARD_IMAGE", targetType: "QUALIFICATION", targetId: (await qualificationService.add(w.admin, w.other, { name: "Muu", noExpiry: "on" })).id }, PDF())).rejects.toBeInstanceOf(ValidationError);

    expect((await employeeFileService.download(w.viewer, f.id)).contentType).toBe("application/pdf");
    expect((await employeeFileService.download(w.supervisorCtx, f.id)).body.byteLength).toBeGreaterThan(0);
    await expect(employeeFileService.download(w.otherCtx, f.id)).rejects.toBeInstanceOf(NotFoundError);

    const personal = await employeeFileService.upload(w.workerCtx, w.worker, { kind: "OTHER", displayName: "Oma dokumentti" }, PDF("x"));
    await expect(employeeFileService.download(w.supervisorCtx, personal.id)).rejects.toBeInstanceOf(NotFoundError);
    await employeeFileService.rename(w.workerCtx, personal.id, { displayName: "Uusi nimi" });
    await expect(employeeFileService.rename(w.supervisorCtx, f.id, { displayName: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await employeeFileService.archive(w.admin, personal.id);
    await expect(employeeFileService.download(w.workerCtx, personal.id)).rejects.toBeInstanceOf(NotFoundError);
    const list = await employeeFileService.list(w.workerCtx, w.worker);
    expect(list.map((x) => x.id)).toEqual([f.id]);
    expect(list[0]).toMatchObject({ createdByName: expect.any(String), sizeBytes: expect.any(Number) });
  });

  it("profile photo: images only, replaces the previous photo", async () => {
    await expect(employeeFileService.uploadPhoto(w.workerCtx, w.worker, PDF())).rejects.toMatchObject({ fieldErrors: { file: ["validation.imageOnly"] } });
    const p1 = await employeeFileService.uploadPhoto(w.workerCtx, w.worker, PNG());
    const p2 = await employeeFileService.uploadPhoto(w.admin, w.worker, PNG());
    const e = await db.employee.findUniqueOrThrow({ where: { id: w.worker } });
    expect(e.photoFileId).toBe(p2.id);
    expect((await db.employeeFile.findUniqueOrThrow({ where: { id: p1.id } })).archivedAt).not.toBeNull();
    expect((await employeeFileService.download(w.otherCtx, p2.id).catch((x) => x)) instanceof NotFoundError).toBe(true);
    await expect(employeeFileService.uploadPhoto(w.supervisorCtx, w.worker, PNG())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("orientations, languages, clothing and items", () => {
  it("orientation: supervisor records, employee acknowledges", async () => {
    const o = await orientationService.add(w.supervisorCtx, w.worker, { scope: "SITE", topic: "Työmaaperehdytys", target: "Kehä III", instructorName: "Sanna Testi" });
    await expect(orientationService.add(w.workerCtx, w.worker, { scope: "SITE", topic: "x", instructorName: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(orientationService.acknowledge(w.supervisorCtx, o.id)).rejects.toBeInstanceOf(ForbiddenError);
    const ack = await orientationService.acknowledge(w.workerCtx, o.id);
    expect(ack.acknowledgedAt).not.toBeNull();
    expect((await hrOverviewService.overview(w.admin)).openOrientations.some((x) => x.id === o.id)).toBe(true);
  });

  it("languages: self-report and supervisor assessment are separate; filter for crew planning", async () => {
    await languageService.save(w.workerCtx, w.worker, { language: "et", speaking: "NATIVE", understanding: "NATIVE", reading: "NATIVE", writing: "FLUENT", source: "SELF" });
    await languageService.save(w.supervisorCtx, w.worker, { language: "fi", speaking: "BASIC", understanding: "FLUENT", reading: "BASIC", writing: "BEGINNER", source: "SUPERVISOR" });
    await expect(languageService.save(w.workerCtx, w.worker, { language: "fi", speaking: "NATIVE", source: "SUPERVISOR" })).rejects.toBeInstanceOf(ForbiddenError);
    const fluentFi = await hrOverviewService.search(w.admin, { language: "fi", languageLevel: "FLUENT" });
    expect(fluentFi.employees.some((e) => e.id === w.worker)).toBe(false);
    const basicFi = await hrOverviewService.search(w.admin, { language: "fi", languageLevel: "BASIC" });
    expect(basicFi.employees.map((e) => e.id)).toContain(w.worker);
    const et = await hrOverviewService.search(w.admin, { language: "et", languageLevel: "NATIVE", team: "Putkitiimi" });
    expect(et.employees.map((e) => e.id)).toEqual([w.worker]);
  });

  it("search by competence level and valid card", async () => {
    const r = await hrOverviewService.search(w.admin, { areaId: w.area, minLevel: "3" });
    expect(r.employees.map((e) => e.id)).toEqual([w.worker]);
    expect((await hrOverviewService.search(w.admin, { areaId: w.area, minLevel: "4" })).employees).toHaveLength(0);
  });

  it("clothing hand-outs are kept; only cancelling is possible", async () => {
    const c = await clothingService.issue(w.admin, w.worker, { product: "Huomiotakki", size: "L", quantity: "1", issuedOn: "2026-09-01" });
    await expect(clothingService.issue(w.supervisorCtx, w.worker, { product: "x", issuedOn: "2026-09-01" })).rejects.toBeInstanceOf(ForbiddenError);
    await clothingService.cancel(w.admin, c.id);
    await expect(db.clothingIssue.update({ where: { id: c.id }, data: { product: "Muu" } })).rejects.toThrow(/only be cancelled/);
    const card = await hrCardService.get(w.workerCtx, w.worker);
    expect(card.equipment!.clothing.find((x) => x.id === c.id)?.archivedAt).not.toBeNull();
  });

  it("company items: receipt by the employee, return list when the employment ends, inspections due", async () => {
    const item = await companyItemService.add(w.admin, w.worker, { name: "Puhelin", itemType: "PHONE", brand: "Nokia", serialNumber: "IMEI-1", issuedOn: "2026-01-10", nextInspectionOn: "2026-01-01" });
    await expect(companyItemService.acknowledge(w.supervisorCtx, item.id)).rejects.toBeInstanceOf(NotFoundError);
    await companyItemService.acknowledge(w.workerCtx, item.id);
    await expect(companyItemService.update(w.workerCtx, item.id, { name: "Puhelin", itemType: "PHONE", issuedOn: "2026-01-10", status: "LOST" })).rejects.toBeInstanceOf(ForbiddenError);
    let o = await hrOverviewService.overview(w.admin);
    expect(o.inspectionsDue.some((x) => x.id === item.id && x.overdue)).toBe(true);
    expect(o.itemsToReturn.some((x) => x.id === item.id)).toBe(false);
    await employeeService.update(w.t.ownerCtx, w.worker, { employeeNumber: "W-1", firstName: "Ville", lastName: "Testi", email: "ville@example.test", userId: w.workerCtx.user.id, endDate: "2026-10-01" });
    o = await hrOverviewService.overview(w.admin);
    expect(o.itemsToReturn.some((x) => x.id === item.id)).toBe(true);
    // Not visible to the supervisor's overview.
    expect((await hrOverviewService.overview(w.supervisorCtx)).itemsToReturn).toEqual([]);
    await companyItemService.update(w.admin, item.id, { name: "Puhelin", itemType: "PHONE", issuedOn: "2026-01-10", status: "RETURNED", returnedOn: "2026-10-01" });
    expect((await hrOverviewService.overview(w.admin)).itemsToReturn.some((x) => x.id === item.id)).toBe(false);
  });
});

describe("job requirements", () => {
  it("shows gaps against the job profile", async () => {
    const type = await qualificationTypeService.create(w.admin, { name: "Tieturva 2" });
    const profile = await jobProfileService.create(w.admin, { name: "Putkiasentaja" });
    await jobProfileService.addRequirement(w.admin, profile.id, { kind: "COMPETENCE", areaId: w.area, minLevel: "4" });
    await jobProfileService.addRequirement(w.admin, profile.id, { kind: "QUALIFICATION", qualificationTypeId: type.id });
    await jobProfileService.addRequirement(w.admin, profile.id, { kind: "ORIENTATION", orientationScope: "SITE", orientationTopic: "työmaaperehdytys" });
    await hrCardService.updateEmployment(w.admin, w.other, { jobProfileId: profile.id });
    const card = await hrCardService.get(w.admin, w.other);
    expect(card.work!.gaps.map((g) => g.reason).sort()).toEqual(["MISSING", "NOT_ASSESSED", "NOT_DONE"]);
    const overview = await hrOverviewService.overview(w.admin);
    expect(overview.gaps.find((g) => g.employee.id === w.other)?.gaps).toHaveLength(3);
    await expect(jobProfileService.addRequirement(w.admin, profile.id, { kind: "COMPETENCE", areaId: w.area })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("suggested catalogues", () => {
  it("adds the suggested competence areas and card types once", async () => {
    const t = await createTenant("Suggest");
    const first = await competenceAreaService.addSuggested(t.ownerCtx);
    expect(first.added).toBeGreaterThan(15);
    expect((await competenceAreaService.addSuggested(t.ownerCtx)).added).toBe(0);
    expect((await qualificationTypeService.addSuggested(t.ownerCtx)).added).toBeGreaterThan(8);
    expect((await qualificationTypeService.addSuggested(t.ownerCtx)).added).toBe(0);
  });
});

describe("HR authorization matrix (role template × action, no supervisor or own-card link)", () => {
  type Outcome = "✓" | "B" | "F" | "N";
  const ROLES = ["CEO", "PROJECT_DIRECTOR", "PROJECT_MANAGER", "SITE_MANAGER", "SUPERVISOR", "LOGISTICS_COORDINATOR", "HSE", "EMPLOYEE", "SUBCONTRACTOR", "CLIENT", "LIFTING_SUPERVISOR", "CLIENT_APPROVER", "HR_ADMIN"] as const;
  // ✓ allowed · B basic employee data only · F 403 · N 404
  const MATRIX: Record<string, Outcome[]> = {
    //                          CEO  PD   PM   SM   SUP  LOG  HSE  EMP  SUB  CLI  LIFT CA   HR
    "view card HR data":       ["✓", "✓", "✓", "✓", "B", "B", "✓", "N", "N", "N", "B", "N", "✓"],
    "competence matrix":       ["✓", "✓", "✓", "✓", "F", "F", "✓", "F", "F", "F", "F", "F", "✓"],
    "manage competence areas": ["✓", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F", "F", "✓"],
    "assess competence":       ["✓", "F", "F", "F", "N", "N", "F", "N", "N", "N", "N", "N", "✓"],
    "issue work clothing":     ["✓", "F", "F", "F", "N", "N", "F", "N", "N", "N", "N", "N", "✓"],
    "download card attachment":["✓", "✓", "✓", "✓", "N", "N", "✓", "N", "N", "N", "N", "N", "✓"],
  };

  let t: Tenant;
  let employee: string;
  let area: string;
  let file: string;
  const ctxs = new Map<string, RequestContext>();

  beforeAll(async () => {
    t = await createTenant("HrMatrix");
    employee = (await employeeService.create(t.ownerCtx, { employeeNumber: "M-1", firstName: "Matti", lastName: "Matriisi" })).id;
    area = (await competenceAreaService.create(t.ownerCtx, { category: "A", name: "Alue", isKey: true })).id;
    const q = await qualificationService.add(t.ownerCtx, employee, { name: "Kortti", noExpiry: "on" });
    file = (await employeeFileService.upload(t.ownerCtx, employee, { kind: "CARD_IMAGE", targetType: "QUALIFICATION", targetId: q.id }, PDF())).id;
    for (const role of ROLES) ctxs.set(role, role === "CEO" ? t.ownerCtx : await createMember(t, role));
  });

  const ACTIONS: Record<string, (c: RequestContext) => Promise<unknown>> = {
    "view card HR data": async (c) => {
      const card = await hrCardService.get(c, employee);
      return card.work ? "✓" : "B";
    },
    "competence matrix": (c) => hrOverviewService.matrix(c),
    "manage competence areas": (c) => competenceAreaService.create(c, { category: "M", name: `x-${Math.random()}` }),
    "assess competence": (c) => assessmentService.create(c, employee, { areaId: area, level: "2", assessedOn: "2026-10-01" }),
    "issue work clothing": (c) => clothingService.issue(c, employee, { product: "Takki", issuedOn: "2026-10-01" }),
    "download card attachment": (c) => employeeFileService.download(c, file),
  };

  const rows = Object.keys(MATRIX).flatMap((action) => ROLES.map((role, i) => ({ action, role, expected: MATRIX[action][i] })));
  it.each(rows)("$role: $action → $expected", async ({ action, role, expected }) => {
    const outcome = await ACTIONS[action](ctxs.get(role)!).then(
      (r) => (r === "B" ? "B" : "✓"),
      (e) => (e instanceof ForbiddenError ? "F" : e instanceof NotFoundError ? "N" : `error: ${e}`),
    );
    expect(outcome).toBe(expected);
  });
});
