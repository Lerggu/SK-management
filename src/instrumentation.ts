/**
 * Next.js start-up hook. Starts the HR expiry-reminder scheduler (ADR 0025)
 * in the Node.js server process, so reminders go out even when nobody uses
 * the application. Duplicate sends are prevented in the database, so more
 * than one instance is safe.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env, isReminderSchedulerEnabled } = await import("@/platform/config/env");
  if (!isReminderSchedulerEnabled()) return;
  await import("@/modules/registry");
  const { startReminderScheduler } = await import("@/modules/hr/reminders");
  startReminderScheduler(env().HR_REMINDER_INTERVAL_MINUTES);
}
