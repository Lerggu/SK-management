import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/platform/authz";
import { PageHeader } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { ProjectForm } from "../_components/forms";
import { createProjectAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("new") };
}

export default async function NewProjectPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  await loadOr404(Promise.resolve().then(() => requirePermission(ctx, "project.manage")));
  const t = await getTranslations("projects");
  const tc = await getTranslations("common");
  return (
    <>
      <PageHeader title={t("new")} backHref={`/c/${companySlug}/projects`} backLabel={tc("back")} />
      <ProjectForm action={createProjectAction.bind(null, companySlug)} />
    </>
  );
}
