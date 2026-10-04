import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { projectService } from "@/modules/projects/service";
import { PageHeader } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SiteForm } from "../../../_components/forms";
import { createSiteAction } from "../../../actions";

export default async function NewSitePage({ params }: { params: Promise<{ companySlug: string; projectId: string }> }) {
  const { companySlug, projectId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const project = await loadOr404(projectService.get(ctx, projectId));
  if (!project.permissions.manage) notFound();
  const t = await getTranslations("projects");
  const tc = await getTranslations("common");
  return (
    <>
      <PageHeader title={t("newSite")} description={`${project.code} · ${project.name}`} backHref={`/c/${companySlug}/projects/${projectId}`} backLabel={tc("back")} />
      <SiteForm action={createSiteAction.bind(null, companySlug, projectId)} />
    </>
  );
}
