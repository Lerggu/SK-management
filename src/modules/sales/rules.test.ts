import { describe, expect, it } from "vitest";
import {
  documentTotals,
  finnishReference,
  finnishVatNumber,
  formatIban,
  formatReference,
  isValidBusinessId,
  isValidFinnishReference,
  isValidIban,
  lineAmount,
  parseEmailList,
  virtualBarcode,
} from "./rules";

describe("lineAmount", () => {
  it("multiplies and rounds to cents half-up", () => {
    expect(lineAmount({ quantity: "3", unitPrice: "10" }).toString()).toBe("30");
    expect(lineAmount({ quantity: "1.235", unitPrice: "1" }).toFixed(2)).toBe("1.24");
    expect(lineAmount({ quantity: "0.333", unitPrice: "0.15" }).toFixed(2)).toBe("0.05");
  });

  it("applies the discount percent", () => {
    expect(lineAmount({ quantity: "3", unitPrice: "10", discountPct: "10" }).toFixed(2)).toBe("27.00");
    expect(lineAmount({ quantity: "7", unitPrice: "12.99", discountPct: "12.5" }).toFixed(2)).toBe("79.56");
  });

  it("keeps credit note lines negative and rounds away from zero", () => {
    expect(lineAmount({ quantity: "-3", unitPrice: "10", discountPct: "10" }).toFixed(2)).toBe("-27.00");
    expect(lineAmount({ quantity: "-1.235", unitPrice: "1" }).toFixed(2)).toBe("-1.24");
  });
});

describe("documentTotals", () => {
  const lines = [
    { quantity: "100", unitPrice: "2.45", vatRate: "25.5" },
    { quantity: "2", unitPrice: "180", discountPct: "5", vatRate: "25.5" },
    { quantity: "1", unitPrice: "49.90", vatRate: "13.5" },
  ];

  it("computes VAT per rate from the rounded line sums", () => {
    const t = documentTotals(lines, "STANDARD");
    expect(t.net.toFixed(2)).toBe("636.90");
    expect(t.groups.map((g) => [g.rate.toString(), g.net.toFixed(2), g.vat.toFixed(2)])).toEqual([
      ["25.5", "587.00", "149.69"],
      ["13.5", "49.90", "6.74"],
    ]);
    expect(t.vat.toFixed(2)).toBe("156.43");
    expect(t.gross.toFixed(2)).toBe("793.33");
  });

  it("charges no VAT under reverse charge", () => {
    const t = documentTotals(lines, "REVERSE_CHARGE");
    expect(t.vat.toFixed(2)).toBe("0.00");
    expect(t.gross.toFixed(2)).toBe("636.90");
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0].rate.toString()).toBe("0");
  });

  it("is zero for an empty document", () => {
    const t = documentTotals([], "STANDARD");
    expect(t.gross.toString()).toBe("0");
    expect(t.groups).toEqual([]);
  });
});

describe("Finnish reference numbers", () => {
  it("adds the 7-3-1 check digit", () => {
    expect(finnishReference("123")).toBe("1232");
    expect(finnishReference("1234567")).toBe("12345672");
    expect(finnishReference("10001")).toBe("100010");
  });

  it("validates and formats", () => {
    expect(isValidFinnishReference("1232")).toBe(true);
    expect(isValidFinnishReference("1233")).toBe(false);
    expect(isValidFinnishReference("86851 62596 19897")).toBe(true);
    expect(formatReference("868516259619897")).toBe("86851 62596 19897");
    expect(formatReference("100013")).toBe("1 00013");
  });

  it("rejects bases that are too short", () => {
    expect(() => finnishReference("12")).toThrow();
  });
});

describe("IBAN and business ID", () => {
  it("checks IBAN mod 97", () => {
    expect(isValidIban("FI21 1234 5600 0007 85")).toBe(true);
    expect(isValidIban("FI21 1234 5600 0007 86")).toBe(false);
    expect(isValidIban("not an iban")).toBe(false);
    expect(formatIban("fi2112345600000785")).toBe("FI21 1234 5600 0007 85");
  });

  it("checks the business ID check digit and forms the VAT number", () => {
    expect(isValidBusinessId("0112038-9")).toBe(true);
    expect(isValidBusinessId("0112038-8")).toBe(false);
    expect(isValidBusinessId("112038-9")).toBe(false);
    expect(finnishVatNumber("0112038-9")).toBe("FI01120389");
  });
});

describe("virtualBarcode", () => {
  it("matches the Finanssiala version 4 example", () => {
    const code = virtualBarcode({ iban: "FI79 4405 2020 0360 82", amount: "4883.15", reference: "86851 62596 19897", dueDate: new Date("2010-06-12T00:00:00Z") });
    expect(code).toBe("479440520200360820048831500000000868516259619897100612");
    expect(code).toHaveLength(54);
  });

  it("is null when it cannot be formed", () => {
    const base = { iban: "FI21 1234 5600 0007 85", reference: "1232", dueDate: null };
    expect(virtualBarcode({ ...base, amount: "0" })).toBeNull();
    expect(virtualBarcode({ ...base, amount: "-10" })).toBeNull();
    expect(virtualBarcode({ ...base, amount: "1000000" })).toBeNull();
    expect(virtualBarcode({ ...base, iban: "SE45 5000 0000 0583 9825 7466", amount: "10" })).toBeNull();
    expect(virtualBarcode({ ...base, amount: "10" })).toBe("421123456000007850000100000000000000000000001232000000");
  });
});

describe("parseEmailList", () => {
  it("splits, lower-cases and removes duplicates", () => {
    expect(parseEmailList("A@x.fi, b@y.fi; a@x.fi")).toEqual(["a@x.fi", "b@y.fi"]);
    expect(parseEmailList("")).toEqual([]);
    expect(parseEmailList("a@x.fi, nope")).toBeNull();
  });
});
