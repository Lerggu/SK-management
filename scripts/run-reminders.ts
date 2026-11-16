/**
 * Runs the HR expiry-reminder job once (ADR 0025), e.g. from a scheduler
 * outside the app or for troubleshooting: `pnpm hr:reminders`.
 */
import "dotenv/config";
import { runExpiryReminders } from "@/modules/hr/reminders";
import { db } from "@/platform/db";

runExpiryReminders()
  .then((r) => console.log("Expiry reminders:", r))
  .catch((e) => {
    console.error("Expiry reminders failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
