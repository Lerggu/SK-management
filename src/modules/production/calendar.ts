/**
 * Calendar rules (pure, unit tested; ADR 0026): the visible range for a
 * zoom level, time-axis ticks in Helsinki time, a bar's position, and the
 * display phase of a logistics task.
 */
import { utcToZoned, zonedToUtc } from "@/platform/i18n/time";

export const ZOOMS = ["day", "week", "twoWeeks", "month"] as const;
export type Zoom = (typeof ZOOMS)[number];

const ZOOM_DAYS: Record<Zoom, number> = { day: 1, week: 7, twoWeeks: 14, month: 28 };
/** Working-day window on the day view (06–22 local time). */
export const DAY_START_MINUTE = 6 * 60;
export const DAY_END_MINUTE = 22 * 60;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week of a local date. */
export function weekMonday(iso: string): string {
  const dow = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

export interface CalendarRange {
  zoom: Zoom;
  /** First local date shown. */
  startDate: string;
  days: number;
  from: Date;
  to: Date;
  prevDate: string;
  nextDate: string;
}

/** The range shown for a zoom level around a local date (weeks start on Monday). */
export function calendarRange(zoom: Zoom, date: string): CalendarRange {
  const days = ZOOM_DAYS[zoom];
  const startDate = zoom === "day" ? date : weekMonday(date);
  const from = zoom === "day" ? zonedToUtc(startDate, DAY_START_MINUTE) : zonedToUtc(startDate, 0);
  const to = zoom === "day" ? zonedToUtc(startDate, DAY_END_MINUTE) : zonedToUtc(addDays(startDate, days), 0);
  return { zoom, startDate, days, from, to, prevDate: addDays(startDate, -days), nextDate: addDays(startDate, days) };
}

export interface Tick {
  /** Position from the start of the range, 0–100. */
  left: number;
  label: string;
  /** A day boundary (stronger line). */
  major: boolean;
  date: string;
}

/** Hour ticks on the day view, day ticks otherwise (labels are local, "ma 16.11." / "08"). */
export function calendarTicks(range: CalendarRange, weekday: (iso: string) => string): Tick[] {
  const span = range.to.getTime() - range.from.getTime();
  const pos = (d: Date) => ((d.getTime() - range.from.getTime()) / span) * 100;
  if (range.zoom === "day") {
    const out: Tick[] = [];
    for (let m = DAY_START_MINUTE; m < DAY_END_MINUTE; m += 60) out.push({ left: pos(zonedToUtc(range.startDate, m)), label: String(m / 60).padStart(2, "0"), major: false, date: range.startDate });
    return out;
  }
  return Array.from({ length: range.days }, (_, i) => {
    const date = addDays(range.startDate, i);
    const [, mm, dd] = date.split("-");
    return { left: pos(zonedToUtc(date, 0)), label: `${weekday(date)} ${Number(dd)}.${Number(mm)}.`, major: weekday(date) === weekday(range.startDate), date };
  });
}

/** A bar's left and width (percent), clipped to the range; null when outside. */
export function barPosition(range: CalendarRange, start: Date, end: Date): { left: number; width: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const a = Math.max(start.getTime(), range.from.getTime());
  const b = Math.min(end.getTime(), range.to.getTime());
  if (b <= a) return null;
  const span = range.to.getTime() - range.from.getTime();
  return { left: ((a - range.from.getTime()) / span) * 100, width: Math.max(((b - a) / span) * 100, 0.6), clippedStart: start < range.from, clippedEnd: end > range.to };
}

export type TaskPhase = "PLANNED" | "MISSING_RESOURCES" | "READY" | "IN_PROGRESS" | "COMPLETE" | "LATE";

/**
 * Display phase of a logistics task. A task whose end has passed without
 * completion is LATE. Approved and scheduled tasks are READY when every
 * resource need is staffed, otherwise MISSING_RESOURCES.
 */
export function taskPhase(t: { status: string; end: Date; missing: number; hasType: boolean }, now: Date): TaskPhase {
  if (t.status === "COMPLETE") return "COMPLETE";
  if (t.end < now) return "LATE";
  if (t.status === "IN_PROGRESS") return "IN_PROGRESS";
  if (t.status === "APPROVED" || t.status === "SCHEDULED") return t.hasType && t.missing === 0 ? "READY" : "MISSING_RESOURCES";
  return "PLANNED";
}

/** Local date of an instant (Helsinki). */
export const localDate = (d: Date) => utcToZoned(d).date;
