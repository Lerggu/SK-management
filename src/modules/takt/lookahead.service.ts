import { readClient } from "@/platform/db";
import { NotFoundError } from "@/platform/errors";
import { parseInput } from "@/platform/http/validation";
import { canAccessProject, projectPermissions, type RequestContext } from "@/platform/authz";
import { parseIsoDate, shiftDays, toIsoDate } from "./calendar";
import { utcToZoned } from "@/platform/i18n/time";
import { mondayOf, weeklyDemand } from "./engine";
import { toWorkingCalendar, today, visibleTaktProjects } from "./access";
import { TaktRepo } from "./repo";
import { lookaheadSchema, type LookaheadInput } from "./schemas";

/**
 * Look-ahead (2-week operational, 6-week resource, 12-week forecast): demand
 * from baseline resource requirements of activities not yet complete, per
 * trade and equipment type, against the company's own active capacity and
 * the resources it has booked (V4).
 */
export const lookaheadService = {
  async compute(ctx: RequestContext, input: LookaheadInput) {
    const data = parseInput(lookaheadSchema, input);
    const repo = new TaktRepo(readClient(), ctx.company.id);
    let projectIds = visibleTaktProjects(ctx);
    if (data.projectId) {
      if (!canAccessProject(ctx, data.projectId) || !projectPermissions(ctx, data.projectId).has("takt.view")) throw new NotFoundError();
      if (!(await repo.findProject(data.projectId))) throw new NotFoundError();
      projectIds = [data.projectId];
    }
    const from = mondayOf(data.from ?? today());
    const to = shiftDays(from, data.weeks * 7 - 1);
    const calendarRow = await repo.findDefaultCalendar();
    const cal = calendarRow ? toWorkingCalendar(calendarRow) : { workingWeekdays: [1, 2, 3, 4, 5], holidays: new Set<string>() };
    const [requirements, tradeCapacity, equipmentCapacity, equipmentTypes, plans, bookings] = await Promise.all([
      repo.baselineRequirements(projectIds, from, to),
      repo.tradeCapacity(),
      repo.equipmentCapacity(),
      repo.listEquipmentTypes(),
      repo.listPlans(visibleTaktProjects(ctx)),
      repo.approvedBookings(from, shiftDays(to, 1)),
    ]);
    // Booked capacity (V4): approved bookings of this company per trade / equipment type.
    const booked = weeklyDemand(
      cal,
      bookings
        .map((b) => ({ kind: b.employee ? ("TRADE" as const) : ("EQUIPMENT_TYPE" as const), key: b.employee ? (b.employee.trade ?? "").toLowerCase() : b.equipment!.equipmentTypeId, quantity: 1, start: parseIsoDate(utcToZoned(b.startsAt).date), end: parseIsoDate(utcToZoned(new Date(b.endsAt.getTime() - 1)).date) }))
        .filter((b) => b.key),
      from,
      data.weeks,
    );
    const bookedFor = (kind: string, key: string) => booked.rows.find((r) => r.kind === kind && r.key === (kind === "TRADE" ? key.toLowerCase() : key))?.cells;
    const demand = weeklyDemand(
      cal,
      requirements.map((r) => ({ kind: r.kind, key: r.kind === "TRADE" ? r.trade! : r.equipmentTypeId!, quantity: r.quantity, start: r.startDate, end: r.endDate })),
      from,
      data.weeks,
    );
    const typeName = new Map(equipmentTypes.map((t) => [t.id, t]));
    const rows = demand.rows
      .map((row) => {
        const capacity = row.kind === "TRADE" ? (tradeCapacity.get(row.key.toLowerCase()) ?? 0) : (equipmentCapacity.get(row.key) ?? 0);
        const type = row.kind === "EQUIPMENT_TYPE" ? typeName.get(row.key) : undefined;
        const activities = new Set(requirements.filter((r) => r.kind === row.kind && (r.trade ?? r.equipmentTypeId) === row.key).map((r) => r.activityId)).size;
        return {
          kind: row.kind,
          key: row.key,
          label: row.kind === "TRADE" ? row.key : (type?.name ?? row.key),
          lifting: type?.category === "CRANE" || type?.category === "LIFTING_ACCESSORY",
          capacity,
          activities,
          cells: row.cells.map((c, i) => ({ ...c, shortage: Math.max(0, c.peak - capacity), booked: bookedFor(row.kind, row.key)?.[i]?.peak ?? 0 })),
        };
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
    const projects = new Map<string, { id: string; code: string; name: string }>();
    for (const p of plans) projects.set(p.site.project.id, p.site.project);
    return {
      weeks: data.weeks,
      from: toIsoDate(from),
      to: toIsoDate(to),
      projectId: data.projectId,
      weekStarts: demand.weekStarts,
      rows,
      shortages: rows.reduce((n, r) => n + r.cells.filter((c) => c.shortage > 0).length, 0),
      projects: [...projects.values()].sort((a, b) => a.code.localeCompare(b.code)),
    };
  },
};
