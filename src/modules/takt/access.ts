import { ForbiddenError, NotFoundError } from "@/platform/errors";
import { canAccessProject, projectIdsWithPermission, projectPermissions, type PermissionKey, type RequestContext } from "@/platform/authz";
import { todayInDisplayZone } from "@/platform/i18n/config";
import type { Tx } from "@/platform/db";
import { writeAudit } from "@/platform/audit";
import { finnishPublicHolidays, parseIsoDate, toIsoDate, type WorkingCalendar } from "./calendar";
import type { TaktRepo } from "./repo";

/** Takt visibility is project-scoped: not visible → 404, no capability → 403. */
export function requireTakt(ctx: RequestContext, projectId: string, permission: PermissionKey) {
  if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
  const perms = projectPermissions(ctx, projectId);
  if (!perms.has("takt.view")) throw new NotFoundError();
  if (!perms.has(permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

export function taktPermissions(ctx: RequestContext, projectId: string) {
  const perms = projectPermissions(ctx, projectId);
  return { manage: perms.has("takt.manage"), progress: perms.has("takt.progress.update"), approve: perms.has("takt.baseline.approve") };
}

/** Projects whose takt data the member may see (undefined = all). */
export function visibleTaktProjects(ctx: RequestContext): string[] | undefined {
  return projectIdsWithPermission(ctx, "takt.view");
}

export function today(): Date {
  return parseIsoDate(todayInDisplayZone());
}

export function toWorkingCalendar(cal: { workingWeekdays: number[]; holidays: { date: Date }[] }): WorkingCalendar {
  return { workingWeekdays: cal.workingWeekdays, holidays: new Set(cal.holidays.map((h) => toIsoDate(h.date))) };
}

/** Finnish public holidays for this year and the next two, as calendar rows. */
export function defaultHolidayRows(fromYear: number, locale: "fi" | "en" = "fi") {
  return [fromYear, fromYear + 1, fromYear + 2].flatMap((y) => finnishPublicHolidays(y).map((h) => ({ date: h.date, name: h.name[locale] })));
}

/**
 * The company's default working calendar (Mon–Fri), created on first use with
 * Finnish public holidays for three years.
 */
export async function ensureDefaultCalendar(tx: Tx, repo: TaktRepo, ctx: RequestContext) {
  const existing = await repo.findDefaultCalendar();
  if (existing) return existing;
  const created = await repo.createCalendar({ name: "Oletus", isDefault: true, createdById: ctx.user.id, updatedById: ctx.user.id });
  const year = today().getUTCFullYear();
  await repo.createHolidays(defaultHolidayRows(year).map((h) => ({ ...h, calendarId: created.id, createdById: ctx.user.id })));
  await writeAudit(tx, ctx, { action: "work_calendar.create", entityType: "work_calendar", entityId: created.id, after: { name: created.name, workingWeekdays: created.workingWeekdays, holidaysFrom: year } });
  return (await repo.findCalendar(created.id))!;
}
