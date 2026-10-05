import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { QrCode } from "lucide-react";
import { cableDrumService, materialBatchService } from "@/modules/lifting/material.service";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { Button } from "@/ui/components/button";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { ProgressBar } from "@/ui/components/progress-bar";
import { StatusBadge } from "@/ui/components/status-badge";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { pullCableAction, updateDrumAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("materials"))("drum") };
}

export default async function DrumPage({ params }: { params: Promise<{ companySlug: string; drumId: string }> }) {
  const { companySlug, drumId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const d = await loadOr404(cableDrumService.get(ctx, drumId));
  const [t, tc, format] = await Promise.all([getTranslations("materials"), getTranslations("common"), getFormatter()]);
  const usable = d.permissions.manage && !d.archivedAt && d.status !== "RETURNED";
  const options = usable ? await materialBatchService.options(ctx, d.siteId) : null;
  const user = (id: string | null) => d.users.find((u) => u.id === id)?.name ?? "–";
  const activityLabel = (a: { taktArea: { code: string }; workPackage: { code: string }; name: string } | null) => (a ? `${a.taktArea.code} · ${a.workPackage.code} ${a.name}` : null);
  const activityOptions = options?.activities.map((a) => ({ value: a.id, label: activityLabel(a)! })) ?? [];
  return (
    <>
      <PageHeader
        title={`${d.code} · ${d.cableType}`}
        description={<StatusBadge status={d.status} label={t(`drumStatuses.${d.status}`)} />}
        backHref={`/c/${companySlug}/materials?site=${d.siteId}`}
        backLabel={t("title")}
        actions={
          <Button asChild variant="outline">
            <a href={`/c/${companySlug}/materials/labels?kind=drum&ids=${d.id}`} target="_blank" rel="noopener">
              <QrCode aria-hidden /> {t("printLabel")}
            </a>
          </Button>
        }
      />
      <div className="space-y-4">
        <Section title={t("remaining")}>
          <p className="text-3xl font-semibold tabular-nums" data-testid="drum-remaining">
            {format.number(Number(d.remainingM))} m <span className="text-base font-normal text-muted-foreground">/ {format.number(Number(d.originalLengthM))} m</span>
          </p>
          <ProgressBar value={100 - d.usedPct} label={t("remainingOf", { remaining: d.remainingM, original: d.originalLengthM })} className="mt-2 h-3" />
        </Section>
        {usable && d.status !== "EMPTY" && (
          <Section title={t("recordPull")}>
            <ActionForm action={pullCableAction.bind(null, companySlug, d.id)} className="grid gap-3 sm:grid-cols-3 sm:items-end" data-testid="pull-form">
              <TextField name="lengthM" label={t("pullLengthM")} required inputMode="decimal" className="text-lg" />
              <SelectField name="activityId" label={t("activity")} placeholder={t("none")} options={activityOptions} defaultValue={d.reservedActivityId} />
              <TextField name="pulledOn" label={t("pulledOn")} type="date" defaultValue={todayInDisplayZone()} />
              <TextField name="note" label={t("note")} className="sm:col-span-2" />
              <SubmitButton className="h-12 md:h-9">{t("savePull")}</SubmitButton>
            </ActionForm>
          </Section>
        )}
        <Section title={t("pulls")}>
          {d.pulls.length === 0 ? (
            <p className="text-sm text-muted-foreground">–</p>
          ) : (
            <ol className="divide-y text-sm" data-testid="drum-pulls">
              {d.pulls.map((p) => (
                <li key={p.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                  <span className="font-semibold tabular-nums">{format.number(Number(p.lengthM))} m</span>
                  <span className="text-muted-foreground">{p.pulledOn} · {user(p.createdById)}</span>
                  {p.activity && (
                    <Link href={`/c/${companySlug}/takt/${p.activity.planId}/activities/${p.activity.id}`} className="text-primary hover:underline">
                      {activityLabel(p.activity)}
                    </Link>
                  )}
                  {p.note && <span className="italic">{p.note}</span>}
                </li>
              ))}
            </ol>
          )}
        </Section>
        <Section title={t("drum")}>
          <DetailList
            items={[
              { label: t("site"), value: `${d.site.project.code} · ${d.site.name}` },
              { label: t("manufacturer"), value: d.manufacturer },
              { label: t("weightKg"), value: d.weightKg ? `${d.weightKg} kg` : null },
              { label: t("dimensions"), value: d.dimensions },
              { label: t("location"), value: d.location?.name },
              { label: t("reservedActivity"), value: activityLabel(d.reservedActivity) },
              { label: t("receivedDate"), value: d.receivedDate },
              { label: t("nextInspection"), value: d.nextInspectionDate },
              { label: t("delivery"), value: d.delivery ? `${d.delivery.supplier}` : null },
              { label: t("note"), value: d.notes },
            ]}
          />
        </Section>
        {usable && options && (
          <Section title={tc("edit")}>
            <ActionForm action={updateDrumAction.bind(null, companySlug, d.id)} className="grid gap-3 sm:grid-cols-2" showSuccess data-testid="drum-edit-form">
              <SelectField name="locationId" label={t("location")} placeholder={t("none")} options={options.locations.map((l) => ({ value: l.id, label: l.name }))} defaultValue={d.locationId} />
              <SelectField name="reservedActivityId" label={t("reservedActivity")} placeholder={t("none")} options={activityOptions} defaultValue={d.reservedActivityId} />
              <TextField name="nextInspectionDate" label={t("nextInspection")} type="date" defaultValue={d.nextInspectionDate} />
              <TextField name="notes" label={t("note")} defaultValue={d.notes} />
              <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
                <input type="checkbox" name="returned" className="size-5 accent-primary md:size-4" /> {t("markReturned")}
              </label>
              <div className="sm:col-span-2">
                <SubmitButton>{tc("save")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
