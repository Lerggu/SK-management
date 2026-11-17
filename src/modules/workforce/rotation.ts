/**
 * Pure rules of the workforce rotation plan (docs/adr/0027-workforce-rotation.md).
 */
export const ROTATION_STATUSES = ["WORK", "OFF", "VACATION", "SICK", "TRAINING", "OTHER"] as const;
export type RotationStatus = (typeof ROTATION_STATUSES)[number];
/** What members without rotation.manage see for SICK and OTHER. */
export type VisibleStatus = RotationStatus | "ABSENT";
/** Absences a rotation pattern never overwrites. */
export const PROTECTED: ReadonlySet<RotationStatus> = new Set(["VACATION", "SICK", "TRAINING", "OTHER"]);
/** Longest range set or cleared in one go. */
export const MAX_RANGE_DAYS = 366;

const DAY = 86_400_000;
export const toDay = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** Inclusive list of ISO dates; [] when until is before from. */
export function daysBetween(from: string, until: string): string[] {
  const a = toDay(from).getTime();
  const b = toDay(until).getTime();
  const out: string[] = [];
  for (let t = a; t <= b; t += DAY) out.push(isoOf(new Date(t)));
  return out;
}

/** "N days at work, M days off" from `from` to `until` (inclusive), starting with work. */
export function patternDays(from: string, until: string, workDays: number, offDays: number): { day: string; status: "WORK" | "OFF" }[] {
  const cycle = workDays + offDays;
  return daysBetween(from, until).map((day, i) => ({ day, status: i % cycle < workDays ? "WORK" : "OFF" }));
}

/**
 * Sick leave is health data and "other" may reveal private reasons: members
 * without rotation.manage see them as ABSENT, without notes.
 */
export function visibleEntry<E extends { status: RotationStatus; note: string | null }>(e: E, canManage: boolean): Omit<E, "status" | "note"> & { status: VisibleStatus; note: string | null } {
  if (canManage) return e;
  const hidden = e.status === "SICK" || e.status === "OTHER";
  return { ...e, status: hidden ? "ABSENT" : e.status, note: null };
}

/** Monday of the ISO week of `iso`. */
export function weekStart(iso: string): string {
  const d = toDay(iso);
  return isoOf(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY));
}

export function addDays(iso: string, n: number): string {
  return isoOf(new Date(toDay(iso).getTime() + n * DAY));
}
