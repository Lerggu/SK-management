import { describe, expect, it } from "vitest";
import { addWorkingDays, easterSunday, finnishPublicHolidays, nextWorkingDay, toIsoDate, utcDate, workingDaysBetween, workingDaysInRange, type WorkingCalendar } from "./calendar";

const holidays2026 = new Set(finnishPublicHolidays(2026).map((h) => toIsoDate(h.date)));
const cal: WorkingCalendar = { workingWeekdays: [1, 2, 3, 4, 5], holidays: holidays2026 };
const iso = (d: Date) => toIsoDate(d);

describe("working calendar", () => {
  it("computes Easter for known years", () => {
    expect(iso(easterSunday(2026))).toBe("2026-04-05");
    expect(iso(easterSunday(2027))).toBe("2027-03-28");
    expect(iso(easterSunday(2024))).toBe("2024-03-31");
  });

  it("lists Finnish public holidays incl. moving feasts", () => {
    const h = Object.fromEntries(finnishPublicHolidays(2026).map((x) => [x.name.en, iso(x.date)]));
    expect(h["Good Friday"]).toBe("2026-04-03");
    expect(h["Easter Monday"]).toBe("2026-04-06");
    expect(h["Ascension Day"]).toBe("2026-05-14");
    expect(h["Midsummer Eve"]).toBe("2026-06-19");
    expect(h["Midsummer Day"]).toBe("2026-06-20");
    expect(h["All Saints' Day"]).toBe("2026-10-31");
    const h27 = Object.fromEntries(finnishPublicHolidays(2027).map((x) => [x.name.en, iso(x.date)]));
    expect(h27["Midsummer Eve"]).toBe("2027-06-25");
    expect(h27["All Saints' Day"]).toBe("2027-11-06");
  });

  it("skips weekends and holidays", () => {
    // Fri 2026-04-03 is Good Friday, Mon 04-06 Easter Monday → next working day Tue 04-07
    expect(iso(nextWorkingDay(cal, utcDate(2026, 4, 3)))).toBe("2026-04-07");
    expect(iso(addWorkingDays(cal, utcDate(2026, 4, 2), 1))).toBe("2026-04-07");
    // Thu 2026-12-24 to Mon 12-28: 24, 25 holidays, 26–27 weekend
    expect(iso(addWorkingDays(cal, utcDate(2026, 12, 23), 1))).toBe("2026-12-28");
  });

  it("counts signed working days between dates", () => {
    expect(workingDaysBetween(cal, utcDate(2026, 10, 5), utcDate(2026, 10, 12))).toBe(5);
    expect(workingDaysBetween(cal, utcDate(2026, 10, 12), utcDate(2026, 10, 5))).toBe(-5);
    expect(workingDaysBetween(cal, utcDate(2026, 10, 10), utcDate(2026, 10, 12))).toBe(0); // Sat → Mon
    expect(workingDaysInRange(cal, utcDate(2026, 10, 5), utcDate(2026, 10, 11))).toHaveLength(5);
  });

  it("supports other working weeks", () => {
    const sixDay: WorkingCalendar = { workingWeekdays: [1, 2, 3, 4, 5, 6], holidays: new Set() };
    expect(iso(addWorkingDays(sixDay, utcDate(2026, 10, 9), 1))).toBe("2026-10-10");
  });
});
