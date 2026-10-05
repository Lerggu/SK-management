import { Prisma } from "@/platform/db";

/**
 * Project cost calculations (Build Master §22, docs/adr/0010).
 *
 * Every formula that turns operational data into money lives here and is
 * covered by deterministic unit tests. Rules:
 * - Decimal arithmetic only (never floats).
 * - Each priced line is rounded to cents, half-up; totals are sums of the
 *   rounded lines.
 * - Only HOUR cost rates are applied. A line without a valid hourly cost rate
 *   in the project currency is reported as unpriced — never guessed.
 */
export type Decimal = Prisma.Decimal;
export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

export type WorkTimeClass = "NORMAL" | "OVERTIME_50" | "OVERTIME_100" | "TRAVEL";
export type CostCategory = "LABOR" | "EQUIPMENT" | "MATERIALS" | "SUBCONTRACT" | "OTHER";
export const COST_CATEGORIES: readonly CostCategory[] = ["LABOR", "EQUIPMENT", "MATERIALS", "SUBCONTRACT", "OTHER"];

/** Owner decision (docs/V2_PLAN.md #1). */
export const WORK_CLASS_MULTIPLIER: Readonly<Record<WorkTimeClass, Decimal>> = {
  NORMAL: D("1.0"),
  OVERTIME_50: D("1.5"),
  OVERTIME_100: D("2.0"),
  TRAVEL: D("1.0"),
};

export function roundCents(v: Decimal): Decimal {
  return v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface RatePeriod {
  resourceId: string;
  rateType: "COST" | "BILLING";
  unit: "HOUR" | "DAY";
  amount: Prisma.Decimal.Value;
  currency: string;
  validFrom: Date;
  validTo: Date | null;
  archivedAt?: Date | null;
}

export type UnpricedReason = "NO_HOURLY_COST_RATE" | "CURRENCY_MISMATCH";

/**
 * The hourly COST rate in force on `date` (date-only values at UTC midnight;
 * validTo is inclusive). Returns a reason when no usable rate exists.
 */
export function findHourlyCostRate(
  rates: readonly RatePeriod[],
  resourceId: string,
  date: Date,
  currency: string,
): { rate: Decimal } | { reason: UnpricedReason } {
  const t = date.getTime();
  const inForce = rates
    .filter(
      (r) =>
        r.resourceId === resourceId &&
        !r.archivedAt &&
        r.rateType === "COST" &&
        r.unit === "HOUR" &&
        r.validFrom.getTime() <= t &&
        (r.validTo === null || r.validTo.getTime() >= t),
    )
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());
  if (inForce.length === 0) return { reason: "NO_HOURLY_COST_RATE" };
  const sameCurrency = inForce.find((r) => r.currency === currency);
  if (!sameCurrency) return { reason: "CURRENCY_MISMATCH" };
  return { rate: D(sameCurrency.amount) };
}

export interface HoursLine {
  id: string;
  resourceId: string;
  date: Date;
  hours: Prisma.Decimal.Value;
  workClass?: WorkTimeClass;
}

export interface PricedLine {
  id: string;
  hours: Decimal;
  rate: Decimal;
  multiplier: Decimal;
  cost: Decimal;
}

export interface PricingResult {
  lines: PricedLine[];
  unpriced: { id: string; hours: Decimal; reason: UnpricedReason }[];
  totalCost: Decimal;
  totalHours: Decimal;
  unpricedHours: Decimal;
}

/**
 * cost = round(hours × hourly cost rate on the date × class multiplier).
 * Used for labour (approved hours, multiplier by work class) and for diary
 * equipment hours (multiplier 1.0). Negative hours (corrections) reduce cost.
 */
export function priceHours(lines: readonly HoursLine[], rates: readonly RatePeriod[], currency: string): PricingResult {
  const priced: PricedLine[] = [];
  const unpriced: PricingResult["unpriced"] = [];
  let totalCost = ZERO;
  let totalHours = ZERO;
  let unpricedHours = ZERO;
  for (const line of lines) {
    const hours = D(line.hours);
    totalHours = totalHours.plus(hours);
    const found = findHourlyCostRate(rates, line.resourceId, line.date, currency);
    if ("reason" in found) {
      unpriced.push({ id: line.id, hours, reason: found.reason });
      unpricedHours = unpricedHours.plus(hours);
      continue;
    }
    const multiplier = WORK_CLASS_MULTIPLIER[line.workClass ?? "NORMAL"];
    const cost = roundCents(hours.times(found.rate).times(multiplier));
    priced.push({ id: line.id, hours, rate: found.rate, multiplier, cost });
    totalCost = totalCost.plus(cost);
  }
  return { lines: priced, unpriced, totalCost, totalHours, unpricedHours };
}

export interface CategoryComparison {
  category: CostCategory;
  budget: Decimal;
  actual: Decimal;
  /** budget − actual (negative = over budget). */
  variance: Decimal;
  /** actual / budget × 100, one decimal; null when the budget is zero. */
  usedPercent: Decimal | null;
}

export function compareBudget(
  budgetLines: readonly { category: CostCategory; amount: Prisma.Decimal.Value }[],
  actuals: Partial<Record<CostCategory, Decimal>>,
): { categories: CategoryComparison[]; total: Omit<CategoryComparison, "category"> } {
  const budgetBy = new Map<CostCategory, Decimal>();
  for (const l of budgetLines) budgetBy.set(l.category, (budgetBy.get(l.category) ?? ZERO).plus(D(l.amount)));
  const row = (budget: Decimal, actual: Decimal) => ({
    budget,
    actual,
    variance: budget.minus(actual),
    usedPercent: budget.isZero() ? null : actual.div(budget).times(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP),
  });
  const categories = COST_CATEGORIES.map((category) => ({ category, ...row(budgetBy.get(category) ?? ZERO, actuals[category] ?? ZERO) }));
  const totalBudget = categories.reduce((s, c) => s.plus(c.budget), ZERO);
  const totalActual = categories.reduce((s, c) => s.plus(c.actual), ZERO);
  return { categories, total: row(totalBudget, totalActual) };
}

export function sumAmounts(values: readonly Prisma.Decimal.Value[]): Decimal {
  return values.reduce<Decimal>((s, v) => s.plus(D(v)), ZERO);
}
