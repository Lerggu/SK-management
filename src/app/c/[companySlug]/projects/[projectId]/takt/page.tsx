import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { taktStructureService } from "@/modules/takt/structure.service";
import { BUILDING_KINDS } from "@/modules/takt/schemas";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import {
  archiveAreaAction,
  archiveBuildingAction,
  archiveWorkPackageAction,
  createAreaAction,
  createBuildingAction,
  createPlanAction,
  createWorkPackageAction,
} from "../../../takt/actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("takt"))("structure") };
}

export default async function ProjectTaktPage({ params }: { params: Promise<{ companySlug: string; projectId: string }> }) {
  const { companySlug, projectId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const o = await loadOr404(taktStructureService.overview(ctx, projectId));
  const [t, tc, format] = await Promise.all([getTranslations("takt"), getTranslations("common"), getFormatter()]);
  const base = `/c/${companySlug}`;
  const canManage = o.permissions.manage && !o.project.archivedAt;
  const siteOptions = o.sites.map((s) => ({ value: s.id, label: s.name }));

  return (
    <>
      <PageHeader title={t("structure")} description={`${o.project.code} · ${o.project.name}`} backHref={`${base}/projects/${projectId}`} backLabel={o.project.code} />
      <div className="space-y-4">
        <Section title={t("plans")}>
          {o.plans.length === 0 ? (
            <EmptyState>{t("noPlans")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="project-plans">
              {o.plans.map((p) => {
                const current = p.versions.find((v) => v.status === "DRAFT" || v.status === "PROPOSED") ?? p.versions.find((v) => v.status === "BASELINE") ?? p.versions[0];
                return (
                  <li key={p.id} className="flex min-h-12 flex-wrap items-center gap-2 py-2">
                    <Link href={`${base}/takt/${p.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {p.name}
                    </Link>
                    <span className="text-muted-foreground">{p.site.name}</span>
                    {current && <StatusBadge status={current.status} label={`${t("version", { number: current.versionNumber })} · ${t(`versionStatuses.${current.status}`)}`} />}
                    <span className="ml-auto text-muted-foreground">{current ? t("planStart", { date: fmtDate(format, current.startDate) }) : ""}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {canManage && o.sites.length > 0 && (
            <ActionForm action={createPlanAction.bind(null, companySlug, projectId)} data-testid="plan-form" className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
              <SelectField name="siteId" label={t("site")} options={siteOptions} defaultValue={o.sites[0]?.id} required />
              <TextField name="name" label={t("planName")} required />
              <TextField name="startDate" label={t("startDate")} type="date" defaultValue={todayInDisplayZone()} required />
              <TextField name="cycleLengthDays" label={t("cycleLength")} inputMode="numeric" defaultValue="1" hint={t("cycleLengthHint")} />
              <div className="sm:col-span-2 lg:col-span-4">
                <SubmitButton>{t("createPlan")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>

        <Section title={t("buildings")}>
          <p className="mb-3 text-sm text-muted-foreground">{t("structureHint")}</p>
          {o.sites.map((site) => {
            const buildings = o.buildings.filter((b) => b.siteId === site.id);
            return (
              <div key={site.id} className="mb-4 space-y-3" data-testid={`site-structure-${site.id}`}>
                <h3 className="text-sm font-semibold">{site.name}</h3>
                {buildings.length === 0 && <p className="text-sm text-muted-foreground">{t("noBuildings")}</p>}
                {buildings.map((b) => (
                  <div key={b.id} className="rounded-lg border p-3" data-testid="building" data-name={b.name}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{b.name}</span>
                      <StatusBadge status="DRAFT" label={t(`buildingKinds.${b.kind}`)} />
                      {canManage && (
                        <ActionButton action={archiveBuildingAction.bind(null, companySlug, projectId, b.id)} confirm={tc("confirmArchive")} variant="ghost" className="ml-auto">
                          {tc("archive")}
                        </ActionButton>
                      )}
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                      {b.taktAreas.map((a) => (
                        <li key={a.id} className="inline-flex min-h-9 items-center gap-1 rounded-md bg-muted px-2">
                          <span className="font-mono text-xs">{a.code}</span> {a.name}
                          {canManage && (
                            <ActionButton action={archiveAreaAction.bind(null, companySlug, projectId, a.id)} confirm={tc("confirmArchive")} variant="ghost">
                              ×
                            </ActionButton>
                          )}
                        </li>
                      ))}
                    </ul>
                    {canManage && (
                      <ActionForm action={createAreaAction.bind(null, companySlug, projectId, b.id)} data-testid="area-form" className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
                        <TextField name="code" label={tc("code")} required />
                        <TextField name="name" label={tc("name")} required />
                        <SubmitButton variant="outline">{t("addArea")}</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {canManage && o.sites.length > 0 && (
            <ActionForm action={createBuildingAction.bind(null, companySlug, projectId)} data-testid="building-form" className="grid gap-3 border-t pt-4 sm:grid-cols-4 sm:items-end">
              <SelectField name="siteId" label={t("site")} options={siteOptions} defaultValue={o.sites[0]?.id} required />
              <TextField name="name" label={tc("name")} required />
              <SelectField name="kind" label={t("kind")} options={BUILDING_KINDS.map((k) => ({ value: k, label: t(`buildingKinds.${k}`) }))} defaultValue="BUILDING" />
              <SubmitButton variant="outline">{t("addBuilding")}</SubmitButton>
            </ActionForm>
          )}
        </Section>

        <Section title={t("workPackages")}>
          {o.workPackages.length === 0 ? (
            <EmptyState>{t("noWorkPackages")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="work-packages">
              {o.workPackages.map((w) => (
                <li key={w.id} className="flex min-h-12 flex-wrap items-center gap-2 py-2">
                  <span aria-hidden className="size-4 rounded" style={{ backgroundColor: w.color }} />
                  <span className="font-mono text-xs">{w.code}</span>
                  <span className="font-medium">{w.name}</span>
                  <span className="text-muted-foreground">
                    {[w.trade, `${w.defaultCrewSize} ${t("crew").toLowerCase()}`, `${w.defaultDurationCycles} ${t("durationCycles").toLowerCase()}`, w.equipmentType ? `${w.equipmentCount} × ${w.equipmentType.name}` : null].filter(Boolean).join(" · ")}
                  </span>
                  {canManage && (
                    <ActionButton action={archiveWorkPackageAction.bind(null, companySlug, projectId, w.id)} confirm={tc("confirmArchive")} variant="ghost" className="ml-auto">
                      {tc("archive")}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <ActionForm action={createWorkPackageAction.bind(null, companySlug, projectId)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <TextField name="code" label={tc("code")} required />
              <TextField name="name" label={tc("name")} required />
              <TextField name="trade" label={t("trade")} />
              <TextField name="color" label={t("color")} type="color" defaultValue="#1E88A8" />
              <TextField name="defaultCrewSize" label={t("crewSize")} inputMode="numeric" defaultValue="2" />
              <TextField name="defaultDurationCycles" label={t("durationCycles")} inputMode="numeric" defaultValue="1" />
              <SelectField name="equipmentTypeId" label={t("equipmentType")} placeholder="–" options={o.equipmentTypes.map((e) => ({ value: e.id, label: e.name }))} />
              <TextField name="equipmentCount" label={t("equipmentCount")} inputMode="numeric" defaultValue="0" />
              <div className="sm:col-span-2 lg:col-span-4">
                <SubmitButton>{t("addWorkPackage")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>
      </div>
    </>
  );
}
