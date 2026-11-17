/**
 * Per-member extra permissions and the registration form (ADR 0030).
 * Real PostgreSQL.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, ValidationError } from "@/platform/errors";
import type { UserContext } from "@/platform/authz";
import { companyAdminService } from "@/modules/companies/service";
import { resolveRequestContext } from "@/modules/companies/context";
import { profileService } from "@/modules/identity/service";
import { createMember, createTenant, type Tenant } from "../helpers/fixtures";

let t: Tenant;
const meta = { ip: "127.0.0.1", userAgent: "test", requestId: "test" };

beforeAll(async () => {
  t = await createTenant("Access");
});

const membershipOf = async (userId: string) => db.companyMembership.findFirstOrThrow({ where: { companyId: t.companyId, userId } });
const userCtx = (id: string, email: string): UserContext => ({ kind: "user", user: { id, email, name: null }, meta, locale: "fi" });

describe("extra permissions", () => {
  it("adds capabilities to one member on top of their roles, audited, and can be removed", async () => {
    const sup = await createMember(t, "SUPERVISOR");
    const m = await membershipOf(sup.user.id);
    expect(sup.permissions.has("takt.manage")).toBe(false);
    await companyAdminService.setMemberPermissions(t.ownerCtx, m.id, { permissionKeys: ["takt.manage", "booking.manage"] });
    const ctx = await resolveRequestContext({ userId: sup.user.id, companySlug: t.slug, meta, locale: "fi" });
    expect(ctx.permissions.has("takt.manage")).toBe(true);
    expect(ctx.permissions.has("booking.manage")).toBe(true);
    const listed = (await companyAdminService.listMembers(t.ownerCtx)).find((x) => x.id === m.id)!;
    expect(listed.extraPermissions).toEqual(["booking.manage", "takt.manage"]);
    expect(await db.auditEvent.count({ where: { companyId: t.companyId, action: "membership.permissions_update", entityId: m.id } })).toBe(1);
    await companyAdminService.setMemberPermissions(t.ownerCtx, m.id, { permissionKeys: [] });
    const again = await resolveRequestContext({ userId: sup.user.id, companySlug: t.slug, meta, locale: "fi" });
    expect(again.permissions.has("takt.manage")).toBe(false);
  });

  it("external members get only non-sensitive, project-level extras; portal permissions are never extras", async () => {
    const sub = await createMember(t, "SUBCONTRACTOR");
    const m = await membershipOf(sub.user.id);
    expect((await companyAdminService.listMembers(t.ownerCtx)).find((x) => x.id === m.id)!.external).toBe(true);
    await expect(companyAdminService.setMemberPermissions(t.ownerCtx, m.id, { permissionKeys: ["employee.rates.view"] })).rejects.toMatchObject({ fieldErrors: { permissionKeys: ["validation.externalSensitive"] } });
    await expect(companyAdminService.setMemberPermissions(t.ownerCtx, m.id, { permissionKeys: ["employee.view"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(companyAdminService.setMemberPermissions(t.ownerCtx, m.id, { permissionKeys: ["portal.client"] })).rejects.toBeInstanceOf(ValidationError);
    await companyAdminService.setMemberPermissions(t.ownerCtx, m.id, { permissionKeys: ["takt.view", "hse.view"] });
    const ctx = await resolveRequestContext({ userId: sub.user.id, companySlug: t.slug, meta, locale: "fi" });
    expect(ctx.external).toBe(true);
    expect(ctx.permissions.has("takt.view")).toBe(true);
  });

  it("needs company.roles.manage; unknown keys are rejected", async () => {
    const pm = await createMember(t, "PROJECT_MANAGER");
    const target = await membershipOf((await createMember(t, "EMPLOYEE")).user.id);
    await expect(companyAdminService.setMemberPermissions(pm, target.id, { permissionKeys: ["takt.view"] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(companyAdminService.setMemberPermissions(t.ownerCtx, target.id, { permissionKeys: ["no.such"] })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("registration form", () => {
  it("records the profile and privacy acceptance once; phone is masked in the audit", async () => {
    await companyAdminService.inviteMember(t.ownerCtx, { email: "uusi.tyontekija@example.test", roleIds: [await t.roleId("EMPLOYEE")] });
    const u = await db.user.findUniqueOrThrow({ where: { email: "uusi.tyontekija@example.test" } });
    const uctx = userCtx(u.id, u.email);
    expect((await profileService.getProfile(uctx)).registeredAt).toBeNull();
    await expect(profileService.register(uctx, { name: "Uusi Työntekijä", acceptPrivacy: undefined })).rejects.toBeInstanceOf(ValidationError); // privacy not accepted
    await expect(profileService.register(uctx, { name: "Uusi Työntekijä", phone: "abc", acceptPrivacy: "on" })).rejects.toBeInstanceOf(ValidationError);
    await profileService.register(uctx, { name: "Uusi Työntekijä", phone: "+358 40 111 2222", jobTitle: "Asentaja", acceptPrivacy: "on" });
    const p = await profileService.getProfile(uctx);
    expect(p).toMatchObject({ name: "Uusi Työntekijä", phone: "+358 40 111 2222", jobTitle: "Asentaja" });
    expect(p.registeredAt).not.toBeNull();
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "user.register", entityId: u.id } });
    expect(JSON.stringify(audit.after)).not.toContain("111 2222");
  });

  it("external users must name the organisation they represent", async () => {
    await companyAdminService.inviteMember(t.ownerCtx, { email: "urakoitsija.rek@example.test", roleIds: [await t.roleId("SUBCONTRACTOR")] });
    const u = await db.user.findUniqueOrThrow({ where: { email: "urakoitsija.rek@example.test" } });
    const uctx = userCtx(u.id, u.email);
    await expect(profileService.register(uctx, { name: "Urho Urakoitsija", acceptPrivacy: "on" })).rejects.toMatchObject({ fieldErrors: { organization: ["validation.required"] } });
    await profileService.register(uctx, { name: "Urho Urakoitsija", organization: "Urakointi Oy", acceptPrivacy: "on" });
    expect((await profileService.getProfile(uctx)).organization).toBe("Urakointi Oy");
  });
});
