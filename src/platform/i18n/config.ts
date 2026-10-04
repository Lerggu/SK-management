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
