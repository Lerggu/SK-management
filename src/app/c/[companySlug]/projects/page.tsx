import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { projectService } from "@/modules/projects/service";
import { Button } from "@/ui/components/button";
import { EmptyState, PageHeader, RowLink, RowList, SearchForm } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate } from "@/ui/format";
import { requireCompanyContext } from "@/app/_lib/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("title") };
}

export default async function ProjectsPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ q?: string; archived?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [projects, t, tc, format] = await Promise.all([
    projectService.list(ctx, { q: sp.q, includeArchived: sp.archived === "1" }),
    getTranslations("projects"),
    getTranslations("common"),
    getFormatter(),
  ]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={tc("total", { count: projects.length })}
        actions={
          hasPermission(ctx, "project.manage") && (
            <Button asChild>
              <Link href={`/c/${companySlug}/projects/new`}>
                <Plus aria-hidden /> {t("new")}
              </Link>
            </Button>
          )
        }
      />
      <SearchForm placeholder={tc("searchPlaceholder")} defaultValue={sp.q} includeArchived={sp.archived === "1"} includeArchivedLabel={tc("includeArchived")} searchLabel={tc("search")} />
      {projects.length === 0 ? (
        <EmptyState>{t("noProjects")}</EmptyState>
      ) : (
        <RowList>
          {projects.map((p) => (
            <RowLink
              key={p.id}
              href={`/c/${companySlug}/projects/${p.id}`}
              title={`${p.code} · ${p.name}`}
              subtitle={[p.customerName, t("siteCount", { count: p.siteCount })].filter(Boolean).join(" · ")}
              badge={p.archivedAt ? <StatusBadge status="ARCHIVED" label={tc("archived")} /> : <StatusBadge status={p.status} label={t(`statuses.${p.status}`)} />}
              meta={p.startDate ? `${fmtDate(format, p.startDate)} – ${fmtDate(format, p.endDate)}` : undefined}
            />
          ))}
        </RowList>
      )}
    </>
  );
}
