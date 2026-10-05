import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { opportunityService } from "@/modules/commercial/crm.service";
import { OPPORTUNITY_STAGES } from "@/modules/commercial/rules";
import { isoDate } from "@/ui/format";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { updateOpportunityAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sales"))("opportunity") };
}

export default async function OpportunityPage({ params }: { params: Promise<{ companySlug: string; opportunityId: string }> }) {
  const { companySlug, opportunityId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const o = await loadOr404(opportunityService.get(ctx, opportunityId));
  const [t, tc] = await Promise.all([getTranslations("sales"), getTranslations("common")]);
  const base = `/c/${companySlug}/sales`;
  return (
    <>
      <PageHeader
        title={o.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={o.stage === "WON" ? "APPROVED" : o.stage === "LOST" ? "REJECTED" : "DRAFT"} label={t(`stages.${o.stage}`)} />
            <Link href={`${base}/customers/${o.customer.id}`} className="hover:underline">
              {o.customer.name}
            </Link>
          </span>
        }
        backHref={base}
        backLabel={t("title")}
      />
      <div className="space-y-4">
        {o.quotes.length > 0 && (
          <Section title={t("quotes")}>
            <ul className="divide-y text-sm">
              {o.quotes.map((q) => (
                <li key={q.id}>
                  <Link href={`${base}/quotes/${q.id}`} className="flex min-h-11 items-center gap-2 py-1 hover:underline">
                    {q.quoteNumber} · {q.title}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title={o.permissions.manage ? tc("edit") : t("opportunity")}>
          <ActionForm action={updateOpportunityAction.bind(null, companySlug, o.id)} className="grid gap-3 sm:grid-cols-3" showSuccess data-testid="opportunity-edit-form">
            <input type="hidden" name="customerId" value={o.customerId} />
            <TextField name="title" label={t("opportunityTitle")} required defaultValue={o.title} className="sm:col-span-2" />
            <SelectField name="stage" label={t("stage")} options={OPPORTUNITY_STAGES.map((s) => ({ value: s, label: t(`stages.${s}`) }))} defaultValue={o.stage} />
            <TextField name="estimatedValue" label={t("estimatedValue")} inputMode="decimal" defaultValue={o.estimatedValue} />
            <TextField name="probabilityPct" label={t("probability")} type="number" min={0} max={100} defaultValue={o.probabilityPct} />
            <TextField name="expectedCloseDate" label={t("expectedClose")} type="date" defaultValue={isoDate(o.expectedCloseDate)} />
            <TextField name="lostReason" label={t("lostReason")} defaultValue={o.lostReason} className="sm:col-span-3" />
            <TextField name="notes" label={t("notes")} defaultValue={o.notes} className="sm:col-span-3" />
            {o.permissions.manage && (
              <div className="sm:col-span-3">
                <SubmitButton>{tc("save")}</SubmitButton>
              </div>
            )}
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
