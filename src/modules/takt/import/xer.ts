import type { DependencyType } from "../engine";
import { datePart, MAX_TASKS, ScheduleParseError, type ParsedLink, type ParsedSchedule, type ParsedTask } from "./types";

const PRED_TYPES: Record<string, DependencyType> = { PR_FS: "FS", PR_SS: "SS", PR_FF: "FF", PR_SF: "SF" };

type Row = Record<string, string>;

/** XER is tab-separated: %T table, %F field names, %R rows, %E end. */
export function readXerTables(text: string): Map<string, Row[]> {
  const tables = new Map<string, Row[]>();
  let current: Row[] | null = null;
  let fields: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const cols = rawLine.split("\t");
    switch (cols[0]) {
      case "%T":
        current = [];
        tables.set(cols[1]?.trim() ?? "", current);
        fields = [];
        break;
      case "%F":
        fields = cols.slice(1).map((f) => f.trim());
        break;
      case "%R":
        if (current) {
          const row: Row = {};
          fields.forEach((f, i) => (row[f] = (cols[i + 1] ?? "").trim()));
          current.push(row);
        }
        break;
      default:
        break;
    }
  }
  return tables;
}

/** Hours → working days (8 h days, P6 default). */
const lagDays = (hours: string) => Math.round((Number(hours) || 0) / 8);

/**
 * Parses a Primavera P6 XER export. The WBS chain (PROJWBS, project node
 * excluded) is the path of each activity. Planned dates use the target dates,
 * falling back to early dates. Only the first project in the file is read.
 */
export function parseXer(text: string): ParsedSchedule {
  if (!text.startsWith("ERMHDR")) throw new ScheduleParseError("not a P6 XER file");
  const tables = readXerTables(text);
  const projects = tables.get("PROJECT") ?? [];
  const projId = projects[0]?.proj_id;
  const inProject = (r: Row) => !projId || !r.proj_id || r.proj_id === projId;
  const wbsRows = (tables.get("PROJWBS") ?? []).filter(inProject);
  const taskRows = (tables.get("TASK") ?? []).filter(inProject);
  if (taskRows.length > MAX_TASKS) throw new ScheduleParseError("too many tasks");

  const wbs = new Map(wbsRows.map((w) => [w.wbs_id, w]));
  const pathCache = new Map<string, string[]>();
  const pathOf = (wbsId: string | undefined, depth = 0): string[] => {
    if (!wbsId || depth > 50) return [];
    const cached = pathCache.get(wbsId);
    if (cached) return cached;
    const node = wbs.get(wbsId);
    if (!node || node.proj_node_flag === "Y") return [];
    const p = [...pathOf(node.parent_wbs_id, depth + 1), node.wbs_name || node.wbs_short_name];
    pathCache.set(wbsId, p);
    return p;
  };

  const tasks: ParsedTask[] = [];
  const known = new Set<string>();
  for (const t of taskRows) {
    if (t.task_type === "TT_WBS" || t.task_type === "TT_LOE") continue;
    const start = datePart(t.target_start_date) ?? datePart(t.early_start_date);
    const finish = datePart(t.target_end_date) ?? datePart(t.early_end_date) ?? start;
    if (!start || !finish) continue;
    known.add(t.task_id);
    tasks.push({
      uid: t.task_id,
      name: t.task_name || t.task_code || t.task_id,
      path: pathOf(t.wbs_id),
      start,
      finish: finish < start ? start : finish,
      milestone: t.task_type === "TT_Mile" || t.task_type === "TT_FinMile",
    });
  }
  const links: ParsedLink[] = (tables.get("TASKPRED") ?? [])
    .filter((p) => known.has(p.task_id) && known.has(p.pred_task_id))
    .map((p) => ({ predecessorUid: p.pred_task_id, successorUid: p.task_id, type: PRED_TYPES[p.pred_type] ?? "FS", lagDays: lagDays(p.lag_hr_cnt) }));
  return { format: "XER", projectName: projects[0]?.proj_short_name || null, tasks, links };
}

/** XER files are often Windows-1252; fall back to latin1 when not valid UTF-8. */
export function decodeScheduleText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}
