import { Prisma } from "@/platform/db";

/**
 * Pure time-tracking rules (unit tested).
 * Workflow: DRAFT → SUBMITTED → APPROVED | REJECTED → (APPROVED) EXPORTED.
 * Approved and exported entries are locked; corrections are new entries.
 */
export type TimeEntryStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "EXPORTED";

export const EDITABLE_STATUSES: readonly TimeEntryStatus[] = ["DRAFT", "REJECTED"];
export const SUBMITTABLE_STATUSES: readonly TimeEntryStatus[] = ["DRAFT", "REJECTED"];
export const CORRECTABLE_STATUSES: readonly TimeEntryStatus[] = ["APPROVED", "EXPORTED"];

export function isEditable(status: TimeEntryStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** "07:30" → 450. Returns null for invalid input. */
export function parseClock(value: string): number | null {
  const m = /^([01]?\d|2[0-4]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= 1440 ? minutes : null;
}

export function formatClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Hours between two clock times, rounded to 2 decimals (no overnight). */
export function hoursBetween(startMinute: number, endMinute: number): Prisma.Decimal {
  return new Prisma.Decimal(endMinute - startMinute).div(60).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Monday (UTC midnight) of the ISO week containing `date`. */
export function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** [Monday, next Monday) for the week containing `date`. */
export function weekRange(date: Date): { from: Date; to: Date } {
  const from = weekStart(date);
  return { from, to: addDays(from, 7) };
}

export function isoDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
