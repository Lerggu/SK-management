import { describe, expect, it } from "vitest";
import { D, compareBudget, findHourlyCostRate, priceHours, roundCents, type RatePeriod } from "./calculations";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const rate = (resourceId: string, amount: string, from: string, to: string | null = null, extra: Partial<RatePeriod> = {}): RatePeriod => ({
  resourceId,
  rateType: "COST",
  unit: "HOUR",
  amount,
  currency: "EUR",
  validFrom: day(from),
  validTo: to ? day(to) : null,
  ...extra,
});

describe("finance calculations (deterministic)", () => {
  it("rounds half-up to cents", () => {
    expect(roundCents(D("10.005")).toString()).toBe("10.01");
    expect(roundCents(D("10.004")).toString()).toBe("10");
    expect(roundCents(D("-1.005")).toString()).toBe("-1.01");
  });

  it("labour cost = hours × hourly cost rate × class multiplier", () => {
    const rates = [rate("e1", "42.50", "2026-01-01")];
    const r = priceHours(
      [
        { id: "a", resourceId: "e1", date: day("2026-03-02"), hours: "8", workClass: "NORMAL" },
        { id: "b", resourceId: "e1", date: day("2026-03-02"), hours: "2", workClass: "OVERTIME_50" },
        { id: "c", resourceId: "e1", date: day("2026-03-08"), hours: "1.5", workClass: "OVERTIME_100" },
        { id: "d", resourceId: "e1", date: day("2026-03-09"), hours: "3", workClass: "TRAVEL" },
      ],
      rates,
      "EUR",
    );
    expect(r.lines.map((l) => l.cost.toString())).toEqual(["340", "127.5", "127.5", "127.5"]);
    expect(r.totalCost.toString()).toBe("722.5");
    expect(r.totalHours.toString()).toBe("14.5");
    expect(r.unpriced).toEqual([]);
  });

  it("uses the rate valid on the work date (validTo inclusive)", () => {
    const rates = [rate("e1", "40", "2026-01-01", "2026-06-30"), rate("e1", "45", "2026-07-01")];
    const r = priceHours(
      [
        { id: "june", resourceId: "e1", date: day("2026-06-30"), hours: "1" },
        { id: "july", resourceId: "e1", date: day("2026-07-01"), hours: "1" },
      ],
      rates,
      "EUR",
    );
    expect(r.lines.map((l) => [l.id, l.cost.toString()])).toEqual([
      ["june", "40"],
      ["july", "45"],
    ]);
  });

  it("corrections (negative hours) reduce cost", () => {
    const r = priceHours(
      [
        { id: "orig", resourceId: "e1", date: day("2026-03-02"), hours: "8" },
        { id: "fix", resourceId: "e1", date: day("2026-03-02"), hours: "-0.5" },
      ],
      [rate("e1", "40", "2026-01-01")],
      "EUR",
    );
    expect(r.totalCost.toString()).toBe("300");
    expect(r.totalHours.toString()).toBe("7.5");
  });

  it("never guesses: no rate, day rate only, archived rate or other currency → unpriced", () => {
    const rates = [
      rate("day", "300", "2026-01-01", null, { unit: "DAY" }),
      rate("arch", "40", "2026-01-01", null, { archivedAt: day("2026-02-01") }),
      rate("sek", "400", "2026-01-01", null, { currency: "SEK" }),
      rate("bill", "70", "2026-01-01", null, { rateType: "BILLING" }),
    ];
    const r = priceHours(
      ["none", "day", "arch", "sek", "bill"].map((id) => ({ id, resourceId: id, date: day("2026-03-02"), hours: "2" })),
      rates,
      "EUR",
    );
    expect(r.lines).toEqual([]);
    expect(r.unpriced.map((u) => [u.id, u.reason])).toEqual([
      ["none", "NO_HOURLY_COST_RATE"],
      ["day", "NO_HOURLY_COST_RATE"],
      ["arch", "NO_HOURLY_COST_RATE"],
      ["sek", "CURRENCY_MISMATCH"],
      ["bill", "NO_HOURLY_COST_RATE"],
    ]);
    expect(r.unpricedHours.toString()).toBe("10");
    expect(r.totalCost.toString()).toBe("0");
  });

  it("finds no rate before the first validity date", () => {
    expect(findHourlyCostRate([rate("e1", "40", "2026-02-01")], "e1", day("2026-01-31"), "EUR")).toEqual({ reason: "NO_HOURLY_COST_RATE" });
  });

  it("per-line rounding then sum (documented rule)", () => {
    // 0.333 h × 10 € = 3.33 each; three lines = 9.99 (not 10.00)
    const r = priceHours(
      ["a", "b", "c"].map((id) => ({ id, resourceId: "e", date: day("2026-03-02"), hours: "0.333" })),
      [rate("e", "10", "2026-01-01")],
      "EUR",
    );
    expect(r.totalCost.toString()).toBe("9.99");
  });

  it("budget vs actual by category with variance and usage %", () => {
    const res = compareBudget(
      [
        { category: "LABOR", amount: "10000" },
        { category: "LABOR", amount: "2000" },
        { category: "MATERIALS", amount: "5000" },
      ],
      { LABOR: D("9000"), MATERIALS: D("5500"), OTHER: D("100") },
    );
    const by = Object.fromEntries(res.categories.map((c) => [c.category, c]));
    expect(by.LABOR.budget.toString()).toBe("12000");
    expect(by.LABOR.variance.toString()).toBe("3000");
    expect(by.LABOR.usedPercent?.toString()).toBe("75");
    expect(by.MATERIALS.variance.toString()).toBe("-500");
    expect(by.MATERIALS.usedPercent?.toString()).toBe("110");
    expect(by.OTHER.usedPercent).toBeNull();
    expect(res.total.budget.toString()).toBe("17000");
    expect(res.total.actual.toString()).toBe("14600");
    expect(res.total.usedPercent?.toString()).toBe("85.9");
  });
});
