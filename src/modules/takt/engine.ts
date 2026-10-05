import { addWorkingDays, isoWeekday, shiftDays, toIsoDate, workingDaysBetween, workingDaysInRange, type WorkingCalendar } from "./calendar";

/**
 * Takt scheduling rules (pure, unit tested). See docs/adr/0012 and 0013.
 */

export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type Execution = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";
export type ReadinessStatus = "NOT_READY" | "READY" | "IN_PROGRESS" | "BLOCKED" | "COMPLETE";
export type ReadinessReason = "manual" | "predecessor" | "constraint";

export interface PlannedSpan {
  start: Date;
  end: Date;
}

/** Planned working-day span of an assignment: cycle n starts n × L working days after the version start. */
export function plannedSpan(cal: WorkingCalendar, versionStart: Date, cycleLengthDays: number, startCycle: number, durationCycles: number): PlannedSpan {
  const start = addWorkingDays(cal, versionStart, startCycle * cycleLengthDays);
  const end = addWorkingDays(cal, start, Math.max(1, durationCycles * cycleLengthDays) - 1);
  return { start, end };
}

/** Dates of the board columns: one per cycle, `count` cycles from the version start. */
export function cycleDates(cal: WorkingCalendar, versionStart: Date, cycleLengthDays: number, count: number): Date[] {
  const out: Date[] = [];
  let cur = addWorkingDays(cal, versionStart, 0);
  for (let i = 0; i < count; i++) {
    out.push(cur);
    cur = addWorkingDays(cal, cur, cycleLengthDays);
  }
  return out;
}

export interface ReadinessInput {
  execution: Execution;
  blocked: boolean;
  openConstraints: number;
  predecessors: { type: DependencyType; execution: Execution }[];
  plannedStart: Date | null;
  today: Date;
}

/**
 * Status rules:
 * - COMPLETE when execution is complete;
 * - BLOCKED when flagged blocked (delay recorded), or when the planned start
 *   has been reached and the activity is still not ready;
 * - IN_PROGRESS once started;
 * - READY when every predecessor condition holds (FS: predecessor complete,
 *   SS: predecessor started; FF/SF do not gate the start) and no constraint
 *   is open; otherwise NOT_READY.
 */
export function deriveStatus(i: ReadinessInput): { status: ReadinessStatus; reasons: ReadinessReason[] } {
  if (i.execution === "COMPLETE") return { status: "COMPLETE", reasons: [] };
  if (i.blocked) return { status: "BLOCKED", reasons: ["manual"] };
  if (i.execution === "IN_PROGRESS") return { status: "IN_PROGRESS", reasons: [] };
  const reasons: ReadinessReason[] = [];
  const predecessorOpen = i.predecessors.some(
    (p) => (p.type === "FS" && p.execution !== "COMPLETE") || (p.type === "SS" && p.execution === "NOT_STARTED"),
  );
  if (predecessorOpen) reasons.push("predecessor");
  if (i.openConstraints > 0) reasons.push("constraint");
  if (reasons.length === 0) return { status: "READY", reasons };
  const late = i.plannedStart !== null && i.plannedStart.getTime() <= i.today.getTime();
  return { status: late ? "BLOCKED" : "NOT_READY", reasons };
}

/** Execution state and actual dates after a progress report. */
export function applyProgress(
  current: { execution: Execution; actualStart: Date | null; actualEnd: Date | null },
  pct: number,
  date: Date,
): { execution: Execution; progressPct: number; actualStart: Date | null; actualEnd: Date | null } {
  if (pct <= 0) return { execution: "NOT_STARTED", progressPct: 0, actualStart: null, actualEnd: null };
  const actualStart = current.actualStart && current.actualStart <= date ? current.actualStart : date;
  if (pct >= 100) return { execution: "COMPLETE", progressPct: 100, actualStart, actualEnd: date };
  return { execution: "IN_PROGRESS", progressPct: pct, actualStart, actualEnd: null };
}

export interface TrainInput {
  workPackages: { id: string; durationCycles: number }[];
  areas: { id: string }[];
  startCycle: number;
  bufferCycles: number;
}

/**
 * Takt train: wagon i (work package) enters area j at
 * startCycle + i × (T + buffer) + j × T, where the takt time T is the longest
 * wagon duration. Each wagon follows the previous one area by area (FS).
 */
