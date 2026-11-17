import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { productionCalendarService } from "@/modules/production/calendar.service";
import { ZOOMS } from "@/modules/production/calendar";
import { EmptyState, PageHeader } from "@/ui/components/page";
import { cn } from "@/ui/lib/utils";
import { requireCompanyContext } from "@/app/_lib/context";
import { ProductionTabs } from "@/app/c/[companySlug]/_components/production-tabs";
import { calendarAssignAction } from "../production-actions";
import { orForbidden } from "../../workforce/_components/hr/access";
import { CalendarBoard } from "./calendar-board";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("production.calendar"))("title") };
}

type SP = { zoom?: string; date?: string; site?: string; view?: string };

/** Production calendar: logistics tasks on a scalable time axis, resources beside (ADR 0026, phase 2). */
export default async function CalendarPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<SP> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const t = await getTranslations("production.calendar");
  const data = await orForbidden(productionCalendarService.view(ctx, { zoom: sp.zoom, date: sp.date, siteId: sp.site }));
  if (!data) {
    return (
      <>
        <PageHeader title={t("title")} />
        <ProductionTabs ctx={ctx} active="calendar" />
        <EmptyState>{t("noAccess")}</EmptyState>
      </>
    );
  }
  const view = sp.view === "resources" ? "resources" : "tasks";
  const href = (o: Partial<SP>) => {
    const q = new URLSearchParams(Object.entries({ zoom: data.range.zoom, date: data.range.startDate, site: data.siteId ?? undefined, view, ...o }).filter((e): e is [string, string] => !!e[1]));
    return `/c/${companySlug}/logistics/calendar?${q.toString()}`;
  };
  const pill = "inline-flex min-h-11 items-center rounded-lg border px-3 text-sm md:min-h-9";
  return (
    <>
      <PageHeader title={t("title")} description={t("hint")} />
      <ProductionTabs ctx={ctx} active="calendar" />
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="calendar-controls">
        <Link href={href({ date: data.range.prevDate })} className={pill} aria-label={t("previous")}>
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <Link href={href({ date: data.range.today })} className={pill}>
          {t("today")}
        </Link>
        <Link href={href({ date: data.range.nextDate })} className={pill} aria-label={t("next")}>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        <div className="flex gap-1" role="group" aria-label={t("zoom")}>
          {ZOOMS.map((z) => (
            <Link key={z} href={href({ zoom: z })} aria-current={z === data.range.zoom ? "true" : undefined} className={cn(pill, z === data.range.zoom && "bg-primary text-primary-foreground")}>
              {t(`zooms.${z}`)}
            </Link>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label={t("view")}>
          {(["tasks", "resources"] as const).map((v) => (
            <Link key={v} href={href({ view: v })} aria-current={v === view ? "true" : undefined} className={cn(pill, v === view && "bg-primary text-primary-foreground")}>
              {t(`views.${v}`)}
            </Link>
          ))}
        </div>
        <form className="flex items-center gap-2" action={`/c/${companySlug}/logistics/calendar`}>
          <input type="hidden" name="zoom" value={data.range.zoom} />
          <input type="hidden" name="date" value={data.range.startDate} />
          <input type="hidden" name="view" value={view} />
          <select name="site" defaultValue={data.siteId ?? ""} aria-label={t("site")} className="h-11 rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm">
            <option value="">{t("allSites")}</option>
            {data.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit" className={pill}>
            {t("show")}
          </button>
        </form>
      </div>
      <CalendarBoard
        slug={companySlug}
        ticks={data.ticks}
        tasks={data.tasks.map((x) => ({ ...x, start: x.start.toISOString(), end: x.end.toISOString() }))}
        resources={data.resources}
        view={view}
        assign={calendarAssignAction.bind(null, companySlug)}
      />
    </>
  );
}
