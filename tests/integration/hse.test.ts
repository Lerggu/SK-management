import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { getMailer, type MemoryMailer } from "@/platform/mail";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { timesheetService } from "@/modules/timesheets/service";
import { hseActionService, hseObservationService, hseOverviewService, hsePhotoService, incidentService } from "@/modules/hse/hse.service";
import { hseInspectionService, riskAssessmentService, toolboxTalkService, workPermitService } from "@/modules/hse/planning.service";
import { auditFor, createMember, createTenant } from "../helpers/fixtures";

const jpeg = (name = "kuva.jpg") => ({ fileName: name, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) });
const mailbox = () => getMailer() as MemoryMailer;

async function setup() {
  const t = await createTenant("Hse");
  const project = await projectService.create(t.ownerCtx, { code: "H", name: "HSE project" });
  const site = await siteService.create(t.ownerCtx, project.id, { name: "Site H" });
  const assigned = [{ projectId: project.id }];
  const emp = await createMember(t, "EMPLOYEE", assigned);
  const sm = await createMember(t, "SITE_MANAGER", assigned);
  const pm = await createMember(t, "PROJECT_MANAGER", assigned);
  const hse = await createMember(t, "HSE", assigned);
  const pd = await createMember(t, "PROJECT_DIRECTOR");
  const sub = await createMember(t, "SUBCONTRACTOR", assigned);
  const sub2 = await createMember(t, "SUBCONTRACTOR", assigned);
  return { t, project, site, emp, sm, pm, hse, pd, sub, sub2 };
}

