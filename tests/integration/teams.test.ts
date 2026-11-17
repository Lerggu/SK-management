/**
 * Teams of employees (ADR 0029): one team per person, a leader, the cached
 * team name on the employee kept in sync, archive releases members, HR card
 * picks a team, rotation board groups by team. Real PostgreSQL.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import type { RequestContext } from "@/platform/authz";
import { employeeService } from "@/modules/workforce/service";
import { teamService } from "@/modules/workforce/team.service";
import { hrCardService } from "@/modules/hr/card.service";
import { hrOverviewService } from "@/modules/hr/overview.service";
import { rotationService } from "@/modules/workforce/rotation.service";
import { createMember, createTenant, type Tenant } from "../helpers/fixtures";

let t: Tenant;
let o: RequestContext;
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await createTenant("Teams");
  o = t.ownerCtx;
  for (const [n, first] of [["T1", "Aino"], ["T2", "Bruno"], ["T3", "Celia"]]) ids[first] = (await employeeService.create(o, { employeeNumber: n, firstName: first, lastName: "Tiimi" })).id;
});

describe("teams", () => {
  it("creates a team with its leader as a member, adds and moves members, keeps the cached name in sync", async () => {
    const a = await teamService.create(o, { name: "Asennus", leaderId: ids.Aino, color: "amber" });
    const b = await teamService.create(o, { name: "Betoni" });
    await teamService.addMembers(o, a.id, { employeeIds: [ids.Bruno, ids.Celia] });
    await teamService.addMembers(o, b.id, { employeeIds: [ids.Celia] }); // moved
    let list = (await teamService.list(o)).teams;
    expect(list.find((x) => x.id === a.id)!.members.map((m) => m.id).sort()).toEqual([ids.Aino, ids.Bruno].sort());
    expect(list.find((x) => x.id === a.id)!.leader?.id).toBe(ids.Aino);
    expect(list.find((x) => x.id === b.id)!.members.map((m) => m.id)).toEqual([ids.Celia]);
    expect((await db.employee.findUniqueOrThrow({ where: { id: ids.Celia } })).team).toBe("Betoni");

    await teamService.update(o, a.id, { name: "Asennustiimi", leaderId: ids.Aino, color: "amber" });
    expect((await db.employee.findUniqueOrThrow({ where: { id: ids.Bruno } })).team).toBe("Asennustiimi");
    // HR filters by the name still work.
    const search = await hrOverviewService.search(o, { team: "Asennustiimi" });
    expect(search.employees.map((e) => e.id).sort()).toEqual([ids.Aino, ids.Bruno].sort());

    await teamService.removeMember(o, a.id, ids.Aino);
    list = (await teamService.list(o)).teams;
    expect(list.find((x) => x.id === a.id)!.leader).toBeNull();
    expect((await db.employee.findUniqueOrThrow({ where: { id: ids.Aino } })).team).toBeNull();
    const audit = await db.auditEvent.findFirst({ where: { companyId: t.companyId, action: "team.members_add", entityId: b.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects duplicate active names, but allows reusing an archived name; archive releases members", async () => {
    const c = await teamService.create(o, { name: "Kaivuu" });
    await expect(teamService.create(o, { name: "kaivuu" })).rejects.toBeInstanceOf(ValidationError);
    await teamService.addMembers(o, c.id, { employeeIds: [ids.Aino] });
    await teamService.archive(o, c.id);
    expect((await db.employee.findUniqueOrThrow({ where: { id: ids.Aino } })).teamId).toBeNull();
    expect((await teamService.list(o)).teams.map((x) => x.id)).not.toContain(c.id);
    await expect(teamService.addMembers(o, c.id, { employeeIds: [ids.Aino] })).rejects.toBeInstanceOf(NotFoundError);
    expect((await teamService.create(o, { name: "Kaivuu" })).id).not.toBe(c.id);
  });

  it("the HR card picks a team by id and keeps the cached name", async () => {
    const d = await teamService.create(o, { name: "Dumpperit" });
    await hrCardService.updateEmployment(o, ids.Aino, { teamId: d.id });
    expect(await db.employee.findUniqueOrThrow({ where: { id: ids.Aino }, select: { teamId: true, team: true } })).toEqual({ teamId: d.id, team: "Dumpperit" });
    await expect(hrCardService.updateEmployment(o, ids.Aino, { teamId: "01900000-0000-7000-8000-000000000000" })).rejects.toBeInstanceOf(ValidationError);
    await hrCardService.updateEmployment(o, ids.Aino, { teamId: "" });
    expect((await db.employee.findUniqueOrThrow({ where: { id: ids.Aino } })).team).toBeNull();
  });

  it("the rotation board lists teams with their members", async () => {
    const b = await rotationService.board(o);
    const betoni = b.teams.find((x) => x.name === "Betoni")!;
    expect(betoni.memberIds).toEqual([ids.Celia]);
    expect(b.people.find((p) => p.id === ids.Celia)!.teamId).toBe(betoni.id);
  });

  it("viewers list teams; only employee/HR managers change them; clients have no access", async () => {
    const sup = await createMember(t, "SUPERVISOR");
    const r = await teamService.list(sup);
    expect(r.canManage).toBe(false);
    await expect(teamService.create(sup, { name: "X" })).rejects.toBeInstanceOf(ForbiddenError);
    const hr = await createMember(t, "HR_ADMIN");
    expect((await teamService.create(hr, { name: "HR:n tiimi" })).id).toBeTruthy();
    const client = await createMember(t, "CLIENT");
    await expect(teamService.list(client)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
