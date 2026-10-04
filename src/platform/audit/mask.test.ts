import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { MASK, computeDelta, maskRecord, toJsonValue } from "./mask";

describe("audit masking", () => {
  it("masks entity-specific sensitive fields", () => {
    const out = maskRecord("employee", { firstName: "Antti", email: "a@example.test", phone: "+358", notes: null });
    expect(out).toEqual({ firstName: "Antti", email: MASK, phone: MASK, notes: null });
  });

  it("masks rate amounts but keeps the period", () => {
    const out = maskRecord("employee_rate", { amount: new Prisma.Decimal("42.50"), validFrom: new Date("2026-01-01T00:00:00Z") });
    expect(out).toEqual({ amount: MASK, validFrom: "2026-01-01T00:00:00.000Z" });
  });

  it("masks secrets globally", () => {
    expect(maskRecord("account", { access_token: "abc", provider: "x" })).toEqual({ access_token: MASK, provider: "x" });
  });

  it("delta contains only changed fields and masks them", () => {
    const d = computeDelta("employee", { firstName: "A", phone: "1", updatedAt: new Date(1) }, { firstName: "B", phone: "2", updatedAt: new Date(2) });
    expect(d).toEqual({ before: { firstName: "A", phone: MASK }, after: { firstName: "B", phone: MASK } });
  });

  it("delta is empty when nothing changed", () => {
    expect(computeDelta("project", { name: "x" }, { name: "x" })).toEqual({ before: null, after: null });
  });

  it("serializes Decimal, BigInt and Date", () => {
    expect(toJsonValue({ a: new Prisma.Decimal("1.10"), b: BigInt(5), c: new Date("2026-01-02T03:04:05Z") })).toEqual({
      a: "1.1",
      b: "5",
      c: "2026-01-02T03:04:05.000Z",
    });
  });
});
