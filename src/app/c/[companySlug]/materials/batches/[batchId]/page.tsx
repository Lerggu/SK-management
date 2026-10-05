import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { QrCode } from "lucide-react";
import { materialBatchService } from "@/modules/lifting/material.service";
import { Button } from "@/ui/components/button";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { moveBatchAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("materials"))("batch") };
}

export default async function BatchPage({ params }: { params: Promise<{ companySlug: string; batchId: string }> }) {
  const { companySlug, batchId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const b = await loadOr404(materialBatchService.get(ctx, batchId));
  const [t, format] = await Promise.all([getTranslations("materials"), getFormatter()]);
  const options = b.permissions.manage && b.next.length > 0 ? await materialBatchService.options(ctx, b.siteId) : null;
  const user = (id: string | null) => b.users.find((u) => u.id === id)?.name ?? "–";
  const activityLabel = (a: { taktArea: { code: string }; workPackage: { code: string }; name: string } | null) => (a ? `${a.taktArea.code} · ${a.workPackage.code} ${a.name}` : null);
  return (
    <>
      <PageHeader
        title={`${b.code} · ${b.material}`}
        description={<StatusBadge status={b.status} label={t(`statuses.${b.status}`)} />}
        backHref={`/c/${companySlug}/materials?site=${b.siteId}`}
        backLabel={t("title")}
        actions={
          <Button asChild variant="outline">
            <a href={`/c/${companySlug}/materials/labels?kind=batch&ids=${b.id}`} target="_blank" rel="noopener">
              <QrCode aria-hidden /> {t("printLabel")}
            </a>
          </Button>
        }
      />
      <div className="space-y-4">
        <Section title={t("batch")}>
          <DetailList
            items={[
              { label: t("site"), value: `${b.site.project.code} · ${b.site.name}` },
              { label: t("quantity"), value: `${b.quantity} ${b.unit}` },
              { label: t("location"), value: b.location?.name },
              {
                label: t("activity"),
                value: b.activity ? (
                  <Link href={`/c/${companySlug}/takt/${b.activity.planId}/activities/${b.activity.id}`} className="text-primary hover:underline">
                    {activityLabel(b.activity)}
                  </Link>
                ) : null,
              },
              {
                label: t("delivery"),
                value: b.delivery ? (
                  <Link href={`/c/${companySlug}/logistics/deliveries/${b.delivery.id}`} className="text-primary hover:underline">
                    {b.delivery.material} · {fmtDateTime(format, b.delivery.slotStart)}
                  </Link>
                ) : null,
              },
              { label: t("note"), value: b.notes },
            ]}
          />
        </Section>
        {options && (
          <Section title={t("move")}>
            <ActionForm action={moveBatchAction.bind(null, companySlug, b.id)} className="space-y-3" data-testid="batch-move-form">
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField name="locationId" label={t("location")} placeholder={t("none")} options={options.locations.map((l) => ({ value: l.id, label: l.name }))} defaultValue={b.locationId} />
                <SelectField name="activityId" label={t("activity")} placeholder={t("none")} options={options.activities.map((a) => ({ value: a.id, label: activityLabel(a)! }))} defaultValue={b.activityId} />
                <TextField name="note" label={t("note")} className="sm:col-span-2" />
              </div>
              <div className="flex flex-wrap gap-2">
                {b.next.map((to) => (
                  <button key={to} type="submit" name="to" value={to} className={to === "RETURNED" ? "h-12 rounded-lg border px-4 text-sm md:h-9" : "h-12 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9"} data-move={to}>
                    {t(`moveTo.${to}`)}
                  </button>
                ))}
              </div>
            </ActionForm>
          </Section>
        )}
        <Section title={t("movements")}>
          <ol className="space-y-2 text-sm" data-testid="batch-movements">
            {b.movements.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 pl-3">
                <StatusBadge status={m.toStatus} label={t(`statuses.${m.toStatus}`)} />
                <span className="text-muted-foreground">{fmtDateTime(format, m.movedAt)} · {user(m.movedById)}</span>
                {m.location && <span>{m.location.name}</span>}
                {m.activity && <span>{activityLabel(m.activity)}</span>}
                {m.note && <span className="italic">{m.note}</span>}
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </>
  );
}
