import { readClient } from "@/platform/db";
import { ForbiddenError } from "@/platform/errors";
import { parseInput } from "@/platform/http/validation";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { hasPermission, type RequestContext } from "@/platform/authz";
import { companyWideHr } from "./access";
import { HrRepo } from "./repo";
import { loadViewer, visibleEmployeeIds } from "./load";
import { addCalendarMonths, isCurrentlyValid, isoDate, latestPublishedByArea, meetsLanguage, requirementGaps, validityState } from "./rules";
import { hrSearchSchema, matrixSchema, qualificationListSchema, type HrSearchInput } from "./schemas";

const ymd = (d: Date | null) => (d ? isoDate(d) : null);
const name = (e: { firstName: string; lastName: string }) => `${e.lastName} ${e.firstName}`;

/** Employees whose HR data the caller may see (active records only unless asked). */
async function visibleEmployees(ctx: RequestContext, repo: HrRepo, includeInactive = false) {
  if (ctx.external) throw new ForbiddenError("External members have no HR access");
  const viewer = await loadViewer(ctx, repo);
  const visible = visibleEmployeeIds(ctx, viewer);
  if (visible !== "ALL" && visible.size === 0) throw new ForbiddenError("No HR access");
  const employees = await repo.listEmployees({
    archivedAt: null,
    ...(includeInactive ? {} : { status: "ACTIVE" }),
    ...(visible === "ALL" ? {} : { id: { in: [...visible] } }),
  });
  return { employees, viewer, companyWide: visible === "ALL" };
}

