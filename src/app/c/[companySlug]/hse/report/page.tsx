import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { hseOverviewService } from "@/modules/hse/hse.service";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { IncidentForm, ObservationForm, PermitForm } from "../_components/forms";
import { ProjectPicker } from "../_components/project-picker";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hse"))("report") };
}

type Kind = "SAFETY_OBSERVATION" | "NEAR_MISS" | "INCIDENT" | "PERMIT";
type Props = { params: Promise<{ companySlug: string }>; searchParams: Promise<{ project?: string; kind?: string }> };

/** Mobile-first reporting page: one short form per kind. */
export default async function ReportPage({ params, searchParams }: Props) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [projects, t] = await Promise.all([hseOverviewService.projects(ctx), getTranslations("hse")]);
  const reportable = projects.filter((p) => p.can.create);
  const kind: Kind = (["SAFETY_OBSERVATION", "NEAR_MISS", "INCIDENT", "PERMIT"] as const).find((k) => k === sp.kind) ?? "SAFETY_OBSERVATION";
  const back = ctx.external ? `/c/${companySlug}/portal` : `/c/${companySlug}/hse`;
  const header = <PageHeader title={t(`reportTitles.${kind}`)} backHref={sp.project ? `${back}${ctx.external ? `/${sp.project}` : `?project=${sp.project}`}` : back} backLabel={ctx.external ? t("portal") : t("title")} />;
  if (reportable.length === 0) {
    return (
      <>
        {header}
        <EmptyState>{t("noProjects")}</EmptyState>
      </>
    );
  }
  const projectId = reportable.some((p) => p.id === sp.project) ? sp.project! : reportable[0].id;
  const r = await loadOr404(hseOverviewService.register(ctx, projectId));
  const props = { slug: companySlug, projectId, sites: r.sites, liftPlans: r.liftPlans };
  return (
    <>
      {header}
      <div className="space-y-4">
        {reportable.length > 1 && <ProjectPicker projects={reportable} projectId={projectId} extra={{ kind }} />}
        <Section title={`${r.project.code} · ${r.project.name}`}>
          {kind === "INCIDENT" ? <IncidentForm {...props} /> : kind === "PERMIT" ? <PermitForm {...props} /> : <ObservationForm {...props} defaultKind={kind} />}
        </Section>
      </div>
    </>
  );
}
