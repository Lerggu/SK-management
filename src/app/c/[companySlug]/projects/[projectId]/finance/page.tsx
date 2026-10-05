import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { projectPermissions } from "@/platform/authz";
import { budgetService, costService, projectFinanceService } from "@/modules/finance/service";
import { CATEGORIES } from "@/modules/finance/schemas";
import { sumAmounts } from "@/modules/finance/calculations";
import { siteService } from "@/modules/projects/service";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtMoney } from "@/ui/format";
import { cn } from "@/ui/lib/utils";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { activateBudgetAction, addBudgetLineAction, addCostAction, archiveCostAction, createBudgetAction, discardBudgetAction, removeBudgetLineAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("finance"))("title") };
}

export default async function FinancePage({ params }: { params: Promise<{ companySlug: string; projectId: string }> }) {
  const { companySlug, projectId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const summary = await loadOr404(projectFinanceService.summary(ctx, projectId));
  const [versions, costs, sites, t, tc, format] = await Promise.all([
    budgetService.listVersions(ctx, projectId),
    costService.list(ctx, projectId),
    siteService.list(ctx, projectId),
    getTranslations("finance"),
    getTranslations("common"),
    getFormatter(),
  ]);
  const canManage = projectPermissions(ctx, projectId).has("finance.manage");
  const money = (v: { toString(): string }) => fmtMoney(format, v, summary.currency);
  const categoryOptions = CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }));
  const draft = versions.find((v) => v.status === "DRAFT");
  const fmtH = (d: { toString(): string }) => format.number(Number(d.toString()), { maximumFractionDigits: 2 });

  return (
    <>
      <PageHeader title={t("title")} description={`${summary.project.code} · ${summary.project.name}`} backHref={`/c/${companySlug}/projects/${projectId}`} backLabel={summary.project.code} />
      <div className="space-y-4">
        {(summary.warnings.unpricedLaborEntries > 0 || summary.warnings.unpricedEquipmentEntries > 0 || summary.warnings.otherCurrencyCosts > 0) && (
          <div role="alert" className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm" data-testid="finance-warnings">
            {summary.warnings.unpricedLaborEntries > 0 && (
              <p className="flex gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-700" aria-hidden />
                {t("unpricedWarning", { count: summary.warnings.unpricedLaborEntries, hours: fmtH(summary.hours.unpriced) })}
              </p>
            )}
            {summary.warnings.unpricedEquipmentEntries > 0 && <p>{t("unpricedEquipment", { count: summary.warnings.unpricedEquipmentEntries })}</p>}
            {summary.warnings.otherCurrencyCosts > 0 && <p>{t("otherCurrency", { count: summary.warnings.otherCurrencyCosts })}</p>}
          </div>
        )}

        <Section title={t("budgetVsActual")}>
          {!summary.budget && <p className="mb-3 text-sm text-muted-foreground">{t("noBudget")}</p>}
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[34rem] text-sm" data-testid="budget-vs-actual">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 font-medium">{t("category")}</th>
                  <th className="py-2 text-right font-medium">{t("budget")}</th>
                  <th className="py-2 text-right font-medium">{t("actual")}</th>
                  <th className="py-2 text-right font-medium">{t("variance")}</th>
                  <th className="py-2 text-right font-medium">{t("used")}</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.comparison.categories.map((c) => ({ ...c, label: t(`categories.${c.category}`), total: false })), { ...summary.comparison.total, label: t("total"), total: true, category: "TOTAL" }].map((row) => {
                  const over = row.variance.isNegative();
                  return (
                    <tr key={row.category} className={cn("border-b last:border-0", row.total && "font-semibold")} data-category={row.category}>
                      <td className="py-2">{row.label}</td>
                      <td className="py-2 text-right tabular-nums">{money(row.budget)}</td>
                      <td className="py-2 text-right tabular-nums">{money(row.actual)}</td>
                      <td className={cn("py-2 text-right tabular-nums", over && "text-destructive")}>{money(row.variance)}</td>
                      <td className={cn("py-2 text-right tabular-nums", over && "text-destructive")}>{row.usedPercent ? `${format.number(Number(row.usedPercent.toString()), { maximumFractionDigits: 1 })} %` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-muted/60 p-3">
              <dt className="text-xs text-muted-foreground">{t("laborComputed")}</dt>
              <dd className="font-semibold tabular-nums">
                {money(summary.breakdown.laborComputed)} · {t("approvedHours")} {fmtH(summary.hours.approved)} h
              </dd>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <dt className="text-xs text-muted-foreground">{t("equipmentComputed")}</dt>
              <dd className="font-semibold tabular-nums">
                {money(summary.breakdown.equipmentComputed)} · {fmtH(summary.hours.equipmentApproved)} h
              </dd>
            </div>
          </dl>
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
            {summary.workflow.submitted.entries > 0 && <li>{t("pendingApprovals", { count: summary.workflow.submitted.entries, hours: fmtH(summary.workflow.submitted.hours) })}</li>}
            {summary.workflow.draftDiaries > 0 && <li>{t("draftDiaries", { count: summary.workflow.draftDiaries })}</li>}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{t("formula")}</p>
        </Section>

        <Section title={t("versions")}>
          {versions.length === 0 ? (
            <EmptyState>{t("noBudget")}</EmptyState>
          ) : (
            <ul className="space-y-4" data-testid="budget-versions">
              {versions.map((v) => {
                const total = sumAmounts(v.lines.map((l) => l.amount));
                return (
                  <li key={v.id} className="rounded-lg border p-3" data-status={v.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {t("version", { number: v.versionNumber })}
                        {v.versionNumber === 1 ? ` (${t("original")})` : ""}
                      </span>
                      <StatusBadge status={v.status === "ACTIVE" ? "CURRENT" : v.status === "SUPERSEDED" ? "SUPERSEDED" : "DRAFT"} label={t(`statuses.${v.status}`)} />
                      <span className="flex-1 text-sm text-muted-foreground">{v.note}</span>
                      <span className="font-semibold tabular-nums">{fmtMoney(format, total, v.currency)}</span>
                    </div>
                    <ul className="mt-2 divide-y text-sm">
                      {v.lines.map((l) => (
                        <li key={l.id} className="flex min-h-10 items-center gap-2 py-1">
                          <span className="w-28 shrink-0 text-muted-foreground">{t(`categories.${l.category}`)}</span>
                          <span className="flex-1">{l.description}</span>
                          <span className="tabular-nums">{fmtMoney(format, l.amount, v.currency)}</span>
                          {canManage && v.status === "DRAFT" && (
                            <ActionButton action={removeBudgetLineAction.bind(null, companySlug, projectId, l.id)} variant="ghost">
                              {tc("remove")}
                            </ActionButton>
                          )}
                        </li>
                      ))}
                    </ul>
                    {canManage && v.status === "DRAFT" && (
                      <div className="mt-3 space-y-3 border-t pt-3">
                        <ActionForm action={addBudgetLineAction.bind(null, companySlug, projectId, v.id)} className="grid gap-3 sm:grid-cols-[10rem_1fr_9rem_auto] sm:items-end">
                          <SelectField name="category" label={t("category")} defaultValue="LABOR" options={categoryOptions} />
                          <TextField name="description" label={t("description")} required />
                          <TextField name="amount" label={t("amount")} inputMode="decimal" required />
                          <SubmitButton variant="outline">{t("addLine")}</SubmitButton>
                        </ActionForm>
                        <p className="text-xs text-muted-foreground">{t("activateHint")}</p>
                        <div className="flex flex-wrap gap-2">
                          <ActionButton action={activateBudgetAction.bind(null, companySlug, projectId, v.id)} confirm={t("activateHint")} variant="default">
                            {t("activate")}
                          </ActionButton>
                          <ActionButton action={discardBudgetAction.bind(null, companySlug, projectId, v.id)} confirm={tc("confirmArchive")} variant="ghost">
                            {t("discard")}
                          </ActionButton>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {canManage && !draft && (
            <ActionForm action={createBudgetAction.bind(null, companySlug, projectId)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <TextField name="note" label={t("note")} />
              <SubmitButton>{t("newVersion")}</SubmitButton>
              <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2 md:min-h-0">
                <input type="checkbox" name="copyFromCurrent" defaultChecked className="size-5 accent-primary md:size-4" />
                {t("copyFromCurrent")}
              </label>
            </ActionForm>
          )}
        </Section>

        <Section title={t("costs")}>
          {costs.length === 0 ? (
            <EmptyState>{t("noCosts")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="cost-list">
              {costs.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{fmtDate(format, c.entryDate)}</span>
                  <span className="w-28 shrink-0">{t(`categories.${c.category}`)}</span>
                  <span className="min-w-0 flex-1">
                    {c.description}
                    {c.supplier ? ` · ${c.supplier}` : ""}
                    {c.reference ? ` · ${c.reference}` : ""}
                  </span>
                  <span className="font-semibold tabular-nums">{fmtMoney(format, c.amount, c.currency)}</span>
                  {canManage && (
                    <ActionButton action={archiveCostAction.bind(null, companySlug, projectId, c.id)} confirm={tc("confirmArchive")} variant="ghost">
                      {tc("remove")}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <ActionForm action={addCostAction.bind(null, companySlug, projectId)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
              <SelectField name="category" label={t("category")} defaultValue="MATERIALS" options={categoryOptions} />
              <TextField name="entryDate" label={t("entryDate")} type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
              <TextField name="amount" label={t("amount")} inputMode="decimal" required />
              <TextField name="description" label={t("description")} required className="sm:col-span-2" />
              <TextField name="supplier" label={t("supplier")} />
              <TextField name="reference" label={t("reference")} />
              <SelectField name="siteId" label={t("site")} placeholder="–" options={sites.map((s) => ({ value: s.id, label: s.name }))} />
              <input type="hidden" name="currency" value={summary.currency} />
              <div className="flex items-end">
                <SubmitButton>{t("addCost")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>
      </div>
    </>
  );
}
