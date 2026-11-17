import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { rotationService } from "@/modules/workforce/rotation.service";
import { ActionForm, CheckboxGroupField, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { cn } from "@/ui/lib/utils";
import { requireCompanyContext } from "@/app/_lib/context";
import { HrTabs } from "../_components/hr/tabs";
import { hrTabsFor, orForbidden } from "../_components/hr/access";
import { rotationClearAction, rotationPatternAction, rotationSetAction } from "../rotation-actions";
import { RotationBoard } from "./rotation-board";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("rotation"))("title") };
}

type SP = { date?: string; weeks?: string; trade?: string };

/** Workforce rotation calendar (ADR 0027). */
export default async function RotationPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<SP> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [t, tabs] = await Promise.all([getTranslations("rotation"), hrTabsFor(ctx)]);
  const data = await orForbidden(rotationService.board(ctx, { date: sp.date, weeks: sp.weeks, trade: sp.trade || null }));
  if (!data) {
    return (
      <>
        <PageHeader title={t("title")} />
        <HrTabs slug={companySlug} active="rotation" show={tabs} />
        <EmptyState>{t("noAccess")}</EmptyState>
      </>
    );
  }
  const base = `/c/${companySlug}/workforce/rotation`;
  const href = (o: Partial<SP>) => {
    const q = new URLSearchParams(Object.entries({ date: data.range.start, weeks: String(data.range.weeks), trade: data.trade ?? undefined, ...o }).filter((e): e is [string, string] => !!e[1]));
    return `${base}?${q.toString()}`;
  };
  const pill = "inline-flex min-h-11 items-center rounded-lg border px-3 text-sm md:min-h-9";
  const fmt = (iso: string) => `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <HrTabs slug={companySlug} active="rotation" show={tabs} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={href({ date: data.range.prev })} className={pill} aria-label={t("previous")}>
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <Link href={href({ date: data.range.today })} className={pill}>
          {t("today")}
        </Link>
        <Link href={href({ date: data.range.next })} className={pill} aria-label={t("next")}>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        <span className="text-sm font-medium" data-testid="rotation-range">
          {fmt(data.range.start)} – {fmt(data.range.end)}
        </span>
        <div className="flex gap-1" role="group" aria-label={t("period")}>
          {[1, 2, 4, 6].map((w) => (
            <Link key={w} href={href({ weeks: String(w) })} aria-current={w === data.range.weeks ? "true" : undefined} className={cn(pill, w === data.range.weeks && "bg-primary text-primary-foreground")}>
              {t("weeksN", { count: w })}
            </Link>
          ))}
        </div>
        {data.trades.length > 0 && (
          <form action={base} className="flex items-center gap-2">
            <input type="hidden" name="date" value={data.range.start} />
            <input type="hidden" name="weeks" value={data.range.weeks} />
            <select name="trade" defaultValue={data.trade ?? ""} aria-label={t("trade")} className="h-11 rounded-lg border bg-background px-3 text-base md:h-9 md:text-sm">
              <option value="">{t("allTrades")}</option>
              {data.trades.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <button type="submit" className={pill}>
              {t("show")}
            </button>
          </form>
        )}
      </div>
      {!data.canManage && <p className="mb-3 text-xs text-muted-foreground">{t("readOnly")}</p>}
      <RotationBoard
        days={data.days}
        people={data.people}
        sites={data.sites}
        unassigned={data.unassigned}
        statusRows={data.statusRows}
        teams={data.teams}
        canManage={data.canManage}
        setRange={rotationSetAction.bind(null, companySlug)}
        clearRange={rotationClearAction.bind(null, companySlug)}
      />
      {data.canManage && (
        <Section title={t("patternTitle")} className="mt-6">
          <p className="mb-3 text-sm text-muted-foreground">{t("patternHint")}</p>
          <ActionForm action={rotationPatternAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" showSuccess data-testid="pattern-form">
            <TextField name="from" label={t("from")} type="date" defaultValue={data.range.start} required />
            <TextField name="until" label={t("until")} type="date" defaultValue={data.range.end} required />
            <SelectField name="siteId" label={t("site")} placeholder={t("noSite")} options={data.sites.map((s) => ({ value: s.id, label: s.name }))} />
            <TextField name="workDays" label={t("workDays")} inputMode="numeric" defaultValue="10" required />
            <TextField name="offDays" label={t("offDays")} inputMode="numeric" defaultValue="4" required />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="overwrite" className="size-5" />
              {t("overwrite")}
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <CheckboxGroupField name="employeeIds" label={t("people")} options={data.people.map((p) => ({ value: p.id, label: p.trade ? `${p.name} (${p.trade})` : p.name }))} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <SubmitButton>{t("applyPattern")}</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      )}
    </>
  );
}
