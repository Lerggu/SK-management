import { readClient } from "@/platform/db";
import { NotFoundError } from "@/platform/errors";
import { canAccessProject, projectPermissions, type RequestContext } from "@/platform/authz";
import { toIsoDate } from "./calendar";
import { TaktRepo } from "./repo";
import { spansFor } from "./plan.service";
import { toWorkingCalendar } from "./access";

/**
 * V7: schedule progress summary for a project — used by the client portal
 * (portal.client) and internal views (takt.view). Baseline dates and progress
 * only: no crews, resources, constraints or delay reasons.
 */
export const scheduleSummaryService = {
  async project(ctx: RequestContext, projectId: string) {
    if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
    const perms = projectPermissions(ctx, projectId);
    if (!perms.has("takt.view") && !perms.has("portal.client")) throw new NotFoundError();
    const repo = new TaktRepo(readClient(), ctx.company.id);
    const project = await repo.findProject(projectId);
    if (!project) throw new NotFoundError();
    const plans = await repo.listPlans([project.id]);
    const out = [];
    let total = 0;
    let complete = 0;
    let progressSum = 0;
    for (const plan of plans) {
      const activities = await repo.listActivities(plan.id);
      const baseline = plan.versions.find((v) => v.status === "BASELINE") ?? null;
      let start: string | null = null;
      let finish: string | null = null;
      if (baseline) {
        const calendar = await repo.findCalendar(plan.calendarId);
        if (!calendar) throw new NotFoundError();
        const cal = toWorkingCalendar(calendar);
        const spans = [...spansFor(cal, plan, baseline, await repo.listAssignments(baseline.id)).values()];
        if (spans.length) {
          start = toIsoDate(spans.reduce((m, s) => (s.start < m ? s.start : m), spans[0].start));
          finish = toIsoDate(spans.reduce((m, s) => (s.end > m ? s.end : m), spans[0].end));
        }
      }
      const done = activities.filter((a) => a.execution === "COMPLETE").length;
      const sum = activities.reduce((a, x) => a + x.progressPct, 0);
      total += activities.length;
      complete += done;
      progressSum += sum;
      out.push({
        id: plan.id,
        name: plan.name,
        site: plan.site.name,
        baselineVersion: baseline?.versionNumber ?? null,
        plannedStart: start,
        plannedFinish: finish,
        activities: activities.length,
        complete: done,
        progressPct: activities.length ? Math.round(sum / activities.length) : 0,
      });
    }
    return { plans: out, activities: total, complete, progressPct: total ? Math.round(progressSum / total) : 0 };
  },
};
