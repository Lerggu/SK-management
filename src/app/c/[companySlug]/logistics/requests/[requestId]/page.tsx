import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { logisticsRequestService } from "@/modules/logistics/logistics.service";
import { ActionForm, SubmitButton, TextField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { transitionRequestAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("logistics"))("request") };
}

export default async function RequestPage({ params }: { params: Promise<{ companySlug: string; requestId: string }> }) {
  const { companySlug, requestId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const r = await loadOr404(logisticsRequestService.get(ctx, requestId));
  const [t, format] = await Promise.all([getTranslations("logistics"), getFormatter()]);
  const base = `/c/${companySlug}/logistics`;
  const user = (id: string | null) => r.users.find((u) => u.id === id)?.name ?? "–";
  return (
    <>
      <PageHeader
        title={r.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status === "REQUESTED" || r.status === "REVIEW" ? "PENDING_APPROVAL" : r.status === "COMPLETE" ? "COMPLETED" : r.status} label={t(`requestStatuses.${r.status}`)} />
            {t(`serviceTypes.${r.serviceType}`)} · {t(`priorities.${r.priority}`)}
          </span>
        }
        backHref={`${base}?site=${r.siteId}`}
        backLabel={t("board")}
      />
      <div className="space-y-4">
        <Section title={t("request")}>
          <DetailList
            items={[
              { label: t("site"), value: `${r.site.project.code} · ${r.site.name}` },
              { label: t("requestedStart"), value: `${fmtDateTime(format, r.requestedStart)} – ${fmtDateTime(format, r.requestedEnd)}` },
              {
                label: t("activity"),
                value: r.activity ? (
                  <Link href={`/c/${companySlug}/takt/${r.activity.planId}/activities/${r.activity.id}`} className="text-primary hover:underline">
                    {r.activity.taktArea.code} · {r.activity.workPackage.code} {r.activity.name}
                  </Link>
                ) : null,
              },
              { label: t("loadDescription"), value: r.loadDescription },
              { label: t("weightKg"), value: r.weightKg },
              { label: t("dimensions"), value: r.dimensions },
              { label: t("pickup"), value: r.pickup },
              { label: t("destination"), value: r.destination },
              { label: t("equipmentType"), value: r.equipmentType?.name },
              { label: t("bookedBy"), value: user(r.requestedById ?? r.createdById) },
              { label: t("approve"), value: r.approvedAt ? `${user(r.approvedById)} · ${fmtDateTime(format, r.approvedAt)}` : null },
              { label: t("decisionNote"), value: r.decisionNote },
            ]}
          />
          <p className="mt-4 text-xs text-muted-foreground">{t("approvers")}</p>
          {r.next.length > 0 && (
            <div className="mt-4 space-y-3 border-t pt-4" data-testid="request-actions">
              <div className="flex flex-wrap gap-2">
                {r.next
                  .filter((n) => n !== "CANCELLED" && n !== "DRAFT")
                  .map((n) => (
                    <ActionForm key={n} action={transitionRequestAction.bind(null, companySlug, r.id)} className="space-y-0">
                      <input type="hidden" name="to" value={n} />
                      <SubmitButton variant={n === "APPROVED" ? "default" : "outline"}>{t(`transitionTo.${n}`)}</SubmitButton>
                    </ActionForm>
                  ))}
              </div>
              {(r.next.includes("DRAFT") || r.next.includes("CANCELLED")) && (
                <ActionForm action={transitionRequestAction.bind(null, companySlug, r.id)} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                  <TextField name="note" label={t("decisionNote")} />
                  {r.next.includes("DRAFT") && (
                    <button type="submit" name="to" value="DRAFT" className="h-11 rounded-lg border px-4 text-sm md:h-9">
                      {t("transitionTo.DRAFT")}
                    </button>
                  )}
                  {r.next.includes("CANCELLED") && (
                    <button type="submit" name="to" value="CANCELLED" className="h-11 rounded-lg border border-destructive/40 px-4 text-sm text-destructive md:h-9">
                      {t("transitionTo.CANCELLED")}
                    </button>
                  )}
                </ActionForm>
              )}
            </div>
          )}
        </Section>
        {r.deliveries.length > 0 && (
          <Section title={t("linkedDeliveries")}>
            <ul className="divide-y text-sm">
              {r.deliveries.map((d) => (
                <li key={d.id}>
                  <Link href={`${base}/deliveries/${d.id}`} className="flex min-h-11 items-center gap-2 py-1 hover:underline">
                    <StatusBadge status={d.status} label={t(`deliveryStatuses.${d.status}`)} /> {d.material} · {fmtDateTime(format, d.slotStart)}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </>
  );
}
