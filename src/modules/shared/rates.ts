import { z } from "zod";
import { currency, dateOnly, decimalString, optionalDate } from "@/platform/http/validation";

/** Shared input schema for employee and equipment rates. */
export const rateSchema = z
  .object({
    rateType: z.enum(["COST", "BILLING"]),
    unit: z.enum(["HOUR", "DAY"]).default("HOUR"),
    amount: decimalString(12, 2),
    currency: currency(),
    validFrom: dateOnly(),
    validTo: optionalDate(),
  })
  .refine((v) => !v.validTo || v.validTo >= v.validFrom, { path: ["validTo"], message: "validation.endBeforeStart" });
export type RateInput = z.input<typeof rateSchema>;

export interface RateRow {
  id: string;
  rateType: "COST" | "BILLING";
  validFrom: Date;
  validTo: Date | null;
  archivedAt: Date | null;
}

const DAY_MS = 86_400_000;

/**
 * When a new rate starts, the open-ended rate of the same type that started
 * earlier is closed the day before. Returns the rows to close and their new
 * validTo. Rates are never overwritten; history stays queryable.
 */
export function ratesToClose(existing: readonly RateRow[], incoming: { rateType: "COST" | "BILLING"; validFrom: Date }) {
  return existing
    .filter((r) => !r.archivedAt && r.rateType === incoming.rateType && r.validTo === null && r.validFrom < incoming.validFrom)
    .map((r) => ({ id: r.id, validTo: new Date(incoming.validFrom.getTime() - DAY_MS) }));
}

/** Detects overlap with an existing closed or open period of the same type. */
export function overlapsExisting(
  existing: readonly RateRow[],
  incoming: { rateType: "COST" | "BILLING"; validFrom: Date; validTo: Date | null },
  closing: ReadonlySet<string>,
): boolean {
  const inEnd = incoming.validTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return existing.some((r) => {
    if (r.archivedAt || r.rateType !== incoming.rateType || closing.has(r.id)) return false;
    const rEnd = r.validTo?.getTime() ?? Number.POSITIVE_INFINITY;
    return r.validFrom.getTime() <= inEnd && incoming.validFrom.getTime() <= rEnd;
  });
}

/** The rate in force on `date` for each type. */
export function currentRates<T extends RateRow>(rates: readonly T[], date = new Date()) {
  const t = date.getTime();
  const pick = (type: "COST" | "BILLING") =>
    rates
      .filter((r) => !r.archivedAt && r.rateType === type && r.validFrom.getTime() <= t && (r.validTo === null || r.validTo.getTime() + DAY_MS > t))
      .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0] ?? null;
  return { cost: pick("COST"), billing: pick("BILLING") };
}
