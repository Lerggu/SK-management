import { createHash } from "node:crypto";
import { D, roundCents, type Decimal } from "@/modules/finance/calculations";
import { Prisma } from "@/platform/db";

/**
 * V6 commercial formulas (Build Master §21–§22, docs/adr/0019). Pure and
 * Decimal-only; every priced value is rounded to cents half-up and totals
 * are sums of rounded values.
 */
const ZERO = D(0);
const pct = (v: Prisma.Decimal.Value) => D(v).div(100);

export const QUOTE_LINE_CATEGORIES = ["LABOR", "EQUIPMENT", "LIFTING", "TRANSPORT", "MATERIALS", "TRAVEL", "ACCOMMODATION", "SUBCONTRACT", "OTHER"] as const;
export type QuoteLineCategory = (typeof QUOTE_LINE_CATEGORIES)[number];

export interface QuoteLineInput {
  category: QuoteLineCategory;
  quantity: Prisma.Decimal.Value;
  unitCost: Prisma.Decimal.Value;
}

export interface QuotePricing {
  byCategory: Record<QuoteLineCategory, Decimal>;
  base: Decimal;
  overhead: Decimal;
  risk: Decimal;
  /** base + overhead + risk reserve */
  cost: Decimal;
  price: Decimal;
  margin: Decimal;
  /** margin / price × 100, one decimal; null when the price is zero */
  marginPct: Decimal | null;
}

/**
 * base = Σ round(quantity × unit cost)
 * overhead = round(base × overhead %)
 * risk reserve = round((base + overhead) × risk %)
 * price = round(cost / (1 − margin %)), so margin % is the share of the price.
 */
export function priceQuote(lines: readonly QuoteLineInput[], v: { overheadPct: Prisma.Decimal.Value; riskPct: Prisma.Decimal.Value; marginPct: Prisma.Decimal.Value }): QuotePricing {
  const byCategory = Object.fromEntries(QUOTE_LINE_CATEGORIES.map((c) => [c, ZERO])) as Record<QuoteLineCategory, Decimal>;
  let base = ZERO;
  for (const l of lines) {
    const amount = roundCents(D(l.quantity).times(D(l.unitCost)));
    byCategory[l.category] = byCategory[l.category].plus(amount);
    base = base.plus(amount);
  }
  const overhead = roundCents(base.times(pct(v.overheadPct)));
  const risk = roundCents(base.plus(overhead).times(pct(v.riskPct)));
  const cost = base.plus(overhead).plus(risk);
  const m = pct(v.marginPct);
  if (m.greaterThanOrEqualTo(1)) throw new Error("margin must be below 100 %");
  const price = roundCents(cost.div(D(1).minus(m)));
  const margin = price.minus(cost);
  return { byCategory, base, overhead, risk, cost, price, margin, marginPct: price.isZero() ? null : margin.div(price).times(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP) };
}

export interface VariationCosts {
  laborCost: Prisma.Decimal.Value;
  equipmentCost: Prisma.Decimal.Value;
  materialsCost: Prisma.Decimal.Value;
  subcontractCost: Prisma.Decimal.Value;
  otherCost: Prisma.Decimal.Value;
  markupPct: Prisma.Decimal.Value;
}

/** sales price = round(Σ costs × (1 + markup %)) (Build Master §21). */
export function priceVariation(v: VariationCosts): { cost: Decimal; markup: Decimal; salesPrice: Decimal } {
  const cost = [v.laborCost, v.equipmentCost, v.materialsCost, v.subcontractCost, v.otherCost].reduce<Decimal>((s, x) => s.plus(D(x)), ZERO);
  const salesPrice = roundCents(cost.times(D(1).plus(pct(v.markupPct))));
  return { cost, markup: salesPrice.minus(cost), salesPrice };
}

/** Variation states whose value counts as approved revenue. */
export const VARIATION_APPROVED_STATES = ["APPROVED", "EXECUTED", "READY_TO_INVOICE", "INVOICED"] as const;
/** Approved but not yet invoiced (dashboard figure, §21). */
export const VARIATION_UNINVOICED_STATES = ["APPROVED", "EXECUTED", "READY_TO_INVOICE"] as const;

export interface ForecastInput {
  budget: Prisma.Decimal.Value | null;
  actualCost: Prisma.Decimal.Value;
  /** latest estimate to complete per category */
  etc: readonly Prisma.Decimal.Value[];
  contractValue: Prisma.Decimal.Value;
  approvedVariations: Prisma.Decimal.Value;
  invoiced: Prisma.Decimal.Value;
  openCandidates: Prisma.Decimal.Value;
}

export interface Forecast {
  budget: Decimal | null;
  actualCost: Decimal;
  etc: Decimal;
  /** estimate at completion = actual + ETC */
  eac: Decimal;
  /** budget − EAC (negative = forecast overrun); null without a budget */
  budgetVariance: Decimal | null;
  forecastRevenue: Decimal;
  forecastMargin: Decimal;
  forecastMarginPct: Decimal | null;
  invoiced: Decimal;
  /** billable (candidates generated) but not yet exported */
  unbilled: Decimal;
  /** forecast revenue not yet invoiced or billable */
  remainingToBill: Decimal;
}

