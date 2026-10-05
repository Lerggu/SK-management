import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { commercialDashboardService, customerService, opportunityService } from "@/modules/commercial/crm.service";
import { OPPORTUNITY_STAGES } from "@/modules/commercial/rules";
import { hasPermission } from "@/platform/authz";
import { Button } from "@/ui/components/button";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtMoney } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { createCustomerAction, createOpportunityAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sales"))("title") };
}

export default async function SalesPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  if (!hasPermission(ctx, "crm.view")) notFound();
  const [summary, pipeline, customers, t, format] = await Promise.all([
    loadOr404(commercialDashboardService.summary(ctx)),
    loadOr404(opportunityService.list(ctx)),
    loadOr404(customerService.list(ctx, { q: sp.q })),
    getTranslations("sales"),
    getFormatter(),
  ]);
  const base = `/c/${companySlug}/sales`;
  const money = (v: string) => fmtMoney(format, v, ctx.company.defaultCurrency);
  const manage = hasPermission(ctx, "crm.manage");
  const open = pipeline.rows.filter((o) => o.stage !== "WON" && o.stage !== "LOST");
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        actions={
          summary.quotes && (
            <Button asChild variant="outline">
              <Link href={`${base}/quotes`}>
                <FileText aria-hidden /> {t("quotes")}
              </Link>
            </Button>
          )
        }
      />
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="sales-kpis">
          <Kpi label={t("weightedPipeline")} value={money(summary.weightedPipeline)} hint={t("openCount", { count: summary.openOpportunities })} />
          {summary.quotes && <Kpi label={t("quotesSent")} value={money(summary.quotes.sentValue)} hint={t("sentCount", { count: summary.quotes.sentCount })} />}
          {summary.quotes && <Kpi label={t("awaitingApproval")} value={String(summary.quotes.awaitingApproval)} hint={t("quotesHint")} />}
          {summary.uninvoicedVariations && <Kpi label={t("uninvoicedVariations")} value={money(summary.uninvoicedVariations.value)} hint={t("variationCount", { count: summary.uninvoicedVariations.count })} testId="kpi-uninvoiced" />}
        </div>

        <Section title={t("pipeline")}>
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <div className="grid min-w-[42rem] grid-cols-7 gap-2 text-xs" data-testid="pipeline">
              {pipeline.byStage.map((s) => (
                <div key={s.stage} className="rounded-lg border p-2">
                  <div className="font-medium">{t(`stages.${s.stage}`)}</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{s.count}</div>
                  <div className="text-muted-foreground tabular-nums">{money(s.value)}</div>
                </div>
              ))}
            </div>
          </div>
          {open.length === 0 ? (
            <div className="mt-3">
              <EmptyState>{t("noOpportunities")}</EmptyState>
            </div>
          ) : (
            <div className="mt-3">
              <RowList>
                {open.map((o) => (
                  <RowLink
                    key={o.id}
                    href={`${base}/opportunities/${o.id}`}
                    title={o.title}
                    subtitle={o.customer.name}
                    meta={[o.estimatedValue ? money(o.estimatedValue) : null, o.probabilityPct !== null ? `${o.probabilityPct} %` : null, o.expectedCloseDate ? fmtDate(format, o.expectedCloseDate) : null].filter(Boolean).join(" · ")}
                    badge={<StatusBadge status={o.stage === "NEGOTIATION" || o.stage === "TENDER" ? "PENDING_APPROVAL" : "DRAFT"} label={t(`stages.${o.stage}`)} />}
                  />
                ))}
              </RowList>
            </div>
          )}
        </Section>

        {manage && (
          <Section title={t("newOpportunity")}>
            {customers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("addCustomerFirst")}</p>
            ) : (
              <ActionForm action={createOpportunityAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-3" showSuccess data-testid="opportunity-form">
                <SelectField name="customerId" label={t("customer")} options={customers.map((c) => ({ value: c.id, label: c.name }))} required />
                <TextField name="title" label={t("opportunityTitle")} required className="sm:col-span-2" />
                <SelectField name="stage" label={t("stage")} options={OPPORTUNITY_STAGES.filter((s) => s !== "WON" && s !== "LOST").map((s) => ({ value: s, label: t(`stages.${s}`) }))} defaultValue="LEAD" />
                <TextField name="estimatedValue" label={t("estimatedValue")} inputMode="decimal" />
                <TextField name="probabilityPct" label={t("probability")} type="number" min={0} max={100} inputMode="numeric" />
                <TextField name="expectedCloseDate" label={t("expectedClose")} type="date" />
                <div className="sm:col-span-3">
                  <SubmitButton>{t("addOpportunity")}</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Section>
        )}

        <Section title={t("customers")}>
          <form method="get" className="mb-3 flex gap-2">
            <input name="q" defaultValue={sp.q ?? ""} placeholder={t("searchCustomers")} className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 md:h-9" />
            <button type="submit" className="h-11 rounded-lg border px-4 md:h-9">
              {t("search")}
            </button>
          </form>
          {customers.length === 0 ? (
            <EmptyState>{t("noCustomers")}</EmptyState>
          ) : (
            <RowList>
              {customers.map((c) => (
                <RowLink key={c.id} href={`${base}/customers/${c.id}`} title={c.name} subtitle={[c.businessId, c.city].filter(Boolean).join(" · ")} meta={t("customerCounts", { opportunities: c._count.opportunities, projects: c._count.projects })} />
              ))}
            </RowList>
          )}
        </Section>

        {manage && (
          <Section title={t("newCustomer")}>
            <ActionForm action={createCustomerAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-3" data-testid="customer-form">
              <TextField name="name" label={t("customerName")} required className="sm:col-span-2" />
              <TextField name="businessId" label={t("businessId")} />
              <TextField name="address" label={t("address")} className="sm:col-span-2" />
              <TextField name="city" label={t("city")} />
              <div className="sm:col-span-3">
                <SubmitButton>{t("addCustomer")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4" data-testid={testId}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