export const hrOverviewService = {
  /** Competence matrix: employees × areas, latest published supervisor assessment with its date. */
  async matrix(ctx: RequestContext, input: { allAreas?: boolean; team?: string | null; jobProfileId?: string | null } = {}) {
    const filter = parseInput(matrixSchema, input);
    const repo = new HrRepo(readClient(), ctx.company.id);
    const { employees: all } = await visibleEmployees(ctx, repo);
    const employees = all.filter((e) => (!filter.team || e.team === filter.team) && (!filter.jobProfileId || e.jobProfileId === filter.jobProfileId));
    const areas = (await repo.listAreas()).filter((a) => filter.allAreas || a.isKey);
    const assessments = await repo.listAssessments(employees.map((e) => e.id));
    const rows = employees.map((e) => {
      const latest = latestPublishedByArea(
        assessments.filter((a) => a.employeeId === e.id),
        "SUPERVISOR",
      );
      return {
        employee: { id: e.id, name: name(e), jobTitle: e.jobTitle, team: e.team },
        cells: Object.fromEntries(areas.map((a) => {
          const l = latest.get(a.id);
          return [a.id, l ? { level: l.level, assessedOn: l.assessedOn } : null];
        })) as Record<string, { level: number | null; assessedOn: Date } | null>,
      };
    });
    const teams = [...new Set(all.map((e) => e.team).filter((x): x is string => !!x))].sort();
    return { areas, rows, teams };
  },

  /** Cards and qualifications of visible employees with validity, filterable. */
  async qualifications(ctx: RequestContext, input: { employeeId?: string | null; typeId?: string | null; validity?: string | null } = {}) {
    const filter = parseInput(qualificationListSchema, input);
    const repo = new HrRepo(readClient(), ctx.company.id);
    const { employees } = await visibleEmployees(ctx, repo, true);
    const ids = employees.map((e) => e.id).filter((id) => !filter.employeeId || id === filter.employeeId);
    const today = todayInDisplayZone();
    const rows = (await repo.listQualifications({ employeeId: { in: ids }, replacedAt: null, ...(filter.typeId ? { typeId: filter.typeId } : {}) }))
      .map((q) => ({ ...q, validity: validityState(ymd(q.expiresOn), q.noExpiry, today), employee: employees.find((e) => e.id === q.employeeId)! }))
      .filter((q) => !filter.validity || q.validity === filter.validity);
    return {
      rows: rows.map((q) => ({ ...q, employee: { id: q.employee.id, name: name(q.employee) } })),
      employees: employees.map((e) => ({ id: e.id, name: name(e) })),
      counts: {
        VALID: rows.filter((q) => q.validity === "VALID").length,
        EXPIRING: rows.filter((q) => q.validity === "EXPIRING").length,
        EXPIRED: rows.filter((q) => q.validity === "EXPIRED").length,
        NO_EXPIRY: rows.filter((q) => q.validity === "NO_EXPIRY").length,
      },
    };
  },

  /**
   * HR summary: missing and expiring cards, upcoming assessments, planned
   * trainings and open actions, orientations in progress, items to return and
   * inspections due (admin), and gaps against job requirements.
   */
  async overview(ctx: RequestContext) {
    const repo = new HrRepo(readClient(), ctx.company.id);
    const { employees } = await visibleEmployees(ctx, repo, true);
    const active = employees.filter((e) => e.status === "ACTIVE");
    const ids = active.map((e) => e.id);
    const today = todayInDisplayZone();
    const horizon = addCalendarMonths(today, 2);
    const byId = new Map(employees.map((e) => [e.id, e]));
    const person = (id: string) => ({ id, name: byId.has(id) ? name(byId.get(id)!) : "" });
    const admin = !ctx.external && hasPermission(ctx, "hr.manage");

    const [qualifications, assessments, trainings, orientations, profiles] = await Promise.all([
      repo.listQualifications({ employeeId: { in: ids }, replacedAt: null }),
      repo.listAssessments(ids),
      repo.listTrainings(ids),
      repo.listOrientations(ids),
      repo.listProfiles(),
    ]);
    const expiring = qualifications
      .map((q) => ({ q, validity: validityState(ymd(q.expiresOn), q.noExpiry, today) }))
      .filter((x) => x.validity === "EXPIRING" || x.validity === "EXPIRED")
      .map((x) => ({ id: x.q.id, name: x.q.name, expiresOn: x.q.expiresOn, validity: x.validity, employee: person(x.q.employeeId) }));
    const expiringTrainings = trainings
      .filter((t) => t.status === "COMPLETED" && t.expiresOn)
      .map((t) => ({ t, validity: validityState(ymd(t.expiresOn), false, today) }))
      .filter((x) => x.validity === "EXPIRING" || x.validity === "EXPIRED")
      .map((x) => ({ id: x.t.id, name: x.t.name, expiresOn: x.t.expiresOn, validity: x.validity, employee: person(x.t.employeeId) }));

    const upcomingAssessments: { employee: { id: string; name: string }; areaId: string; nextAssessmentOn: Date; overdue: boolean }[] = [];
    const levelsByEmployee = new Map<string, Map<string, number | null>>();
    for (const id of ids) {
      const latest = latestPublishedByArea(
        assessments.filter((a) => a.employeeId === id),
        "SUPERVISOR",
      );
      levelsByEmployee.set(id, new Map([...latest].map(([k, v]) => [k, v.level])));
      for (const a of latest.values()) {
        if (a.nextAssessmentOn && isoDate(a.nextAssessmentOn) <= horizon) upcomingAssessments.push({ employee: person(id), areaId: a.areaId, nextAssessmentOn: a.nextAssessmentOn, overdue: isoDate(a.nextAssessmentOn) < today });
      }
    }
    upcomingAssessments.sort((a, b) => a.nextAssessmentOn.getTime() - b.nextAssessmentOn.getTime());

    const openActions = assessments
      .filter((a) => a.kind === "SUPERVISOR" && a.status === "PUBLISHED" && a.agreedActions && !a.actionDoneAt)
      .map((a) => ({ id: a.id, employee: person(a.employeeId), areaId: a.areaId, agreedActions: a.agreedActions!, actionDueOn: a.actionDueOn, actionOwner: a.actionOwnerEmployeeId ? person(a.actionOwnerEmployeeId) : null }));
    const plannedTrainings = trainings.filter((t) => t.status === "PLANNED").map((t) => ({ id: t.id, name: t.name, plannedOn: t.plannedOn, employee: person(t.employeeId) }));
    const openOrientations = orientations
      .filter((o) => o.status === "IN_PROGRESS" || (o.renewalDueOn && isoDate(o.renewalDueOn) <= horizon))
      .map((o) => ({ id: o.id, topic: o.topic, scope: o.scope, status: o.status, renewalDueOn: o.renewalDueOn, employee: person(o.employeeId) }));

    const gaps = active
      .filter((e) => e.jobProfileId)
      .map((e) => {
        const profile = profiles.find((p) => p.id === e.jobProfileId);
        if (!profile) return null;
        const valid = new Set(qualifications.filter((q) => q.employeeId === e.id && q.typeId && isCurrentlyValid(ymd(q.expiresOn), q.noExpiry, today)).map((q) => q.typeId!));
        const list = requirementGaps(profile.requirements, {
          levels: levelsByEmployee.get(e.id) ?? new Map(),
          validQualificationTypes: valid,
          orientations: orientations.filter((o) => o.employeeId === e.id && o.status === "DONE").map((o) => ({ scope: o.scope, topic: o.topic })),
        });
        return list.length ? { employee: person(e.id), profile: { id: profile.id, name: profile.name }, gaps: list } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    let itemsToReturn: { id: string; name: string; serialNumber: string | null; employee: { id: string; name: string }; endDate: Date | null }[] = [];
    let inspectionsDue: { id: string; name: string; nextInspectionOn: Date; overdue: boolean; employee: { id: string; name: string } }[] = [];
    if (admin) {
      const items = await repo.listItems({ status: "WITH_EMPLOYEE" });
      const soon = addCalendarMonths(today, 1);
      itemsToReturn = items
        .filter((i) => {
          const e = byId.get(i.employeeId);
          return e && (e.status !== "ACTIVE" || (e.endDate && isoDate(e.endDate) <= soon));
        })
        .map((i) => ({ id: i.id, name: i.name, serialNumber: i.serialNumber, employee: person(i.employeeId), endDate: byId.get(i.employeeId)?.endDate ?? null }));
      inspectionsDue = items
        .filter((i) => i.nextInspectionOn && isoDate(i.nextInspectionOn) <= soon)
        .map((i) => ({ id: i.id, name: i.name, nextInspectionOn: i.nextInspectionOn!, overdue: isoDate(i.nextInspectionOn!) < today, employee: person(i.employeeId) }))
        .sort((a, b) => a.nextInspectionOn.getTime() - b.nextInspectionOn.getTime());
    }

    const areas = await repo.listAreas(true);
    return {
      expiring,
      expiringTrainings,
      upcomingAssessments,
      openActions,
      plannedTrainings,
      openOrientations,
      gaps,
      itemsToReturn,
      inspectionsDue,
      admin,
      areaNames: Object.fromEntries(areas.map((a) => [a.id, a.name])),
      typeNames: Object.fromEntries((await repo.listTypes(true)).map((t) => [t.id, t.name])),
    };
  },

  /**
   * Employee search for crew planning: job profile, team and location for
   * everyone with employee access; competence, language and valid-card
   * filters only over employees whose HR data the caller may see.
   */
  async search(ctx: RequestContext, input: HrSearchInput) {
    const f = parseInput(hrSearchSchema, input);
    const repo = new HrRepo(readClient(), ctx.company.id);
    const workFilter = Boolean(f.areaId || f.language || f.qualificationTypeId);
    if (ctx.external) throw new ForbiddenError("External members have no HR access");
    const viewer = await loadViewer(ctx, repo);
    const visible = visibleEmployeeIds(ctx, viewer);
    if (!hasPermission(ctx, "employee.view") && !companyWideHr(ctx)) throw new ForbiddenError("Missing permission employee.view");
    if (workFilter && visible !== "ALL" && visible.size === 0) throw new ForbiddenError("No HR access");
    const q = f.q;
    let employees = await repo.listEmployees({
      archivedAt: null,
      ...(f.includeInactive ? {} : { status: "ACTIVE" }),
      ...(f.jobProfileId ? { jobProfileId: f.jobProfileId } : {}),
      ...(f.team ? { team: f.team } : {}),
      ...(f.location ? { location: f.location } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" as const } },
              { lastName: { contains: q, mode: "insensitive" as const } },
              { employeeNumber: { contains: q, mode: "insensitive" as const } },
              { jobTitle: { contains: q, mode: "insensitive" as const } },
              { trade: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(workFilter && visible !== "ALL" ? { id: { in: [...visible] } } : {}),
    });
    const ids = employees.map((e) => e.id);
    if (f.areaId) {
      const assessments = await repo.listAssessments(ids);
      employees = employees.filter((e) => {
        const l = latestPublishedByArea(
          assessments.filter((a) => a.employeeId === e.id),
          "SUPERVISOR",
        ).get(f.areaId!);
        return l && l.level !== null && l.level >= (f.minLevel ?? 1);
      });
    }
    if (f.language) {
      const langs = await repo.listLanguages(employees.map((e) => e.id));
      employees = employees.filter((e) => meetsLanguage(langs.filter((l) => l.employeeId === e.id), f.language!, f.languageLevel ?? "BEGINNER") || (e.preferredLanguage === f.language && !f.languageLevel));
    }
    if (f.qualificationTypeId) {
      const today = todayInDisplayZone();
      const quals = await repo.listQualifications({ employeeId: { in: employees.map((e) => e.id) }, typeId: f.qualificationTypeId, replacedAt: null });
      const ok = new Set(quals.filter((x) => isCurrentlyValid(ymd(x.expiresOn), x.noExpiry, today)).map((x) => x.employeeId));
      employees = employees.filter((e) => ok.has(e.id));
    }
    const all = await repo.listEmployees({ archivedAt: null });
    return {
      employees: employees.map((e) => ({ id: e.id, employeeNumber: e.employeeNumber, firstName: e.firstName, lastName: e.lastName, jobTitle: e.jobTitle, trade: e.trade, team: e.team, location: e.location, status: e.status })),
      teams: [...new Set(all.map((e) => e.team).filter((x): x is string => !!x))].sort(),
      locations: [...new Set(all.map((e) => e.location).filter((x): x is string => !!x))].sort(),
      workFilters: companyWideHr(ctx) || (visible !== "ALL" && visible.size > 0),
    };
  },
};
