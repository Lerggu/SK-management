import { readClient, runInTransaction } from "@/platform/db";
import { NotFoundError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { hasPermission, requirePermission, type RequestContext } from "@/platform/authz";
import { finnishPublicHolidays, toIsoDate } from "./calendar";
import { defaultHolidayRows, ensureDefaultCalendar, today } from "./access";
import { TaktRepo } from "./repo";
import { holidaySchema, holidayYearSchema, weekdaysSchema } from "./schemas";

/** Company working calendar (working weekdays and public holidays). */
export const workCalendarService = {
  /** The default calendar (readable by every member); before first use, the defaults that will be created. */
  async get(ctx: RequestContext) {
    const repo = new TaktRepo(readClient(), ctx.company.id);
    const cal = await repo.findDefaultCalendar();
    const canManage = hasPermission(ctx, "company.manage");
    if (cal) return { persisted: true, id: cal.id, name: cal.name, workingWeekdays: cal.workingWeekdays, holidays: cal.holidays.map((h) => ({ id: h.id, date: toIsoDate(h.date), name: h.name })), canManage };
    const year = today().getUTCFullYear();
    return { persisted: false, id: null, name: "Oletus", workingWeekdays: [1, 2, 3, 4, 5], holidays: defaultHolidayRows(year, ctx.locale).map((h) => ({ id: null, date: toIsoDate(h.date), name: h.name })), canManage };
  },

  async updateWeekdays(ctx: RequestContext, input: { workingWeekdays: (number | string)[] }) {
    const data = parseInput(weekdaysSchema, input);
    requirePermission(ctx, "company.manage");
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const before = await ensureDefaultCalendar(tx, repo, ctx);
      const weekdays = [...new Set(data.workingWeekdays)].sort();
      const after = await repo.updateCalendar(before.id, { workingWeekdays: weekdays, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "work_calendar.update", entityType: "work_calendar", entityId: after.id, before: { workingWeekdays: before.workingWeekdays }, after: { workingWeekdays: after.workingWeekdays } });
      return after;
    });
  },

  async addHoliday(ctx: RequestContext, input: { date: string; name: string }) {
    const data = parseInput(holidaySchema, input);
    requirePermission(ctx, "company.manage");
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const cal = await ensureDefaultCalendar(tx, repo, ctx);
      await repo.createHolidays([{ calendarId: cal.id, date: data.date, name: data.name, createdById: ctx.user.id }]);
      await writeAudit(tx, ctx, { action: "work_calendar.holiday_add", entityType: "work_calendar", entityId: cal.id, after: { date: toIsoDate(data.date), name: data.name } });
    });
  },

  async removeHoliday(ctx: RequestContext, holidayId: string) {
    requirePermission(ctx, "company.manage");
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const h = await repo.findHoliday(holidayId);
      if (!h) throw new NotFoundError();
      await repo.deleteHoliday(h.id);
      await writeAudit(tx, ctx, { action: "work_calendar.holiday_remove", entityType: "work_calendar", entityId: h.calendarId, before: { date: toIsoDate(h.date), name: h.name } });
    });
  },

  /** Adds Finnish public holidays of a year (existing dates are kept). */
  async addFinnishHolidays(ctx: RequestContext, input: { year: number | string }) {
    const data = parseInput(holidayYearSchema, input);
    requirePermission(ctx, "company.manage");
    return runInTransaction(async (tx) => {
      const repo = new TaktRepo(tx, ctx.company.id);
      const cal = await ensureDefaultCalendar(tx, repo, ctx);
      const result = await repo.createHolidays(finnishPublicHolidays(data.year).map((h) => ({ calendarId: cal.id, date: h.date, name: h.name[ctx.locale], createdById: ctx.user.id })));
      await writeAudit(tx, ctx, { action: "work_calendar.holiday_add", entityType: "work_calendar", entityId: cal.id, after: { year: data.year, added: result.count } });
      return { added: result.count };
    });
  },
};
