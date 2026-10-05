import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logisticsBoardService, logisticsLocationService } from "@/modules/logistics/logistics.service";
import { LOCATION_KINDS } from "@/modules/logistics/schemas";
import { formatMinute } from "@/platform/i18n/time";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SiteDayPicker } from "../_components/site-day-picker";
import { archiveLocationAction, createLocationAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("logistics"))("setup") };
}

export default async function SetupPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ site?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [sites, t, tc] = await Promise.all([logisticsBoardService.sites(ctx), getTranslations("logistics"), getTranslations("common")]);
  if (sites.length === 0) return <EmptyState>{t("noSites")}</EmptyState>;
  const siteId = sites.some((s) => s.id === sp.site) ? sp.site! : sites[0].id;
  const { site, locations, permissions } = await loadOr404(logisticsLocationService.list(ctx, siteId));
  return (
    <>
      <PageHeader title={t("setup")} description={`${site.project.code} · ${site.name}`} backHref={`/c/${companySlug}/logistics?site=${siteId}`} backLabel={t("board")} />
      <div className="space-y-4">
        <SiteDayPicker sites={sites} siteId={siteId} showDate={false} />
        {LOCATION_KINDS.map((k) => {
          const rows = locations.filter((l) => l.kind === k);
          return (
            <Section key={k} title={t(`locationKinds.${k}`)}>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">–</p>
              ) : (
                <ul className="divide-y text-sm" data-testid={`locations-${k}`}>
                  {rows.map((l) => (
                    <li key={l.id} className="flex min-h-11 items-center gap-2 py-1">
                      <span className="font-medium">{l.name}</span>
                      {l.kind === "GATE" && <span className="text-muted-foreground">{t("hours", { opens: formatMinute(l.opensMinute!), closes: formatMinute(l.closesMinute!) })}</span>}
                      {permissions.approve && (
                        <ActionButton action={archiveLocationAction.bind(null, companySlug, l.id)} confirm={tc("confirmArchive")} variant="ghost" className="ml-auto">
                          {tc("archive")}
                        </ActionButton>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          );
        })}
        {permissions.approve && (
          <Section title={t("addLocation")}>
            <ActionForm action={createLocationAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-5 sm:items-end" data-testid="location-form">
              <input type="hidden" name="siteId" value={siteId} />
              <SelectField name="kind" label={t("kind")} options={LOCATION_KINDS.map((k) => ({ value: k, label: t(`locationKinds.${k}`) }))} defaultValue="GATE" />
              <TextField name="name" label={t("name")} required className="sm:col-span-2" />
              <TextField name="opens" label={t("opens")} type="time" step={1800} defaultValue="06:00" />
              <TextField name="closes" label={t("closes")} type="time" step={1800} defaultValue="18:00" />
              <div className="sm:col-span-5">
                <SubmitButton>{t("addLocation")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
