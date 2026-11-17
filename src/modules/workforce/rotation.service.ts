import { readClient, runInTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { hasPermission, type RequestContext } from "@/platform/authz";
import { finnishPublicHolidays } from "@/modules/takt/calendar";
import { RotationRepo } from "./rotation.repo";
import { addDays, daysBetween, isoOf, patternDays, PROTECTED, toDay, visibleEntry, weekStart, type RotationStatus, type VisibleStatus } from "./rotation";
import { boardSchema, clearRangeSchema, patternSchema, setRangeSchema, type ClearRangeInput, type PatternInput, type SetRangeInput } from "./rotation.schemas";

function requireView(ctx: RequestContext) {
  if (ctx.external) throw new ForbiddenError("External members have no workforce access");
  if (!hasPermission(ctx, "rotation.view") && !hasPermission(ctx, "rotation.manage")) throw new ForbiddenError("Missing permission rotation.view");
}

function requireManage(ctx: RequestContext) {
  if (ctx.external) throw new ForbiddenError("External members have no workforce access");
  if (!hasPermission(ctx, "rotation.manage")) throw new ForbiddenError("Missing permission rotation.manage");
}

async function siteOr422(repo: RotationRepo, siteId: string | null) {
  if (!siteId) return null;
  const site = await repo.findSite(siteId);
  if (!site) throw new ValidationError({ siteId: ["validation.invalidOption"] });
  return site;
}

/**
 * Workforce rotation plan (docs/adr/0027-workforce-rotation.md): per employee
 * and day, at work (optionally on a site), off, on vacation, sick, in
 * training or away for another reason. Company-wide; sick leave and other
 * reasons are visible only with rotation.manage.
 */
export const rotationService = {
  /** Calendar board: days, people with their entries, sites with who is there each day. */
  async board(ctx: RequestContext, input: { date?: string; weeks?: number | string; trade?: string | null } = {}) {
    requireView(ctx);
    const data = parseInput(boardSchema, input);
    const canManage = hasPermission(ctx, "rotation.manage");
    const start = weekStart(data.date ?? todayInDisplayZone());
    const end = addDays(start, data.weeks * 7 - 1);
    const repo = new RotationRepo(readClient(), ctx.company.id);
    const [employees, sites, trades, entries, teams] = await Promise.all([repo.employees(data.trade), repo.sites(), repo.trades(), repo.entries(start, end), repo.teams()]);
    const years = [...new Set([start.slice(0, 4), end.slice(0, 4)])].map(Number);
    const holidays = new Map(years.flatMap((y) => finnishPublicHolidays(y)).map((h) => [isoOf(h.date), ctx.locale === "en" ? h.name.en : h.name.fi]));
    const days = daysBetween(start, end).map((iso) => {
      const wd = (toDay(iso).getUTCDay() + 6) % 7;
      return { date: iso, weekday: wd, weekend: wd >= 5, holiday: holidays.get(iso) ?? null, today: iso === todayInDisplayZone() };
    });

    const ids = new Set(employees.map((e) => e.id));
    const byEmployee = new Map<string, Record<string, { status: VisibleStatus; siteId: string | null; note: string | null }>>();
    for (const e of entries) {
      if (!ids.has(e.employeeId)) continue;
      const v = visibleEntry({ status: e.status as RotationStatus, siteId: e.siteId, note: e.note }, canManage);
      if (!byEmployee.has(e.employeeId)) byEmployee.set(e.employeeId, {});
      byEmployee.get(e.employeeId)![isoOf(e.day)] = v;
    }
    const people = employees.map((e) => {
      const days = byEmployee.get(e.id) ?? {};
      return { id: e.id, name: `${e.lastName} ${e.firstName}`, trade: e.trade, teamId: e.teamId, days, workDays: Object.values(days).filter((d) => d.status === "WORK").length };
    });
    const siteRows = sites.map((s) => ({
      id: s.id,
      name: `${s.project.code} · ${s.name}`,
      days: Object.fromEntries(days.map((d) => [d.date, people.filter((p) => p.days[d.date]?.status === "WORK" && p.days[d.date]?.siteId === s.id).map((p) => p.id)])),
    }));
    const statusKeys: VisibleStatus[] = canManage ? ["WORK", "OFF", "VACATION", "SICK", "TRAINING", "OTHER"] : ["WORK", "OFF", "VACATION", "TRAINING", "ABSENT"];
    const statusRows = statusKeys
      .filter((k) => k !== "WORK")
      .map((k) => ({ status: k, days: Object.fromEntries(days.map((d) => [d.date, people.filter((p) => p.days[d.date]?.status === k).map((p) => p.id)])) }));
    // At work without a site.
    const unassigned = Object.fromEntries(days.map((d) => [d.date, people.filter((p) => p.days[d.date]?.status === "WORK" && !p.days[d.date]?.siteId).map((p) => p.id)]));

    return {
      range: { start, end, weeks: data.weeks, prev: addDays(start, -data.weeks * 7), next: addDays(start, data.weeks * 7), today: todayInDisplayZone() },
      days,
      people,
      sites: siteRows,
      unassigned,
      statusRows,
      trades: trades.map((t) => t.trade!).filter(Boolean),
      teams: teams.map((t) => ({ ...t, memberIds: employees.filter((e) => e.teamId === t.id).map((e) => e.id) })).filter((t) => t.memberIds.length > 0),
      trade: data.trade,
      canManage,
    };
  },

  /** Marks one employee for a range of days (overwrites what was there). */
  async setRange(ctx: RequestContext, input: SetRangeInput) {
    requireManage(ctx);
    const data = parseInput(setRangeSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new RotationRepo(tx, ctx.company.id);
      const employee = await repo.findEmployee(data.employeeId);
      if (!employee) throw new NotFoundError();
      if (employee.status !== "ACTIVE") throw new ValidationError({ employeeId: ["validation.archived"] });
      const site = await siteOr422(repo, data.status === "WORK" ? data.siteId : null);
      const days = daysBetween(data.from, data.until);
      for (const day of days) await repo.upsert(employee.id, day, { status: data.status, projectId: site?.projectId ?? null, siteId: site?.id ?? null, note: data.note }, ctx.user.id);
      await writeAudit(tx, ctx, {
        action: "rotation.set",
        entityType: "employee",
        entityId: employee.id,
        projectId: site?.projectId,
        after: { from: data.from, until: data.until, status: data.status, siteId: site?.id ?? null, days: days.length },
      });
      return { days: days.length };
    });
  },

  /** Clears an employee's plan for a range of days. */
  async clearRange(ctx: RequestContext, input: ClearRangeInput) {
    requireManage(ctx);
    const data = parseInput(clearRangeSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new RotationRepo(tx, ctx.company.id);
      const employee = await repo.findEmployee(data.employeeId);
      if (!employee) throw new NotFoundError();
      const { count } = await repo.clear(employee.id, data.from, data.until);
      await writeAudit(tx, ctx, { action: "rotation.clear", entityType: "employee", entityId: employee.id, after: { from: data.from, until: data.until, removed: count } });
      return { removed: count };
    });
  },

  /**
   * Applies a work/off rhythm (e.g. 10 days on, 4 off) to several people.
   * Vacation, sick leave, training and other absences are never overwritten;
   * existing work/off days only with `overwrite`.
   */
  async applyPattern(ctx: RequestContext, input: PatternInput) {
    requireManage(ctx);
    const data = parseInput(patternSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new RotationRepo(tx, ctx.company.id);
      const ids = [...new Set(data.employeeIds)];
      const found = await repo.employeesByIds(ids);
      if (found.length !== ids.length) throw new ValidationError({ employeeIds: ["validation.invalidOption"] });
      const site = await siteOr422(repo, data.siteId);
      const existing = await repo.entries(data.from, data.until, ids);
      const key = (e: string, d: string) => `${e}|${d}`;
      const have = new Map(existing.map((e) => [key(e.employeeId, isoOf(e.day)), e.status as RotationStatus]));
      const plan = patternDays(data.from, data.until, data.workDays, data.offDays);
      let written = 0;
      let kept = 0;
      for (const employeeId of ids) {
        for (const p of plan) {
          const current = have.get(key(employeeId, p.day));
          if (current && (PROTECTED.has(current) || !data.overwrite)) {
            kept++;
            continue;
          }
          const work = p.status === "WORK";
          await repo.upsert(employeeId, p.day, { status: p.status, projectId: work ? (site?.projectId ?? null) : null, siteId: work ? (site?.id ?? null) : null, note: null }, ctx.user.id);
          written++;
        }
      }
      await writeAudit(tx, ctx, {
        action: "rotation.pattern",
        entityType: "company",
        entityId: ctx.company.id,
        projectId: site?.projectId,
        after: { employees: ids.length, from: data.from, until: data.until, workDays: data.workDays, offDays: data.offDays, siteId: site?.id ?? null, overwrite: data.overwrite, written, kept },
      });
      return { written, kept };
    });
  },
};
