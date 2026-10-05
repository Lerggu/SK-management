/**
 * Working calendar arithmetic (pure, unit tested). All dates are UTC-midnight
 * `Date` values for `date` columns. Day-takt cycles count working days only.
 */
export interface WorkingCalendar {
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  workingWeekdays: readonly number[];
  /** Holiday dates as "YYYY-MM-DD". */
  holidays: ReadonlySet<string>;
}

const DAY_MS = 86_400_000;

export function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function shiftDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function isoWeekday(d: Date): number {
  return d.getUTCDay() || 7;
}

export function isWorkingDay(cal: WorkingCalendar, d: Date): boolean {
  return cal.workingWeekdays.includes(isoWeekday(d)) && !cal.holidays.has(toIsoDate(d));
}

/** `d` itself when it is a working day, otherwise the next working day. */
export function nextWorkingDay(cal: WorkingCalendar, d: Date): Date {
  if (cal.workingWeekdays.length === 0) throw new Error("calendar has no working weekdays");
  let cur = d;
  for (let i = 0; i < 3660 && !isWorkingDay(cal, cur); i++) cur = shiftDays(cur, 1);
  return cur;
}

/** The working day `n` working days after `start` (start normalized first; n ≥ 0). */
export function addWorkingDays(cal: WorkingCalendar, start: Date, n: number): Date {
  let cur = nextWorkingDay(cal, start);
  for (let i = 0; i < n; i++) cur = nextWorkingDay(cal, shiftDays(cur, 1));
  return cur;
}

/**
 * Signed number of working days from `from` to `to` (both normalized to the
 * next working day): 0 when they fall on the same working day.
 */
export function workingDaysBetween(cal: WorkingCalendar, from: Date, to: Date): number {
  const a = nextWorkingDay(cal, from);
  const b = nextWorkingDay(cal, to);
  if (a.getTime() === b.getTime()) return 0;
  const sign = a < b ? 1 : -1;
  const end = sign > 0 ? b : a;
  let cur = sign > 0 ? a : b;
  let count = 0;
  while (cur < end) {
    cur = nextWorkingDay(cal, shiftDays(cur, 1));
    count++;
    if (count > 36_500) throw new Error("date range too long");
  }
  return sign * count;
}

/** Working days in [from, to] inclusive. */
export function workingDaysInRange(cal: WorkingCalendar, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let cur = from; cur <= to; cur = shiftDays(cur, 1)) {
    if (isWorkingDay(cal, cur)) out.push(cur);
    if (out.length > 3660) break;
  }
  return out;
}

/** Easter Sunday (anonymous Gregorian algorithm). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

/** First date on or after `from` that falls on ISO weekday `weekday`. */
function onOrAfter(from: Date, weekday: number): Date {
  return shiftDays(from, (weekday - isoWeekday(from) + 7) % 7);
}

/**
 * Finnish public holidays plus the de facto non-working Midsummer Eve and
 * Christmas Eve. Holidays on weekends are included (harmless for Mon–Fri).
 */
export function finnishPublicHolidays(year: number): { date: Date; name: { fi: string; en: string } }[] {
  const easter = easterSunday(year);
  const list = [
    { date: utcDate(year, 1, 1), name: { fi: "Uudenvuodenpäivä", en: "New Year's Day" } },
    { date: utcDate(year, 1, 6), name: { fi: "Loppiainen", en: "Epiphany" } },
    { date: shiftDays(easter, -2), name: { fi: "Pitkäperjantai", en: "Good Friday" } },
    { date: easter, name: { fi: "Pääsiäispäivä", en: "Easter Sunday" } },
    { date: shiftDays(easter, 1), name: { fi: "2. pääsiäispäivä", en: "Easter Monday" } },
    { date: utcDate(year, 5, 1), name: { fi: "Vappu", en: "May Day" } },
    { date: shiftDays(easter, 39), name: { fi: "Helatorstai", en: "Ascension Day" } },
    { date: shiftDays(easter, 49), name: { fi: "Helluntaipäivä", en: "Whit Sunday" } },
    { date: onOrAfter(utcDate(year, 6, 19), 5), name: { fi: "Juhannusaatto", en: "Midsummer Eve" } },
    { date: onOrAfter(utcDate(year, 6, 20), 6), name: { fi: "Juhannuspäivä", en: "Midsummer Day" } },
    { date: onOrAfter(utcDate(year, 10, 31), 6), name: { fi: "Pyhäinpäivä", en: "All Saints' Day" } },
    { date: utcDate(year, 12, 6), name: { fi: "Itsenäisyyspäivä", en: "Independence Day" } },
    { date: utcDate(year, 12, 24), name: { fi: "Jouluaatto", en: "Christmas Eve" } },
    { date: utcDate(year, 12, 25), name: { fi: "Joulupäivä", en: "Christmas Day" } },
    { date: utcDate(year, 12, 26), name: { fi: "Tapaninpäivä", en: "St Stephen's Day" } },
  ];
  return list.sort((x, y) => x.date.getTime() - y.date.getTime());
}
