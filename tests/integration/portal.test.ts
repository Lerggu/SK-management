import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, RateLimitedError, UnauthenticatedError, ValidationError } from "@/platform/errors";
import { getMailer, type MemoryMailer } from "@/platform/mail";
import { resetRateLimits } from "@/platform/ratelimit";
import { projectService } from "@/modules/projects/service";
import { variationService } from "@/modules/commercial/project.service";
import { clientApprovalService } from "@/modules/commercial/client-approval.service";
import { snapshotHash } from "@/modules/commercial/rules";
import { consumeEmailSignIn, findExternalSignInUser, requestEmailSignIn, sha256 } from "@/modules/identity/email-sign-in";
import { portalService } from "@/modules/portal/service";
import { scheduleSummaryService } from "@/modules/takt/summary.service";
import { hseOverviewService } from "@/modules/hse/hse.service";
import { auditFor, createMember, createTenant, meta } from "../helpers/fixtures";

const mailbox = () => getMailer() as MemoryMailer;
const linkToken = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

async function setup() {
  const t = await createTenant("Portal");
  const project = await projectService.create(t.ownerCtx, { code: "PO", name: "Portal project" });
  const pm = await createMember(t, "PROJECT_MANAGER", [{ projectId: project.id }]);
  const pd = await createMember(t, "PROJECT_DIRECTOR");
  const client = await createMember(t, "CLIENT", [{ projectId: project.id }]);
  const approver = await createMember(t, "CLIENT", [{ projectId: project.id, role: "CLIENT_APPROVER" }]);
  return { t, project, pm, pd, client, approver };
}
type S = Awaited<ReturnType<typeof setup>>;

async function sentToClient(s: S, title = "Lisäkaapelointi") {
  const v = await variationService.create(s.pm, { projectId: s.project.id, title, description: "Asiakkaan muutospyyntö" });
  await variationService.updateDraft(s.pm, v.id, { title, description: "Asiakkaan muutospyyntö", laborCost: "2000", materialsCost: "1000", markupPct: "15" });
  await variationService.submitForReview(s.pm, v.id);
  await variationService.approveInternal(s.pd, v.id, { decision: "APPROVE" });
  const a = await db.variationClientApproval.findFirstOrThrow({ where: { variationId: v.id, decision: "PENDING" } });
  return { v, a };
}

