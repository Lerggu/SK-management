import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { portalService } from "@/modules/portal/service";
import { EmptyState, PageHeader, RowLink, RowList } from "@/ui/components/page";
import { fmtDate } from "@/ui/format";
import { requireCompanyContext } from "@/app/_lib/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("portal"))("title") };
}

export default async function PortalPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [projects, t, format] = await Promise.all([portalService.projects(ctx), getTranslations("portal"), getFormatter()]);
  // A single project opens directly (fewer taps on the phone).
  if (projects.length === 1) redirect(`/c/${companySlug}/portal/${projects[0].id}`);
  return (
    <>
      <PageHeader title={t("title")} description={t("intro", { company: ctx.company.name })} />
      {projects.length === 0 ? (
        <EmptyState>{t("noProjects")}</EmptyState>
      ) : (
        <RowList>
          {projects.map((p) => (
            <RowLink
              key={p.id}
              href={`/c/${companySlug}/portal/${p.id}`}
              title={`${p.code} · ${p.name}`}
              subtitle={[p.sections.client ? t("clientPortal") : null, p.sections.subcontractor ? t("subcontractorPortal") : null].filter(Boolean).join(" · ")}
              meta={[p.startDate ? fmtDate(format, p.startDate) : null, p.endDate ? fmtDate(format, p.endDate) : null].filter(Boolean).join(" – ")}
            />
          ))}
        </RowList>
      )}
    </>
  );
}
