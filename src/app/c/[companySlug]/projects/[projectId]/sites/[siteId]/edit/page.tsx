import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { projectService, siteService } from "@/modules/projects/service";
import { ActionButton } from "@/ui/components/form";
import { PageHeader } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SiteForm } from "../../../../_components/forms";
import { archiveSiteAction, updateSiteAction } from "../../../../actions";

export default async function EditSitePage({ params }: { params: Promise<{ companySlug: string; projectId: string; siteId: string }> }) {
  const { companySlug, projectId, siteId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [project, site] = await Promise.all([loadOr404(projectService.get(ctx, projectId)), loadOr404(siteService.get(ctx, siteId))]);
  if (!project.permissions.manage || site.projectId !== project.id || site.archivedAt) notFound();
  const t = await getTranslations("projects");
  const tc = await getTranslations("common");
  return (
    <>
      <PageHeader
        title={t("editSite")}
        description={site.name}
        backHref={`/c/${companySlug}/projects/${projectId}`}
        backLabel={tc("back")}
        actions={<ActionButton action={archiveSiteAction.bind(null, companySlug, projectId, siteId)} confirm={tc("confirmArchive")} variant="destructive">{tc("archive")}</ActionButton>}
      />
      <SiteForm action={updateSiteAction.bind(null, companySlug, projectId, siteId)} site={site} />
    </>
  );
}
