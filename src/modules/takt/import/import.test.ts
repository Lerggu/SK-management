import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { utcDate, type WorkingCalendar } from "../calendar";
import { buildPreview, cyclePosition } from "./mapping";
import { parseMspdi } from "./mspdi";
import { decodeScheduleText, parseXer } from "./xer";
import { ScheduleParseError } from "./types";

const fixture = (name: string) => readFileSync(join(__dirname, "../../../../tests/fixtures/schedules", name));
const cal: WorkingCalendar = { workingWeekdays: [1, 2, 3, 4, 5], holidays: new Set() };

describe.each([
  ["MSPDI", () => parseMspdi(fixture("data-hall-b.xml").toString("utf8"))],
  ["XER", () => parseXer(decodeScheduleText(fixture("data-hall-b.xer")))],
])("%s parser", (format, parse) => {
  it("reads leaf tasks with their summary/WBS path", () => {
    const s = parse();
    expect(s.format).toBe(format);
    expect(s.projectName).toBeTruthy();
    expect(s.tasks).toHaveLength(6);
    const trays = s.tasks.filter((t) => t.name === "Cable trays");
    expect(trays.map((t) => t.path)).toEqual([["Zone B1"], ["Zone B2"]]);
    expect(s.tasks.find((t) => t.name === "Handover")!.milestone).toBe(true);
    expect(s.tasks.find((t) => t.name === "Mobilisation")!.path).toEqual([]);
  });

  it("reads dependency types and lags in days", () => {
    const s = parse();
    expect(s.links).toHaveLength(4);
    expect(s.links.map((l) => `${l.type}:${l.lagDays}`).sort()).toEqual(["FS:0", "FS:0", "FS:1", "SS:0"]);
  });

  it("maps tasks to takt areas and work packages", () => {
    const p = buildPreview(cal, parse(), { areaLevel: 1, cycleLengthDays: 1 });
    expect(p.counts).toEqual({ tasks: 6, mapped: 4, merged: 0, unmapped: 1, milestones: 1, links: 4 });
    expect(p.areaNames).toEqual(["Zone B1", "Zone B2"]);
    expect(p.workPackageNames).toEqual(["Cable trays", "Cabling"]);
    expect(p.earliestStart).toBe("2026-11-03");
    const b2 = p.activities.find((a) => a.areaName === "Zone B2" && a.workPackageName === "Cabling")!;
    expect(b2.workingDays).toBe(2);
    expect(cyclePosition(cal, utcDate(2026, 11, 3), b2, 1)).toEqual({ startCycle: 4, durationCycles: 2 });
  });
});

describe("parser safety", () => {
  it("rejects files of the wrong type", () => {
    expect(() => parseMspdi("<html></html>")).toThrow(ScheduleParseError);
    expect(() => parseXer("not xer")).toThrow(ScheduleParseError);
  });

  it("does not expand XML entities", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;">]><Project><Tasks><Task><UID>1</UID><Name>&b;</Name><OutlineLevel>1</OutlineLevel><Start>2026-11-02T08:00:00</Start><Finish>2026-11-02T16:00:00</Finish></Task></Tasks></Project>`;
    const s = parseMspdi(xml);
    expect(s.tasks[0].name).not.toContain("AAAA");
  });

  it("merges several tasks of the same area × work package", () => {
    const xml = `<Project><Tasks>
      <Task><UID>1</UID><Name>A1</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>
      <Task><UID>2</UID><Name>Trays</Name><OutlineLevel>2</OutlineLevel><Summary>1</Summary></Task>
      <Task><UID>3</UID><Name>Trays east</Name><OutlineLevel>3</OutlineLevel><Start>2026-11-02T08:00:00</Start><Finish>2026-11-02T16:00:00</Finish></Task>
      <Task><UID>4</UID><Name>Trays west</Name><OutlineLevel>3</OutlineLevel><Start>2026-11-03T08:00:00</Start><Finish>2026-11-04T16:00:00</Finish></Task>
    </Tasks></Project>`;
    const p = buildPreview(cal, parseMspdi(xml), { areaLevel: 1, cycleLengthDays: 1 });
    expect(p.activities).toHaveLength(1);
    expect(p.activities[0]).toMatchObject({ name: "Trays", start: "2026-11-02", finish: "2026-11-04", workingDays: 3 });
    expect(p.counts.merged).toBe(1);
  });
});
