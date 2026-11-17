import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { projectService } from "@/modules/projects/service";
import { logisticsAiService } from "@/modules/production/ai.service";
import { visibleLogisticsProjects } from "@/modules/logistics/access";
import { ActionButton } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { Badge } from "@/ui/components/badge";
import { cn } from "@/ui/lib/utils";
import { requireCompanyContext } from "@/app/_lib/context";
import { ProductionTabs } from "@/app/c/[companySlug]/_components/production-tabs";
import { orForbidden } from "../../workforce/_components/hr/access";
import { productionAction } from "../production-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("production.risks"))("title") };
}

const SEVERITY = { CRITICAL: "border-red-600 bg-red-50 text-red-950", WARNING: "border-amber-500 bg-amber-50 text-amber-950", INFO: "border-sky-500 bg-sky-50 text-sky-950" } as const;
const KIND = { FACT: "bg-zinc-100 text-zinc-800", FORECAST: "bg-sky-100 text-sky-900", AI_RECOMMENDATION: "bg-violet-100 text-violet-900" } as const;

/** §27 logistics risks (ADR 0026, phase 4): rule-detected facts and an optional AI analysis. */
export default async function RisksPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ project?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [t, ta, td, tl, format] = await Promise.all([getTranslations("production.risks"), getTranslations("ai"), getTranslations("production.deviations"), getTranslations("logistics"), getFormatter()]);
  const visible = visibleLogisticsProjects(ctx);
  const projects = ctx.external ? [] : (await projectService.list(ctx)).filter((p) => !visible || visible.includes(p.id));
  const projectId = projects.find((p) => p.id === sp.project)?.id ?? projects[0]?.id ?? null;
  const data = projectId ? await orForbidden(logisticsAiService.risks(ctx, projectId)) : null;
  const base = `/c/${companySlug}/logistics`;
  // Enum codes in fact parameters are shown with their labels.
  const label = (params: Record<string, string | number>) => {
    const out = { ...params };
    if (typeof out.deviation === "string") out.deviation = td(`types.${out.deviation}`);
    if (typeof out.status === "string") out.status = td.has(`statuses.${out.status}`) && "deviation" in params ? td(`statuses.${out.status}`) : tl.has(`requestStatuses.${out.status}`) ? tl(`requestStatuses.${out.status}`) : tl.has(`deliveryStatuses.${out.status}`) ? tl(`deliveryStatuses.${out.status}`) : out.status;
    return out;
  };
  const when = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : null);

  return (
    <>
      <PageHeader title={t("title")} description={t("intro", { days: data?.horizonDays ?? 14 })} />
      <ProductionTabs ctx={ctx} active="risks" />
      {projects.length === 0 ? (
        <EmptyState>{t("noProjects")}</EmptyState>
      ) : (
        <>
          {projects.length > 1 && (
            <form className="mb-4 flex items-center gap-2" action={`${base}/risks`}>
              <select name="project" defaultValue={projectId ?? ""} aria-label={t("project")} className="h-11 rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm">
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm md:min-h-9">
                {t("show")}
              </button>
            </form>
          )}
          {data && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Section title={t("facts", { count: data.facts.length })}>
                {data.facts.length === 0 ? (
                  <EmptyState>{t("none")}</EmptyState>
                ) : (
                  <ul className="space-y-2" data-testid="risk-facts">
                    {data.facts.map((f, i) => {
                      const body = (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide">{t(`type.${f.type}`)}</span>
                            <span className="text-xs">{ta(`severities.${f.severity}`)}</span>
                            {f.at && <span className="ml-auto text-xs">{when(f.at)}</span>}
                          </div>
                          <div className="font-medium">{f.subject}</div>
                          <div className="text-sm">{t(`detail.${f.type}`, label(f.params))}</div>
                        </>
                      );
                      return (
                        <li key={i} className={cn("rounded-lg border-l-4 px-3 py-2", SEVERITY[f.severity])} data-risk={f.type} data-severity={f.severity}>
                          {f.taskId ? (
                            <Link href={`${base}/requests/${f.taskId}`} className="block hover:underline">
                              {body}
                            </Link>
                          ) : (
                            body
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
              <Section title={t("analysis")}>
                <div className="space-y-3" data-testid="risk-analysis">
                  <p className="text-xs text-muted-foreground">{t("dataNotice")}</p>
                  {!data.available && <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">{ta("unavailable")}</p>}
                  {data.canAnalyse && data.available && (
                    <ActionButton action={productionAction.bind(null, companySlug, "riskAnalyse", data.projectId)} variant="default">
                      {t("analyse")}
                    </ActionButton>
                  )}
                  {!data.analysis ? (
                    <p className="text-sm text-muted-foreground">{t("noAnalysis")}</p>
                  ) : (
                    <div data-status={data.analysis.status}>
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="rounded-md">
                          {ta(`runStatuses.${data.analysis.status}`)}
                        </Badge>
                        <span>{format.dateTime(data.analysis.createdAt, { dateStyle: "short", timeStyle: "short" })}</span>
                        {data.analysis.provider === "fake" && <span>{ta("testProvider")}</span>}
                      </div>
                      {data.analysis.error && <p className="text-sm text-red-700">{ta.has(data.analysis.error.replace(/^ai\./, "")) ? ta(data.analysis.error.replace(/^ai\./, "")) : ta("errors.failed")}</p>}
                      {data.analysis.result && (
                        <>
                          <p className="text-sm">{data.analysis.result.summary}</p>
                          <ul className="mt-2 space-y-2">
                            {data.analysis.result.items
                              .filter((x) => x.kind !== "AI_RECOMMENDATION")
                              .map((x, i) => (
                                <li key={i} className="rounded-md border px-3 py-2 text-sm">
                                  <Badge variant="secondary" className={cn("mr-2 rounded-md", KIND[x.kind as keyof typeof KIND])}>
                                    {ta(`kinds.${x.kind}`)}
                                  </Badge>
                                  <span className="font-medium">{x.title}</span>
                                  <p className="mt-1 text-muted-foreground">{x.detail}</p>
                                </li>
                              ))}
                          </ul>
                        </>
                      )}
                      {data.analysis.recommendations.length > 0 && (
                        <ul className="mt-3 space-y-2" data-testid="risk-recommendations">
                          {data.analysis.recommendations.map((r) => (
                            <li key={r.id} className="rounded-md border border-violet-300 px-3 py-2 text-sm" data-status={r.status}>
                              <Badge variant="secondary" className={cn("mr-2 rounded-md", KIND.AI_RECOMMENDATION)}>
                                {ta("kinds.AI_RECOMMENDATION")}
                              </Badge>
                              <span className="font-medium">{r.title}</span>
                              <p className="mt-1 text-muted-foreground">{r.detail}</p>
                              {r.status === "PROPOSED" && data.canAnalyse ? (
                                <div className="mt-2 flex gap-2">
                                  <ActionButton action={productionAction.bind(null, companySlug, "recommendationDecide", r.id)} hidden={{ decision: "ACCEPTED" }} variant="default">
                                    {ta("accept")}
                                  </ActionButton>
                                  <ActionButton action={productionAction.bind(null, companySlug, "recommendationDecide", r.id)} hidden={{ decision: "DISMISSED" }}>
                                    {ta("dismiss")}
                                  </ActionButton>
                                </div>
                              ) : (
                                <p className="mt-1 text-xs">{ta(`recStatuses.${r.status}`)}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </Section>
            </div>
          )}
        </>
      )}
    </>
  );
}
