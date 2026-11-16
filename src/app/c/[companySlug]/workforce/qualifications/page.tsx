import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { hrOverviewService } from "@/modules/hr/overview.service";
import { qualificationTypeService } from "@/modules/hr/settings.service";
import { EmptyState, PageHeader } from "@/ui/components/page";
import { fmtDate } from "@/ui/format";
import { requireCompanyContext } from "@/app/_lib/context";
import { HrTabs } from "../_components/hr/tabs";
import { hrTabsFor, orForbidden } from "../_components/hr/access";
import { ValidityBadge } from "../_components/hr/badges";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hr.qualification"))("title") };
}

const STATES = ["VALID", "EXPIRING", "EXPIRED", "NO_EXPIRY"] as const;

/** All cards and qualifications with validity (text and colour), filterable. */
export default async function QualificationsPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ employeeId?: string; typeId?: string; validity?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [tabs, t, format] = await Promise.all([hrTabsFor(ctx), getTranslations("hr"), getFormatter()]);
  const [data, types] = await Promise.all([orForbidden(hrOverviewService.qualifications(ctx, sp)), orForbidden(qualificationTypeService.list(ctx))]);
  const select = "h-11 rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm";
  return (
    <>
      <PageHeader title={t("qualification.title")} description={data ? t("qualification.counts", { valid: data.counts.VALID + data.counts.NO_EXPIRY, expiring: data.counts.EXPIRING, expired: data.counts.EXPIRED }) : undefined} />
      <HrTabs slug={companySlug} active="qualifications" show={tabs} />
      {!data ? (
        <EmptyState>{t("basicOnly")}</EmptyState>
      ) : (
        <>
          <form className="mb-4 grid gap-2 sm:grid-cols-4 sm:items-end" role="search" data-testid="qualification-filters">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("qualification.employee")}</span>
              <select name="employeeId" defaultValue={sp.employeeId ?? ""} className={select}>
                <option value="">{t("qualification.allEmployees")}</option>
                {data.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("qualification.type")}</span>
              <select name="typeId" defaultValue={sp.typeId ?? ""} className={select}>
                <option value="">{t("qualification.allTypes")}</option>
                {(types ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("employment.status")}</span>
              <select name="validity" defaultValue={sp.validity ?? ""} className={select}>
                <option value="">{t("qualification.allStates")}</option>
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {t(`validity.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-11 rounded-lg border px-4 text-sm font-medium hover:bg-muted md:h-9">
              {t("qualification.filter")}
            </button>
          </form>
          {data.rows.length === 0 ? (
            <EmptyState>{t("qualification.none")}</EmptyState>
          ) : (
            <ul className="divide-y rounded-xl border bg-card" data-testid="all-qualifications">
              {data.rows.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3" data-validity={q.validity}>
                  <div className="min-w-0 flex-1">
                    <Link href={`/c/${companySlug}/workforce/${q.employee.id}?tab=qualifications`} className="font-medium underline-offset-2 hover:underline">
                      {q.employee.name}
                    </Link>
                    <div className="text-sm">{q.name}</div>
                    <div className="text-xs text-muted-foreground">{[q.issuer, q.cardNumber].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="text-right text-sm">
                    <ValidityBadge state={q.validity} label={t(`validity.${q.validity}`)} />
                    <div className="mt-1 text-xs text-muted-foreground tabular-nums">{q.noExpiry ? t("qualification.noExpiry") : fmtDate(format, q.expiresOn)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
