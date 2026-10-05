import { nextWorkingDay, toIsoDate, workingDaysBetween, workingDaysInRange, type WorkingCalendar } from "../calendar";
import type { DependencyType } from "../engine";
import type { ParsedSchedule } from "./types";

export interface MappingOptions {
  /** Path level (1-based) whose name is the takt area. */
  areaLevel: number;
  cycleLengthDays: number;
}

export type RowStatus = "OK" | "MERGED" | "UNMAPPED" | "MILESTONE";

export interface PreviewRow {
  uid: string;
  name: string;
  path: string[];
  areaName: string | null;
  workPackageName: string | null;
  start: string;
  finish: string;
  status: RowStatus;
}

export interface MappedActivity {
  key: string;
  areaName: string;
  workPackageName: string;
  name: string;
  uids: string[];
  start: string;
  finish: string;
  /** Working days, start → finish inclusive. */
  workingDays: number;
}

export interface ImportPreview {
  projectName: string | null;
  format: "MSPDI" | "XER";
  rows: PreviewRow[];
  activities: MappedActivity[];
  areaNames: string[];
  workPackageNames: string[];
  links: { predecessorKey: string; successorKey: string; type: DependencyType; lagDays: number }[];
  counts: { tasks: number; mapped: number; merged: number; unmapped: number; milestones: number; links: number };
  earliestStart: string | null;
}

export const activityKey = (area: string, wp: string) => `${area.toLowerCase()}\u001f${wp.toLowerCase()}`;

/**
 * Maps leaf tasks to takt areas and work packages: the takt area is the path
 * element at `areaLevel`; the work package is the next path element, or the
 * task name when the task sits directly under the area. Several tasks for the
 * same area × work package are merged (earliest start, latest finish).
 * Milestones and tasks above the area level are reported, not imported.
 */
export function buildPreview(cal: WorkingCalendar, parsed: ParsedSchedule, options: MappingOptions): ImportPreview {
  const rows: PreviewRow[] = [];
  const byKey = new Map<string, MappedActivity>();
  const keyOfUid = new Map<string, string>();
  for (const t of parsed.tasks) {
    const base = { uid: t.uid, name: t.name, path: t.path, start: toIsoDate(t.start), finish: toIsoDate(t.finish) };
    if (t.milestone) {
      rows.push({ ...base, areaName: null, workPackageName: null, status: "MILESTONE" });
      continue;
    }
    if (t.path.length < options.areaLevel) {
      rows.push({ ...base, areaName: null, workPackageName: null, status: "UNMAPPED" });
      continue;
    }
    const areaName = t.path[options.areaLevel - 1];
    const workPackageName = t.path[options.areaLevel] ?? t.name;
    const key = activityKey(areaName, workPackageName);
    keyOfUid.set(t.uid, key);
    const existing = byKey.get(key);
    if (existing) {
      existing.uids.push(t.uid);
      if (base.start < existing.start) existing.start = base.start;
      if (base.finish > existing.finish) existing.finish = base.finish;
      rows.push({ ...base, areaName, workPackageName, status: "MERGED" });
    } else {
      byKey.set(key, { key, areaName, workPackageName, name: t.path[options.areaLevel] ? t.path[options.areaLevel] : t.name, uids: [t.uid], start: base.start, finish: base.finish, workingDays: 0 });
      rows.push({ ...base, areaName, workPackageName, status: "OK" });
    }
  }
  const activities = [...byKey.values()].map((a) => {
    const start = nextWorkingDay(cal, new Date(`${a.start}T00:00:00Z`));
    const days = workingDaysInRange(cal, start, new Date(`${a.finish}T00:00:00Z`)).length;
    return { ...a, start: toIsoDate(start), workingDays: Math.max(1, days) };
  });
  const seen = new Set<string>();
  const links: ImportPreview["links"] = [];
  for (const l of parsed.links) {
    const p = keyOfUid.get(l.predecessorUid);
    const s = keyOfUid.get(l.successorUid);
    if (!p || !s || p === s) continue;
    const id = `${p}\u0001${s}`;
    if (seen.has(id)) continue;
    seen.add(id);
    links.push({ predecessorKey: p, successorKey: s, type: l.type, lagDays: l.lagDays });
  }
  const earliest = activities.reduce<string | null>((min, a) => (min === null || a.start < min ? a.start : min), null);
  return {
    projectName: parsed.projectName,
    format: parsed.format,
    rows,
    activities,
    areaNames: [...new Set(activities.map((a) => a.areaName))],
    workPackageNames: [...new Set(activities.map((a) => a.workPackageName))],
    links,
    counts: {
      tasks: parsed.tasks.length,
      mapped: rows.filter((r) => r.status === "OK").length,
      merged: rows.filter((r) => r.status === "MERGED").length,
      unmapped: rows.filter((r) => r.status === "UNMAPPED").length,
      milestones: rows.filter((r) => r.status === "MILESTONE").length,
      links: links.length,
    },
    earliestStart: earliest,
  };
}

/** Cycle position of a mapped activity relative to a version start. */
export function cyclePosition(cal: WorkingCalendar, versionStart: Date, a: MappedActivity, cycleLengthDays: number) {
  const offset = workingDaysBetween(cal, versionStart, new Date(`${a.start}T00:00:00Z`));
  return { startCycle: Math.floor(offset / cycleLengthDays), durationCycles: Math.max(1, Math.ceil(a.workingDays / cycleLengthDays)) };
}
