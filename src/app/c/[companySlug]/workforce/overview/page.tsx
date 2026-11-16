import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { hrOverviewService } from "@/modules/hr/overview.service";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { fmtDate } from "@/ui/format";
import { requireCompanyContext } from "@/app/_lib/context";
import { HrTabs } from "../_components/hr/tabs";
import { hrTabsFor, orForbidden } from "../_components/hr/access";
import { SmallBadge, ValidityBadge } from "../_components/hr/badges";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hr.overview"))("title") };
}

function Block({ title, count, children, testId }: { title: string; count: number; children: React.ReactNode; testId: string }) {
  return (
    <Section title={`${title} (${count})`}>
      <div data-testid={testId}>{children}</div>
    </Section>
  );
}

/** HR summary for HR admins, hr.view readers and supervisors (their area of responsibility). */
export default async function HrOverviewPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [tabs, t, format] = await Promise.all([hrTabsFor(ctx), getTranslations("hr"), getFormatter()]);
  const o = await orForbidden(hrOverviewService.overview(ctx));
  const person = (p: { id: string; name: string }, tab?: string) => (
    <Link href={`/c/${companySlug}/workforce/${p.id}${tab ? `?tab=${tab}` : ""}`} className="font-medium underline-offset-2 hover:underline">
      {p.name}
    </Link>
  );
  const nothing = <EmptyState>{t("overview.nothing")}</EmptyState>;
  return (
    <>
      <PageHeader title={t("overview.title")} />
      <HrTabs slug={companySlug} active="overview" show={tabs} />
      {!o ? (
        <EmptyState>{t("basicOnly")}</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Block title={t("overview.expiring")} count={o.expiring.length} testId="overview-expiring">
            {o.expiring.length === 0 ? nothing : (
              <ul className="divide-y text-sm">
                {o.expiring.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                    {person(x.employee, "qualifications")}
                    <span className="flex-1">{x.name}</span>
                    <ValidityBadge state={x.validity} label={t(`validity.${x.validity}`)} />
                    <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(format, x.expiresOn)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
          <Block title={t("overview.gaps")} count={o.gaps.length} testId="overview-gaps">
            {o.gaps.length === 0 ? nothing : (
              <ul className="divide-y text-sm">
                {o.gaps.map((g) => (
                  <li key={g.employee.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {person(g.employee)} <SmallBadge tone="muted">{g.profile.name}</SmallBadge>
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {g.gaps.map((x) => (
                        <li key={x.requirement.id}>
                          {t(`requirements.kinds.${x.requirement.kind}`)}:{" "}
                          {x.requirement.kind === "COMPETENCE" ? o.areaNames[x.requirement.areaId ?? ""] : x.requirement.kind === "QUALIFICATION" ? o.typeNames[x.requirement.qualificationTypeId ?? ""] : x.requirement.orientationTopic} –{" "}
                          {t(`requirements.reasons.${x.reason}`, { level: x.currentLevel ?? 0, min: x.requirement.minLevel ?? 0 })}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Block>
          <Block title={t("overview.upcomingAssessments")} count={o.upcomingAssessments.length} testId="overview-assessments">
            {o.upcomingAssessments.length === 0 ? nothing : (
              <ul className="divide-y text-sm">
                {o.upcomingAssessments.map((x) => (
                  <li key={`${x.employee.id}-${x.areaId}`} className="flex flex-wrap items-center gap-2 py-2">
                    {person(x.employee, "competence")}
                    <span className="flex-1">{o.areaNames[x.areaId]}</span>
                    {x.overdue && <SmallBadge tone="bad">{t("overview.overdue")}</SmallBadge>}
                    <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(format, x.nextAssessmentOn)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
          <Block title={`${t("overview.plannedTrainings")} · ${t("overview.openActions")}`} count={o.plannedTrainings.length + o.openActions.length} testId="overview-actions">
            {o.plannedTrainings.length + o.openActions.length === 0 ? nothing : (
              <ul className="divide-y text-sm">
                {o.plannedTrainings.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                    {person(x.employee, "qualifications")}
                    <span className="flex-1">{x.name}</span>
                    <SmallBadge tone="warn">{t("training.statuses.PLANNED")}</SmallBadge>
                    <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(format, x.plannedOn)}</span>
                  </li>
                ))}
                {o.openActions.map((x) => (
                  <li key={x.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {person(x.employee, "competence")}
                      <span className="flex-1">{o.areaNames[x.areaId]}</span>
                      {x.actionDueOn && <span className="text-xs text-muted-foreground">{t("overview.due", { date: fmtDate(format, x.actionDueOn) })}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {x.agreedActions}
                      {x.actionOwner ? ` · ${x.actionOwner.name}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Block>
          <Block title={t("overview.expiringTrainings")} count={o.expiringTrainings.length} testId="overview-trainings">
            {o.expiringTrainings.length === 0 ? nothing : (
              <ul className="divide-y text-sm">
                {o.expiringTrainings.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                    {person(x.employee, "qualifications")}
                    <span className="flex-1">{x.name}</span>
                    <ValidityBadge state={x.validity} label={t(`validity.${x.validity}`)} />
                    <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(format, x.expiresOn)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
          <Block title={t("overview.openOrientations")} count={o.openOrientations.length} testId="overview-orientations">
            {o.openOrientations.length === 0 ? nothing : (
              <ul className="divide-y text-sm">
                {o.openOrientations.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                    {person(x.employee, "qualifications")}
                    <span className="flex-1">{x.topic}</span>
                    <SmallBadge tone={x.status === "DONE" ? "muted" : "warn"}>{t(`orientation.statuses.${x.status}`)}</SmallBadge>
                    {x.renewalDueOn && <span className="text-xs text-muted-foreground">{t("orientation.renewalDueOn")} {fmtDate(format, x.renewalDueOn)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Block>
          {o.admin && (
            <>
              <Block title={t("overview.itemsToReturn")} count={o.itemsToReturn.length} testId="overview-returns">
                {o.itemsToReturn.length === 0 ? nothing : (
                  <ul className="divide-y text-sm">
                    {o.itemsToReturn.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                        {person(x.employee, "equipment")}
                        <span className="flex-1">
                          {x.name}
                          {x.serialNumber ? ` (${x.serialNumber})` : ""}
                        </span>
                        <span className="text-xs text-muted-foreground">{fmtDate(format, x.endDate)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Block>
              <Block title={t("overview.inspectionsDue")} count={o.inspectionsDue.length} testId="overview-inspections">
                {o.inspectionsDue.length === 0 ? nothing : (
                  <ul className="divide-y text-sm">
                    {o.inspectionsDue.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                        {person(x.employee, "equipment")}
                        <span className="flex-1">{x.name}</span>
                        {x.overdue && <SmallBadge tone="bad">{t("overview.overdue")}</SmallBadge>}
                        <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(format, x.nextInspectionOn)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Block>
            </>
          )}
        </div>
      )}
    </>
  );
}
