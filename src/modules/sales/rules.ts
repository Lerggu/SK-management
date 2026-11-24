import { D, roundCents, type Decimal } from "@/modules/finance/calculations";
import type { Prisma } from "@/platform/db";

/**
 * Order confirmation and invoice formulas (docs/adr/0033-sales-documents.md).
 * Pure and Decimal-only. Each line is rounded to cents half-up; VAT is
 * computed per rate from the rounded line sums, as Finnish invoices show it.
 */
export const SALES_DOCUMENT_KINDS = ["ORDER_CONFIRMATION", "INVOICE", "CREDIT_NOTE"] as const;
export type SalesDocumentKind = (typeof SALES_DOCUMENT_KINDS)[number];
export const SALES_VAT_MODES = ["STANDARD", "REVERSE_CHARGE"] as const;
export type SalesVatMode = (typeof SALES_VAT_MODES)[number];

/** Finnish VAT rates in force 2026 (general 25.5 %, reduced 13.5 % and 10 %, zero). */
export const VAT_RATES = ["25.5", "13.5", "10", "0"] as const;
/** Common units; any short text is accepted. */
export const COMMON_UNITS = ["kpl", "m", "km", "kg", "t", "h", "pv", "erä", "rll", "m²", "m³", "l"] as const;

export interface PricedLineInput {
  quantity: Prisma.Decimal.Value;
  unitPrice: Prisma.Decimal.Value;
  discountPct?: Prisma.Decimal.Value | null;
  vatRate: Prisma.Decimal.Value;
}

/** round(quantity × unit price × (1 − discount %), 2) — matches CHECK sales_document_lines_amount. */
export function lineAmount(l: Omit<PricedLineInput, "vatRate">): Decimal {
  const discount = D(l.discountPct ?? 0);
  return roundCents(D(l.quantity).times(D(l.unitPrice)).times(D(1).minus(discount.div(100))));
}

export interface VatGroup {
  rate: Decimal;
  net: Decimal;
  vat: Decimal;
}

export interface DocumentTotals {
  net: Decimal;
  vat: Decimal;
  gross: Decimal;
  /** One group per VAT rate, highest rate first; a single 0 % group under reverse charge. */
  groups: VatGroup[];
}

/**
 * net = Σ line amounts; VAT per rate = round(Σ net at that rate × rate %);
 * gross = net + Σ VAT. Under reverse charge (AVL 8 c §) no VAT is charged.
 */
export function documentTotals(lines: PricedLineInput[], vatMode: SalesVatMode): DocumentTotals {
  const byRate = new Map<string, Decimal>();
  let net = D(0);
  for (const l of lines) {
    const amount = lineAmount(l);
    net = net.plus(amount);
    const key = vatMode === "REVERSE_CHARGE" ? "0" : D(l.vatRate).toString();
    byRate.set(key, (byRate.get(key) ?? D(0)).plus(amount));
  }
  const groups = [...byRate.entries()]
    .map(([rate, groupNet]) => ({ rate: D(rate), net: groupNet, vat: roundCents(groupNet.times(D(rate)).div(100)) }))
    .sort((a, b) => b.rate.comparedTo(a.rate));
  const vat = groups.reduce((s, g) => s.plus(g.vat), D(0));
  return { net, vat, gross: net.plus(vat), groups };
}

/**
 * Finnish reference number (viitenumero): the base digits followed by a check
 * digit from the weights 7, 3, 1 repeated from the right. The base must have
 * 3–19 digits.
 */
export function finnishReference(base: string): string {
  const digits = base.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 19) throw new Error("Reference base must have 3–19 digits");
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += Number(digits[digits.length - 1 - i]) * weights[i % 3];
  return `${digits}${(10 - (sum % 10)) % 10}`;
}

export function isValidFinnishReference(ref: string): boolean {
  const digits = ref.replace(/\s/g, "");
  return /^\d{4,20}$/.test(digits) && finnishReference(digits.slice(0, -1)) === digits;
}

/** Printed in groups of five from the right, as banks do: "12 34561". */
export function formatReference(ref: string): string {
  const out: string[] = [];
  for (let end = ref.length; end > 0; end -= 5) out.unshift(ref.slice(Math.max(0, end - 5), end));
  return out.join(" ");
}

/** IBAN check (ISO 13616 mod 97). Spaces are ignored. */
export function isValidIban(iban: string): boolean {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** "FI49 5000 9420 0287 30". */
export function formatIban(iban: string): string {
  return iban
    .replace(/\s/g, "")
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

/** Finnish business ID with a valid check digit ("1234567-8"). */
export function isValidBusinessId(id: string): boolean {
  const m = /^(\d{7})-(\d)$/.exec(id.trim());
  if (!m) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2];
  const sum = [...m[1]].reduce((s, d, i) => s + Number(d) * weights[i], 0);
  const rem = sum % 11;
  if (rem === 1) return false;
  return (rem === 0 ? 0 : 11 - rem) === Number(m[2]);
}

/** EU VAT number of a Finnish business ID: "1234567-8" → "FI12345678". */
export function finnishVatNumber(businessId: string): string {
  return `FI${businessId.replace(/\D/g, "")}`;
}

/**
 * Finnish bank virtual barcode (pankkiviivakoodi, version 4) for a euro
 * invoice with a national reference number, or null when it cannot be formed
 * (not a Finnish IBAN, amount over 999 999,99 €, or not a positive amount).
 */
export function virtualBarcode(input: { iban: string; amount: Prisma.Decimal.Value; reference: string; dueDate: Date | null }): string | null {
  const iban = input.iban.replace(/\s/g, "").toUpperCase();
  if (!/^FI\d{16}$/.test(iban)) return null;
  const cents = D(input.amount).times(100);
  if (!cents.isInteger() || cents.lte(0) || cents.gt(99999999)) return null;
  const ref = input.reference.replace(/\s/g, "");
  if (!/^\d{4,20}$/.test(ref)) return null;
  const euros = cents.div(100).floor().toString().padStart(6, "0");
  const c = cents.mod(100).toString().padStart(2, "0");
  const due = input.dueDate ? input.dueDate.toISOString().slice(2, 10).replace(/-/g, "") : "000000";
  return `4${iban.slice(2)}${euros}${c}000${ref.padStart(20, "0")}${due}`;
}

/** Due date = issue date + payment term days (dates are UTC midnights). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Comma/semicolon/space separated e-mail list → lower-cased unique addresses.
 * Returns null when any entry is not an e-mail address.
 */
export function parseEmailList(value: string | null | undefined): string[] | null {
  const parts = (value ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.some((p) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p))) return null;
  return [...new Set(parts)];
}
