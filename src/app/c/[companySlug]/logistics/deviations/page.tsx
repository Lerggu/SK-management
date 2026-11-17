import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { deviationService } from "@/modules/production/deviation.service";
import { productionCalendarService } from "@/modules/production/calendar.service";
import { staffingService } from "@/modules/production/service";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { requireCompanyContext } from "@/app/_lib/context";
import { ProductionTabs } from "@/app/c/[companySlug]/_components/production-tabs";
import { orForbidden } from "../../workforce/_components/hr/access";
import { reportDeviationAction } from "../production-actions";
import { DeviationList } from "../_components/deviation-list";
import { PHASE_STYLE } from "../_components/task-colors";
import { DeviationReportForm } from "./report-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("production.deviations"))("title") };
}

/** Deviations: report from the phone (task → type → photo/comment), open list (ADR 0026, phase 3). */
export default async function DeviationsPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ task?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [t, format] = await Promise.all([getTranslations("production.deviations"), getFormatter()]);
  const [today, open] = await Promise.all([orForbidden(productionCalendarService.view(ctx, { zoom: "day" })), orForbidden(deviationService.list(ctx, { open: true }))]);
  const selected = sp.task ? (today?.tasks.find((x) => x.id === sp.task) ?? (await orForbidden(staffingService.get(ctx, sp.task)).catch(() => null))?.request ?? null) : null;
  const time = (d: Date) => format.dateTime(d, { hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <PageHeader title={t("title")} description={t("hint")} />
      <ProductionTabs ctx={ctx} active="deviations" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("report")}>
          {!selected ? (
            <>
              <h3 className="mb-2 text-sm font-semibold">{t("chooseTask")}</h3>
              <p className="mb-2 text-xs text-muted-foreground">{t("todayTasks")}</p>
              {!today || today.tasks.length === 0 ? (
                <EmptyState>{t("noTasks")}</EmptyState>
              ) : (
                <ul className="space-y-2" data-testid="report-tasks">
                  {today.tasks.map((x) => (
                    <li key={x.id}>
                      <Link href={`/c/${companySlug}/logistics/deviations?task=${x.id}`} className={`flex min-h-14 items-center gap-3 rounded-xl border-l-4 px-3 ${PHASE_STYLE[x.phase]}`} data-task={x.title}>
                        <span className="flex-1 font-medium">{x.title}</span>
                        <span className="text-xs">
                          {time(x.start)}–{time(x.end)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="font-medium">{selected.title}</span>
                <Link href={`/c/${companySlug}/logistics/deviations`} className="text-sm text-primary underline-offset-2 hover:underline">
                  {t("changeTask")}
                </Link>
              </div>
              <DeviationReportForm action={reportDeviationAction.bind(null, companySlug, selected.id)} />
            </>
          )}
        </Section>
        <Section title={t("open")}>{open && <DeviationList slug={companySlug} rows={open} showTask />}</Section>
      </div>
    </>
  );
}
