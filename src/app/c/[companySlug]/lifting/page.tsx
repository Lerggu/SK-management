import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { liftPlanService } from "@/modules/lifting/lift.service";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { Button } from "@/ui/components/button";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SiteDayPicker } from "../logistics/_components/site-day-picker";
import { createLiftPlanAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("lifting"))("title") };
}

type Props = { params: Promise<{ companySlug: string }>; searchParams: Promise<{ site?: string }> };

export default async function LiftingPage({ params, searchParams }: Props) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [sites, t, format] = await Promise.all([liftPlanService.sites(ctx), getTranslations("lifting"), getFormatter()]);
  const base = `/c/${companySlug}/lifting`;
  const header = (
    <PageHeader
      title={t("title")}
      description={t("intro")}
      actions={
        <Button asChild variant="outline">
          <Link href={`${base}/accessories`}>
            <ShieldCheck aria-hidden /> {t("accessories")}
          </Link>
        </Button>
      }
    />
  );
  if (sites.length === 0) {
    return (
      <>
        {header}
        <EmptyState>{t("noSites")}</EmptyState>
      </>
    );
  }
  const siteId = sites.some((s) => s.id === sp.site) ? sp.site! : sites[0].id;
  const [plans, options] = await Promise.all([liftPlanService.list(ctx, { siteId }), loadOr404(liftPlanService.options(ctx, siteId))]);
  const open = plans.filter((p) => p.status === "OPEN");
  const closed = plans.filter((p) => p.status !== "OPEN");
  const today = todayInDisplayZone();
  const badge = (p: (typeof plans)[number]) =>
    p.status !== "OPEN" ? (
      <StatusBadge status={p.status} label={t(`planStatuses.${p.status}`)} />
    ) : (
      <StatusBadge status={p.approved ? "APPROVED" : (p.versionStatus ?? "DRAFT")} label={p.approved ? t("approvedPlan") : t(`versionStatuses.${p.versionStatus ?? "DRAFT"}`)} />
    );
  return (
    <>
      {header}
      <div className="space-y-4">
        <SiteDayPicker sites={sites} siteId={siteId} showDate={false} />
        <Section title={t("openLifts")}>
          {open.length === 0 ? (
            <EmptyState>{t("noLifts")}</EmptyState>
          ) : (
            <RowList>
              {open.map((p) => (
                <RowLink
                  key={p.id}
                  href={`${base}/${p.id}`}
                  title={p.title}
                  subtitle={[p.activity ? `${p.activity.taktArea.code} · ${p.activity.workPackage.code} ${p.activity.name}` : null, p.loadWeightKg ? `${p.loadWeightKg} kg` : null].filter(Boolean).join(" · ")}
                  meta={`${fmtDateTime(format, p.plannedStart)} · v${p.versionNumber}`}
                  badge={badge(p)}
                />
              ))}
            </RowList>
          )}
        </Section>
        {options.permissions.request && (
          <Section title={t("newLift")}>
            <ActionForm action={createLiftPlanAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-2" data-testid="lift-form">
              <input type="hidden" name="siteId" value={siteId} />
              <TextField name="title" label={t("liftTitle")} required className="sm:col-span-2" />
              <TextField name="plannedStart" label={t("plannedStart")} type="datetime-local" step={900} required defaultValue={`${today}T14:00`} />
              <TextField name="plannedEnd" label={t("plannedEnd")} type="datetime-local" step={900} required defaultValue={`${today}T15:00`} />
              <SelectField name="requestId" label={t("liftRequest")} placeholder={t("none")} options={options.requests.map((r) => ({ value: r.id, label: r.title }))} />
              <SelectField name="activityId" label={t("activity")} placeholder={t("none")} options={options.activities.map((a) => ({ value: a.id, label: `${a.taktArea.code} · ${a.workPackage.code} ${a.name}` }))} />
              <div className="sm:col-span-2">
                <SubmitButton>{t("createLift")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
        {closed.length > 0 && (
          <Section title={t("closedLifts")}>
            <RowList>
              {closed.map((p) => (
                <RowLink key={p.id} href={`${base}/${p.id}`} title={p.title} meta={fmtDateTime(format, p.plannedStart)} badge={badge(p)} />
              ))}
            </RowList>
          </Section>
        )}
      </div>
    </>
  );
}
