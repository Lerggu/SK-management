import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { deliveryService, logisticsLocationService } from "@/modules/logistics/logistics.service";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { advanceDeliveryAction, rescheduleDeliveryAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("logistics"))("deliveries") };
}

export default async function DeliveryPage({ params }: { params: Promise<{ companySlug: string; deliveryId: string }> }) {
  const { companySlug, deliveryId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const d = await loadOr404(deliveryService.get(ctx, deliveryId));
  const [t, tc, format, loc] = await Promise.all([getTranslations("logistics"), getTranslations("common"), getFormatter(), logisticsLocationService.list(ctx, d.siteId)]);
  const base = `/c/${companySlug}/logistics`;
  const canMove = d.permissions.deliver && (d.status === "PLANNED" || d.status === "CONFIRMED");
  return (
    <>
      <PageHeader
        title={d.material}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status === "INSTALLED" ? "COMPLETED" : d.status} label={t(`deliveryStatuses.${d.status}`)} />
            {d.local.date} {d.local.start}–{d.local.end} · {d.gate.name}
          </span>
        }
        backHref={`${base}?site=${d.siteId}&date=${d.local.date}`}
        backLabel={t("board")}
      />
      <div className="space-y-4">
        <Section title={tc("details")}>
          <DetailList
            items={[
              { label: t("site"), value: `${d.site.project.code} · ${d.site.name}` },
              { label: t("supplier"), value: d.supplier },
              { label: t("carrier"), value: d.carrier },
              { label: t("vehicle"), value: d.vehicle },
              { label: t("quantity"), value: d.quantity },
              { label: t("weightKg"), value: d.weightKg },
              { label: t("unloading"), value: d.unloading?.name },
              { label: t("storage"), value: d.storage?.name },
              {
                label: t("activity"),
                value: d.activity ? (
                  <Link href={`/c/${companySlug}/takt/${d.activity.planId}/activities/${d.activity.id}`} className="text-primary hover:underline">
                    {d.activity.taktArea.code} · {d.activity.workPackage.code} {d.activity.name}
                    {d.constraint ? ` (${d.constraint.status === "OPEN" ? "⏳" : "✓"})` : ""}
                  </Link>
                ) : null,
              },
              { label: t("request"), value: d.request ? <Link href={`${base}/requests/${d.request.id}`} className="text-primary hover:underline">{d.request.title}</Link> : null },
              { label: t("deliveryStatuses.ARRIVED_GATE"), value: d.arrivedAt ? fmtDateTime(format, d.arrivedAt) : null },
              { label: t("notes"), value: d.notes },
            ]}
          />
          {d.permissions.deliver && d.next.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" data-testid="delivery-actions">
              {d.next.map((n, i) => (
                <ActionButton key={n} action={advanceDeliveryAction.bind(null, companySlug, d.id)} hidden={{ to: n }} variant={n === "CANCELLED" ? "ghost" : i === 0 ? "default" : "outline"} confirm={n === "CANCELLED" ? tc("confirmArchive") : undefined}>
                  {t(`advanceTo.${n}`)}
                </ActionButton>
              ))}
            </div>
          )}
        </Section>
        {canMove && (
          <Section title={t("reschedule")}>
            <ActionForm action={rescheduleDeliveryAction.bind(null, companySlug, d.id)} className="grid gap-3 sm:grid-cols-4 sm:items-end">
              <SelectField name="gateId" label={t("gate")} options={loc.locations.filter((l) => l.kind === "GATE").map((g) => ({ value: g.id, label: g.name }))} defaultValue={d.gate.id} />
              <TextField name="date" label={t("date")} type="date" defaultValue={d.local.date} />
              <TextField name="startTime" label={t("startTime")} type="time" step={1800} defaultValue={d.local.start} />
              <TextField name="slots" label={t("slots")} inputMode="numeric" defaultValue={String(Math.round((d.slotEnd.getTime() - d.slotStart.getTime()) / 1_800_000))} />
              <div className="sm:col-span-4">
                <SubmitButton variant="outline">{t("reschedule")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
