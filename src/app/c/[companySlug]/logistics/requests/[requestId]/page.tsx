import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { logisticsRequestService } from "@/modules/logistics/logistics.service";
import { ActionForm, SubmitButton, TextField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { ProductionTabs } from "@/app/c/[companySlug]/_components/production-tabs";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { transitionRequestAction } from "../../actions";
import { staffingService, taskTypeService } from "@/modules/production/service";
import { StaffingSection } from "../../_components/staffing";
import { deviationService } from "@/modules/production/deviation.service";
import { DeviationList } from "../../_components/deviation-list";
import { logisticsAiService } from "@/modules/production/ai.service";
import { AiSuggestionSection } from "../../_components/ai-suggestion";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("logistics"))("request") };
}

export default async function RequestPage({ params }: { params: Promise<{ companySlug: string; requestId: string }> }) {
  const { companySlug, requestId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const r = await loadOr404(logisticsRequestService.get(ctx, requestId));
  const [t, td, format, staffing, taskTypes, deviations, ai] = await Promise.all([getTranslations("logistics"), getTranslations("production.deviations"), getFormatter(), staffingService.get(ctx, requestId), taskTypeService.list(ctx).catch(() => []), deviationService.list(ctx, { requestId }), logisticsAiService.suggestion(ctx, requestId)]);
  const base = `/c/${companySlug}/logistics`;
  const user = (id: string | null) => r.users.find((u) => u.id === id)?.name ?? "–";
  const isLift = r.serviceType === "LIFT";
  const minutes = Math.round((r.requestedEnd.getTime() - r.requestedStart.getTime()) / 60_000);
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
      <ProductionTabs ctx={ctx} active="logistics" site={r.siteId} />
      <div className="space-y-4">
        <Section title={t("request")}>
          <DetailList
            items={[
              { label: t("site"), value: `${r.site.project.code} · ${r.site.name}` },
              { label: t("requestedStart"), value: fmtDateTime(format, r.requestedStart) },
              { label: t("estimatedEnd"), value: fmtDateTime(format, r.requestedEnd) },
              { label: t("duration"), value: t("durationValue", { h: Math.floor(minutes / 60), m: minutes % 60 }) },
              {
                label: t("activity"),
                value: r.activity ? (
                  <Link href={`/c/${companySlug}/takt/${r.activity.planId}/activities/${r.activity.id}`} className="text-primary hover:underline">
                    {r.activity.taktArea.code} · {r.activity.workPackage.code} {r.activity.name}
                  </Link>
                ) : null,
              },
              { label: t("loadDescription"), value: r.loadDescription },
              { label: t("heaviestPieceKg"), value: r.weightKg },
              { label: t("dimensions"), value: r.dimensions },
              ...(isLift || r.liftRadiusM ? [{ label: t("liftRadiusM"), value: r.liftRadiusM ? `${r.liftRadiusM} m` : null }] : []),
              ...(isLift || r.liftingAccessories ? [{ label: t("liftingAccessories"), value: r.liftingAccessories }] : []),
              ...(isLift || r.riggerCount !== null ? [{ label: t("riggerCount"), value: r.riggerCount === null ? null : t("persons", { n: r.riggerCount }) }] : []),
              ...(isLift || r.extraCrew ? [{ label: t("extraCrew"), value: r.extraCrew }] : []),
              { label: t("pickup"), value: r.pickup },
              { label: t("destination"), value: r.destination },
              { label: t("equipmentType"), value: r.equipmentType?.name },
              {
                label: t("contactSection"),
                value:
                  r.contactName || r.contactPhone || r.contactEmail ? (
                    <span className="flex flex-col gap-1" data-testid="request-contact">
                      {r.contactName && <span>{r.contactName}</span>}
                      {r.contactPhone && (
                        <a href={`tel:${r.contactPhone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-11 items-center text-primary hover:underline md:min-h-0">
                          {r.contactPhone}
                        </a>
                      )}
                      {r.contactEmail && (
                        <a href={`mailto:${r.contactEmail}`} className="inline-flex min-h-11 items-center break-all text-primary hover:underline md:min-h-0">
                          {r.contactEmail}
                        </a>
                      )}
                    </span>
                  ) : null,
              },
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
        <StaffingSection slug={companySlug} s={staffing} taskTypes={taskTypes.map((x) => ({ id: x.id, name: x.name }))} />
        {staffing.taskType && staffing.needs.length > 0 && <AiSuggestionSection slug={companySlug} taskId={requestId} s={ai} />}
        <Section
          title={td("history")}
          actions={
            <Link href={`${base}/deviations?task=${r.id}`} className="inline-flex min-h-11 items-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 md:min-h-9">
              {td("report")}
            </Link>
          }
        >
          <DeviationList slug={companySlug} rows={deviations} showTask={false} />
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
