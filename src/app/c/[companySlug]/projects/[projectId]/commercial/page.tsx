import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Receipt } from "lucide-react";
import { contractService, forecastService, variationService } from "@/modules/commercial/project.service";
import { customerService } from "@/modules/commercial/crm.service";
import { hasPermission } from "@/platform/authz";
import { Button } from "@/ui/components/button";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtMoney } from "@/ui/format";
import { cn } from "@/ui/lib/utils";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { addMilestoneAction, createContractAction, createVariationAction, setEtcAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("commercial"))("title") };
}

const VARIATION_TONE: Record<string, string> = { INTERNAL_REVIEW: "PENDING_APPROVAL", SUBMITTED_TO_CLIENT: "PENDING_APPROVAL", APPROVED: "APPROVED", EXECUTED: "IN_PROGRESS", READY_TO_INVOICE: "IN_PROGRESS", INVOICED: "COMPLETE" };

export default async function CommercialPage({ params }: { params: Promise<{ companySlug: string; projectId: string }> }) {
  const { companySlug, projectId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const f = await loadOr404(forecastService.get(ctx, projectId));
  const [contracts, variations, t, tf, format] = await Promise.all([contractService.list(ctx, projectId), variationService.list(ctx, projectId), getTranslations("commercial"), getTranslations("finance"), getFormatter()]);
  const perms = f.permissions;
  const customers = perms.manage && hasPermission(ctx, "crm.view") ? await customerService.list(ctx) : [];
  const money = (v: string | null) => (v === null ? "–" : fmtMoney(format, v, f.currency));
  const base = `/c/${companySlug}/projects/${projectId}`;
  const fc = f.forecast;
  const neg = (v: string | null) => v !== null && v.startsWith("-");
  return (
    <>
      <PageHeader
        title={t("title")}
        description={`${f.project.code} · ${f.project.name}${f.project.customer ? ` · ${f.project.customer.name}` : ""}`}
        backHref={base}
        backLabel={f.project.code}
        actions={
          perms.invoice && (
            <Button asChild variant="outline">
              <Link href={`/c/${companySlug}/billing?project=${projectId}`}>
                <Receipt aria-hidden /> {t("billing")}
              </Link>
            </Button>
          )
        }
      />
      <div className="space-y-4">
        <Section title={t("forecast")}>
          {!f.costVisible && <p className="mb-3 text-xs text-muted-foreground">{t("costHidden")}</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="forecast">
            {(
              [
                ["forecastRevenue", fc.forecastRevenue],
                ["eac", fc.eac],
                ["forecastMargin", fc.forecastMargin],
                ["budgetVariance", fc.budgetVariance],
                ["actualCost", fc.actualCost],
                ["etc", fc.etc],
                ["invoiced", fc.invoiced],
                ["remainingToBill", fc.remainingToBill],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border p-3" data-kpi={k}>
                <div className="text-xs text-muted-foreground">{t(`kpi.${k}`)}</div>
                <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", neg(v) && "text-red-700")}>{money(v)}</div>
                {k === "forecastMargin" && fc.forecastMarginPct && <div className="text-xs text-muted-foreground">{fc.forecastMarginPct} %</div>}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t("forecastHint")}</p>
          {f.etc.length > 0 && (
            <ul className="mt-3 divide-y text-sm">
              {f.etc.map((e) => (
                <li key={e.category} className="flex min-h-9 flex-wrap items-center gap-x-3 py-1">
                  <span className="font-medium">{tf(`categories.${e.category}`)}</span>
                  <span className="tabular-nums">{money(e.etcAmount)}</span>
                  {e.note && <span className="text-muted-foreground">{e.note}</span>}
                  <span className="text-xs text-muted-foreground">{fmtDate(format, e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
          {perms.manage && (
            <ActionForm action={setEtcAction.bind(null, companySlug, projectId)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-4 sm:items-end" showSuccess data-testid="etc-form">
              <SelectField name="category" label={t("category")} options={(["LABOR", "EQUIPMENT", "MATERIALS", "SUBCONTRACT", "OTHER"] as const).map((c) => ({ value: c, label: tf(`categories.${c}`) }))} defaultValue="LABOR" />
              <TextField name="etcAmount" label={t("etcAmount")} inputMode="decimal" required />
              <TextField name="note" label={t("note")} />
              <SubmitButton variant="outline">{t("saveEtc")}</SubmitButton>
            </ActionForm>
          )}
        </Section>

        <Section title={t("variations")} actions={<span className="text-sm text-muted-foreground" data-testid="uninvoiced">{t("uninvoicedValue", { value: money(variations.uninvoicedValue) })}</span>}>
          {variations.rows.length === 0 ? (
            <EmptyState>{t("noVariations")}</EmptyState>
          ) : (
            <RowList>
              {variations.rows.map((v) => (
                <RowLink key={v.id} href={`${base}/commercial/variations/${v.id}`} title={`${t("variationNo", { n: v.number })} · ${v.title}`} meta={money(v.salesPrice)} badge={<StatusBadge status={VARIATION_TONE[v.status] ?? v.status} label={t(`variationStatuses.${v.status}`)} />} />
              ))}
            </RowList>
          )}
          {perms.manage && (
            <ActionForm action={createVariationAction.bind(null, companySlug, projectId)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3" data-testid="variation-form">
              <TextField name="title" label={t("variationTitle")} required className="sm:col-span-2" />
              <SelectField name="contractId" label={t("contract")} placeholder={t("none")} options={contracts.map((c) => ({ value: c.id, label: `${c.contractNumber} · ${c.title}` }))} />
              <TextField name="cause" label={t("cause")} className="sm:col-span-2" />
              <TextField name="clientReference" label={t("clientReference")} />
              <div className="sm:col-span-3">
                <SubmitButton>{t("createVariation")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>

        <Section title={t("contracts")}>
          {contracts.length === 0 ? (
            <EmptyState>{t("noContracts")}</EmptyState>
          ) : (
            <div className="space-y-4" data-testid="contracts">
              {contracts.map((c) => (
                <div key={c.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{c.contractNumber}</span>
                    <span>{c.title}</span>
                    <StatusBadge status={c.status === "ACTIVE" ? "ACTIVE" : "CLOSED"} label={t(`contractStatuses.${c.status}`)} />
                    <span className="ml-auto font-semibold tabular-nums">{money(c.value)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {c.customer.name}
                    {c.signedDate ? ` · ${t("signed")} ${fmtDate(format, c.signedDate)}` : ""}
                  </div>
                  {c.milestones.length > 0 && (
                    <ul className="mt-2 divide-y text-sm">
                      {c.milestones.map((m) => (
                        <li key={m.id} className="flex min-h-9 items-center gap-3 py-1">
                          <span>{m.title}</span>
                          <span className="text-muted-foreground">{fmtDate(format, m.dueDate)}</span>
                          <span className="ml-auto tabular-nums">{money(m.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {perms.manage && c.status === "ACTIVE" && (
                    <ActionForm action={addMilestoneAction.bind(null, companySlug, c.id)} className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-4 sm:items-end">
                      <TextField name="title" label={t("milestone")} required className="sm:col-span-2" />
                      <TextField name="amount" label={t("amount")} inputMode="decimal" required />
                      <TextField name="dueDate" label={t("dueDate")} type="date" required />
                      <div className="sm:col-span-4">
                        <SubmitButton variant="outline">{t("addMilestone")}</SubmitButton>
                      </div>
                    </ActionForm>
                  )}
                </div>
              ))}
            </div>
          )}
          {perms.manage && customers.length > 0 && (
            <ActionForm action={createContractAction.bind(null, companySlug)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3" showSuccess data-testid="contract-form">
              <input type="hidden" name="projectId" value={projectId} />
              <SelectField name="customerId" label={t("customer")} options={customers.map((c) => ({ value: c.id, label: c.name }))} defaultValue={f.project.customer?.id ?? null} />
              <TextField name="contractNumber" label={t("contractNumber")} required />
              <TextField name="value" label={t("value")} inputMode="decimal" required />
              <TextField name="title" label={t("contractTitle")} required className="sm:col-span-2" />
              <TextField name="signedDate" label={t("signedDate")} type="date" />
              <div className="sm:col-span-3">
                <SubmitButton variant="outline">{t("addContract")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>
      </div>
    </>
  );
}
