/**
 * Display formatting. Timestamps are shown in Europe/Helsinki (the next-intl
 * time zone); date-only columns are stored at UTC midnight and formatted in
 * UTC so the calendar day never shifts. Money is formatted for display only —
 * calculations never use floats.
 */
import type { createFormatter } from "next-intl";

type Formatter = ReturnType<typeof createFormatter>;

export function fmtDate(format: Formatter, d: Date | null | undefined): string {
  return d ? format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" }) : "–";
}

export function fmtDateTime(format: Formatter, d: Date | null | undefined): string {
  return d ? format.dateTime(d, { dateStyle: "short", timeStyle: "short" }) : "–";
}

export function fmtMoney(format: Formatter, amount: { toString(): string } | null | undefined, currency = "EUR"): string {
  if (amount === null || amount === undefined) return "–";
  return format.number(Number(amount.toString()), { style: "currency", currency, minimumFractionDigits: 2 });
}

export function fmtNumber(format: Formatter, n: { toString(): string } | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "–";
  return format.number(Number(n.toString()), { maximumFractionDigits: digits });
}

/** "YYYY-MM-DD" for date inputs. */
export function isoDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Message key for a dotted code (next-intl keys cannot contain dots). */
export function codeKey(code: string): string {
  return code.replaceAll(".", "_");
}
