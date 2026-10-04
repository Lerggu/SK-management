import { describe, expect, it } from "vitest";
import { currentRates, overlapsExisting, ratesToClose, type RateRow } from "./rates";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const rate = (id: string, type: "COST" | "BILLING", from: string, to: string | null, archived = false): RateRow => ({
  id,
  rateType: type,
  validFrom: d(from),
  validTo: to ? d(to) : null,
  archivedAt: archived ? d("2026-01-01") : null,
});

describe("rate periods", () => {
  it("closes the open-ended earlier rate of the same type the day before", () => {
    const existing = [rate("a", "COST", "2026-01-01", null), rate("b", "BILLING", "2026-01-01", null)];
    expect(ratesToClose(existing, { rateType: "COST", validFrom: d("2026-07-01") })).toEqual([{ id: "a", validTo: d("2026-06-30") }]);
  });

  it("detects overlaps with closed periods", () => {
    const existing = [rate("a", "COST", "2026-01-01", "2026-06-30")];
    expect(overlapsExisting(existing, { rateType: "COST", validFrom: d("2026-06-01"), validTo: null }, new Set())).toBe(true);
    expect(overlapsExisting(existing, { rateType: "COST", validFrom: d("2026-07-01"), validTo: null }, new Set())).toBe(false);
    expect(overlapsExisting(existing, { rateType: "BILLING", validFrom: d("2026-06-01"), validTo: null }, new Set())).toBe(false);
  });

  it("ignores archived rates and rates being closed", () => {
    const existing = [rate("a", "COST", "2026-01-01", null), rate("x", "COST", "2026-03-01", null, true)];
    expect(overlapsExisting(existing, { rateType: "COST", validFrom: d("2026-07-01"), validTo: null }, new Set(["a"]))).toBe(false);
  });

  it("picks the rate in force on a date (validTo inclusive)", () => {
    const rates = [rate("old", "COST", "2025-01-01", "2025-12-31"), rate("new", "COST", "2026-01-01", null)];
    expect(currentRates(rates, d("2025-12-31")).cost?.id).toBe("old");
    expect(currentRates(rates, d("2026-02-01")).cost?.id).toBe("new");
    expect(currentRates(rates, d("2024-02-01")).cost).toBeNull();
  });
});
