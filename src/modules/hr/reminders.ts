import { db, runInTransaction, withTenantScope, readClient } from "@/platform/db";
import { getMailer, type Mailer } from "@/platform/mail";
import { appBaseUrl } from "@/platform/config/env";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { translate } from "@/platform/i18n/translate";
import { addCalendarMonths, dateFromIso, isoDate, isReminderWindow, reminderDueDate } from "./rules";

/**
 * Expiry reminders (ADR 0025). Runs on a schedule inside the app process (and
 * on demand by an HR admin). For every card or fixed-term training with the
 * reminder selected, one reminder per recipient — the card owner and the
 * company's maintenance address — is sent once per expiry date:
 *
 * - due one calendar month before the last valid day (rules.reminderDueDate);
 *   a card added after the due date but before expiry is reminded in the next run;
 * - delivery state is stored per recipient (expiry_reminders, unique per
 *   record + expiry date + recipient), so reruns and parallel instances never
 *   send twice: a row is claimed (PENDING/FAILED → SENDING) before sending;
 * - SENT is recorded only after the mail server accepted the message; failures
 *   are retried in later runs (at most MAX_ATTEMPTS);
 * - renewing a card (new record) or changing its expiry date starts a new cycle.
 */
export const MAX_ATTEMPTS = 8;
const STALE_SENDING_MS = 30 * 60_000;

export interface ReminderRunResult {
  companies: number;
  candidates: number;
  sent: number;
  failed: number;
  noAddress: number;
  mailNotConfigured: number;
}

type Candidate = {
  sourceType: "QUALIFICATION" | "TRAINING";
  sourceId: string;
  name: string;
  expiresOn: Date;
  employee: { id: string; firstName: string; lastName: string; email: string | null; userId: string | null };
};

function formatFi(d: Date) {
  const [y, m, day] = isoDate(d).split("-");
  return `${Number(day)}.${Number(m)}.${y}`;
}

export async function runExpiryReminders(opts: { now?: Date; companyId?: string; mailer?: Mailer | null } = {}): Promise<ReminderRunResult> {
  const now = opts.now ?? new Date();
  const mailer = opts.mailer !== undefined ? opts.mailer : getMailer();
  const companies = await db.company.findMany({ where: { archivedAt: null, ...(opts.companyId ? { id: opts.companyId } : {}) }, select: { id: true, slug: true, organizationId: true, defaultLocale: true } });
  const total: ReminderRunResult = { companies: companies.length, candidates: 0, sent: 0, failed: 0, noAddress: 0, mailNotConfigured: 0 };
  for (const company of companies) {
    const r = await withTenantScope({ companyId: company.id, organizationId: company.organizationId }, () => runForCompany(company, now, mailer));
    total.candidates += r.candidates;
    total.sent += r.sent;
    total.failed += r.failed;
    total.noAddress += r.noAddress;
    total.mailNotConfigured += r.mailNotConfigured;
  }
  return total;
}

