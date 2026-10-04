import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, ValidationError } from "@/platform/errors";
import { timesheetService } from "@/modules/timesheets/service";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { auditFor, contextFor, createMember, createTenant } from "../helpers/fixtures";

async function setup() {
  const t = await createTenant("Time");
  const project = await projectService.create(t.ownerCtx, { code: "T", name: "Time project" });
  const site = await siteService.create(t.ownerCtx, project.id, { name: "Site" });
  const worker = await createMember(t, "EMPLOYEE", [{ projectId: project.id }]);
  const workerEmp = await employeeService.create(t.ownerCtx, { employeeNumber: "W1", firstName: "Wille", lastName: "Worker", userId: worker.user.id });
  const supervisor = await createMember(t, "SUPERVISOR", [{ projectId: project.id }]);
  const siteManager = await createMember(t, "SITE_MANAGER", [{ projectId: project.id }]);
  const other = await employeeService.create(t.ownerCtx, { employeeNumber: "W2", firstName: "Olli", lastName: "Other" });
  return { t, project, site, worker: await contextFor(t, worker.user.id), workerEmp, supervisor, siteManager, other };
}

describe("time tracking", () => {
  it("own entry with start/end → weekly submit → approve; approved entry is locked", async () => {
    const s = await setup();
    const e = await timesheetService.create(s.worker, { projectId: s.project.id, siteId: s.site.id, workDate: "2026-03-04", startTime: "07:00", endTime: "15:30" });
    expect(e.hours.toString()).toBe("8.5");
    expect(e.employeeId).toBe(s.workerEmp.id);
    expect((await timesheetService.submitWeek(s.worker, { date: "2026-03-08" })).submitted).toBe(1);
    await expect(timesheetService.update(s.worker, e.id, { projectId: s.project.id, workDate: "2026-03-04", hours: "9" })).rejects.toMatchObject({
      fieldErrors: { _form: ["validation.entryLocked"] },
    });
    await timesheetService.decide(s.siteManager, { entryIds: [e.id], decision: "APPROVE" });
    // DB trigger: approved rows cannot be changed or deleted
    await expect(db.timeEntry.update({ where: { id: e.id }, data: { hours: "1" } })).rejects.toThrow(/locked/);
    await expect(db.timeEntry.delete({ where: { id: e.id } })).rejects.toThrow(/cannot be deleted/);
    const actions = (await auditFor(s.t.companyId, e.id)).map((a) => a.action);
    expect(actions).toEqual(["time_entry.create", "time_entry.submit", "time_entry.approve"]);
  });

  it("workers enter only their own hours; supervisors enter crew hours", async () => {
    const s = await setup();
    await expect(timesheetService.create(s.worker, { employeeId: s.other.id, projectId: s.project.id, workDate: "2026-03-04", hours: "8" })).rejects.toBeInstanceOf(ForbiddenError);
    const crew = await timesheetService.createCrew(s.supervisor, { employeeIds: [s.workerEmp.id, s.other.id], projectId: s.project.id, siteId: s.site.id, workDate: "2026-03-04", hours: "7,5" });
    expect(crew.map((c) => c.hours.toString())).toEqual(["7.5", "7.5"]);
    await expect(timesheetService.createCrew(s.worker, { employeeIds: [s.other.id], projectId: s.project.id, workDate: "2026-03-04", hours: "8" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("nobody approves their own hours; supervisors cannot approve", async () => {
    const s = await setup();
    const smEmp = await employeeService.create(s.t.ownerCtx, { employeeNumber: "SM", firstName: "Sami", lastName: "Site", userId: s.siteManager.user.id });
    const own = await timesheetService.create(s.siteManager, { projectId: s.project.id, workDate: "2026-03-04", hours: "8" });
    expect(own.employeeId).toBe(smEmp.id);
    await timesheetService.submitWeek(s.siteManager, { date: "2026-03-04" });
    await expect(timesheetService.decide(s.siteManager, { entryIds: [own.id], decision: "APPROVE" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.selfApproval"] } });
    await expect(timesheetService.decide(s.supervisor, { entryIds: [own.id], decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
    await timesheetService.decide(s.t.ownerCtx, { entryIds: [own.id], decision: "APPROVE" });
  });

  it("rejection needs a reason; rejected entries can be fixed and resubmitted", async () => {
    const s = await setup();
    const e = await timesheetService.create(s.worker, { projectId: s.project.id, workDate: "2026-03-04", hours: "12" });
    await timesheetService.submitWeek(s.worker, { date: "2026-03-04" });
    await expect(timesheetService.decide(s.siteManager, { entryIds: [e.id], decision: "REJECT" })).rejects.toBeInstanceOf(ValidationError);
    await timesheetService.decide(s.siteManager, { entryIds: [e.id], decision: "REJECT", reason: "Liikaa tunteja" });
    const fixed = await timesheetService.update(s.worker, e.id, { projectId: s.project.id, workDate: "2026-03-04", hours: "8" });
    expect(fixed.status).toBe("DRAFT");
    expect(fixed.rejectionReason).toBeNull();
    expect((await timesheetService.submitWeek(s.worker, { date: "2026-03-04" })).submitted).toBe(1);
  });

  it("corrections of approved hours are separate audited entries that need approval", async () => {
    const s = await setup();
    const e = await timesheetService.create(s.worker, { projectId: s.project.id, workDate: "2026-03-04", hours: "8" });
    await timesheetService.submitWeek(s.worker, { date: "2026-03-04" });
    await timesheetService.decide(s.siteManager, { entryIds: [e.id], decision: "APPROVE" });
    await expect(timesheetService.createCorrection(s.worker, e.id, { hours: "-1", note: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const fix = await timesheetService.createCorrection(s.supervisor, e.id, { hours: "-0,5", note: "Lounastauko unohtui" });
    expect(fix.status).toBe("SUBMITTED");
    expect(fix.hours.toString()).toBe("-0.5");
    expect(fix.correctionOfId).toBe(e.id);
    await expect(timesheetService.createCorrection(s.supervisor, fix.id, { hours: "1", note: "x" })).rejects.toBeInstanceOf(ValidationError);
    await timesheetService.decide(s.siteManager, { entryIds: [fix.id], decision: "APPROVE" });
    const audit = await auditFor(s.t.companyId, fix.id);
    expect(audit[0]).toMatchObject({ action: "time_entry.correction" });
  });

  it("export marks approved hours EXPORTED once, with CSV rows", async () => {
    const s = await setup();
    const e = await timesheetService.create(s.worker, { projectId: s.project.id, workDate: "2026-03-04", hours: "8", workClass: "OVERTIME_50" });
    await timesheetService.submitWeek(s.worker, { date: "2026-03-04" });
    await timesheetService.decide(s.siteManager, { entryIds: [e.id], decision: "APPROVE" });
    await expect(timesheetService.exportApproved(s.siteManager, { from: "2026-03-01", to: "2026-03-31" })).rejects.toBeInstanceOf(ForbiddenError);
    const batch = await timesheetService.exportApproved(s.t.ownerCtx, { from: "2026-03-01", to: "2026-03-31" });
    expect(batch.count).toBe(1);
    const rows = await timesheetService.exportRows(s.t.ownerCtx, batch.batchId);
    expect(rows[0]).toMatchObject({ employeeNumber: "W1", hours: "8", workClass: "OVERTIME_50", projectCode: "T" });
    await expect(timesheetService.exportApproved(s.t.ownerCtx, { from: "2026-03-01", to: "2026-03-31" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.nothingToExport"] } });
  });

  it("validates hours input", async () => {
    const s = await setup();
    await expect(timesheetService.create(s.worker, { projectId: s.project.id, workDate: "2026-03-04", hours: "25" })).rejects.toMatchObject({ fieldErrors: { hours: ["validation.hours"] } });
    await expect(timesheetService.create(s.worker, { projectId: s.project.id, workDate: "2026-03-04", startTime: "15:00", endTime: "07:00" })).rejects.toMatchObject({
      fieldErrors: { endTime: ["validation.timeRange"] },
    });
    await expect(timesheetService.create(s.worker, { projectId: s.project.id, workDate: "2026-03-04" })).rejects.toMatchObject({ fieldErrors: { hours: ["validation.required"] } });
    const noRecord = await createMember(s.t, "EMPLOYEE", [{ projectId: s.project.id }]);
    await expect(timesheetService.create(noRecord, { projectId: s.project.id, workDate: "2026-03-04", hours: "8" })).rejects.toMatchObject({ fieldErrors: { employeeId: ["validation.noEmployeeRecord"] } });
  });
});
