import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { customerService } from "@/modules/commercial/crm.service";
import { quoteService } from "@/modules/commercial/quote.service";
import { projectService } from "@/modules/projects/service";
import { hasPermission } from "@/platform/authz";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtMoney } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { createQuoteAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sales"))("quotes") };
}

const QUOTE_TONE: Record<string, string> = { SUBMITTED: "PENDING_APPROVAL", SENT: "IN_PROGRESS", WON: "COMPLETE", LOST: "REJECTED" };

export default async function QuotesPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [quotes, t, format] = await Promise.all([loadOr404(quoteService.list(ctx)), getTranslations("sales"), getFormatter()]);
  const manage = hasPermission(ctx, "commercial.manage");
  const [customers, projects] = manage ? await Promise.all([customerService.list(ctx), projectService.list(ctx)]) : [[], []];
  const base = `/c/${companySlug}/sales`;
  return (
    <>
      <PageHeader title={t("quotes")} description={t("quotesIntro")} backHref={base} backLabel={t("title")} />
      <div className="space-y-4">
        <Section title={t("quotes")}>
          {quotes.length === 0 ? (
            <EmptyState>{t("noQuotes")}</EmptyState>
          ) : (
            <RowList>
              {quotes.map((q) => (
                <RowLink
                  key={q.id}
                  href={`${base}/quotes/${q.id}`}
                  title={`${q.quoteNumber} · ${q.title}`}
                  subtitle={[q.customer.name, q.project?.code].filter(Boolean).join(" · ")}
                  meta={[fmtMoney(format, q.price, q.currency), q.validUntil ? t("validUntilShort", { date: fmtDate(format, q.validUntil) }) : null, q.versionNumber ? `v${q.versionNumber}` : null].filter(Boolean).join(" · ")}
                  badge={q.status && <StatusBadge status={QUOTE_TONE[q.status] ?? q.status} label={t(`quoteStatuses.${q.status}`)} />}
                />
              ))}
            </RowList>
          )}
        </Section>
        {manage && (
          <Section title={t("newQuote")}>
            {customers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("addCustomerFirst")}</p>
            ) : (
              <ActionForm action={createQuoteAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-3" data-testid="quote-form">
                <SelectField name="customerId" label={t("customer")} options={customers.map((c) => ({ value: c.id, label: c.name }))} required />
                <TextField name="title" label={t("quoteTitle")} required className="sm:col-span-2" />
                <SelectField name="projectId" label={t("project")} placeholder={t("none")} options={projects.filter((p) => !p.archivedAt).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} />
                <div className="sm:col-span-3">
                  <SubmitButton>{t("createQuote")}</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