async function runForCompany(company: { id: string; slug: string; defaultLocale: string }, now: Date, mailer: Mailer | null) {
  const today = todayInDisplayZone(now);
  // Upper bound with slack for month-end clamping; the exact rule is isReminderWindow.
  const upper = dateFromIso(addCalendarMonths(today, 1));
  upper.setUTCDate(upper.getUTCDate() + 4);
  const window = { gte: dateFromIso(today), lte: upper };
  const employeeWhere = { archivedAt: null, status: "ACTIVE" as const };
  const select = { id: true, firstName: true, lastName: true, email: true, userId: true };
  const client = readClient();

  const [quals, trainings, settings] = await Promise.all([
    client.employeeQualification.findMany({
      where: { companyId: company.id, remindBeforeExpiry: true, archivedAt: null, replacedAt: null, expiresOn: window, employee: employeeWhere },
      include: { employee: { select } },
    }),
    client.training.findMany({
      where: { companyId: company.id, remindBeforeExpiry: true, archivedAt: null, status: "COMPLETED", expiresOn: window, employee: employeeWhere },
      include: { employee: { select } },
    }),
    client.hrSettings.findUnique({ where: { companyId: company.id } }),
  ]);
  const candidates: Candidate[] = [
    ...quals.map((q) => ({ sourceType: "QUALIFICATION" as const, sourceId: q.id, name: q.name, expiresOn: q.expiresOn!, employee: q.employee })),
    ...trainings.map((t) => ({ sourceType: "TRAINING" as const, sourceId: t.id, name: t.name, expiresOn: t.expiresOn!, employee: t.employee })),
  ].filter((c) => isReminderWindow(isoDate(c.expiresOn), today));

  const result = { candidates: candidates.length, sent: 0, failed: 0, noAddress: 0, mailNotConfigured: 0 };
  if (candidates.length === 0) return result;

  const userIds = [...new Set(candidates.map((c) => c.employee.userId).filter((x): x is string => !!x))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, locale: true } }) : [];

  await runInTransaction((tx) =>
    tx.expiryReminder.createMany({
      data: candidates.flatMap((c) =>
        (["OWNER", "MAINTENANCE"] as const).map((recipientKind) => ({
          companyId: company.id,
          sourceType: c.sourceType,
          sourceId: c.sourceId,
          employeeId: c.employee.id,
          expiresOn: c.expiresOn,
          dueOn: dateFromIso(reminderDueDate(isoDate(c.expiresOn))),
          recipientKind,
        })),
      ),
      skipDuplicates: true,
    }),
  );

  for (const c of candidates) {
    const rows = await client.expiryReminder.findMany({ where: { companyId: company.id, sourceType: c.sourceType, sourceId: c.sourceId, expiresOn: c.expiresOn, status: { not: "SENT" } } });
    for (const row of rows) {
      const user = users.find((u) => u.id === c.employee.userId) ?? null;
      const email = row.recipientKind === "OWNER" ? (c.employee.email ?? user?.email ?? null) : (settings?.reminderEmail ?? null);
      const locale = row.recipientKind === "OWNER" ? (user?.locale ?? company.defaultLocale) : company.defaultLocale;
      if (row.attempts >= MAX_ATTEMPTS && row.status === "FAILED") continue;
      if (!email) {
        result.noAddress += 1;
        if (row.status !== "NO_ADDRESS") await runInTransaction((tx) => tx.expiryReminder.update({ where: { id: row.id }, data: { status: "NO_ADDRESS", recipientEmail: null, lastError: null } }));
        continue;
      }
      if (!mailer) {
        result.mailNotConfigured += 1;
        await runInTransaction((tx) => tx.expiryReminder.update({ where: { id: row.id }, data: { status: "PENDING", recipientEmail: email, lastError: "MAIL_NOT_CONFIGURED" } }));
        continue;
      }
      // Claim the row so a parallel run (another instance) cannot send it too.
      const claimed = await runInTransaction((tx) =>
        tx.expiryReminder.updateMany({
          where: {
            id: row.id,
            attempts: { lt: MAX_ATTEMPTS },
            OR: [{ status: { in: ["PENDING", "FAILED", "NO_ADDRESS"] } }, { status: "SENDING", lockedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } }],
          },
          data: { status: "SENDING", lockedAt: now, recipientEmail: email },
        }),
      );
      if (claimed.count !== 1) continue;
      const params = {
        name: c.name,
        employee: `${c.employee.firstName} ${c.employee.lastName}`,
        date: formatFi(c.expiresOn),
        link: `${appBaseUrl()}/c/${company.slug}/workforce/${c.employee.id}?tab=qualifications`,
      };
      try {
        await mailer.send({
          to: email,
          subject: translate(locale, "mail.expiryReminderSubject", params),
          text: translate(locale, row.recipientKind === "OWNER" ? "mail.expiryReminderOwnerBody" : "mail.expiryReminderMaintenanceBody", params),
        });
        await runInTransaction((tx) => tx.expiryReminder.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null, lockedAt: null } }));
        result.sent += 1;
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        await runInTransaction((tx) => tx.expiryReminder.update({ where: { id: row.id }, data: { status: "FAILED", attempts: { increment: 1 }, lastError: message, lockedAt: null } }));
        console.error("expiry reminder failed", { reminderId: row.id, error: message });
        result.failed += 1;
      }
    }
  }
  return result;
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

/** Starts the hourly scheduler once per process (src/instrumentation.ts). */
export function startReminderScheduler(intervalMinutes: number) {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runExpiryReminders();
      if (r.candidates > 0) console.log("expiry reminders", r);
    } catch (e) {
      console.error("expiry reminder run failed", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 60_000).unref?.();
  timer = setInterval(tick, intervalMinutes * 60_000);
  timer.unref?.();
}
