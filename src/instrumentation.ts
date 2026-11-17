/**
 * Next.js start-up hook. Starts the HR expiry-reminder scheduler (ADR 0025)
 * in the Node.js server process, so reminders go out even when nobody uses
 * the application, and the marketing agents (ADR 0032). Duplicate sends are
 * prevented in the database, so more than one instance is safe.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env, isMarketingSchedulerEnabled, isReminderSchedulerEnabled } = await import("@/platform/config/env");
  const reminders = isReminderSchedulerEnabled();
  const marketing = isMarketingSchedulerEnabled();
  if (!reminders && !marketing) return;
  await import("@/modules/registry");
  if (reminders) {
    const { startReminderScheduler } = await import("@/modules/hr/reminders");
    startReminderScheduler(env().HR_REMINDER_INTERVAL_MINUTES);
  }
  if (marketing) {
    // Marketing agents (ADR 0032): companies run only when enabled in their settings.
    const { startMarketingScheduler } = await import("@/modules/marketing/agents");
    startMarketingScheduler();
  }
}
