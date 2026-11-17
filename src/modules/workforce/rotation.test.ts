import { describe, expect, it } from "vitest";
import { addDays, daysBetween, patternDays, visibleEntry, weekStart } from "./rotation";

describe("rotation rules", () => {
  it("lists inclusive days across months and the DST change", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(daysBetween("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(daysBetween("2026-03-02", "2026-03-01")).toEqual([]);
  });

  it("builds a work/off rhythm starting with work", () => {
    const p = patternDays("2026-11-02", "2026-11-09", 3, 2);
    expect(p.map((x) => x.status)).toEqual(["WORK", "WORK", "WORK", "OFF", "OFF", "WORK", "WORK", "WORK"]);
  });

  it("hides sick leave and other reasons (and notes) without rotation.manage", () => {
    expect(visibleEntry({ status: "SICK" as const, note: "flunssa" }, false)).toEqual({ status: "ABSENT", note: null });
    expect(visibleEntry({ status: "OTHER" as const, note: "x" }, false)).toEqual({ status: "ABSENT", note: null });
    expect(visibleEntry({ status: "VACATION" as const, note: "x" }, false)).toEqual({ status: "VACATION", note: null });
    expect(visibleEntry({ status: "SICK" as const, note: "flunssa" }, true)).toEqual({ status: "SICK", note: "flunssa" });
  });

  it("finds the Monday and shifts days", () => {
    expect(weekStart("2026-11-18")).toBe("2026-11-16");
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(weekStart("2026-11-22")).toBe("2026-11-16");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
