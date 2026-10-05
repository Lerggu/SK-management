import { describe, expect, it } from "vitest";
import { forecast, lineAmount, priceQuote, priceVariation, toCsv, weightedPipeline } from "./rules";

describe("quote pricing", () => {
  it("adds overhead and risk reserve, then prices for the margin share", () => {
    const p = priceQuote(
      [
        { category: "LABOR", quantity: "400", unitCost: "45.50" },
        { category: "LIFTING", quantity: "3", unitCost: "1250" },
        { category: "MATERIALS", quantity: "1", unitCost: "12000" },
      ],
      { overheadPct: "8", riskPct: "5", marginPct: "15" },
    );
    expect(p.base.toString()).toBe("33950");
    expect(p.overhead.toString()).toBe("2716");
    expect(p.risk.toString()).toBe("1833.3");
    expect(p.cost.toString()).toBe("38499.3");
    expect(p.price.toString()).toBe("45293.29");
    expect(p.margin.toString()).toBe("6793.99");
    expect(p.marginPct!.toString()).toBe("15");
    expect(p.byCategory.LIFTING.toString()).toBe("3750");
  });

  it("rounds each line to cents and handles an empty quote", () => {
    expect(priceQuote([{ category: "OTHER", quantity: "3", unitCost: "0.335" }], { overheadPct: 0, riskPct: 0, marginPct: 0 }).base.toString()).toBe("1.01");
    const empty = priceQuote([], { overheadPct: 10, riskPct: 10, marginPct: 10 });
    expect(empty.price.toString()).toBe("0");
    expect(empty.marginPct).toBeNull();
  });

  it("refuses a 100 % margin", () => {
    expect(() => priceQuote([], { overheadPct: 0, riskPct: 0, marginPct: 100 })).toThrow();
  });
});

describe("variation pricing and invoice lines", () => {
  it("sales price = costs × (1 + markup)", () => {
    const v = priceVariation({ laborCost: "1200", equipmentCost: "450.50", materialsCost: "800", subcontractCost: "0", otherCost: "49.50", markupPct: "12.5" });
    expect(v.cost.toString()).toBe("2500");
    expect(v.salesPrice.toString()).toBe("2812.5");
    expect(v.markup.toString()).toBe("312.5");
  });

  it("line amount rounds half up like the DB check", () => {
    expect(lineAmount("7.5", "58.33").toString()).toBe("437.48");
    expect(lineAmount("0.5", "0.01").toString()).toBe("0.01");
  });
});

describe("forecast / EAC", () => {
  it("EAC = actual + ETC; revenue = contract + approved variations", () => {
    const f = forecast({ budget: "100000", actualCost: "62000", etc: ["30000", "12500"], contractValue: "120000", approvedVariations: "8000", invoiced: "70000", openCandidates: "5000" });
    expect(f.eac.toString()).toBe("104500");
    expect(f.budgetVariance!.toString()).toBe("-4500");
    expect(f.forecastRevenue.toString()).toBe("128000");
    expect(f.forecastMargin.toString()).toBe("23500");
    expect(f.forecastMarginPct!.toString()).toBe("18.4");
    expect(f.remainingToBill.toString()).toBe("53000");
  });

  it("works without budget or revenue", () => {
    const f = forecast({ budget: null, actualCost: "10", etc: [], contractValue: 0, approvedVariations: 0, invoiced: 0, openCandidates: 0 });
    expect(f.budgetVariance).toBeNull();
    expect(f.forecastMarginPct).toBeNull();
    expect(f.remainingToBill.toString()).toBe("0");
  });

  it("weighted pipeline counts open stages only", () => {
    expect(
      weightedPipeline([
        { stage: "TENDER", estimatedValue: "200000", probabilityPct: 40 },
        { stage: "LEAD", estimatedValue: "50000", probabilityPct: null },
        { stage: "WON", estimatedValue: "999999", probabilityPct: 100 },
      ]).toString(),
    ).toBe("80000");
  });
});

describe("CSV export", () => {
  it("uses BOM, semicolons, decimal comma and quoting", () => {
    const csv = toCsv(["a", "b"], [{ a: 'Kaapeli; "AXMK"', b: "1234.50" }], new Set(["b"]));
    expect(csv).toBe('﻿a;b\r\n"Kaapeli; ""AXMK""";1234,50\r\n');
  });
});

describe("billing rates", () => {
  const rates = [
    { resourceId: "e1", rateType: "BILLING" as const, unit: "HOUR" as const, amount: "55", currency: "EUR", validFrom: new Date("2026-01-01"), validTo: new Date("2026-06-30") },
    { resourceId: "e1", rateType: "BILLING" as const, unit: "HOUR" as const, amount: "58", currency: "EUR", validFrom: new Date("2026-07-01"), validTo: null },
    { resourceId: "e1", rateType: "COST" as const, unit: "HOUR" as const, amount: "40", currency: "EUR", validFrom: new Date("2026-01-01"), validTo: null },
  ];
  it("uses the BILLING rate valid on the day, inclusive end", async () => {
    const { findHourlyBillingRate, bookedHours } = await import("./rules");
    expect(findHourlyBillingRate(rates, "e1", new Date("2026-06-30T15:00:00Z"), "EUR")!.toString()).toBe("55");
    expect(findHourlyBillingRate(rates, "e1", new Date("2026-07-01T05:00:00Z"), "EUR")!.toString()).toBe("58");
    expect(findHourlyBillingRate(rates, "e1", new Date("2025-12-31"), "EUR")).toBeNull();
    expect(findHourlyBillingRate(rates, "e1", new Date("2026-08-01"), "SEK")).toBeNull();
    expect(bookedHours(new Date("2026-11-02T05:00:00Z"), new Date("2026-11-02T13:30:00Z")).toString()).toBe("8.5");
  });
});
