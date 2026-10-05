import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { QrCode, ScanLine } from "lucide-react";
import { cableDrumService, materialBatchService } from "@/modules/lifting/material.service";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { Button } from "@/ui/components/button";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { ProgressBar } from "@/ui/components/progress-bar";
import { StatusBadge } from "@/ui/components/status-badge";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SiteDayPicker } from "../logistics/_components/site-day-picker";
import { createBatchAction, createDrumAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("materials"))("title") };
}

type Props = { params: Promise<{ companySlug: string }>; searchParams: Promise<{ site?: string }> };

export default async function MaterialsPage({ params, searchParams }: Props) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [sites, t] = await Promise.all([materialBatchService.sites(ctx), getTranslations("materials")]);
  const base = `/c/${companySlug}/materials`;
  const scan = (
    <Button asChild size="lg">
      <Link href={`/c/${companySlug}/scan`} data-testid="open-scan">
        <ScanLine aria-hidden /> {t("scan")}
      </Link>
    </Button>
  );
  if (sites.length === 0) {
    return (
      <>
        <PageHeader title={t("title")} actions={scan} />
        <EmptyState>{t("noSites")}</EmptyState>
      </>
    );
  }
  const siteId = sites.some((s) => s.id === sp.site) ? sp.site! : sites[0].id;
  const [options, batches, drums] = await Promise.all([loadOr404(materialBatchService.options(ctx, siteId)), materialBatchService.list(ctx, { siteId }), cableDrumService.list(ctx, { siteId })]);
  const perms = options.permissions;
  const activityOptions = options.activities.map((a) => ({ value: a.id, label: `${a.taktArea.code} · ${a.workPackage.code} ${a.name}` }));
  const locationOptions = options.locations.map((l) => ({ value: l.id, label: l.name }));
  const deliveryOptions = options.deliveries.map((d) => ({ value: d.id, label: `${d.slotStart.toISOString().slice(0, 10)} · ${d.supplier} · ${d.material}` }));
  return (
    <>
      <PageHeader title={t("title")} description={`${options.site.project.code} · ${options.site.name}`} actions={scan} />
      <div className="space-y-4">
        <SiteDayPicker sites={sites} siteId={siteId} showDate={false} />
        <Section
          title={t("drums")}
          actions={
            drums.length > 0 && (
              <Button asChild variant="outline" size="sm">
                <a href={`${base}/labels?kind=drum&siteId=${siteId}`} target="_blank" rel="noopener" data-testid="drum-labels">
                  <QrCode aria-hidden /> {t("printLabels")}
                </a>
              </Button>
            )
          }
        >
          {drums.length === 0 ? (
            <EmptyState>{t("noDrums")}</EmptyState>
          ) : (
            <RowList>
              {drums.map((d) => (
                <RowLink
                  key={d.id}
                  href={`${base}/drums/${d.id}`}
                  title={`${d.code} · ${d.cableType}`}
                  subtitle={
                    <span className="block w-full max-w-xs">
                      <ProgressBar value={100 - d.usedPct} label={t("remainingOf", { remaining: d.remainingM, original: d.originalLengthM })} />
                    </span>
                  }
                  meta={[d.location?.name, d.reservedActivity ? `${d.reservedActivity.taktArea.code} · ${d.reservedActivity.workPackage.code}` : null].filter(Boolean).join(" · ")}
                  badge={<StatusBadge status={d.status} label={t(`drumStatuses.${d.status}`)} />}
                />
              ))}
            </RowList>
          )}
        </Section>
        <Section
          title={t("batches")}
          actions={
            batches.length > 0 && (
              <Button asChild variant="outline" size="sm">
                <a href={`${base}/labels?kind=batch&siteId=${siteId}`} target="_blank" rel="noopener">
                  <QrCode aria-hidden /> {t("printLabels")}
                </a>
              </Button>
            )
          }
        >
          {batches.length === 0 ? (
            <EmptyState>{t("noBatches")}</EmptyState>
          ) : (
            <RowList>
              {batches.map((b) => (
                <RowLink
                  key={b.id}
                  href={`${base}/batches/${b.id}`}
                  title={`${b.code} · ${b.material}`}
                  subtitle={`${b.quantity} ${b.unit}${b.location ? ` · ${b.location.name}` : ""}`}
                  meta={b.activity ? `${b.activity.taktArea.code} · ${b.activity.workPackage.code} ${b.activity.name}` : undefined}
                  badge={<StatusBadge status={b.status} label={t(`statuses.${b.status}`)} />}
                />
              ))}
            </RowList>
          )}
        </Section>
        {perms.manage && (
          <>
            <Section title={t("newDrum")}>
              <ActionForm action={createDrumAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-3" data-testid="drum-form">
                <input type="hidden" name="siteId" value={siteId} />
                <TextField name="code" label={t("code")} required autoCapitalize="characters" />
                <TextField name="cableType" label={t("cableType")} required className="sm:col-span-2" />
                <TextField name="originalLengthM" label={t("originalLengthM")} required inputMode="decimal" />
                <TextField name="manufacturer" label={t("manufacturer")} />
                <TextField name="weightKg" label={t("weightKg")} inputMode="decimal" />
                <TextField name="dimensions" label={t("dimensions")} />
                <SelectField name="locationId" label={t("location")} placeholder={t("none")} options={locationOptions} />
                <SelectField name="reservedActivityId" label={t("reservedActivity")} placeholder={t("none")} options={activityOptions} />
                <SelectField name="deliveryId" label={t("delivery")} placeholder={t("none")} options={deliveryOptions} />
                <TextField name="receivedDate" label={t("receivedDate")} type="date" defaultValue={todayInDisplayZone()} />
                <TextField name="nextInspectionDate" label={t("nextInspection")} type="date" />
                <div className="sm:col-span-3">
                  <SubmitButton>{t("addDrum")}</SubmitButton>
                </div>
              </ActionForm>
            </Section>
            <Section title={t("newBatch")}>
              <ActionForm action={createBatchAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-3" data-testid="batch-form">
                <input type="hidden" name="siteId" value={siteId} />
                <TextField name="code" label={t("code")} required autoCapitalize="characters" />
                <TextField name="material" label={t("material")} required className="sm:col-span-2" />
                <TextField name="quantity" label={t("quantity")} required inputMode="decimal" />
                <TextField name="unit" label={t("unit")} required defaultValue="kpl" />
                <SelectField name="deliveryId" label={t("delivery")} placeholder={t("none")} options={deliveryOptions} />
                <SelectField name="locationId" label={t("location")} placeholder={t("none")} options={locationOptions} />
                <SelectField name="activityId" label={t("activity")} placeholder={t("none")} options={activityOptions} className="sm:col-span-2" />
                <div className="sm:col-span-3">
                  <SubmitButton>{t("addBatch")}</SubmitButton>
                </div>
              </ActionForm>
            </Section>
          </>
        )}
      </div>
    </>
  );
}
