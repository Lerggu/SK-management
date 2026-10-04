import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { ROLE_TEMPLATES } from "@/platform/authz";
import { companyAdminService, companyDirectoryService } from "@/modules/companies/service";
import { resolveRequestContext } from "@/modules/companies/context";
import { findSignInEligibleUser, recordSignIn } from "@/modules/identity/service";
import { createMember, createTenant, meta, uniq } from "../helpers/fixtures";

describe("companies", () => {
  it("org owner creates a company with the 10 role templates and becomes CEO", async () => {
    const t = await createTenant("Create");
    const roles = await db.role.findMany({ where: { companyId: t.companyId } });
    expect(roles.map((r) => r.key).sort()).toEqual(ROLE_TEMPLATES.map((r) => r.key).sort());
    expect(roles.filter((r) => r.projectAccess === "ALL").map((r) => r.key).sort()).toEqual(["CEO", "PROJECT_DIRECTOR"]);
    expect(t.ownerCtx.projectAccess).toBe("ALL");
    expect(t.ownerCtx.permissions.has("company.roles.manage")).toBe(true);
    const audit = await db.auditEvent.findMany({ where: { companyId: t.companyId }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["company.create", "role.create_from_templates", "membership.create"]));
  });

  it("only org OWNER/ADMIN can create companies; outsiders get 404", async () => {
    const t = await createTenant("Org");
    const member = await db.user.create({ data: { email: `${uniq()}@example.test` } });
    await db.organizationMembership.create({ data: { organizationId: t.organizationId, userId: member.id, role: "MEMBER" } });
    const memberCtx = { kind: "user" as const, user: { id: member.id, email: member.email, name: null }, meta, locale: "fi" as const };
    await expect(companyDirectoryService.createCompany(memberCtx, { organizationId: t.organizationId, name: "X", slug: uniq("s") })).rejects.toBeInstanceOf(ForbiddenError);

    const other = await createTenant("Other");
    await expect(companyDirectoryService.createCompany(other.owner, { organizationId: t.organizationId, name: "X", slug: uniq("s") })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects duplicate slugs", async () => {
    const t = await createTenant("Dup");
    await expect(companyDirectoryService.createCompany(t.owner, { organizationId: t.organizationId, name: "Again", slug: t.slug })).rejects.toBeInstanceOf(ConflictError);
  });

  it("lists only the user's companies", async () => {
    const a = await createTenant("A");
    await createTenant("B");
    const list = await companyDirectoryService.listMyCompanies(a.owner);
    expect(list.map((c) => c.id)).toEqual([a.companyId]);
  });

  it("invitation → sign-in activates the membership and audits it", async () => {
    const t = await createTenant("Invite");
    const email = `${uniq("inv")}@example.test`;
    expect(await findSignInEligibleUser(email)).toBeNull();
    const membership = await companyAdminService.inviteMember(t.ownerCtx, { email: email.toUpperCase(), name: "New Person", roleIds: [await t.roleId("SUPERVISOR")] });
    expect(membership.status).toBe("INVITED");

    const user = await findSignInEligibleUser(email);
    expect(user?.email).toBe(email);
    // INVITED members cannot enter the company yet.
    await expect(resolveRequestContext({ userId: user!.id, companySlug: t.slug, meta, locale: "fi" })).rejects.toBeInstanceOf(NotFoundError);

    await recordSignIn({ userId: user!.id, provider: "dev", subject: email, email, meta });
    const ctx = await resolveRequestContext({ userId: user!.id, companySlug: t.slug, meta, locale: "fi" });
    expect(ctx.permissions.has("documents.manage")).toBe(true);
    const actions = (await db.auditEvent.findMany({ where: { companyId: t.companyId }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["membership.invite", "membership.accept", "auth.sign_in"]));
    await expect(companyAdminService.inviteMember(t.ownerCtx, { email, roleIds: [await t.roleId("SUPERVISOR")] })).rejects.toBeInstanceOf(ConflictError);
  });

  it("disabled membership loses access immediately (404)", async () => {
    const t = await createTenant("Disable");
    const sup = await createMember(t, "SUPERVISOR");
    await companyAdminService.setMemberStatus(t.ownerCtx, sup.membershipId, { status: "DISABLED" });
    await expect(resolveRequestContext({ userId: sup.user.id, companySlug: t.slug, meta, locale: "fi" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await findSignInEligibleUser(sup.user.email)).toBeNull();
  });

  it("cannot disable yourself or remove the last administrator", async () => {
    const t = await createTenant("Admins");
    await expect(companyAdminService.setMemberStatus(t.ownerCtx, t.ownerCtx.membershipId, { status: "DISABLED" })).rejects.toBeInstanceOf(ValidationError);
    await expect(companyAdminService.updateMemberRoles(t.ownerCtx, t.ownerCtx.membershipId, { roleIds: [await t.roleId("EMPLOYEE")] })).rejects.toMatchObject({
      fieldErrors: { _form: ["validation.lastAdmin"] },
    });
  });

  it("role permission changes are audited and Client/Subcontractor roles can never receive rate permissions", async () => {
    const t = await createTenant("Roles");
    const clientRole = await t.roleId("CLIENT");
    await expect(
      companyAdminService.updateRolePermissions(t.ownerCtx, clientRole, { permissionKeys: ["project.view", "employee.rates.view"] }),
    ).rejects.toMatchObject({ fieldErrors: { permissionKeys: ["validation.externalSensitive"] } });
    await expect(companyAdminService.updateRolePermissions(t.ownerCtx, clientRole, { permissionKeys: ["root.all"] })).rejects.toBeInstanceOf(ValidationError);

    const empRole = await t.roleId("EMPLOYEE");
    await companyAdminService.updateRolePermissions(t.ownerCtx, empRole, { permissionKeys: ["project.view", "documents.view", "equipment.view"] });
    const ev = await db.auditEvent.findFirstOrThrow({ where: { companyId: t.companyId, action: "role.permissions_update", entityId: empRole } });
    expect(ev.after).toMatchObject({ key: "EMPLOYEE", permissions: ["documents.view", "equipment.view", "project.view"] });
  });

  it("members administration requires company.members.manage; audit log requires audit.view", async () => {
    const t = await createTenant("Perm");
    const pm = await createMember(t, "PROJECT_MANAGER");
    await expect(companyAdminService.listMembers(pm)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(companyAdminService.listAuditEvents(pm)).rejects.toBeInstanceOf(ForbiddenError);
    const pd = await createMember(t, "PROJECT_DIRECTOR");
    const events = await companyAdminService.listAuditEvents(pd);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.companyId === t.companyId)).toBe(true);
  });

  it("settings update is audited with a delta", async () => {
    const t = await createTenant("Settings");
    await companyAdminService.updateSettings(t.ownerCtx, { name: "Renamed Oy", businessId: "1234567-8", defaultLocale: "en" });
    const ev = await db.auditEvent.findFirstOrThrow({ where: { companyId: t.companyId, action: "company.update" } });
    expect(ev.before).toMatchObject({ name: "Settings Oy" });
    expect(ev.after).toMatchObject({ name: "Renamed Oy", defaultLocale: "en" });
  });
});
