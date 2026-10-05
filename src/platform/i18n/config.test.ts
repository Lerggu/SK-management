import { describe, expect, it } from "vitest";
import { todayInDisplayZone } from "./config";

describe("todayInDisplayZone", () => {
  it("uses the Helsinki calendar date, not UTC", () => {
    // 22:30 UTC on 3 Oct = 01:30 on 4 Oct in Helsinki (EEST, UTC+3)
    expect(todayInDisplayZone(new Date("2026-10-03T22:30:00Z"))).toBe("2026-10-04");
    expect(todayInDisplayZone(new Date("2026-10-04T12:00:00Z"))).toBe("2026-10-04");
    // Winter time (UTC+2)
    expect(todayInDisplayZone(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01");
  });
});
