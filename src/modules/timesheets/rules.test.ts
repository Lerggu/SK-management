import { describe, expect, it } from "vitest";
import { formatClock, hoursBetween, isEditable, parseClock, weekRange, weekStart } from "./rules";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("time-tracking rules", () => {
  it("parses clock times", () => {
    expect(parseClock("07:30")).toBe(450);
    expect(parseClock("7:05")).toBe(425);
    expect(parseClock("24:00")).toBe(1440);
    expect(parseClock("24:30")).toBeNull();
    expect(parseClock("12:60")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(formatClock(450)).toBe("07:30");
  });

  it("computes hours between clock times with 2 decimals", () => {
    expect(hoursBetween(420, 930).toString()).toBe("8.5");
    expect(hoursBetween(420, 440).toString()).toBe("0.33");
  });

  it("weeks run Monday to Sunday (ISO)", () => {
    expect(weekStart(day("2026-10-04")).toISOString().slice(0, 10)).toBe("2026-09-28"); // Sunday
    expect(weekStart(day("2026-09-28")).toISOString().slice(0, 10)).toBe("2026-09-28"); // Monday
    const r = weekRange(day("2026-10-01"));
    expect([r.from, r.to].map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-09-28", "2026-10-05"]);
  });

  it("only drafts and rejected entries are editable", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("REJECTED")).toBe(true);
    expect(isEditable("SUBMITTED")).toBe(false);
    expect(isEditable("APPROVED")).toBe(false);
    expect(isEditable("EXPORTED")).toBe(false);
  });
});

describe("ISO week numbers", () => {
  it("matches ISO-8601", async () => {
    const { isoWeekNumber } = await import("./rules");
    expect(isoWeekNumber(new Date("2026-10-04T00:00:00Z"))).toBe(40);
    expect(isoWeekNumber(new Date("2026-01-01T00:00:00Z"))).toBe(1);
    expect(isoWeekNumber(new Date("2027-01-01T00:00:00Z"))).toBe(53);
  });
});