describe("acceptance 1: anyone on site reports from the phone, with a photo", () => {
  it("employee and subcontractor report; numbering is per project; photos are images only and append-only", async () => {
    const s = await setup();
    const o1 = await hseObservationService.create(s.emp, { projectId: s.project.id, siteId: s.site.id, kind: "NEAR_MISS", category: "LIFTING", title: "Taakka heilahti", occurredAt: "2026-10-01T08:15" });
    const o2 = await hseObservationService.create(s.sub, { projectId: s.project.id, kind: "SAFETY_OBSERVATION", title: "Kaide puuttuu", occurredAt: "2026-10-01T09:00" });
    expect([o1.number, o2.number]).toEqual([1, 2]);
    expect(o2.reportedByExternal).toBe(true);
    const photo = await hsePhotoService.add(s.sub, { recordType: "OBSERVATION", recordId: o2.id }, jpeg());
    expect(photo.sizeBytes).toBe(8);
    expect((await hsePhotoService.download(s.sub, photo.id)).contentType).toBe("image/jpeg");
    await expect(hsePhotoService.add(s.sub, { recordType: "OBSERVATION", recordId: o2.id }, { fileName: "x.pdf", bytes: new Uint8Array([1]) })).rejects.toMatchObject({ fieldErrors: { file: ["validation.imageOnly"] } });
    // Someone else's record: invisible to the subcontractor; employees cannot add photos to others' reports.
    await expect(hsePhotoService.add(s.sub, { recordType: "OBSERVATION", recordId: o1.id }, jpeg())).rejects.toBeInstanceOf(NotFoundError);
    await expect(hsePhotoService.add(s.emp, { recordType: "OBSERVATION", recordId: o2.id }, jpeg())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(db.hsePhoto.delete({ where: { id: photo.id } })).rejects.toThrow(/append-only/);
    // Reports in the future are rejected.
    await expect(hseObservationService.create(s.emp, { projectId: s.project.id, kind: "NEAR_MISS", title: "x", occurredAt: "2099-01-01T08:00" })).rejects.toMatchObject({ fieldErrors: { occurredAt: ["validation.notFuture"] } });
  });
});

describe("acceptance 8: subcontractors see only their own reports and permits", () => {
  it("own-only register and 404 for other people's records", async () => {
    const s = await setup();
    const mine = await incidentService.report(s.sub, { projectId: s.project.id, type: "PROPERTY_DAMAGE", severity: "FIRST_AID", title: "Peili rikki", occurredAt: "2026-10-01T10:00" });
    const theirs = await incidentService.report(s.sub2, { projectId: s.project.id, type: "PROPERTY_DAMAGE", severity: "FIRST_AID", title: "Toisen ilmoitus", occurredAt: "2026-10-01T10:00" });
    const internal = await hseObservationService.create(s.emp, { projectId: s.project.id, kind: "NEAR_MISS", title: "Sisäinen", occurredAt: "2026-10-01T08:00" });
    const permit = await workPermitService.request(s.sub, { projectId: s.project.id, type: "HOT_WORK", description: "Hitsaus", contractor: "Ali Oy", validFrom: "2026-11-02T07:00", validTo: "2026-11-02T15:00" });
    const reg = await hseOverviewService.register(s.sub, s.project.id);
    expect(reg.can.ownOnly).toBe(true);
    expect(reg.incidents.map((i) => i.id)).toEqual([mine.id]);
    expect(reg.observations).toEqual([]);
    expect(reg.permits.map((p) => p.id)).toEqual([permit.id]);
    expect(reg.metrics).toBeNull();
    expect(reg.actions).toEqual([]);
    expect(reg.members).toEqual([]);
    await expect(incidentService.get(s.sub, theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(hseObservationService.get(s.sub, internal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(hseOverviewService.metrics(s.sub, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
    // Own record is readable but carries no investigation results.
    const own = await incidentService.get(s.sub, mine.id);
    expect(own.ownOnly).toBe(true);
    expect(own.persons).toBeNull();
    // Internal register sees everything.
    const full = await hseOverviewService.register(s.sm, s.project.id);
    expect(full.incidents.map((i) => i.id).sort()).toEqual([mine.id, theirs.id].sort());
  });
});

describe("acceptance 2: incident workflow, notifications and closing rules", () => {
  it("serious incident: immediate notification without personal data; investigation and approved actions before closing", async () => {
    const s = await setup();
    const before = mailbox().sent.length;
    const inc = await incidentService.report(s.emp, { projectId: s.project.id, siteId: s.site.id, type: "INJURY", severity: "SERIOUS", title: "Putoaminen telineeltä", description: "Työntekijä putosi 2 m", occurredAt: "2026-10-02T13:20" });
    // hse.serious.notify holders on the project: owner (CEO), the PD and HSE — not the SM or PM.
    const sent = mailbox().sent.slice(before);
    const recipients = sent.map((m) => m.to).sort();
    expect(recipients).toEqual([s.t.owner.user.email, s.pd.user.email, s.hse.user.email].sort());
    for (const m of sent) {
      expect(m.subject).toContain("#1");
      expect(m.text).toContain(`/hse/incidents/${inc.id}`);
      expect(m.text).not.toContain("Putoaminen");
      expect(m.text).not.toContain("2 m");
    }
    expect((await db.incident.findUniqueOrThrow({ where: { id: inc.id } })).notifiedAt).not.toBeNull();
    expect((await hseOverviewService.urgent(s.pd)).map((u) => u.id)).toContain(inc.id);
    expect(await hseOverviewService.urgent(s.sm)).toEqual([]);

    // Triage by the Site Manager; the employee cannot triage.
    await expect(incidentService.triage(s.emp, inc.id, { type: "INJURY", severity: "SERIOUS" })).rejects.toBeInstanceOf(ForbiddenError);
    await incidentService.triage(s.sm, inc.id, { type: "INJURY", severity: "SERIOUS", immediateActions: "Alue eristetty" });
    // Serious → closing requires hse.investigate and an investigation.
    await expect(incidentService.close(s.sm, inc.id, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(incidentService.close(s.hse, inc.id, {})).rejects.toMatchObject({ fieldErrors: { _form: ["validation.incidentInvestigationRequired"] } });
    await expect(db.incident.update({ where: { id: inc.id }, data: { status: "CLOSED" } })).rejects.toThrow(/investigation/);
    await expect(incidentService.startInvestigation(s.pm, inc.id)).rejects.toBeInstanceOf(ForbiddenError);
    await incidentService.startInvestigation(s.hse, inc.id);
    await incidentService.recordInvestigation(s.hse, inc.id, { rootCause: "Kaide irrotettu ilman lupaa", lostDays: "12" });

    // Corrective action: assigned by the SM, done by the assignee, approved by the PM.
    const action = await hseActionService.create(s.sm, { sourceType: "INCIDENT", sourceId: inc.id, title: "Telineen tarkastus ennen käyttöä", assigneeId: s.emp.user.id, dueDate: "2026-10-09" });
    await expect(incidentService.close(s.hse, inc.id, {})).rejects.toMatchObject({ fieldErrors: { _form: ["validation.incidentActionsUnapproved"] } });
    await expect(db.incident.update({ where: { id: inc.id }, data: { status: "CLOSED" } })).rejects.toThrow(/corrective actions/);
    await expect(hseActionService.markDone(s.sub, action.id, {})).rejects.toBeInstanceOf(NotFoundError);
    await hseActionService.markDone(s.emp, action.id, { note: "Tarkastuslista käyttöön" });
    await expect(hseActionService.verify(s.sm, action.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(hseActionService.verify(s.hse, action.id)).rejects.toBeInstanceOf(ForbiddenError);
    await hseActionService.verify(s.pm, action.id);
    await expect(db.hseAction.update({ where: { id: action.id }, data: { status: "OPEN" } })).rejects.toThrow(/final/);

    await incidentService.close(s.hse, inc.id, { note: "Toimenpiteet tehty" });
    await expect(incidentService.triage(s.sm, inc.id, { type: "INJURY", severity: "FIRST_AID" })).rejects.toBeInstanceOf(ValidationError);
    await expect(db.incident.update({ where: { id: inc.id }, data: { title: "muutettu" } })).rejects.toThrow(/final/);
    await expect(db.incident.delete({ where: { id: inc.id } })).rejects.toThrow(/cannot be deleted/);
    const actions = (await auditFor(s.t.companyId, inc.id)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["incident.report", "incident.notify", "incident.triage", "incident.investigation_start", "incident.investigation_update", "incident.close"]));
  });

  it("minor incident: closed by the Site Manager after triage; a severity raise at triage notifies once", async () => {
    const s = await setup();
    const minor = await incidentService.report(s.emp, { projectId: s.project.id, type: "INJURY", severity: "FIRST_AID", title: "Viilto sormeen", occurredAt: "2026-10-02T08:00" });
    const before = mailbox().sent.length;
    await incidentService.triage(s.sm, minor.id, { type: "INJURY", severity: "FIRST_AID" });
    expect(mailbox().sent.length).toBe(before);
    await incidentService.close(s.sm, minor.id, {});

    const raised = await incidentService.report(s.emp, { projectId: s.project.id, type: "INJURY", severity: "MEDICAL_TREATMENT", title: "Nilkka", occurredAt: "2026-10-02T09:00" });
    await incidentService.triage(s.sm, raised.id, { type: "INJURY", severity: "LOST_TIME" });
    expect(mailbox().sent.length).toBe(before + 3);
    expect((await auditFor(s.t.companyId, raised.id)).filter((a) => a.action === "incident.notify")).toHaveLength(1);
  });
});

describe("acceptance 3: injured-person data", () => {
  it("visible only with hse.personal.view and masked in audit", async () => {
    const s = await setup();
    const employee = await employeeService.create(s.t.ownerCtx, { employeeNumber: "H-1", firstName: "Matti", lastName: "Meikäläinen" });
    const inc = await incidentService.report(s.emp, { projectId: s.project.id, type: "INJURY", severity: "MEDICAL_TREATMENT", title: "Liukastuminen", occurredAt: "2026-10-02T08:00" });
    await incidentService.triage(s.sm, inc.id, { type: "INJURY", severity: "MEDICAL_TREATMENT" });
    await expect(incidentService.addPerson(s.sm, inc.id, { personName: "Matti Meikäläinen" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(incidentService.addPerson(s.pm, inc.id, { personName: "Matti Meikäläinen" })).rejects.toBeInstanceOf(ForbiddenError);
    const person = await incidentService.addPerson(s.hse, inc.id, { personName: "Matti Meikäläinen", employeeId: employee.id, injuryDescription: "Ranne nyrjähti", bodyPart: "Ranne", absenceDays: "3" });
    expect((await incidentService.get(s.hse, inc.id)).persons).toHaveLength(1);
    expect((await incidentService.get(s.sm, inc.id)).persons).toBeNull();
    expect((await incidentService.get(s.emp, inc.id)).persons).toBeNull();
    const audit = await auditFor(s.t.companyId, person.id);
    const after = JSON.stringify(audit[0].after);
    expect(after).not.toContain("Matti");
    expect(after).not.toContain("Ranne");
    expect(after).toContain("[MASKED]");
  });
});

describe("acceptance 4: permits and risk assessments are never approved by their author", () => {
  it("permit: requested by a subcontractor, decided by the SM, closed by the requester", async () => {
    const s = await setup();
    const p = await workPermitService.request(s.sub, { projectId: s.project.id, siteId: s.site.id, type: "CONFINED_SPACE", description: "Kaivo", validFrom: "2026-11-02T07:00", validTo: "2026-11-02T15:00" });
    expect(p.requestedByExternal).toBe(true);
    await expect(workPermitService.decide(s.sub, p.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(workPermitService.decide(s.pm, p.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(workPermitService.decide(s.sm, p.id, { decision: "REJECT" })).rejects.toMatchObject({ fieldErrors: { note: ["validation.required"] } });
    await workPermitService.decide(s.sm, p.id, { decision: "APPROVE", note: "Kaasumittaus tehty" });
    await expect(db.workPermit.update({ where: { id: p.id }, data: { validTo: new Date("2026-12-01") } })).rejects.toThrow(/frozen/);
    await workPermitService.close(s.sub, p.id);
    // The SM's own permit cannot be self-approved — in the service and in the database.
    const own = await workPermitService.request(s.sm, { projectId: s.project.id, type: "HOT_WORK", description: "Leikkaus", validFrom: "2026-11-03T07:00", validTo: "2026-11-03T09:00" });
    await expect(workPermitService.decide(s.sm, own.id, { decision: "APPROVE" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.hseSelfApproval"] } });
    await expect(db.workPermit.update({ where: { id: own.id }, data: { status: "APPROVED", decidedById: s.sm.user.id } })).rejects.toThrow(/requester/);
    await expect(workPermitService.request(s.sm, { projectId: s.project.id, type: "OTHER", description: "x", validFrom: "2026-11-03T07:00", validTo: "2026-11-30T07:00" })).rejects.toMatchObject({ fieldErrors: { validTo: ["validation.permitTooLong"] } });
  });

  it("risk assessment: scored items, approval by another manager, frozen afterwards", async () => {
    const s = await setup();
    const r = await riskAssessmentService.create(s.sm, { projectId: s.project.id, siteId: s.site.id, title: "Kaapelikelan nosto", workDescription: "Nosto autonosturilla" });
    await expect(riskAssessmentService.approve(s.hse, r.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.riskAssessmentEmpty"] } });
    const item = await riskAssessmentService.addItem(s.sm, r.id, { hazard: "Taakan putoaminen", likelihood: "2", consequence: "5", controls: "Nostoalue eristetty", residualLikelihood: "1", residualConsequence: "5" });
    const got = await riskAssessmentService.get(s.sm, r.id);
    expect(got.items[0]).toMatchObject({ score: 10, level: "HIGH", residualScore: 5, residualLevel: "MEDIUM" });
    expect(got.can.selfApprovalBlocked).toBe(true);
    await expect(riskAssessmentService.approve(s.sm, r.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.hseSelfApproval"] } });
    await expect(riskAssessmentService.approve(s.emp, r.id)).rejects.toBeInstanceOf(ForbiddenError);
    await riskAssessmentService.approve(s.hse, r.id);
    await expect(riskAssessmentService.addItem(s.sm, r.id, { hazard: "x", likelihood: "1", consequence: "1" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.riskAssessmentLocked"] } });
    await expect(db.riskAssessmentItem.update({ where: { id: item.id }, data: { likelihood: 1 } })).rejects.toThrow(/draft/);
    await expect(db.riskAssessment.update({ where: { id: r.id }, data: { title: "x" } })).rejects.toThrow(/frozen/);
    await expect(db.riskAssessmentItem.create({ data: { companyId: s.t.companyId, riskAssessmentId: r.id, position: 9, hazard: "x", likelihood: 6, consequence: 1 } })).rejects.toThrow();
    await riskAssessmentService.archive(s.sm, r.id);
  });
});

describe("acceptance 5: key figures from approved hours", () => {
  it("LTIF, report rate, MVR index, toolbox talks and overdue actions", async () => {
    const s = await setup();
    const worker = await employeeService.create(s.t.ownerCtx, { employeeNumber: "H-2", firstName: "Työ", lastName: "Läinen" });
    // 3 × 8 h approved = 24 h of own people's hours.
    for (const date of ["2026-09-28", "2026-09-29", "2026-09-30"]) {
      const [e] = await timesheetService.createCrew(s.t.ownerCtx, { employeeIds: [worker.id], projectId: s.project.id, workDate: date, hours: "8" });
      await timesheetService.submitWeek(s.t.ownerCtx, { employeeId: worker.id, date });
      await timesheetService.decide(s.pm, { entryIds: [e.id], decision: "APPROVE" });
    }
    await hseObservationService.create(s.emp, { projectId: s.project.id, kind: "NEAR_MISS", title: "LP", occurredAt: "2026-09-30T08:00" });
    await hseObservationService.create(s.emp, { projectId: s.project.id, kind: "SAFETY_OBSERVATION", title: "SH", occurredAt: "2026-09-30T08:00" });
    const lti = await incidentService.report(s.emp, { projectId: s.project.id, type: "INJURY", severity: "LOST_TIME", title: "LTI", occurredAt: "2026-09-30T08:00" });
    await incidentService.triage(s.sm, lti.id, { type: "INJURY", severity: "LOST_TIME" });
    await hseActionService.create(s.sm, { sourceType: "INCIDENT", sourceId: lti.id, title: "Myöhässä", dueDate: "2026-01-01" });
    await toolboxTalkService.create(s.sm, { projectId: s.project.id, heldOn: "2026-09-29", topic: "Nostot", attendeeCount: "11" });
    await hseInspectionService.create(s.sm, { projectId: s.project.id, kind: "MVR", inspectedOn: "2026-09-22", correctCount: "80", incorrectCount: "20" });
    await hseInspectionService.create(s.hse, { projectId: s.project.id, kind: "MVR", inspectedOn: "2026-09-29", correctCount: "93", incorrectCount: "7" });
    await expect(hseInspectionService.create(s.emp, { projectId: s.project.id, kind: "MVR", inspectedOn: "2026-09-29", correctCount: "1", incorrectCount: "0" })).rejects.toBeInstanceOf(ForbiddenError);
    const m = await hseOverviewService.metrics(s.pm, s.project.id);
    expect(m).toMatchObject({
      hours: 24,
      safetyObservations: 1,
      nearMisses: 1,
      lostTimeInjuries: 1,
      ltif: 41666.7,
      reportRate: 83.33,
      openActions: 1,
      overdueActions: 1,
      toolboxTalks: 1,
      toolboxAttendees: 11,
      latestInspectionIndex: 93,
    });
    expect(m.inspectionTrend.map((x) => x.index)).toEqual([80, 93]);
  });
});

describe("observation workflow", () => {
  it("triage and close; closing waits for open actions", async () => {
    const s = await setup();
    const o = await hseObservationService.create(s.emp, { projectId: s.project.id, kind: "SAFETY_OBSERVATION", title: "Kypärä puuttuu", occurredAt: "2026-10-01T08:00" });
    await hseObservationService.triage(s.sm, o.id, { category: "PPE", severity: "MEDIUM" });
    const a = await hseActionService.create(s.sm, { sourceType: "OBSERVATION", sourceId: o.id, title: "Perehdytys" });
    await expect(hseObservationService.close(s.sm, o.id, {})).rejects.toMatchObject({ fieldErrors: { _form: ["validation.hseActionsOpen"] } });
    await hseActionService.markDone(s.sm, a.id, {});
    // Non-incident actions are verified with hse.manage.
    await hseActionService.verify(s.sm, a.id);
    await hseObservationService.close(s.sm, o.id, { note: "OK" });
    await expect(hseActionService.create(s.sm, { sourceType: "OBSERVATION", sourceId: o.id, title: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(db.hseObservation.update({ where: { id: o.id }, data: { status: "OPEN" } })).rejects.toThrow(/final/);
    await expect(hsePhotoService.add(s.emp, { recordType: "OBSERVATION", recordId: o.id }, jpeg())).rejects.toBeInstanceOf(ValidationError);
  });
});
