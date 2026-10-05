import { describe, expect, it } from "vitest";
import { formatMinute, parseClockTime, parseLocalDateTime, toLocalDateTimeInput, utcToZoned, zonedToUtc } from "./time";

describe("display-zone time", () => {
  it("converts Helsinki wall-clock time to UTC across DST", () => {
    expect(zonedToUtc("2026-10-05", 7 * 60 + 30).toISOString()).toBe("2026-10-05T04:30:00.000Z"); // EEST +3
    expect(zonedToUtc("2026-12-01", 7 * 60).toISOString()).toBe("2026-12-01T05:00:00.000Z"); // EET +2
    expect(zonedToUtc("2026-03-29", 12 * 60).toISOString()).toBe("2026-03-29T09:00:00.000Z"); // DST start day
  });

  it("converts back to local date and minute", () => {
    expect(utcToZoned(new Date("2026-10-05T21:30:00Z"))).toEqual({ date: "2026-10-06", minute: 30 });
    expect(toLocalDateTimeInput(new Date("2026-12-01T05:00:00Z"))).toBe("2026-12-01T07:00");
    expect(parseLocalDateTime("2026-12-01T07:00")?.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    expect(parseLocalDateTime("2026-12-01 07:00")).toBeNull();
  });

  it("parses and formats clock times", () => {
    expect(parseClockTime("7:30")).toBe(450);
    expect(parseClockTime("24:00")).toBeNull();
    expect(formatMinute(450)).toBe("07:30");
  });
});