/** Build Master §22: EAC = actual + ETC; forecast revenue = contract + approved variations. */
export function forecast(i: ForecastInput): Forecast {
  const actualCost = D(i.actualCost);
  const etc = i.etc.reduce<Decimal>((s, x) => s.plus(D(x)), ZERO);
  const eac = actualCost.plus(etc);
  const budget = i.budget === null ? null : D(i.budget);
  const forecastRevenue = D(i.contractValue).plus(D(i.approvedVariations));
  const forecastMargin = forecastRevenue.minus(eac);
  const invoiced = D(i.invoiced);
  const unbilled = D(i.openCandidates);
  const remaining = forecastRevenue.minus(invoiced).minus(unbilled);
  return {
    budget,
    actualCost,
    etc,
    eac,
    budgetVariance: budget === null ? null : budget.minus(eac),
    forecastRevenue,
    forecastMargin,
    forecastMarginPct: forecastRevenue.isZero() ? null : forecastMargin.div(forecastRevenue).times(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP),
    invoiced,
    unbilled,
    remainingToBill: remaining.isNegative() ? ZERO : remaining,
  };
}

/** amount = round(quantity × unit price) — mirrors the DB check constraint. */
export function lineAmount(quantity: Prisma.Decimal.Value, unitPrice: Prisma.Decimal.Value): Decimal {
  return roundCents(D(quantity).times(D(unitPrice)));
}

// ── workflows ────────────────────────────────────────────────────────
export type QuoteStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SENT" | "WON" | "LOST" | "SUPERSEDED";
export const QUOTE_FLOW: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["DRAFT", "APPROVED", "REJECTED"],
  APPROVED: ["SENT", "SUPERSEDED"],
  SENT: ["WON", "LOST", "SUPERSEDED"],
  REJECTED: [],
  WON: [],
  LOST: [],
  SUPERSEDED: [],
};

export type VariationStatus = "DRAFT" | "INTERNAL_REVIEW" | "SUBMITTED_TO_CLIENT" | "APPROVED" | "REJECTED" | "EXECUTED" | "READY_TO_INVOICE" | "INVOICED";
export const VARIATION_FLOW: Record<VariationStatus, VariationStatus[]> = {
  DRAFT: ["INTERNAL_REVIEW"],
  INTERNAL_REVIEW: ["DRAFT", "SUBMITTED_TO_CLIENT"],
  SUBMITTED_TO_CLIENT: ["APPROVED", "REJECTED"],
  APPROVED: ["EXECUTED"],
  EXECUTED: ["READY_TO_INVOICE"],
  READY_TO_INVOICE: ["INVOICED"],
  REJECTED: [],
  INVOICED: [],
};

export const OPPORTUNITY_STAGES = ["LEAD", "QUALIFIED", "RFQ", "TENDER", "NEGOTIATION", "WON", "LOST"] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/** Weighted pipeline: Σ estimated value × probability (open stages only). */
export function weightedPipeline(rows: readonly { stage: OpportunityStage; estimatedValue: Prisma.Decimal.Value | null; probabilityPct: number | null }[]): Decimal {
  return rows
    .filter((r) => r.stage !== "WON" && r.stage !== "LOST" && r.estimatedValue !== null)
    .reduce<Decimal>((s, r) => s.plus(roundCents(D(r.estimatedValue!).times(pct(r.probabilityPct ?? 0)))), ZERO);
}

// ── file export (owner decision 1) ───────────────────────────────────
export interface ExportRow {
  [key: string]: string;
}

/**
 * CSV for Finnish Excel: UTF-8 with BOM, semicolon separator, decimal
 * comma for the given numeric columns, CRLF line endings, RFC 4180 quoting.
 */
export function toCsv(columns: readonly string[], rows: readonly ExportRow[], numericColumns: ReadonlySet<string>): string {
  const esc = (v: string) => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const out = [columns.map(esc).join(";")];
  for (const r of rows) out.push(columns.map((c) => esc(numericColumns.has(c) ? (r[c] ?? "").replace(".", ",") : (r[c] ?? ""))).join(";"));
  return `﻿${out.join("\r\n")}\r\n`;
}

// ── billing rates ────────────────────────────────────────────────────
export interface BillingRate {
  resourceId: string;
  rateType: "COST" | "BILLING";
  unit: "HOUR" | "DAY";
  amount: Prisma.Decimal.Value;
  currency: string;
  validFrom: Date;
  validTo: Date | null;
}

/**
 * The hourly BILLING rate in force on `date` (validTo inclusive), in the
 * given currency. A line without one is reported as unpriced, never guessed.
 */
export function findHourlyBillingRate(rates: readonly BillingRate[], resourceId: string, date: Date, currency: string): Decimal | null {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const hit = rates
    .filter((r) => r.resourceId === resourceId && r.rateType === "BILLING" && r.unit === "HOUR" && r.currency === currency && r.validFrom.getTime() <= day && (r.validTo === null || r.validTo.getTime() >= day))
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
  return hit ? D(hit.amount) : null;
}

/** Booked hours of a period, two decimals. */
export function bookedHours(startsAt: Date, endsAt: Date): Decimal {
  return D(endsAt.getTime() - startsAt.getTime())
    .div(3_600_000)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

// ── V7: client approval snapshot (owner decision 2) ───────────────────
/**
 * The frozen content a client approves: never costs, markup or margin. The
 * hash is SHA-256 over canonical JSON (sorted keys), so the client's decision
 * is bound to exactly the version they saw.
 */
export interface ClientSnapshot {
  number: number;
  title: string;
  description: string | null;
  cause: string | null;
  clientReference: string | null;
  salesPrice: string;
  currency: string;
}

export function clientSnapshot(v: { number: number; title: string; description: string | null; cause: string | null; clientReference: string | null; salesPrice: Prisma.Decimal.Value; currency: string }): ClientSnapshot {
  return {
    number: v.number,
    title: v.title,
    description: v.description,
    cause: v.cause,
    clientReference: v.clientReference,
    salesPrice: roundCents(D(v.salesPrice)).toFixed(2),
    currency: v.currency,
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function snapshotHash(snapshot: ClientSnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}
