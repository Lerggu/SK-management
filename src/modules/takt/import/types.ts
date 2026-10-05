import type { DependencyType } from "../engine";

/** Format-neutral schedule parsed from an MS Project XML or P6 XER file. */
export interface ParsedTask {
  uid: string;
  name: string;
  /** Summary/WBS ancestor names from the top level down (project node excluded). */
  path: string[];
  start: Date;
  finish: Date;
  milestone: boolean;
}

export interface ParsedLink {
  predecessorUid: string;
  successorUid: string;
  type: DependencyType;
  lagDays: number;
}

export interface ParsedSchedule {
  format: "MSPDI" | "XER";
  projectName: string | null;
  tasks: ParsedTask[];
  links: ParsedLink[];
}

export class ScheduleParseError extends Error {}

/** Date part of "2026-10-05T08:00:00" / "2026-10-05 08:00" as UTC midnight. */
export function datePart(value: string | undefined | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const MAX_TASKS = 5000;
