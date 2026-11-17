import { readClient, runInTransaction } from "@/platform/db";
import { writeAudit } from "@/platform/audit";
import { getMailer } from "@/platform/mail";
import { appBaseUrl } from "@/platform/config/env";
import { translate } from "@/platform/i18n/translate";
import type { RequestContext } from "@/platform/authz";
import { EMAIL_LINK_TTL_MS, findExternalSignInUser } from "@/modules/identity/email-sign-in";

export type InvitationEmailResult = { sent: boolean; channel: "smtp" | "dev-outbox" | "test" | "none" };

/**
 * Invitation e-mail: tells the invited person where and how to sign in.
 * External-only users (client, subcontractor) get the e-mail sign-in page
 * with their address prefilled; everyone else signs in with Microsoft.
 * The mail holds no sign-in token (a link from it would expire in
 * minutes); the person asks for a fresh link on the sign-in page.
 * A mail failure never undoes the invitation; it is audited either way.
 */
export async function sendInvitationEmail(ctx: RequestContext, membershipId: string, action: "membership.invite_email" | "membership.invite_resend"): Promise<InvitationEmailResult> {
  const m = await readClient().companyMembership.findFirst({
    where: { id: membershipId, companyId: ctx.company.id },
    select: { id: true, user: { select: { email: true, name: true, locale: true } } },
  });
  if (!m) return { sent: false, channel: "none" };
  const mailer = getMailer();
  let sent = false;
  const external = Boolean(await findExternalSignInUser(m.user.email));
  if (mailer) {
    const locale = m.user.locale ?? ctx.locale;
    const params = {
      name: m.user.name ?? m.user.email,
      inviter: ctx.user.name ?? ctx.user.email,
      company: ctx.company.name,
      link: external ? `${appBaseUrl()}/sign-in?email=${encodeURIComponent(m.user.email)}` : `${appBaseUrl()}/sign-in`,
      minutes: Math.round(EMAIL_LINK_TTL_MS / 60_000),
    };
    try {
      await mailer.send({
        to: m.user.email,
        subject: translate(locale, "mail.inviteSubject", params),
        text: translate(locale, external ? "mail.inviteExternalBody" : "mail.inviteInternalBody", params),
      });
      sent = true;
    } catch (e) {
      console.error("invitation e-mail failed", { membershipId, error: (e as Error).message });
    }
  }
  await runInTransaction((tx) =>
    writeAudit(tx, ctx, { action, entityType: "company_membership", entityId: m.id, metadata: { sent, channel: mailer?.kind ?? "none", signIn: external ? "EMAIL_LINK" : "MICROSOFT" } }),
  );
  return { sent, channel: mailer?.kind ?? "none" };
}
