import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ConflictError, NotFoundError, ValidationError } from "@/platform/errors";
import { projectService, siteService } from "@/modules/projects/service";
import { auditFor, contextFor, createMember, createTenant } from "../helpers/fixtures";

describe("projects and sites", () => {
  it("creates, updates and archives a project with audit events", async () => {
    const t = await createTenant("Proj");
    const p = await projectService.create(t.ownerCtx, { code: "NDC-1", name: "Data Center", customerName: "Demo Oy", startDate: "2026-01-01" });
    await projectService.update(t.ownerCtx, p.id, { code: "NDC-1", name: "Data Center Phase 1", customerName: "Demo Oy", status: "ACTIVE", startDate: "2026-01-01" });
    await projectService.archive(t.ownerCtx, p.id);
    const events = await auditFor(t.companyId, p.id);
    expect(events.map((e) => e.action)).toEqual(["project.create", "project.update", "project.archive"]);
    expect(events[1].before).toEqual({ name: "Data Center", status: "PLANNED" });
    expect(events[1].after).toEqual({ name: "Data Center Phase 1", status: "ACTIVE" });
    await expect(projectService.update(t.ownerCtx, p.id, { code: "NDC-1", name: "x" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("validates input and rejects duplicate codes", async () => {
    const t = await createTenant("Val");
    await expect(projectService.create(t.ownerCtx, { code: "", name: "x" })).rejects.toMatchObject({ fieldErrors: { code: ["validation.required"] } });
    await expect(projectService.create(t.ownerCtx, { code: "A", name: "x", startDate: "2026-05-01", endDate: "2026-04-01" })).rejects.toMatchObject({
      fieldErrors: { endDate: ["validation.endBeforeStart"] },
    });
    await projectService.create(t.ownerCtx, { code: "DUP", name: "x" });
    await expect(projectService.create(t.ownerCtx, { code: "DUP", name: "y" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("ASSIGNED members see only their projects; creators are auto-assigned", async () => {
    const t = await createTenant("Assigned");
    const visible = await projectService.create(t.ownerCtx, { code: "V", name: "Visible" });
    const hidden = await projectService.create(t.ownerCtx, { code: "H", name: "Hidden" });
    const pm = await createMember(t, "PROJECT_MANAGER", [{ projectId: visible.id }]);
    expect((await projectService.list(pm)).map((p) => p.id)).toEqual([visible.id]);
    await expect(projectService.get(pm, hidden.id)).rejects.toBeInstanceOf(NotFoundError);

    const own = await projectService.create(pm, { code: "OWN", name: "PM created" });
    const pmAfter = await contextFor(t, pm.user.id);
    expect((await projectService.list(pmAfter)).map((p) => p.id).sort()).toEqual([visible.id, own.id].sort());
  });

  it("sites belong to a project and are audited", async () => {
    const t = await createTenant("Sites");
    const p = await projectService.create(t.ownerCtx, { code: "S", name: "Sites project" });
    const s = await siteService.create(t.ownerCtx, p.id, { name: "Hall A", latitude: "65,012100", longitude: "25.465100" });
    expect(s.latitude?.toString()).toBe("65.0121");
    await siteService.update(t.ownerCtx, s.id, { name: "Hall A1" });
    expect((await siteService.list(t.ownerCtx, p.id)).map((x) => x.name)).toEqual(["Hall A1"]);
    await siteService.archive(t.ownerCtx, s.id);
    expect(await siteService.list(t.ownerCtx, p.id)).toEqual([]);
    expect((await auditFor(t.companyId, s.id)).map((e) => e.action)).toEqual(["site.create", "site.update", "site.archive"]);
  });

  it("project members can be assigned and removed by project.members.manage holders", async () => {
    const t = await createTenant("Members");
    const p = await projectService.create(t.ownerCtx, { code: "M", name: "Members" });
    const emp = await createMember(t, "EMPLOYEE");
    await expect(projectService.get(emp, p.id)).rejects.toBeInstanceOf(NotFoundError);
    const pm = await projectService.assignMember(t.ownerCtx, p.id, { userId: emp.user.id, roleId: await t.roleId("SITE_MANAGER") });
    const empCtx = await contextFor(t, emp.user.id);
    const detail = await projectService.get(empCtx, p.id);
    expect(detail.permissions.manage).toBe(false);
    expect((await projectService.listMembers(empCtx, p.id)).length).toBe(1);
    await projectService.removeMember(t.ownerCtx, pm.id);
    await expect(projectService.get(await contextFor(t, emp.user.id), p.id)).rejects.toBeInstanceOf(NotFoundError);
    const outsider = await db.user.create({ data: { email: `outsider.${Date.now()}@example.test` } });
    await expect(projectService.assignMember(t.ownerCtx, p.id, { userId: outsider.id, roleId: await t.roleId("EMPLOYEE") })).rejects.toBeInstanceOf(ValidationError);
  });
});
