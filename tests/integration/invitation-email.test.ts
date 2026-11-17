/**
 * Invitation e-mail: inviting a member sends how-to-sign-in instructions
 * (Microsoft for staff, e-mail link for external roles), never a sign-in
 * token; a missing or failing mailer never undoes the invitation; the
 * invitation can be resent while it is pending. Real PostgreSQL.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { MemoryMailer, setMailerForTests, type Mailer } from "@/platform/mail";
import { companyAdminService } from "@/modules/companies/service";
import { createMember, createTenant, uniq, type Tenant } from "../helpers/fixtures";

let t: Tenant;
let mailer: MemoryMailer;
beforeAll(async () => {
  t = await createTenant("Invite");
});
afterEach(() => setMailerForTests(undefined));
const useMailer = () => {
  mailer = new MemoryMailer();
  setMailerForTests(mailer);
  return mailer;
};
const invite = async (key: Parameters<Tenant["roleId"]>[0], email = `${uniq("inv")}@example.test`) =>
  companyAdminService.inviteMember(t.ownerCtx, { email, name: "Urho Urakoitsija", roleIds: [await t.roleId(key)] });

describe("invitation e-mail", () => {
  it("tells a subcontractor to use the e-mail link, with the address prefilled and no token", async () => {
    useMailer();
    const email = `${uniq("sub")}@example.test`;
    const m = await invite("SUBCONTRACTOR", email);
    expect(m.email).toEqual({ sent: true, channel: "test" });
    expect(mailer.sent).toHaveLength(1);
    const [msg] = mailer.sent;
    expect(msg.to).toBe(email);
    expect(msg.subject).toContain("kutsui sinut");
    expect(msg.text).toContain(`/sign-in?email=${encodeURIComponent(email)}`);
    expect(msg.text).toContain("Lähetä kirjautumislinkki");
    expect(msg.text).not.toMatch(/token=/);
    const audit = await db.auditEvent.findFirst({ where: { companyId: t.companyId, action: "membership.invite_email", entityId: m.id } });
    expect(audit?.metadata).toMatchObject({ sent: true, signIn: "EMAIL_LINK" });
  });

  it("tells staff to sign in with Microsoft", async () => {
    useMailer();
    await invite("SITE_MANAGER");
    expect(mailer.sent[0].text).toContain("Kirjaudu Microsoft-tilillä");
    expect(mailer.sent[0].text).not.toContain("?email=");
  });

  it("keeps the invitation when there is no mailer or sending fails", async () => {
    setMailerForTests(null);
    const a = await invite("CLIENT");
    expect(a.email).toEqual({ sent: false, channel: "none" });
    const failing: Mailer = { kind: "test", send: async () => Promise.reject(new Error("smtp down")) };
    setMailerForTests(failing);
    const b = await invite("CLIENT");
    expect(b.email.sent).toBe(false);
    expect(await db.companyMembership.count({ where: { id: { in: [a.id, b.id] }, status: "INVITED" } })).toBe(2);
    await expect(companyAdminService.resendInvite(t.ownerCtx, b.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("resends a pending invitation; not after sign-in, not without the permission, 404 for unknown", async () => {
    useMailer();
    const m = await invite("SUBCONTRACTOR");
    expect(await companyAdminService.resendInvite(t.ownerCtx, m.id)).toEqual({ sent: true, channel: "test" });
    expect(mailer.sent).toHaveLength(2);
    expect(await db.auditEvent.count({ where: { companyId: t.companyId, action: "membership.invite_resend", entityId: m.id } })).toBe(1);

    await db.companyMembership.update({ where: { id: m.id }, data: { status: "ACTIVE" } });
    await expect(companyAdminService.resendInvite(t.ownerCtx, m.id)).rejects.toBeInstanceOf(ValidationError);
    const pm = await createMember(t, "PROJECT_MANAGER");
    await expect(companyAdminService.resendInvite(pm, m.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(companyAdminService.resendInvite(t.ownerCtx, "01900000-0000-7000-8000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
  });
});
