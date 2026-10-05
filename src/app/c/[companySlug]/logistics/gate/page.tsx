import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { logisticsBoardService } from "@/modules/logistics/logistics.service";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { ActionButton } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SiteDayPicker } from "../_components/site-day-picker";
import { advanceDeliveryAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("logistics"))("gateView") };
}

/** Mobile gate view: today's arrivals with large status buttons. */
export default async function GatePage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ site?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [sites, t] = await Promise.all([logisticsBoardService.sites(ctx), getTranslations("logistics")]);
  const base = `/c/${companySlug}/logistics`;
  if (sites.length === 0) return <EmptyState>{t("noSites")}</EmptyState>;
  const siteId = sites.some((s) => s.id === sp.site) ? sp.site! : sites[0].id;
  const board = await loadOr404(logisticsBoardService.day(ctx, { siteId, date: todayInDisplayZone() }));
  const active = board.deliveries.filter((d) => d.status !== "CANCELLED");
  return (
    <>
      <PageHeader title={t("gateView")} description={`${board.site.project.code} · ${board.site.name} · ${board.date}`} backHref={`${base}?site=${siteId}`} backLabel={t("board")} />
      <div className="space-y-4">
        <SiteDayPicker sites={sites} siteId={siteId} showDate={false} />
        <Section title={t("deliveries")}>
          <p className="mb-3 text-sm text-muted-foreground">{t("gateViewHint")}</p>
          {active.length === 0 ? (
            <EmptyState>{t("noDeliveries")}</EmptyState>
          ) : (
            <ul className="space-y-3" data-testid="gate-list">
              {active.map((d) => (
                <li key={d.id} className="rounded-lg border p-3" data-delivery={d.id} data-status={d.status}>
                  <Link href={`${base}/deliveries/${d.id}`} className="block min-h-11">
                    <span className="flex items-center gap-2">
                      <span className="text-lg font-semibold tabular-nums">{d.startLabel}</span>
                      <span className="text-sm text-muted-foreground">{d.gate.name}</span>
                      <StatusBadge status={d.status === "INSTALLED" ? "COMPLETED" : d.status} label={t(`deliveryStatuses.${d.status}`)} className="ml-auto" />
                    </span>
                    <span className="mt-1 block font-medium">{d.material}</span>
                    <span className="block text-sm text-muted-foreground">
                      {[d.supplier, d.vehicle, d.quantity].filter(Boolean).join(" · ")}
                      {d.activity ? ` · ${d.activity.taktArea.code} ${d.activity.name}` : ""}
                    </span>
                  </Link>
                  {board.permissions.deliver && d.next.filter((n) => n !== "CANCELLED").length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {d.next
                        .filter((n) => n !== "CANCELLED")
                        .slice(0, 2)
                        .map((n, i) => (
                          <ActionButton key={n} action={advanceDeliveryAction.bind(null, companySlug, d.id)} hidden={{ to: n }} variant={i === 0 ? "default" : "outline"} className="w-full [&_button]:h-14 [&_button]:w-full [&_button]:text-base">
                            {t(`advanceTo.${n}`)}
                          </ActionButton>
                        ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
