import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { taktPlanService } from "@/modules/takt/plan.service";
import { taktStructureService } from "@/modules/takt/structure.service";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate } from "@/ui/format";
import { requireCompanyContext } from "@/app/_lib/context";
import { ProductionTabs } from "@/app/c/[companySlug]/_components/production-tabs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("takt"))("title") };
}

export default async function TaktPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [plans, projects, t, format] = await Promise.all([taktPlanService.list(ctx), taktStructureService.projects(ctx), getTranslations("takt"), getFormatter()]);
  const base = `/c/${companySlug}/takt`;
  return (
    <>
      <PageHeader title={t("title")} />
      <ProductionTabs ctx={ctx} active="takt" />
      <Section title={t("projectsTitle")}>
        <ol className="mb-4 grid gap-2 text-sm sm:grid-cols-3" data-testid="takt-steps">
          {(["step1", "step2", "step3"] as const).map((k, i) => (
            <li key={k} className="rounded-lg border bg-muted/40 px-3 py-2">
              <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
              {t(k)}
            </li>
          ))}
        </ol>
        {projects.length === 0 ? (
          <EmptyState>{t("noProjects")}</EmptyState>
        ) : (
          <ul className="divide-y" data-testid="takt-projects">
            {projects.map((p) => {
              const next = p.areas === 0 || p.workPackages === 0 ? "structure" : p.plans === 0 ? "plan" : null;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" data-project={p.code}>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {p.code} · {p.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">{t("projectCounts", { areas: p.areas, workPackages: p.workPackages, plans: p.plans })}</span>
                  </span>
                  {next && p.canManage && <span className="text-xs font-medium text-amber-800">{t(next === "structure" ? "nextStructure" : "nextPlan")}</span>}
                  <Link href={`/c/${companySlug}/projects/${p.id}/takt`} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted md:min-h-9">
                    {p.canManage ? t("openStructure") : t("viewStructure")}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title={t("plans")}>
        {plans.length === 0 ? (
          <EmptyState>{t("noPlans")}</EmptyState>
        ) : (
          <RowList>
            {plans.map((p) => {
              const current = p.versions.find((v) => v.status === "DRAFT" || v.status === "PROPOSED") ?? p.versions.find((v) => v.status === "BASELINE") ?? p.versions[0];
              return (
                <RowLink
                  key={p.id}
                  href={`${base}/${p.id}`}
                  title={p.name}
                  subtitle={`${p.site.project.code} · ${p.site.project.name} · ${p.site.name}`}
                  meta={[current ? t("planStart", { date: fmtDate(format, current.startDate) }) : t("noVersion"), t("activitiesN", { count: p._count.activities })].join(" · ")}
                  badge={current ? <StatusBadge status={current.status} label={`${t("version", { number: current.versionNumber })} · ${t(`versionStatuses.${current.status}`)}`} /> : undefined}
                />
              );
            })}
          </RowList>
        )}
      </Section>
    </>
  );
}
