import { readClient } from "@/platform/db";
import { ForbiddenError, NotFoundError } from "@/platform/errors";
import { parseInput } from "@/platform/http/validation";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { hasProjectPermission, projectIdsWithPermission, type RequestContext } from "@/platform/authz";
import { ProductionRepo } from "./repo";
import { applicableRoles } from "./rules";
import { barPosition, calendarRange, calendarTicks, taskPhase } from "./calendar";
import { calendarSchema } from "./schemas";

const WEEKDAYS_FI = ["ma", "ti", "ke", "to", "pe", "la", "su"];
const WEEKDAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/**
 * Production calendar (ADR 0026, phase 2): logistics tasks of the visible
 * projects on a scalable time axis, with their colour phase and open
 * resource needs, and the company's own people and equipment with their
 * bookings, for dragging a resource onto a task.
 */
export const productionCalendarService = {
  async view(ctx: RequestContext, input: { zoom?: string; date?: string; siteId?: string | null } = {}) {
    if (ctx.external) throw new ForbiddenError("External members have no logistics access");
    const data = parseInput(calendarSchema, input);
    const projectIds = projectIdsWithPermission(ctx, "logistics.view");
    if (projectIds && projectIds.length === 0) throw new ForbiddenError("Missing permission logistics.view");
    const repo = new ProductionRepo(readClient(), ctx.company.id);
    const sites = await repo.sites(projectIds);
    if (data.siteId && !sites.some((s) => s.id === data.siteId)) throw new NotFoundError();
    const range = calendarRange(data.zoom, data.date ?? todayInDisplayZone());
    const weekdays = ctx.locale === "en" ? WEEKDAYS_EN : WEEKDAYS_FI;
    const ticks = calendarTicks(range, (iso) => weekdays[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7]);

    const [tasks, types] = await Promise.all([repo.tasksInRange({ projectIds, siteId: data.siteId, from: range.from, to: range.to }), repo.listTypes(true)]);
    const [bookings, openDeviations] = await Promise.all([repo.bookingsOfTasks(tasks.map((t) => t.id)), repo.openDeviationTaskIds(tasks.map((t) => t.id))]);
    const deviating = new Set(openDeviations.map((d) => d.requestId));
    const now = new Date();
    const canBookAny = tasks.some((t) => hasProjectPermission(ctx, t.projectId, "booking.manage"));

    const taskRows = tasks.map((t) => {
      const type = types.find((x) => x.id === t.taskTypeId) ?? null;
      const { roles } = applicableRoles(
        (type?.roles ?? []).map((r) => ({ ...r, minWeightKg: num(r.minWeightKg), maxWeightKg: num(r.maxWeightKg) })),
        num(t.weightKg),
      );
      const openRoles = roles
        .map((r) => ({ id: r.id, label: r.label, kind: r.kind, missing: Math.max(0, r.quantity - bookings.filter((b) => b.logisticsRequestId === t.id && b.taskRoleId === r.id).length) }))
        .filter((r) => r.missing > 0);
      const missing = openRoles.reduce((n, r) => n + r.missing, 0);
      return {
        id: t.id,
        title: t.title,
        site: { id: t.site.id, name: `${t.site.project.code} · ${t.site.name}` },
        start: t.requestedStart,
        end: t.requestedEnd,
        status: t.status,
        serviceType: t.serviceType,
        taskType: type ? { name: type.name, color: type.color } : null,
        phase: taskPhase({ status: t.status, end: t.requestedEnd, missing, hasType: Boolean(type) }, now),
        missing,
        openRoles,
        canAssign: hasProjectPermission(ctx, t.projectId, "booking.manage") && t.status !== "COMPLETE",
        // Open or acknowledged deviations reported from the phone (phase 3).
        deviation: deviating.has(t.id),
        bar: barPosition(range, t.requestedStart, t.requestedEnd),
      };
    });

    let resources: { kind: "EMPLOYEE" | "EQUIPMENT"; value: string; label: string; detail: string | null; bookings: { id: string; title: string; bar: ReturnType<typeof barPosition>; taskId: string | null }[] }[] = [];
    if (canBookAny) {
      const [employees, equipment, resBookings] = await Promise.all([repo.employees(), repo.equipment(), repo.resourceBookings(range.from, range.to)]);
      const of = (pred: (b: (typeof resBookings)[number]) => boolean) =>
        resBookings.filter(pred).map((b) => ({ id: b.id, title: b.logisticsRequest?.title ?? b.project.code, bar: barPosition(range, b.startsAt, b.endsAt), taskId: b.logisticsRequestId }));
      resources = [
        ...employees.map((e) => ({ kind: "EMPLOYEE" as const, value: `EMPLOYEE:${e.id}`, label: `${e.lastName} ${e.firstName}`, detail: e.trade, bookings: of((b) => b.employeeId === e.id) })),
        ...equipment.filter((q) => q.status !== "OUT_OF_SERVICE").map((q) => ({ kind: "EQUIPMENT" as const, value: `EQUIPMENT:${q.id}`, label: `${q.assetNumber} ${q.name}`, detail: null, bookings: of((b) => b.equipmentId === q.id) })),
      ];
    }

    return {
      range: { zoom: range.zoom, startDate: range.startDate, days: range.days, prevDate: range.prevDate, nextDate: range.nextDate, today: todayInDisplayZone() },
      ticks,
      sites: sites.map((s) => ({ id: s.id, name: `${s.project.code} · ${s.name}` })),
      siteId: data.siteId,
      tasks: taskRows,
      resources,
      canAssign: canBookAny,
    };
  },
};
