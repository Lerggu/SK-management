/**
 * Controlled data tools of the AI project controller (ADR 0023). Each tool
 * calls an existing domain service with the requesting user's own context, so
 * the model only ever sees what that user may see — and each output mapper
 * selects explicit fields: no person names, e-mails, user ids or rates
 * (owner decision: no personal data to the AI provider).
 */
import { projectPermissions, type PermissionKey, type RequestContext } from "@/platform/authz";
import type { AiTool } from "@/platform/ai";
import { projectService } from "../projects/service";
import { scheduleSummaryService } from "../takt/summary.service";
import { forecastService, variationService } from "../commercial/project.service";
import { hseOverviewService } from "../hse/hse.service";
import { AiRepo } from "./repo";

const NO_INPUT = { type: "object", properties: {}, required: [], additionalProperties: false };
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const clip = (s: string | null | undefined, n = 300) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);

interface ToolDef extends AiTool {
  permission: PermissionKey;
  execute(ctx: RequestContext, projectId: string, repo: AiRepo): Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "project_overview",
    description: "Project code, name, status, planned dates and number of sites.",
    inputSchema: NO_INPUT,
    permission: "project.view",
    async execute(ctx, projectId, repo) {
      const p = await projectService.get(ctx, projectId);
      return { code: p.code, name: p.name, status: p.status, startDate: iso(p.startDate), endDate: iso(p.endDate), sites: await repo.siteCount(projectId), today: new Date().toISOString().slice(0, 10) };
    },
  },
  {
    name: "schedule_status",
    description:
      "Takt schedule: plans with baseline dates and progress, blocked or delayed activities with delay reasons, and open constraints with due dates.",
    inputSchema: NO_INPUT,
    permission: "takt.view",
    async execute(ctx, projectId, repo) {
      const summary = await scheduleSummaryService.project(ctx, projectId);
      const [problems, constraints] = await Promise.all([repo.problemActivities(projectId), repo.openConstraints(projectId)]);
      return {
        summary,
        blockedOrDelayed: problems.map((a) => ({
          activity: a.name,
          trade: a.crewTrade,
          execution: a.execution,
          progressPct: a.progressPct,
          blocked: a.blocked,
          delayReason: clip(a.delayReason),
          recoveryAction: clip(a.recoveryAction),
          area: a.taktArea.name,
        })),
        openConstraints: constraints.map((c) => ({ activity: c.activity.name, type: c.type, description: clip(c.description), dueDate: iso(c.dueDate) })),
      };
    },
  },
  {
    name: "cost_forecast",
    description: "Budget, actual cost, estimate to complete, EAC, forecast revenue and margin, invoicing status (amounts in the project currency).",
    inputSchema: NO_INPUT,
    permission: "commercial.view",
    async execute(ctx, projectId) {
      const f = await forecastService.get(ctx, projectId);
      return {
        currency: f.currency,
        costVisible: f.costVisible,
        forecast: f.forecast,
        etc: f.etc.map((e) => ({ category: e.category, etcAmount: e.etcAmount, recordedOn: iso(e.createdAt) })),
        uninvoicedVariations: f.uninvoicedVariations,
      };
    },
  },
  {
    name: "variations",
    description: "Variations (change orders): number, title, status, sales price and dates, plus approved and uninvoiced totals.",
    inputSchema: NO_INPUT,
    permission: "commercial.view",
    async execute(ctx, projectId) {
      const v = await variationService.list(ctx, projectId);
      return {
        approvedValue: v.approvedValue,
        uninvoicedValue: v.uninvoicedValue,
        rows: v.rows.slice(0, 50).map((r) => ({
          number: r.number,
          title: r.title,
          status: r.status,
          salesPrice: r.salesPrice,
          currency: r.currency,
          submittedOn: iso(r.submittedAt),
          clientDecisionOn: iso(r.clientDecisionAt),
        })),
      };
    },
  },
  {
    name: "hse_metrics",
    description: "Safety key figures: hours, observations, near misses, incidents by severity, LTIF, report rate, open and overdue actions, inspection index trend.",
    inputSchema: NO_INPUT,
    permission: "hse.view",
    async execute(ctx, projectId) {
      return hseOverviewService.metrics(ctx, projectId);
    },
  },
];

/** The tools this user may use on this project (by their own permissions). */
export function toolsFor(ctx: RequestContext, projectId: string): ToolDef[] {
  const perms = projectPermissions(ctx, projectId);
  return TOOLS.filter((t) => perms.has(t.permission));
}

export const ALL_TOOL_NAMES = TOOLS.map((t) => t.name);
