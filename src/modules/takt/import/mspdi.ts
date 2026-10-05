import { XMLParser } from "fast-xml-parser";
import type { DependencyType } from "../engine";
import { datePart, MAX_TASKS, ScheduleParseError, type ParsedLink, type ParsedSchedule, type ParsedTask } from "./types";

/** MSPDI PredecessorLink/Type: 0 = FF, 1 = FS, 2 = SF, 3 = SS. */
const LINK_TYPES: Record<string, DependencyType> = { "0": "FF", "1": "FS", "2": "SF", "3": "SS" };

type XmlNode = Record<string, unknown>;

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v)).trim();

/**
 * Parses Microsoft Project XML (MSPDI, "Save as → XML"). Entity processing is
 * disabled (no entity expansion, no external resources). Summary tasks become
 * the path of their leaf tasks; the project summary task (outline level 0) is
 * ignored.
 */
export function parseMspdi(xml: string): ParsedSchedule {
  let doc: XmlNode;
  try {
    const parser = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      processEntities: false,
      isArray: (name) => name === "Task" || name === "PredecessorLink",
    });
    doc = parser.parse(xml) as XmlNode;
  } catch {
    throw new ScheduleParseError("invalid XML");
  }
  const project = doc.Project as XmlNode | undefined;
  if (!project || typeof project !== "object") throw new ScheduleParseError("not an MS Project XML file");
  const rawTasks = ((project.Tasks as XmlNode | undefined)?.Task as XmlNode[] | undefined) ?? [];
  if (rawTasks.length > MAX_TASKS) throw new ScheduleParseError("too many tasks");
  const minutesPerDay = Number(str(project.MinutesPerDay)) || 480;

  const tasks: ParsedTask[] = [];
  const links: ParsedLink[] = [];
  const stack: { level: number; name: string }[] = [];
  for (const t of rawTasks) {
    const level = Number(str(t.OutlineLevel) || "1");
    const uid = str(t.UID);
    const name = str(t.Name);
    if (!uid || level === 0 || str(t.IsNull) === "1") continue;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const isSummary = str(t.Summary) === "1";
    if (isSummary) {
      stack.push({ level, name });
      continue;
    }
    const start = datePart(str(t.Start));
    const finish = datePart(str(t.Finish));
    if (!start || !finish) continue;
    tasks.push({ uid, name: name || uid, path: stack.map((s) => s.name), start, finish: finish < start ? start : finish, milestone: str(t.Milestone) === "1" });
    for (const l of (t.PredecessorLink as XmlNode[] | undefined) ?? []) {
      const pred = str(l.PredecessorUID);
      if (!pred) continue;
      const lagTenthMinutes = Number(str(l.LinkLag) || "0");
      links.push({ predecessorUid: pred, successorUid: uid, type: LINK_TYPES[str(l.Type) || "1"] ?? "FS", lagDays: Math.round(lagTenthMinutes / 10 / minutesPerDay) });
    }
  }
  return { format: "MSPDI", projectName: str(project.Title) || str(project.Name) || null, tasks, links };
}
