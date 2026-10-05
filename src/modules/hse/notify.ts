import { readClient, runInTransaction } from "@/platform/db";
import { writeAudit } from "@/platform/audit";
import { resolvePermissions, type RequestContext } from "@/platform/authz";
import { getMailer } from "@/platform/mail";
import { appBaseUrl } from "@/platform/config/env";
import { translate } from "@/platform/i18n/translate";
import { HseRepo } from "./repo";

const toGrant = (r: { templateKey: string | null; projectAccess: "ALL" | "ASSIGNED"; permissions: { permissionKey: string }[] }) => ({
  templateKey: r.templateKey,
  projectAccess: r.projectAccess,
  permissions: r.permissions.map((p) => p.permissionKey),
});

/** Active members holding hse.serious.notify in the project (capability, never role names). */
export async function seriousIncidentRecipients(companyId: string, projectId: string) {
  const members = await new HseRepo(readClient(), companyId).listMembersWithRoles(projectId);
  return members.filter((m) => {
    const r = resolvePermissions(
      m.roles.map((x) => toGrant(x.role)),
      m.projectMemberships.map((pm) => ({ projectId: pm.projectId, role: toGrant(pm.role) })),
    );
    if (r.external) return false;
    const access = r.projectAccess === "ALL" || r.projectGrants.has(projectId);
    if (!access) return false;
    return r.permissions.has("hse.serious.notify") || (r.projectGrants.get(projectId)?.has("hse.serious.notify") ?? false);
  });
}

/**
 * Owner decision 3: a serious or lost-time incident immediately notifies the
 * Project Director, HSE and CEO (hse.serious.notify) — in-app (urgent list)
 * and by e-mail. The message carries no personal data. Runs after the
 * report's transaction commits; a mail failure never loses the report.
 */
export async function notifySeriousIncident(ctx: RequestContext, incident: { id: string; number: number; severity: string; projectId: string; title: string }, project: { code: string; name: string }) {
  const recipients = await seriousIncidentRecipients(ctx.company.id, incident.projectId);
  const mailer = getMailer();
  const link = `${appBaseUrl()}/c/${ctx.company.slug}/hse/incidents/${incident.id}`;
  let sent = 0;
  if (mailer) {
    for (const r of recipients) {
      const params = { project: `${project.code} ${project.name}`, number: incident.number, severity: translate(r.user.locale, `hse.incidentSeverity.${incident.severity}`), link };
      try {
        await mailer.send({ to: r.user.email, subject: translate(r.user.locale, "mail.seriousIncidentSubject", params), text: translate(r.user.locale, "mail.seriousIncidentBody", params) });
        sent += 1;
      } catch (e) {
        console.error("serious incident notification failed", { incidentId: incident.id, error: (e as Error).message });
      }
    }
  }
  await runInTransaction(async (tx) => {
    await new HseRepo(tx, ctx.company.id).updateIncident(incident.id, { notifiedAt: new Date() });
    await writeAudit(tx, ctx, {
      action: "incident.notify",
      entityType: "incident",
      entityId: incident.id,
      projectId: incident.projectId,
      metadata: { recipients: recipients.length, emailsSent: sent, channel: mailer?.kind ?? "in-app" },
    });
  });
  return { recipients: recipients.length, emailsSent: sent };
}
