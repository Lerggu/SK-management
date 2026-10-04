import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Pencil, Plus } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { projectService, siteService } from "@/modules/projects/service";
import { documentService } from "@/modules/documents/service";
import { equipmentService } from "@/modules/equipment/service";
import { Button } from "@/ui/components/button";
import { ActionButton, ActionForm, SelectField, SubmitButton } from "@/ui/components/form";
import { DetailList, EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { archiveProjectAction, assignMemberAction, removeMemberAction } from "../actions";

type Props = { params: Promise<{ companySlug: string; projectId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("title") + " · " + (await params).projectId.slice(-6) };
}

export default async function ProjectPage({ params }: Props) {
  const { companySlug, projectId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const project = await loadOr404(projectService.get(ctx, projectId));
  const base = `/c/${companySlug}`;
  const [sites, members, documents, equipment, assignable, t, tc, td, te, format] = await Promise.all([
    siteService.list(ctx, project.id),
    projectService.listMembers(ctx, project.id),
    documentService.list(ctx, { projectId: project.id }),
    hasPermission(ctx, "equipment.view") ? equipmentService.list(ctx, { projectId: project.id }) : Promise.resolve(null),
    project.permissions.manageMembers ? projectService.listAssignable(ctx, project.id) : Promise.resolve(null),
    getTranslations("projects"),
    getTranslations("common"),
    getTranslations("documents"),
    getTranslations("equipment"),
    getFormatter(),
  ]);
  const editable = project.permissions.manage && !project.archivedAt;

  return (
    <>
      <PageHeader
        title={`${project.code} · ${project.name}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {project.archivedAt ? <StatusBadge status="ARCHIVED" label={tc("archived")} /> : <StatusBadge status={project.status} label={t(`statuses.${project.status}`)} />}
            {project.customerName}
          </span>
        }
        backHref={`${base}/projects`}
        backLabel={t("title")}
        actions={
          editable && (
            <>
              <Button asChild variant="outline">
                <Link href={`${base}/projects/${project.id}/edit`}>
                  <Pencil aria-hidden /> {tc("edit")}
                </Link>
              </Button>
              <ActionButton action={archiveProjectAction.bind(null, companySlug, project.id)} confirm={tc("confirmArchive")} variant="destructive">
                {tc("archive")}
              </ActionButton>
            </>
          )
        }
      />

      <div className="space-y-4">
        <Section title={tc("details")}>
          <DetailList
            items={[
              { label: t("code"), value: project.code },
              { label: t("customer"), value: project.customerName },
              { label: t("startDate"), value: fmtDate(format, project.startDate) },
              { label: t("endDate"), value: fmtDate(format, project.endDate) },
              { label: t("description"), value: project.description },
            ]}
          />
        </Section>

        <Section
          title={t("sites")}
          actions={
            editable && (
              <Button asChild size="sm">
                <Link href={`${base}/projects/${project.id}/sites/new`}>
                  <Plus aria-hidden /> {t("addSite")}
                </Link>
              </Button>
            )
          }
        >
          {sites.length === 0 ? (
            <EmptyState>{t("noSites")}</EmptyState>
          ) : (
            <ul className="divide-y" data-testid="site-list">
              {sites.map((s) => (
                <li key={s.id} className="flex min-h-14 items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {s.code ? `${s.code} · ` : ""}
                      {s.name}
                    </div>
                    <div className="text-sm text-muted-foreground">{[s.address, s.postalCode, s.city].filter(Boolean).join(", ")}</div>
                  </div>
                  <StatusBadge status={s.status} label={t(`siteStatuses.${s.status}`)} />
                  {editable && (
                    <Button asChild variant="ghost" size="icon" aria-label={`${tc("edit")} ${s.name}`}>
                      <Link href={`${base}/projects/${project.id}/sites/${s.id}/edit`}>
                        <Pencil aria-hidden />
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("members")}>
          {members.length === 0 ? (
            <EmptyState>{t("noMembers")}</EmptyState>
          ) : (
            <ul className="divide-y">
              {members.map((m) => (
                <li key={m.id} className="flex min-h-14 flex-wrap items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{m.membership.user.name ?? m.membership.user.email}</div>
                    <div className="text-sm text-muted-foreground">{m.role.name}</div>
                  </div>
                  {project.permissions.manageMembers && (
                    <ActionButton action={removeMemberAction.bind(null, companySlug, project.id, m.id)} confirm={tc("confirmArchive")} variant="ghost">
                      {tc("remove")}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {assignable && !project.archivedAt && (
            <ActionForm action={assignMemberAction.bind(null, companySlug, project.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <SelectField name="userId" label={t("user")} placeholder={tc("select")} options={assignable.users.map((u) => ({ value: u.id, label: u.name ? `${u.name} (${u.email})` : u.email }))} />
              <SelectField name="roleId" label={t("projectRole")} placeholder={tc("select")} options={assignable.roles.map((r) => ({ value: r.id, label: r.name }))} />
              <SubmitButton>{t("assignMember")}</SubmitButton>
            </ActionForm>
          )}
        </Section>

        <Section
          title={t("documents")}
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/documents/new?projectId=${project.id}`}>
                <Plus aria-hidden /> {td("new")}
              </Link>
            </Button>
          }
        >
          {documents.length === 0 ? (
            <EmptyState>{td("noDocuments")}</EmptyState>
          ) : (
            <RowList>
              {documents.map((d) => (
                <RowLink
                  key={d.id}
                  href={`${base}/documents/${d.id}`}
                  title={d.title}
                  subtitle={[td(`categories.${d.category}`), d.documentNumber, d.site?.name].filter(Boolean).join(" · ")}
                  badge={d.currentVersion && <StatusBadge status={d.currentVersion.approvalState} label={td(`approvalStates.${d.currentVersion.approvalState}`)} />}
                />
              ))}
            </RowList>
          )}
        </Section>

        {equipment && (
          <Section title={t("equipment")}>
            {equipment.length === 0 ? (
              <EmptyState>{te("noEquipment")}</EmptyState>
            ) : (
              <RowList>
                {equipment.map((e) => (
                  <RowLink key={e.id} href={`${base}/equipment/${e.id}`} title={`${e.assetNumber} · ${e.name}`} subtitle={e.currentSite?.name} badge={<StatusBadge status={e.status} label={te(`statuses.${e.status}`)} />} />
                ))}
              </RowList>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
