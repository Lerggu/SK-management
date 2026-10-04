import { getTranslations } from "next-intl/server";
import { hasPermission, projectPermissions } from "@/platform/authz";
import { DOCUMENT_CATEGORIES } from "@/modules/documents/schemas";
import { projectService, siteService } from "@/modules/projects/service";
import { uploadMaxBytes } from "@/platform/config/env";
import { ActionForm, FileField, SelectField, SubmitButton, TextareaField, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader } from "@/ui/components/page";
import { requireCompanyContext } from "@/app/_lib/context";
import { createDocumentAction } from "../actions";

export default async function NewDocumentPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ projectId?: string }> }) {
  const { companySlug } = await params;
  const { projectId } = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [t, tc, td, projects] = await Promise.all([getTranslations("documents"), getTranslations("common"), getTranslations("documents"), projectService.list(ctx)]);

  // Only scopes where the member may create documents.
  const locations: { value: string; label: string }[] = [];
  const companyLevel = hasPermission(ctx, "documents.manage") && !ctx.external;
  for (const p of projects.filter((p) => !p.archivedAt && projectPermissions(ctx, p.id).has("documents.manage"))) {
    locations.push({ value: `p:${p.id}`, label: `${p.code} · ${p.name}` });
    for (const s of await siteService.list(ctx, p.id)) locations.push({ value: `s:${p.id}:${s.id}`, label: `${p.code} › ${s.name}` });
  }
  const defaultLocation = projectId && locations.some((l) => l.value === `p:${projectId}`) ? `p:${projectId}` : companyLevel ? "" : locations[0]?.value;
  const maxMb = Math.round(uploadMaxBytes() / 1024 / 1024);

  return (
    <>
      <PageHeader title={t("new")} backHref={`/c/${companySlug}/documents`} backLabel={tc("back")} />
      {!companyLevel && locations.length === 0 ? (
        <EmptyState>{tc("noResults")}</EmptyState>
      ) : (
        <ActionForm action={createDocumentAction.bind(null, companySlug)} className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 md:p-6">
          <TextField name="title" label={td("documentTitle")} required className="sm:col-span-2" />
          <SelectField name="category" label={td("category")} defaultValue="OTHER" options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: td(`categories.${c}`) }))} />
          <TextField name="documentNumber" label={td("number")} />
          <SelectField name="location" label={td("scope")} defaultValue={defaultLocation} placeholder={companyLevel ? td("companyLevel") : undefined} options={locations} className="sm:col-span-2" />
          <TextField name="revisionLabel" label={td("revision")} maxLength={20} />
          <TextField name="issueDate" label={td("issueDate")} type="date" />
          <TextareaField name="description" label={td("description")} className="sm:col-span-2" />
          <div className="sm:col-span-2">
            <FileField label={td("file")} hint={td("fileHint", { max: maxMb })} required />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton>{tc("create")}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </>
  );
}
