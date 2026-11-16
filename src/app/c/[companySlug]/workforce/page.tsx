import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { employeeService } from "@/modules/workforce/service";
import { hrOverviewService } from "@/modules/hr/overview.service";
import { hrCardService } from "@/modules/hr/card.service";
import { competenceAreaService, jobProfileService, qualificationTypeService } from "@/modules/hr/settings.service";
import { LANGUAGES } from "@/modules/hr/schemas";
import { LANGUAGE_LEVELS } from "@/modules/hr/rules";
import { Button } from "@/ui/components/button";
import { EmptyState, PageHeader, RowLink, RowList, SearchForm } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { HrTabs } from "./_components/hr/tabs";
import { hrTabsFor } from "./_components/hr/access";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("workforce"))("title") };
}

type SP = { q?: string; archived?: string; jobProfileId?: string; team?: string; location?: string; areaId?: string; minLevel?: string; language?: string; languageLevel?: string; qualificationTypeId?: string; inactive?: string };
const HR_FILTERS = ["jobProfileId", "team", "location", "areaId", "language", "qualificationTypeId", "inactive"] as const;

function Select({ name, label, value, options, any }: { name: string; label: string; value?: string; options: { value: string; label: string }[]; any: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="h-11 rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm">
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default async function WorkforcePage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<SP> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  if (!hasPermission(ctx, "employee.view")) {
    // Employees without the register see their own personnel card only.
    const own = await hrCardService.myEmployeeId(ctx);
    if (own) redirect(`/c/${companySlug}/workforce/${own}`);
    notFound();
  }
  const filtered = HR_FILTERS.some((k) => sp[k]);
  const [tabs, t, th, tc] = await Promise.all([hrTabsFor(ctx), getTranslations("workforce"), getTranslations("hr"), getTranslations("common")]);
  const [employees, search, areas, types, profiles] = await Promise.all([
    filtered ? Promise.resolve(null) : loadOr404(employeeService.list(ctx, { q: sp.q, includeArchived: sp.archived === "1" })),
    loadOr404(
      hrOverviewService.search(ctx, {
        q: sp.q,
        jobProfileId: sp.jobProfileId,
        team: sp.team,
        location: sp.location,
        areaId: sp.areaId,
        minLevel: sp.minLevel,
        language: sp.language,
        languageLevel: sp.languageLevel,
        qualificationTypeId: sp.qualificationTypeId,
        includeInactive: sp.inactive === "1",
      }),
    ),
    competenceAreaService.list(ctx),
    qualificationTypeService.list(ctx),
    jobProfileService.list(ctx),
  ]);
  const rows = employees ?? search.employees.map((e) => ({ ...e, archivedAt: null as Date | null, employmentType: null as string | null }));
  const any = th("search.any");
  return (
    <>
      <PageHeader
        title={t("title")}
        description={tc("total", { count: rows.length })}
        actions={
          hasPermission(ctx, "employee.manage") && (
            <Button asChild>
              <Link href={`/c/${companySlug}/workforce/new`}>
                <Plus aria-hidden /> {t("new")}
              </Link>
            </Button>
          )
        }
      />
      <HrTabs slug={companySlug} active="people" show={tabs} />
      <SearchForm placeholder={tc("searchPlaceholder")} defaultValue={sp.q} includeArchived={sp.archived === "1"} includeArchivedLabel={tc("includeArchived")} searchLabel={tc("search")} />
      <details className="mb-4 rounded-xl border bg-card" open={filtered}>
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium md:min-h-9">{th("search.filters")}</summary>
        <form className="grid gap-3 border-t p-4 sm:grid-cols-2 lg:grid-cols-3" role="search" data-testid="hr-filters">
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          <Select name="jobProfileId" label={th("search.jobProfile")} value={sp.jobProfileId} any={any} options={profiles.map((p) => ({ value: p.id, label: p.name }))} />
          <Select name="team" label={th("search.team")} value={sp.team} any={any} options={search.teams.map((x) => ({ value: x, label: x }))} />
          <Select name="location" label={th("search.location")} value={sp.location} any={any} options={search.locations.map((x) => ({ value: x, label: x }))} />
          {search.workFilters && (
            <>
              <Select name="areaId" label={th("search.area")} value={sp.areaId} any={any} options={areas.map((a) => ({ value: a.id, label: `${a.category} · ${a.name}` }))} />
              <Select name="minLevel" label={th("search.minLevel")} value={sp.minLevel} any={any} options={(["1", "2", "3", "4"] as const).map((l) => ({ value: l, label: th(`levels.${l}`) }))} />
              <Select name="qualificationTypeId" label={th("search.qualification")} value={sp.qualificationTypeId} any={any} options={types.map((x) => ({ value: x.id, label: x.name }))} />
              <Select name="language" label={th("search.language")} value={sp.language} any={any} options={LANGUAGES.map((l) => ({ value: l, label: th(`language.names.${l}`) }))} />
              <Select name="languageLevel" label={th("search.languageLevel")} value={sp.languageLevel} any={any} options={LANGUAGE_LEVELS.filter((l) => l !== "NOT_ASSESSED").map((l) => ({ value: l, label: th(`language.levels.${l}`) }))} />
            </>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2 lg:col-span-3 md:min-h-9">
            <input type="checkbox" name="inactive" value="1" defaultChecked={sp.inactive === "1"} className="size-5 accent-primary md:size-4" />
            {th("search.includeInactive")}
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
            <button type="submit" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9">
              {th("search.apply")}
            </button>
            <Link href={`/c/${companySlug}/workforce`} className="inline-flex h-11 items-center rounded-lg border px-4 text-sm md:h-9">
              {th("search.clear")}
            </Link>
          </div>
        </form>
      </details>
      {rows.length === 0 ? (
        <EmptyState>{t("noEmployees")}</EmptyState>
      ) : (
        <RowList>
          {rows.map((e) => (
            <RowLink
              key={e.id}
              href={`/c/${companySlug}/workforce/${e.id}`}
              title={`${e.lastName} ${e.firstName}`}
              subtitle={[e.employeeNumber, e.jobTitle ?? e.trade, e.team, e.location].filter(Boolean).join(" · ")}
              badge={e.archivedAt ? <StatusBadge status="ARCHIVED" label={tc("archived")} /> : e.status !== "ACTIVE" && <StatusBadge status={e.status} label={t(`statuses.${e.status}`)} />}
              meta={e.employmentType ? t(`employmentTypes.${e.employmentType}`) : undefined}
            />
          ))}
        </RowList>
      )}
    </>
  );
}
