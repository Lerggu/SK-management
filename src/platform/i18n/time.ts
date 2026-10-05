import { DISPLAY_TIME_ZONE } from "./config";

/**
 * Wall-clock time in the display zone (Europe/Helsinki) ↔ UTC instants.
 * Handles DST: the offset is resolved at the resulting instant.
 */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** "2026-10-05" + 450 (07:30) in the display zone → UTC instant. */
export function zonedToUtc(dateIso: string, minuteOfDay: number, timeZone = DISPLAY_TIME_ZONE): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  let result = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  result = guess - offsetMinutes(new Date(result), timeZone) * 60_000;
  return new Date(result);
}

/** UTC instant → display-zone date ("YYYY-MM-DD") and minute of day. */
export function utcToZoned(instant: Date, timeZone = DISPLAY_TIME_ZONE): { date: string; minute: number } {
  const local = new Date(instant.getTime() + offsetMinutes(instant, timeZone) * 60_000);
  return { date: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** "07:30" → 450; null when invalid. */
export function parseClockTime(value: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** "2026-10-05T07:30" (datetime-local) in the display zone → UTC instant; null when invalid. */
export function parseLocalDateTime(value: string, timeZone = DISPLAY_TIME_ZONE): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value.trim());
  if (!m) return null;
  const minute = parseClockTime(m[2]);
  return minute === null ? null : zonedToUtc(m[1], minute, timeZone);
}

/** UTC instant → "YYYY-MM-DDTHH:mm" for datetime-local inputs. */
export function toLocalDateTimeInput(instant: Date, timeZone = DISPLAY_TIME_ZONE): string {
  const z = utcToZoned(instant, timeZone);
  return `${z.date}T${formatMinute(z.minute)}`;
}
