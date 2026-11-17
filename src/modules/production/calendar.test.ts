import { describe, expect, it } from "vitest";
import { barPosition, calendarRange, calendarTicks, taskPhase, weekMonday } from "./calendar";

const wd = (iso: string) => ["ma", "ti", "ke", "to", "pe", "la", "su"][(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];

describe("calendarRange", () => {
  it("weeks start on Monday; the day view covers 06–22 Helsinki time", () => {
    expect(weekMonday("2026-11-19")).toBe("2026-11-16");
    expect(weekMonday("2026-11-16")).toBe("2026-11-16");
    const week = calendarRange("week", "2026-11-19");
    expect(week.startDate).toBe("2026-11-16");
    expect(week.from.toISOString()).toBe("2026-11-15T22:00:00.000Z");
    expect(week.to.toISOString()).toBe("2026-11-22T22:00:00.000Z");
    expect(week.prevDate).toBe("2026-11-09");
    const day = calendarRange("day", "2026-07-01");
    expect(day.from.toISOString()).toBe("2026-07-01T03:00:00.000Z");
    expect(day.to.toISOString()).toBe("2026-07-01T19:00:00.000Z");
    expect(calendarRange("month", "2026-11-19").days).toBe(28);
  });

  it("handles the daylight-saving change inside a week", () => {
    const r = calendarRange("week", "2026-10-25");
    expect(r.from.toISOString()).toBe("2026-10-18T21:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-25T22:00:00.000Z");
  });
});

describe("calendarTicks", () => {
  it("has hour ticks on the day view and day ticks on longer views", () => {
    const day = calendarTicks(calendarRange("day", "2026-11-18"), wd);
    expect(day).toHaveLength(16);
    expect(day[0]).toMatchObject({ left: 0, label: "06" });
    expect(day[8].left).toBeCloseTo(50);
    const week = calendarTicks(calendarRange("week", "2026-11-18"), wd);
    expect(week.map((t) => t.label)).toEqual(["ma 16.11.", "ti 17.11.", "ke 18.11.", "to 19.11.", "pe 20.11.", "la 21.11.", "su 22.11."]);
  });
});

describe("barPosition", () => {
  const r = calendarRange("day", "2026-11-18"); // 06–22 local = 04:00–20:00Z
  it("positions and clips bars", () => {
    expect(barPosition(r, new Date("2026-11-18T06:00:00Z"), new Date("2026-11-18T08:00:00Z"))).toMatchObject({ left: 12.5, width: 12.5, clippedStart: false });
    expect(barPosition(r, new Date("2026-11-18T02:00:00Z"), new Date("2026-11-18T05:00:00Z"))).toMatchObject({ left: 0, clippedStart: true });
    expect(barPosition(r, new Date("2026-11-19T06:00:00Z"), new Date("2026-11-19T08:00:00Z"))).toBeNull();
  });
});

describe("taskPhase", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  const end = new Date("2026-11-18T12:00:00Z");
  it("derives the colour phase from status, staffing and time", () => {
    expect(taskPhase({ status: "REQUESTED", end, missing: 2, hasType: true }, now)).toBe("PLANNED");
    expect(taskPhase({ status: "APPROVED", end, missing: 1, hasType: true }, now)).toBe("MISSING_RESOURCES");
    expect(taskPhase({ status: "SCHEDULED", end, missing: 0, hasType: true }, now)).toBe("READY");
    expect(taskPhase({ status: "SCHEDULED", end, missing: 0, hasType: false }, now)).toBe("MISSING_RESOURCES");
    expect(taskPhase({ status: "IN_PROGRESS", end, missing: 0, hasType: true }, now)).toBe("IN_PROGRESS");
    expect(taskPhase({ status: "IN_PROGRESS", end: new Date("2026-11-18T09:00:00Z"), missing: 0, hasType: true }, now)).toBe("LATE");
    expect(taskPhase({ status: "COMPLETE", end: new Date("2026-11-17T09:00:00Z"), missing: 0, hasType: true }, now)).toBe("COMPLETE");
  });
});
