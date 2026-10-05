import { describe, expect, it } from "vitest";
import { toIsoDate, utcDate, type WorkingCalendar } from "./calendar";
import { applyProgress, compareSpans, cycleDates, deriveStatus, generateTrain, plannedSpan, weeklyDemand } from "./engine";

const cal: WorkingCalendar = { workingWeekdays: [1, 2, 3, 4, 5], holidays: new Set(["2026-10-07"]) };
const iso = toIsoDate;

describe("planned spans", () => {
  it("places day-takt cycles on working days", () => {
    // start Mon 2026-10-05; Wed 10-07 is a holiday in this calendar
    const s = plannedSpan(cal, utcDate(2026, 10, 5), 1, 2, 2);
    expect(iso(s.start)).toBe("2026-10-08");
    expect(iso(s.end)).toBe("2026-10-09");
    expect(cycleDates(cal, utcDate(2026, 10, 5), 1, 4).map(iso)).toEqual(["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-09"]);
  });

  it("supports longer cycles", () => {
    const s = plannedSpan(cal, utcDate(2026, 10, 5), 5, 1, 1);
    expect(iso(s.start)).toBe("2026-10-13");
    expect(iso(s.end)).toBe("2026-10-19");
  });
});

describe("readiness", () => {
  const today = utcDate(2026, 10, 10);
  const base = { execution: "NOT_STARTED" as const, blocked: false, openConstraints: 0, predecessors: [], plannedStart: utcDate(2026, 10, 20), today };

  it("READY with no open conditions", () => {
    expect(deriveStatus(base).status).toBe("READY");
  });
  it("NOT_READY with an open constraint or unfinished FS predecessor", () => {
    expect(deriveStatus({ ...base, openConstraints: 1 })).toEqual({ status: "NOT_READY", reasons: ["constraint"] });
    expect(deriveStatus({ ...base, predecessors: [{ type: "FS", execution: "IN_PROGRESS" }] })).toEqual({ status: "NOT_READY", reasons: ["predecessor"] });
  });
  it("SS needs the predecessor started; FF/SF do not gate the start", () => {
    expect(deriveStatus({ ...base, predecessors: [{ type: "SS", execution: "IN_PROGRESS" }] }).status).toBe("READY");
    expect(deriveStatus({ ...base, predecessors: [{ type: "SS", execution: "NOT_STARTED" }] }).status).toBe("NOT_READY");
    expect(deriveStatus({ ...base, predecessors: [{ type: "FF", execution: "NOT_STARTED" }] }).status).toBe("READY");
  });
  it("BLOCKED when the planned start is reached but not ready, or flagged", () => {
    expect(deriveStatus({ ...base, openConstraints: 1, plannedStart: today }).status).toBe("BLOCKED");
    expect(deriveStatus({ ...base, blocked: true })).toEqual({ status: "BLOCKED", reasons: ["manual"] });
    expect(deriveStatus({ ...base, execution: "IN_PROGRESS", blocked: true }).status).toBe("BLOCKED");
  });
  it("IN_PROGRESS and COMPLETE follow execution", () => {
    expect(deriveStatus({ ...base, execution: "IN_PROGRESS", openConstraints: 2 }).status).toBe("IN_PROGRESS");
    expect(deriveStatus({ ...base, execution: "COMPLETE", blocked: true }).status).toBe("COMPLETE");
  });
});

describe("progress", () => {
  it("sets actual dates from progress reports", () => {
    const d1 = utcDate(2026, 10, 5);
    const d2 = utcDate(2026, 10, 8);
    const started = applyProgress({ execution: "NOT_STARTED", actualStart: null, actualEnd: null }, 40, d1);
    expect(started).toEqual({ execution: "IN_PROGRESS", progressPct: 40, actualStart: d1, actualEnd: null });
    expect(applyProgress(started, 100, d2)).toEqual({ execution: "COMPLETE", progressPct: 100, actualStart: d1, actualEnd: d2 });
    expect(applyProgress(started, 0, d2).execution).toBe("NOT_STARTED");
  });
});

describe("takt train", () => {
  it("staggers wagons by the takt time and links them per area", () => {
    const t = generateTrain({ workPackages: [{ id: "w1", durationCycles: 1 }, { id: "w2", durationCycles: 2 }], areas: [{ id: "a1" }, { id: "a2" }], startCycle: 0, bufferCycles: 1 });
    expect(t.taktTime).toBe(2);
    const at = (w: string, a: string) => t.assignments.find((x) => x.workPackageId === w && x.areaId === a)!.startCycle;
    expect([at("w1", "a1"), at("w1", "a2"), at("w2", "a1"), at("w2", "a2")]).toEqual([0, 2, 3, 5]);
    expect(t.dependencies).toHaveLength(2);
  });
});

describe("version comparison", () => {
  it("classifies changes with working-day deltas", () => {
    const span = (a: [number, number], b: [number, number]) => ({ start: utcDate(2026, 10, a[0]), end: utcDate(2026, 10, b[0]) });
    const base = new Map([["x", span([5, 0], [6, 0])], ["y", span([8, 0], [8, 0])], ["gone", span([5, 0], [5, 0])]]);
    const other = new Map([["x", span([5, 0], [6, 0])], ["y", span([12, 0], [12, 0])], ["new", span([9, 0], [9, 0])]]);
    const rows = Object.fromEntries(compareSpans(cal, base, other).map((r) => [r.activityId, r]));
    expect(rows.x.change).toBe("UNCHANGED");
    expect(rows.y).toMatchObject({ change: "MOVED", startDelta: 2 });
    expect(rows.gone.change).toBe("REMOVED");
    expect(rows.new.change).toBe("ADDED");
  });
});

describe("look-ahead demand", () => {
  it("computes weekly peak and person-days per resource", () => {
    const r = weeklyDemand(
      cal,
      [
        { kind: "TRADE", key: "Electrician", quantity: 3, start: utcDate(2026, 10, 5), end: utcDate(2026, 10, 9) },
        { kind: "TRADE", key: "Electrician", quantity: 2, start: utcDate(2026, 10, 8), end: utcDate(2026, 10, 13) },
        { kind: "EQUIPMENT_TYPE", key: "eq-1", quantity: 1, start: utcDate(2026, 10, 12), end: utcDate(2026, 10, 12) },
      ],
      utcDate(2026, 10, 7),
      2,
    );
    expect(r.weekStarts).toEqual(["2026-10-05", "2026-10-12"]);
    const el = r.rows.find((x) => x.key === "Electrician")!;
    // week 1 working days: 5, 6, 8, 9 (7th holiday) → 3,3,5,5
    expect(el.cells[0]).toEqual({ weekStart: "2026-10-05", peak: 5, days: 16 });
    expect(el.cells[1]).toEqual({ weekStart: "2026-10-12", peak: 2, days: 4 });
    expect(r.rows.find((x) => x.key === "eq-1")!.cells[1].peak).toBe(1);
  });
});
