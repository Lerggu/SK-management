/**
 * Role journeys (owner request 2026-11-26, ADR 0037): the fixes found by
 * walking every role through the demo project.
 */
import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError } from "@/platform/errors";
import { projectService } from "@/modules/projects/service";
import { variationService } from "@/modules/commercial/project.service";
import { dashboardService } from "@/modules/companies/dashboard";
import { documentService } from "@/modules/documents/service";
import { teamService } from "@/modules/workforce/team.service";
import { timesheetService } from "@/modules/timesheets/service";
import { scheduleSummaryService } from "@/modules/takt/summary.service";
import { auditFor, createMember, createTenant, textFile } from "../helpers/fixtures";

describe("dashboard: waiting for your decision", () => {
  it("lists a variation in internal review for the approver only", async () => {
    const t = await createTenant("Decisions");
    const project = await projectService.create(t.ownerCtx, { code: "DEC", name: "Decisions" });
    const pm = await createMember(t, "PROJECT_MANAGER", [{ projectId: project.id }]);
    const pd = await createMember(t, "PROJECT_DIRECTOR");
    const v = await variationService.create(pm, { projectId: project.id, title: "Lisätyö", description: "x" });
    await variationService.updateDraft(pm, v.id, { title: "Lisätyö", description: "x", laborCost: "100", materialsCost: "0", markupPct: "10" });
    await variationService.submitForReview(pm, v.id);
    const items = await dashboardService.decisions(pd);
    expect(items).toContainEqual(expect.objectContaining({ kind: "variation", id: v.id, path: `projects/${project.id}/commercial/variations/${v.id}` }));
    // The project manager has no commercial.approve: nothing to decide.
    expect((await dashboardService.decisions(pm)).some((i) => i.id === v.id)).toBe(false);
    const client = await createMember(t, "CLIENT", [{ projectId: project.id }]);
    expect(await dashboardService.decisions(client)).toEqual([]);
  });
});

describe("subcontractor delivers documents (ADR 0037)", () => {
  it("creates an internal document waiting for approval; nothing is shared back unapproved", async () => {
    const t = await createTenant("Delivery");
    const project = await projectService.create(t.ownerCtx, { code: "DLV", name: "Delivery" });
    const sub = await createMember(t, "SUBCONTRACTOR", [{ projectId: project.id }]);
    const client = await createMember(t, "CLIENT", [{ projectId: project.id }]);
    const other = await projectService.create(t.ownerCtx, { code: "DLX", name: "Not assigned" });

    const doc = await documentService.submitExternal(sub, project.id, { title: "RAMS nostotyöt", category: "RAMS" }, textFile("rams.pdf", "%PDF-1.4 rams"));
    expect(doc).toMatchObject({ title: "RAMS nostotyöt", category: "RAMS", approvalState: "PENDING_APPROVAL" });
    const row = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row).toMatchObject({ projectId: project.id, ownerUserId: sub.user.id, sharedWithClient: false, sharedWithSubcontractors: false });
    expect((await auditFor(t.companyId, doc.id)).map((e) => e.action)).toContain("document.external_submit");

    // The sender sees the status; the shared list does not contain the unapproved delivery.
    expect((await documentService.listOwnSubmissions(sub, project.id)).map((d) => [d.id, d.approvalState])).toEqual([[doc.id, "PENDING_APPROVAL"]]);
    expect((await documentService.list(sub, { projectId: project.id })).some((d) => d.id === doc.id)).toBe(false);
    // Internal approvers see it waiting.
    expect((await documentService.get(t.ownerCtx, doc.id)).versions[0].approvalState).toBe("PENDING_APPROVAL");

    // Only subcontractors, only in their projects; categories are limited.
    await expect(documentService.submitExternal(client, project.id, { title: "x" }, textFile("x.pdf"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(documentService.submitExternal(sub, other.id, { title: "x" }, textFile("x.pdf"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(documentService.submitExternal(t.ownerCtx, project.id, { title: "x" }, textFile("x.pdf"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(documentService.submitExternal(sub, project.id, { title: "x", category: "CONTRACT" }, textFile("x.pdf"))).rejects.toMatchObject({ fieldErrors: { category: expect.anything() } });
  });

  it("subcontractors see schedule progress (dates and percentages only)", async () => {
    const t = await createTenant("SubSchedule");
    const project = await projectService.create(t.ownerCtx, { code: "SCH", name: "Schedule" });
    const sub = await createMember(t, "SUBCONTRACTOR", [{ projectId: project.id }]);
    expect(await scheduleSummaryService.project(sub, project.id)).toEqual({ plans: [], activities: 0, complete: 0, progressPct: 0 });
  });
});

describe("permissions from the role journeys", () => {
  it("a site manager creates teams with team.manage; a supervisor cannot", async () => {
    const t = await createTenant("Teams");
    const sm = await createMember(t, "SITE_MANAGER");
    const team = await teamService.create(sm, { name: "Nostoryhmä A" });
    expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).name).toBe("Nostoryhmä A");
    const sup = await createMember(t, "SUPERVISOR");
    await expect(teamService.create(sup, { name: "Ei oikeutta" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("HR administration may run the payroll export", async () => {
    const t = await createTenant("HrExport");
    const hr = await createMember(t, "HR_ADMIN");
    await expect(timesheetService.exportApproved(hr, { from: "2026-01-01", to: "2026-01-31" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.nothingToExport"] } });
  });
});