export function generateTrain(input: TrainInput) {
  const takt = Math.max(1, ...input.workPackages.map((w) => w.durationCycles));
  const assignments: { workPackageId: string; areaId: string; startCycle: number; durationCycles: number }[] = [];
  const dependencies: { predecessor: { workPackageId: string; areaId: string }; successor: { workPackageId: string; areaId: string } }[] = [];
  input.workPackages.forEach((wp, i) => {
    input.areas.forEach((area, j) => {
      assignments.push({ workPackageId: wp.id, areaId: area.id, startCycle: input.startCycle + i * (takt + input.bufferCycles) + j * takt, durationCycles: wp.durationCycles });
      if (i > 0) dependencies.push({ predecessor: { workPackageId: input.workPackages[i - 1].id, areaId: area.id }, successor: { workPackageId: wp.id, areaId: area.id } });
    });
  });
  return { taktTime: takt, assignments, dependencies };
}

export type ChangeKind = "ADDED" | "REMOVED" | "MOVED" | "UNCHANGED";

/** Version comparison: planned spans per activity, delta in working days. */
export function compareSpans(cal: WorkingCalendar, base: Map<string, PlannedSpan>, other: Map<string, PlannedSpan>) {
  const ids = new Set([...base.keys(), ...other.keys()]);
  return [...ids].map((activityId) => {
    const a = base.get(activityId) ?? null;
    const b = other.get(activityId) ?? null;
    let change: ChangeKind;
    let startDelta = 0;
    let endDelta = 0;
    if (!a) change = "ADDED";
    else if (!b) change = "REMOVED";
    else {
      startDelta = workingDaysBetween(cal, a.start, b.start);
      endDelta = workingDaysBetween(cal, a.end, b.end);
      change = startDelta === 0 && endDelta === 0 ? "UNCHANGED" : "MOVED";
    }
    return { activityId, base: a, other: b, change, startDelta, endDelta };
  });
}

// ── Look-ahead ─────────────────────────────────────────────────────

export interface RequirementSpan {
  kind: "TRADE" | "EQUIPMENT_TYPE";
  key: string;
  quantity: number;
  start: Date;
  end: Date;
}

export interface WeekCell {
  weekStart: string;
  /** Highest daily demand in the week (people or units needed at once). */
  peak: number;
  /** Sum over working days (person-days / unit-days). */
  days: number;
}

/** Monday of the ISO week. */
export function mondayOf(d: Date): Date {
  return shiftDays(d, -(isoWeekday(d) - 1));
}

/**
 * Weekly demand per resource key for `weeks` weeks starting from the week of
 * `from`. Demand on a day = sum of quantities of spans covering that working day.
 */
export function weeklyDemand(cal: WorkingCalendar, spans: RequirementSpan[], from: Date, weeks: number) {
  const first = mondayOf(from);
  const weekStarts = Array.from({ length: weeks }, (_, i) => shiftDays(first, i * 7));
  const end = shiftDays(first, weeks * 7 - 1);
  const days = workingDaysInRange(cal, first, end);
  const byKey = new Map<string, { kind: RequirementSpan["kind"]; key: string; cells: WeekCell[] }>();
  for (const s of spans) {
    if (s.end < first || s.start > end) continue;
    const id = `${s.kind}:${s.key}`;
    if (!byKey.has(id)) byKey.set(id, { kind: s.kind, key: s.key, cells: weekStarts.map((w) => ({ weekStart: toIsoDate(w), peak: 0, days: 0 })) });
  }
  for (const row of byKey.values()) {
    const relevant = spans.filter((s) => s.kind === row.kind && s.key === row.key);
    for (const day of days) {
      const demand = relevant.reduce((sum, s) => (s.start <= day && day <= s.end ? sum + s.quantity : sum), 0);
      if (demand === 0) continue;
      const cell = row.cells[Math.floor((day.getTime() - first.getTime()) / (7 * 86_400_000))];
      cell.peak = Math.max(cell.peak, demand);
      cell.days += demand;
    }
  }
  return { weekStarts: weekStarts.map(toIsoDate), rows: [...byKey.values()] };
}
