export const LOCALES = ["fi", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];
/** Finnish is the default UI language (owner requirement). */
export const DEFAULT_LOCALE: AppLocale = "fi";
export const LOCALE_COOKIE = "sk_locale";
/** Timestamps are stored in UTC and displayed in Helsinki time. */
export const DISPLAY_TIME_ZONE = "Europe/Helsinki";

export function toLocale(value: string | null | undefined): AppLocale {
  return (LOCALES as readonly string[]).includes(value ?? "") ? (value as AppLocale) : DEFAULT_LOCALE;
}

/** Today's calendar date (YYYY-MM-DD) in Helsinki, for date-only fields. */
export function todayInDisplayZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
