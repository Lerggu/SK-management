import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError } from "@/platform/errors";
import { diaryService } from "@/modules/diary/service";
import { timesheetService } from "@/modules/timesheets/service";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { auditFor, createMember, createTenant } from "../helpers/fixtures";

async function setup() {
  const t = await createTenant("Diary");
  const project = await projectService.create(t.ownerCtx, { code: "D", name: "Diary project" });
  const site = await siteService.create(t.ownerCtx, project.id, { name: "Hall A" });
  const supervisor = await createMember(t, "SUPERVISOR", [{ projectId: project.id }]);
  const emp = await employeeService.create(t.ownerCtx, { employeeNumber: "E1", firstName: "Eeva", lastName: "Esimerkki" });
  const type = await equipmentTypeService.create(t.ownerCtx, { name: "Crane" });
  const crane = await equipmentService.create(t.ownerCtx, { equipmentTypeId: type.id, assetNumber: "C1", name: "Crane" });
  return { t, project, site, supervisor, emp, crane };
}

describe("site diary", () => {
  it("draft from structured data → sign → locked with attendance snapshot; addenda audited", async () => {
    const s = await setup();
    await timesheetService.createCrew(s.supervisor, { employeeIds: [s.emp.id], projectId: s.project.id, siteId: s.site.id, workDate: "2026-03-04", hours: "8" });
    const r = await diaryService.open(s.supervisor, { siteId: s.site.id, date: "2026-03-04" });
    expect((await diaryService.open(s.supervisor, { siteId: s.site.id, date: "2026-03-04" })).id).toBe(r.id);
    await diaryService.update(s.supervisor, r.id, { weather: "Pakkasta -5", summary: "Kaapelointi etenee" });
    await diaryService.addEntry(s.supervisor, r.id, { kind: "WORK", description: "Kaapelihyllyt asennettu" });
    await diaryService.addEntry(s.supervisor, r.id, { kind: "EQUIPMENT", equipmentId: s.crane.id, hours: "3,5" });
    await diaryService.addAttachment(s.supervisor, r.id, { caption: "Hylly" }, { fileName: "kuva.jpg", bytes: new Uint8Array([255, 216, 255, 1]) });
    const draft = await diaryService.get(s.supervisor, r.id);
    expect(draft.attendance).toEqual([expect.objectContaining({ name: "Esimerkki Eeva", hours: "8.00" })]);

    await diaryService.sign(s.supervisor, r.id);
    // More hours after signing do not change the frozen attendance.
    await timesheetService.createCrew(s.supervisor, { employeeIds: [s.emp.id], projectId: s.project.id, siteId: s.site.id, workDate: "2026-03-04", hours: "2" });
    const signed = await diaryService.get(s.supervisor, r.id);
    expect(signed.status).toBe("SIGNED");
    expect(signed.attendance[0].hours).toBe("8.00");

    await expect(diaryService.update(s.supervisor, r.id, { summary: "muutettu" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.diarySigned"] } });
    await expect(db.dailyReport.update({ where: { id: r.id }, data: { summary: "tampered" } })).rejects.toThrow(/locked/);
    const entryId = signed.entries[0].id;
    await expect(db.dailyReportEntry.delete({ where: { id: entryId } })).rejects.toThrow(/signed/);

    const addendum = await diaryService.addEntry(s.supervisor, r.id, { kind: "INSTRUCTION", description: "Lisäys: asiakas pyysi muutosta" });
    expect(addendum.isAddendum).toBe(true);
    expect((await auditFor(s.t.companyId, addendum.id))[0].action).toBe("daily_report.addendum");
    expect((await auditFor(s.t.companyId, r.id)).map((a) => a.action)).toEqual(["daily_report.create", "daily_report.update", "daily_report.sign"]);
  });

  it("employees can read but not write; outsiders cannot see", async () => {
    const s = await setup();
    const r = await diaryService.open(s.supervisor, { siteId: s.site.id, date: "2026-03-04" });
    const worker = await createMember(s.t, "EMPLOYEE", [{ projectId: s.project.id }]);
    expect((await diaryService.get(worker, r.id)).id).toBe(r.id);
    await expect(diaryService.addEntry(worker, r.id, { kind: "WORK", description: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(diaryService.sign(worker, r.id)).rejects.toBeInstanceOf(ForbiddenError);
    const client = await createMember(s.t, "CLIENT", [{ projectId: s.project.id }]);
    await expect(diaryService.get(client, r.id)).rejects.toBeInstanceOf(NotFoundError);
    const unassigned = await createMember(s.t, "SUPERVISOR");
    await expect(diaryService.get(unassigned, r.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only photos and PDFs are accepted as attachments", async () => {
    const s = await setup();
    const r = await diaryService.open(s.supervisor, { siteId: s.site.id, date: "2026-03-04" });
    await expect(diaryService.addAttachment(s.supervisor, r.id, {}, { fileName: "x.docx", bytes: new Uint8Array([1]) })).rejects.toMatchObject({
      fieldErrors: { file: ["validation.imageType"] },
    });
  });
});
