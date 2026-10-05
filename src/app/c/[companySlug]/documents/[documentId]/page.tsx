import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { DOCUMENT_CATEGORIES } from "@/modules/documents/schemas";
import { documentService } from "@/modules/documents/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService } from "@/modules/equipment/service";
import { projectService } from "@/modules/projects/service";
import { ActionButton, ActionForm, FileField, SelectField, SubmitButton, TextareaField, TextField } from "@/ui/components/form";
import { DetailList, EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtBytes, fmtDate, fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { addLinkAction, archiveDocumentAction, removeLinkAction, setApprovalAction, setSharingAction, updateDocumentAction, uploadVersionAction } from "../actions";

export default async function DocumentPage({ params }: { params: Promise<{ companySlug: string; documentId: string }> }) {
  const { companySlug, documentId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const doc = await loadOr404(documentService.get(ctx, documentId));
  const base = `/c/${companySlug}`;
  const [t, tc, format] = await Promise.all([getTranslations("documents"), getTranslations("common"), getFormatter()]);
  const canManage = doc.permissions.manage && !doc.archivedAt;
  const current = doc.versions.find((v) => v.status === "CURRENT");

  // Link targets the member can see.
  const [projects, employees, equipment] = await Promise.all([
    canManage ? projectService.list(ctx) : Promise.resolve([]),
    canManage && hasPermission(ctx, "employee.view") ? employeeService.list(ctx) : Promise.resolve([]),
    canManage && hasPermission(ctx, "equipment.view") ? equipmentService.list(ctx) : Promise.resolve([]),
  ]);
  const labelFor = new Map<string, string>([
    ...projects.map((p) => [`PROJECT:${p.id}`, `${p.code} · ${p.name}`] as const),
    ...employees.map((e) => [`EMPLOYEE:${e.id}`, `${e.lastName} ${e.firstName}`] as const),
    ...equipment.map((e) => [`EQUIPMENT:${e.id}`, `${e.assetNumber} · ${e.name}`] as const),
  ]);
  const targets = [...labelFor.entries()].map(([value, label]) => ({ value, label: `${t(`linkEntities.${value.split(":")[0]}`)}: ${label}` }));
  const approvalButtons = (state: string) => {
    const out: { to: string; label: string; variant: "default" | "outline" | "destructive" }[] = [];
    if (canManage && (state === "DRAFT" || state === "REJECTED")) out.push({ to: "PENDING_APPROVAL", label: t("submit"), variant: "outline" });
    if (doc.permissions.approve && !doc.archivedAt && (state === "DRAFT" || state === "PENDING_APPROVAL")) {
      out.push({ to: "APPROVED", label: t("approve"), variant: "default" }, { to: "REJECTED", label: t("reject"), variant: "destructive" });
    }
    return out;
  };

  return (
    <>
      <PageHeader
        title={doc.title}
        description={[t(`categories.${doc.category}`), doc.documentNumber, doc.project ? `${doc.project.code}${doc.site ? ` › ${doc.site.name}` : ""}` : t("companyLevel")].filter(Boolean).join(" · ")}
        backHref={ctx.external ? (doc.project ? `${base}/portal/${doc.project.id}` : `${base}/portal`) : `${base}/documents`}
        backLabel={ctx.external ? t("portal") : t("title")}
        actions={
          canManage && (
            <ActionButton action={archiveDocumentAction.bind(null, companySlug, doc.id)} confirm={tc("confirmArchive")} variant="destructive">
              {tc("archive")}
            </ActionButton>
          )
        }
      />
      <div className="space-y-4">
        {current && (
          <Section title={t("currentVersion")}>
            <div className="flex flex-wrap items-center gap-2" data-testid="current-version">
              <StatusBadge status="CURRENT" label={t("current")} />
              <span className="font-medium">
                {t("version", { number: current.versionNumber })}
                {current.revisionLabel ? ` · ${t("revision")} ${current.revisionLabel}` : ""}
              </span>
              <StatusBadge status={current.approvalState} label={t(`approvalStates.${current.approvalState}`)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`${base}/documents/versions/${current.id}/download`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium hover:bg-muted md:min-h-9">
                <Download className="size-4" aria-hidden /> {tc("download")} ({current.fileName})
              </a>
              {approvalButtons(current.approvalState).map((b) => (
                <ActionButton key={b.to} action={setApprovalAction.bind(null, companySlug, doc.id, current.id, b.to)} variant={b.variant}>
                  {b.label}
                </ActionButton>
              ))}
            </div>
          </Section>
        )}

        <Section title={t("versions")}>
          <ol className="divide-y" data-testid="version-list">
            {doc.versions.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center" data-status={v.status}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t("version", { number: v.versionNumber })}</span>
                    {v.revisionLabel && <span className="text-sm text-muted-foreground">{t("revision")} {v.revisionLabel}</span>}
                    <StatusBadge status={v.status} label={v.status === "CURRENT" ? t("current") : t("superseded")} />
                    <StatusBadge status={v.approvalState} label={t(`approvalStates.${v.approvalState}`)} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground break-all">
                    {v.fileName} · {fmtBytes(v.sizeBytes)} · {fmtDateTime(format, v.createdAt)}
                    {v.issueDate ? ` · ${t("issueDate")} ${fmtDate(format, v.issueDate)}` : ""}
                  </div>
                  {v.changeNote && <div className="mt-1 text-sm">{v.changeNote}</div>}
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground break-all">
                    {t("sha256")}: {v.sha256}
                  </div>
                </div>
                <a href={`${base}/documents/versions/${v.id}/download`} className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg border px-3 text-sm hover:bg-muted md:min-h-9" aria-label={`${tc("download")} ${t("version", { number: v.versionNumber })}`}>
                  <Download className="size-4" aria-hidden />
                  {tc("download")}
                </a>
              </li>
            ))}
          </ol>
          {canManage && (
            <ActionForm action={uploadVersionAction.bind(null, companySlug, doc.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
              <p className="text-sm text-muted-foreground sm:col-span-2">{t("uploadVersionHint")}</p>
              <TextField name="revisionLabel" label={t("revision")} maxLength={20} />
              <TextField name="issueDate" label={t("issueDate")} type="date" />
              <TextField name="changeNote" label={t("changeNote")} className="sm:col-span-2" />
              <div className="sm:col-span-2">
                <FileField label={t("file")} required />
              </div>
              <div className="sm:col-span-2">
                <SubmitButton>{t("uploadVersion")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>

        {doc.permissions.share && (
          <Section title={t("sharing")}>
            <p className="mb-3 text-sm text-muted-foreground">{t("sharingHint")}</p>
            <ActionForm action={setSharingAction.bind(null, companySlug, doc.id)} className="space-y-2" showSuccess data-testid="sharing-form">
              <input type="hidden" name="present" value="1" />
              <SharingBoxes client={doc.sharedWithClient} subcontractors={doc.sharedWithSubcontractors} labels={{ client: t("shareClient"), subcontractors: t("shareSubcontractors") }} />
              <SubmitButton variant="outline">{tc("save")}</SubmitButton>
            </ActionForm>
          </Section>
        )}

        {!ctx.external && (
        <Section title={t("links")}>
          {doc.links.length === 0 ? (
            <EmptyState>{t("noLinks")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm">
              {doc.links.map((l) => (
                <li key={l.id} className="flex min-h-12 items-center gap-3 py-2">
                  <span className="text-muted-foreground">{t(`linkEntities.${l.entityType}`)}</span>
                  <span className="flex-1 font-medium">{labelFor.get(`${l.entityType}:${l.entityId}`) ?? l.entityId.slice(0, 8)}</span>
                  {canManage && (
                    <ActionButton action={removeLinkAction.bind(null, companySlug, doc.id, l.id)} variant="ghost">
                      {tc("remove")}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && targets.length > 0 && (
            <ActionForm action={addLinkAction.bind(null, companySlug, doc.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <SelectField name="target" label={t("linkTarget")} placeholder={tc("select")} options={targets} />
              <SubmitButton>{t("addLink")}</SubmitButton>
            </ActionForm>
          )}
        </Section>
        )}

        <Section title={tc("details")}>
          {canManage ? (
            <ActionForm action={updateDocumentAction.bind(null, companySlug, doc.id)} className="grid gap-4 sm:grid-cols-2" showSuccess>
              <TextField name="title" label={t("documentTitle")} defaultValue={doc.title} required className="sm:col-span-2" />
              <SelectField name="category" label={t("category")} defaultValue={doc.category} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))} />
              <TextField name="documentNumber" label={t("number")} defaultValue={doc.documentNumber} />
              <TextareaField name="description" label={t("description")} defaultValue={doc.description} className="sm:col-span-2" />
              <div className="sm:col-span-2">
                <SubmitButton>{tc("save")}</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <DetailList
              items={[
                { label: t("category"), value: t(`categories.${doc.category}`) },
                { label: t("number"), value: doc.documentNumber },
                { label: t("description"), value: doc.description },
              ]}
            />
          )}
          {doc.project && !ctx.external && (
            <p className="mt-3 text-sm">
              <Link className="underline" href={`${base}/projects/${doc.project.id}`}>
                {doc.project.code} · {doc.project.name}
              </Link>
            </p>
          )}
        </Section>
      </div>
    </>
  );
}

/** Checkboxes pre-set from the stored flags. */
function SharingBoxes({ client, subcontractors, labels }: { client: boolean; subcontractors: boolean; labels: { client: string; subcontractors: string } }) {
  return (
    <div className="space-y-1">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm md:min-h-9">
        <input type="checkbox" name="sharedWithClient" defaultChecked={client} className="size-5 accent-primary md:size-4" />
        {labels.client}
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm md:min-h-9">
        <input type="checkbox" name="sharedWithSubcontractors" defaultChecked={subcontractors} className="size-5 accent-primary md:size-4" />
        {labels.subcontractors}
      </label>
    </div>
  );
}