describe("acceptance 7: the named client approver decides the frozen version once", () => {
  it("internal approval publishes a snapshot without costs; only the approver decides; hash-bound; final", async () => {
    const s = await setup();
    const { v, a } = await sentToClient(s);
    expect(a.snapshot).toEqual({ number: v.number, title: "Lisäkaapelointi", description: "Asiakkaan muutospyyntö", cause: null, clientReference: null, salesPrice: "3450.00", currency: "EUR" });
    expect(a.contentSha256).toBe(snapshotHash(a.snapshot as never));

    // The plain client sees the portal but cannot list or decide approvals.
    expect((await portalService.project(s.client, s.project.id)).sections).toMatchObject({ client: true, approveVariations: false });
    await expect(clientApprovalService.list(s.client, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(clientApprovalService.decide(s.client, a.id, { decision: "APPROVED", contentSha256: a.contentSha256 })).rejects.toBeInstanceOf(ForbiddenError);
    // Internal users never act on the client's behalf in the portal.
    await expect(clientApprovalService.decide(s.pd, a.id, { decision: "APPROVED", contentSha256: a.contentSha256 })).rejects.toBeInstanceOf(NotFoundError);

    const list = await clientApprovalService.list(s.approver, s.project.id);
    expect(list.map((x) => x.id)).toEqual([a.id]);
    expect(JSON.stringify(list)).not.toMatch(/laborCost|markupPct|"cost"/);
    // A hash other than the one shown is refused.
    await expect(clientApprovalService.decide(s.approver, a.id, { decision: "APPROVED", contentSha256: "0".repeat(64) })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.clientSnapshotChanged"] } });
    await expect(clientApprovalService.decide(s.approver, a.id, { decision: "REJECTED", contentSha256: a.contentSha256 })).rejects.toMatchObject({ fieldErrors: { note: ["validation.required"] } });
    // The snapshot cannot be tampered with in the database.
    await expect(db.variationClientApproval.update({ where: { id: a.id }, data: { snapshot: { salesPrice: "1.00" } } })).rejects.toThrow(/immutable/);

    await clientApprovalService.decide(s.approver, a.id, { decision: "APPROVED", contentSha256: a.contentSha256, note: "Hyväksytään" });
    expect((await db.variation.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("APPROVED");
    const decided = await clientApprovalService.get(s.approver, a.id);
    expect(decided).toMatchObject({ decision: "APPROVED", channel: "PORTAL", canDecide: false });
    await expect(clientApprovalService.decide(s.approver, a.id, { decision: "REJECTED", contentSha256: a.contentSha256, note: "x" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.clientDecisionFinal"] } });
    await expect(db.variationClientApproval.update({ where: { id: a.id }, data: { decision: "REJECTED" } })).rejects.toThrow(/final/);
    const audit = (await auditFor(s.t.companyId, v.id)).find((e) => e.action === "variation.client_approve")!;
    expect(audit.actorUserId).toBe(s.approver.user.id);
    expect(audit.metadata).toMatchObject({ channel: "PORTAL", clientApprovalId: a.id, contentSha256: a.contentSha256 });
  });

  it("a decision recorded internally closes the pending snapshot; publishToClient re-publishes when none is pending", async () => {
    const s = await setup();
    const { v, a } = await sentToClient(s, "Paperihyväksyntä");
    await expect(variationService.publishToClient(s.pd, v.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.clientApprovalPending"] } });
    // Withdraw (e.g. sent before V7) and publish again.
    await db.variationClientApproval.update({ where: { id: a.id }, data: { decision: "WITHDRAWN", decidedAt: new Date() } });
    await expect(variationService.publishToClient(s.pm, v.id)).rejects.toBeInstanceOf(ForbiddenError);
    const again = await variationService.publishToClient(s.pd, v.id);
    expect(again.contentSha256).toBe(a.contentSha256);
    await variationService.recordClientDecision(s.pm, v.id, { decision: "APPROVED", clientReference: "Sähköposti 3.10." });
    expect(await db.variationClientApproval.findUniqueOrThrow({ where: { id: again.id } })).toMatchObject({ decision: "APPROVED", channel: "RECORDED", decidedById: s.pm.user.id });
    await expect(clientApprovalService.decide(s.approver, again.id, { decision: "APPROVED", contentSha256: again.contentSha256 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("acceptance 6: the client portal shows progress, aggregated HSE and nothing internal", () => {
  it("portal projects, schedule summary and HSE figures", async () => {
    const s = await setup();
    const other = await projectService.create(s.t.ownerCtx, { code: "PX", name: "Not for the client" });
    expect((await portalService.projects(s.client)).map((p) => p.id)).toEqual([s.project.id]);
    await expect(portalService.project(s.client, other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portalService.project(s.pm, s.project.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await scheduleSummaryService.project(s.client, s.project.id)).toEqual({ plans: [], activities: 0, complete: 0, progressPct: 0 });
    const figures = await hseOverviewService.portalFigures(s.client, s.project.id);
    expect(Object.keys(figures)).not.toContain("observations");
    expect(figures.incidents).toBe(0);
  });
});

describe("acceptance 9: e-mail sign-in link for external users", () => {
  beforeEach(() => resetRateLimits());

  it("sends a single-use link to an external user only; the token is stored hashed; session is external-length", async () => {
    const s = await setup();
    const before = mailbox().sent.length;
    await requestEmailSignIn(s.client.user.email.toUpperCase(), { ...meta, ip: "10.0.0.1" });
    const mail = mailbox().sent.slice(before);
    expect(mail.map((m) => m.to)).toEqual([s.client.user.email]);
    const token = linkToken(mail[0].text);
    expect(token).toHaveLength(43);
    const stored = await db.emailSignInToken.findFirstOrThrow({ where: { userId: s.client.user.id } });
    expect(stored.tokenSha256).toBe(sha256(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeLessThanOrEqual(15 * 60_000 + 1000);

    const session = await consumeEmailSignIn(token, { ...meta, ip: "10.0.0.1" });
    expect(session.expires.getTime() - Date.now()).toBeLessThanOrEqual(8 * 3600_000 + 1000);
    expect(await db.session.count({ where: { sessionToken: session.sessionToken, userId: s.client.user.id } })).toBe(1);
    const signIns = await db.auditEvent.findMany({ where: { companyId: s.t.companyId, action: "auth.sign_in", entityId: s.client.user.id } });
    expect(signIns.some((e) => (e.metadata as { provider?: string }).provider === "email")).toBe(true);
    // Single use — in the service and in the database.
    await expect(consumeEmailSignIn(token, meta)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(db.emailSignInToken.update({ where: { id: stored.id }, data: { consumedAt: new Date() } })).rejects.toThrow(/once/);
  });

  it("no link for internal users, mixed users, unknown or disabled addresses — with an identical response", async () => {
    const s = await setup();
    const before = mailbox().sent.length;
    const ip = { ...meta, ip: "10.0.0.2" };
    await expect(requestEmailSignIn(s.pm.user.email, ip)).resolves.toBeUndefined();
    await expect(requestEmailSignIn("nobody@example.test", ip)).resolves.toBeUndefined();
    // A client who also holds an internal role must use Entra ID.
    const mixed = await createMember(s.t, "CLIENT", [{ projectId: s.project.id }]);
    await db.membershipRole.create({ data: { companyId: s.t.companyId, membershipId: mixed.membershipId, roleId: await s.t.roleId("EMPLOYEE") } });
    await requestEmailSignIn(mixed.user.email, ip);
    const disabled = await createMember(s.t, "SUBCONTRACTOR", [{ projectId: s.project.id }]);
    await db.companyMembership.update({ where: { id: disabled.membershipId }, data: { status: "DISABLED" } });
    await requestEmailSignIn(disabled.user.email, ip);
    expect(mailbox().sent.length).toBe(before);
    expect(await findExternalSignInUser(s.pm.user.email)).toBeNull();
    expect(await db.emailSignInToken.count({ where: { userId: { in: [s.pm.user.id, mixed.user.id, disabled.user.id] } } })).toBe(0);
  });

  it("expired, malformed or no-longer-eligible tokens are rejected; requests are rate limited", async () => {
    const s = await setup();
    const past = new Date(Date.now() - 3600_000);
    const expired = "e".repeat(43);
    await db.emailSignInToken.create({ data: { userId: s.client.user.id, tokenSha256: sha256(expired), createdAt: past, expiresAt: new Date(past.getTime() + 15 * 60_000) } });
    await expect(consumeEmailSignIn(expired, meta)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(consumeEmailSignIn("not-a-token", meta)).rejects.toBeInstanceOf(UnauthenticatedError);

    // Membership disabled after the link was sent → the link no longer works.
    const sub = await createMember(s.t, "SUBCONTRACTOR", [{ projectId: s.project.id }]);
    const before = mailbox().sent.length;
    await requestEmailSignIn(sub.user.email, { ...meta, ip: "10.0.0.3" });
    const token = linkToken(mailbox().sent[before].text);
    await db.companyMembership.update({ where: { id: sub.membershipId }, data: { status: "DISABLED" } });
    await expect(consumeEmailSignIn(token, meta)).rejects.toBeInstanceOf(UnauthenticatedError);

    // Per address: silently capped at 5 per 15 minutes.
    const n = mailbox().sent.length;
    for (let i = 0; i < 7; i++) await requestEmailSignIn(s.approver.user.email, { ...meta, ip: `10.1.0.${i}` });
    expect(mailbox().sent.length - n).toBe(5);
    // Per IP: refused after 20 requests.
    for (let i = 0; i < 20; i++) await requestEmailSignIn(`x${i}@example.test`, { ...meta, ip: "10.9.9.9" });
    await expect(requestEmailSignIn("y@example.test", { ...meta, ip: "10.9.9.9" })).rejects.toBeInstanceOf(RateLimitedError);
  });
});
