import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { siteMapService } from "@/modules/production/sitemap.service";
import { DEVIATION_TYPES } from "@/modules/production/deviation.service";
import { EmptyState, PageHeader } from "@/ui/components/page";
import { cn } from "@/ui/lib/utils";
import { requireCompanyContext } from "@/app/_lib/context";
import { ProductionTabs } from "@/app/c/[companySlug]/_components/production-tabs";
import { orForbidden } from "../../workforce/_components/hr/access";
import { SiteMapBoard, type MapActions } from "./map-board";
import { MapUpload } from "./map-upload";
import {
  archiveObjectAction,
  createObjectAction,
  moveObjectAction,
  placeTaskAction,
  reportObjectDeviationAction,
  unplaceTaskAction,
  updateObjectAction,
  uploadMapAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("production.map"))("title") };
}

type SP = { site?: string; date?: string; range?: string; object?: string };

/** Site map (ADR 0034): overview image of a site with objects and logistics tasks on it. */
export default async function SiteMapPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<SP> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const t = await getTranslations("production.map");
  const tc = await getTranslations("production.calendar");
  const format = await getFormatter();
  const data = await orForbidden(siteMapService.view(ctx, { siteId: sp.site, date: sp.date, range: sp.range }));
  if (!data) {
    return (
      <>
        <PageHeader title={t("title")} />
        <ProductionTabs ctx={ctx} active="map" />
        <EmptyState>{tc("noAccess")}</EmptyState>
      </>
    );
  }
  const base = `/c/${companySlug}/logistics/map`;
  const href = (o: Partial<SP>) => {
    const q = new URLSearchParams(Object.entries({ site: data.site?.id, date: data.range.startDate, range: data.range.kind, ...o }).filter((e): e is [string, string] => !!e[1]));
    return `${base}?${q.toString()}`;
  };
  const pill = "inline-flex min-h-11 items-center rounded-lg border px-3 text-sm md:min-h-9";
  const site = data.site;
  const actions: MapActions | null = site
    ? {
        createObject: createObjectAction.bind(null, companySlug, site.id) as MapActions["createObject"],
        updateObject: updateObjectAction.bind(null, companySlug) as MapActions["updateObject"],
        moveObject: moveObjectAction.bind(null, companySlug) as MapActions["moveObject"],
        archiveObject: archiveObjectAction.bind(null, companySlug),
        placeTask: placeTaskAction.bind(null, companySlug) as MapActions["placeTask"],
        unplaceTask: unplaceTaskAction.bind(null, companySlug),
        reportDeviation: reportObjectDeviationAction.bind(null, companySlug),
      }
    : null;

  return (
    <>
      <PageHeader title={t("title")} description={t("hint")} />
      <ProductionTabs ctx={ctx} active="map" />
      {!site ? (
        <EmptyState>{t("noSites")}</EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2" data-testid="map-controls">
            <form method="get" className="flex min-w-0 flex-1 items-end gap-2 sm:flex-none">
              <input type="hidden" name="range" value={data.range.kind} />
              <input type="hidden" name="date" value={data.range.startDate} />
              <label className="min-w-0 flex-1 text-sm sm:w-72 sm:flex-none">
                <span className="block font-medium">{t("site")}</span>
                <select name="site" defaultValue={site.id} className="mt-1 h-11 w-full rounded-lg border bg-background px-2 md:h-9">
                  {data.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.hasMap ? "" : ` (${t("noMapShort")})`}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={pill}>
                {tc("show")}
              </button>
            </form>
            <Link href={href({ date: data.range.prevDate })} className={pill} aria-label={tc("previous")}>
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <Link href={href({ date: data.range.today })} className={pill}>
              {tc("today")}
            </Link>
            <Link href={href({ date: data.range.nextDate })} className={pill} aria-label={tc("next")}>
              <ChevronRight className="size-4" aria-hidden />
            </Link>
            <div className="flex gap-1" role="group" aria-label={t("period")}>
              {(["day", "week"] as const).map((r) => (
                <Link key={r} href={href({ range: r })} aria-current={r === data.range.kind ? "true" : undefined} className={cn(pill, r === data.range.kind && "bg-primary text-primary-foreground")}>
                  {t(`ranges.${r}`)}
                </Link>
              ))}
            </div>
            <span className="text-sm text-muted-foreground">{t("from", { date: data.range.startDate.split("-").reverse().join(".") })}</span>
          </div>

          {data.can.edit && (
            <details className="rounded-lg border p-3" open={!data.map}>
              <summary className="cursor-pointer text-sm font-semibold">{data.map ? t("replaceMap") : t("uploadMap")}</summary>
              <div className="mt-3">
                <MapUpload upload={uploadMapAction.bind(null, companySlug, site.id, null)} hasMap={!!data.map} />
              </div>
            </details>
          )}

          <SiteMapBoard
            key={site.id}
            slug={companySlug}
            imageUrl={data.map ? `${base}/image/${data.map.id}` : null}
            aspect={data.map ? data.map.width / data.map.height : 1.5}
            objects={data.objects.map((o) => ({ ...o, deviations: o.deviations.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })) }))}
            tasks={data.tasks.map((x) => ({
              id: x.id,
              title: x.title,
              when: `${format.dateTime(x.start, { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}–${format.dateTime(x.end, { hour: "2-digit", minute: "2-digit" })}`,
              phase: x.phase,
              missing: x.missing,
              inRange: x.inRange,
              taskType: x.taskType,
              pin: x.pin,
              deviations: x.deviations.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
            }))}
            locations={data.locations}
            canEdit={data.can.edit}
            canReport={data.can.report}
            deviationTypes={DEVIATION_TYPES}
            initialObjectId={sp.object ?? null}
            actions={actions!}
          />
        </div>
      )}
    </>
  );
}
