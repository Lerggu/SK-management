import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { invoiceService } from "@/modules/commercial/invoice.service";
import { projectService } from "@/modules/projects/service";
import { hasPermission, projectIdsWithPermission } from "@/platform/authz";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { ActionButton, ActionForm, CheckboxField, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtDateTime, fmtMoney } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { exportAction, generateAction, generateInternalAction, markInvoicedAction, voidCandidateAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("title") };
}

const TONE: Record<string, string> = { OPEN: "PENDING_APPROVAL", EXPORTED: "IN_PROGRESS", INVOICED: "COMPLETE", VOID: "ARCHIVED" };

export default async function BillingPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ project?: string; exported?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [t, format] = await Promise.all([getTranslations("billing"), getFormatter()]);
  const allowed = projectIdsWithPermission(ctx, "invoice.manage");
  const projects = (await projectService.list(ctx)).filter((p) => !p.archivedAt && (allowed === undefined || allowed.includes(p.id)));
  const projectId = projects.some((p) => p.id === sp.project) ? sp.project! : null;
  const company = hasPermission(ctx, "invoice.manage");
  const [candidates, exports, internal, incoming] = await Promise.all([
    loadOr404(invoiceService.list(ctx, { projectId })),
    company ? invoiceService.listExports(ctx) : Promise.resolve([]),
    company ? invoiceService.list(ctx, { kind: "INTERNAL" }) : Promise.resolve([]),
    company ? invoiceService.incomingInternal(ctx) : Promise.resolve([]),
  ]);
  const cur = ctx.company.defaultCurrency;
  const money = (v: string) => fmtMoney(format, v, cur);
  const sum = (rows: { amount: string; status: string }[], status: string) => rows.filter((r) => r.status === status).reduce((a, r) => a + Number(r.amount), 0);
  const slug = companySlug;
  const projectOptions = projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));
  const exportedRows = candidates.filter((c) => c.status === "EXPORTED");
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <div className="space-y-4">
        <form method="get" className="flex flex-wrap items-end gap-2 text-sm" data-testid="billing-project-picker">
          <label className="min-w-0 flex-1 space-y-1 sm:flex-none">
            <span className="block font-medium">{t("project")}</span>
            <select name="project" defaultValue={projectId ?? ""} className="h-11 w-full rounded-lg border bg-background px-3 md:h-9 sm:w-72">
              <option value="">{t("allProjects")}</option>
              {projectOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-11 rounded-lg border px-4 md:h-9">
            {t("show")}
          </button>
        </form>

        <div className="grid gap-3 sm:grid-cols-3" data-testid="billing-kpis">
          {(["OPEN", "EXPORTED", "INVOICED"] as const).map((s) => (
            <div key={s} className="rounded-xl border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`statuses.${s}`)}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{money(String(sum(candidates, s)))}</div>
            </div>
          ))}
        </div>

        <Section title={t("generate")}>
          <ActionForm action={generateAction.bind(null, slug)} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" showSuccess data-testid="generate-form">
            <SelectField name="projectId" label={t("project")} options={projectOptions} defaultValue={projectId} required />
            <TextField name="to" label={t("until")} type="date" defaultValue={todayInDisplayZone()} required />
            <SubmitButton>{t("generateButton")}</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-muted-foreground">{t("generateHint")}</p>
        </Section>

        <Section title={t("candidates")}>
          {candidates.length === 0 ? (
            <EmptyState>{t("noCandidates")}</EmptyState>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
              <table className="w-full min-w-[44rem] text-sm" data-testid="candidates">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2">{t("status")}</th>
                    <th className="py-1 pr-2">{t("source")}</th>
                    <th className="py-1 pr-2">{t("description")}</th>
                    <th className="py-1 pr-2">{t("date")}</th>
                    <th className="py-1 pr-2 text-right">{t("quantity")}</th>
                    <th className="py-1 pr-2 text-right">{t("unitPrice")}</th>
                    <th className="py-1 pr-2 text-right">{t("amount")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.id} className="border-b" data-source={c.sourceType} data-status={c.status}>
                      <td className="py-1 pr-2">
                        <StatusBadge status={TONE[c.status]} label={t(`statuses.${c.status}`)} />
                      </td>
                      <td className="py-1 pr-2">{t(`sources.${c.sourceType}`)}</td>
                      <td className="py-1 pr-2">
                        {c.project?.code} {c.description}
                        {c.invoiceReference && <span className="text-muted-foreground"> · {c.invoiceReference}</span>}
                      </td>
                      <td className="py-1 pr-2 tabular-nums">{fmtDate(format, c.periodDate)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">
                        {format.number(Number(c.quantity))} {c.unit}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{money(c.unitPrice)}</td>
                      <td className="py-1 pr-2 text-right font-medium tabular-nums">{money(c.amount)}</td>
                      <td className="py-1 text-right">
                        {c.status === "OPEN" && (
                          <ActionButton action={voidCandidateAction.bind(null, slug, c.id)} variant="ghost" confirm={t("confirmVoid")}>
                            {t("void")}
                          </ActionButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={t("export")}>
          <ActionForm action={exportAction.bind(null, slug)} className="grid gap-3 sm:grid-cols-3 sm:items-end" data-testid="export-form">
            <input type="hidden" name="kind" value="CUSTOMER" />
            {projectId && <input type="hidden" name="projectId" value={projectId} />}
            <SelectField name="format" label={t("format")} options={[{ value: "CSV", label: t("formats.CSV") }, { value: "JSON", label: t("formats.JSON") }]} defaultValue="CSV" />
            <CheckboxField name="includeExported" label={t("includeExported")} />
            <SubmitButton>{t("exportButton")}</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-muted-foreground">{t("exportHint")}</p>
          {exportedRows.length > 0 && (
            <ActionForm action={markInvoicedAction.bind(null, slug)} className="mt-4 space-y-3 border-t pt-4" showSuccess data-testid="invoiced-form">
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">{t("markInvoiced")}</legend>
                {exportedRows.map((c) => (
                  <label key={c.id} className="flex min-h-11 items-center gap-3 text-sm md:min-h-9">
                    <input type="checkbox" name="ids" value={c.id} defaultChecked className="size-5 accent-primary md:size-4" />
                    <span>
                      {c.project?.code} {c.description} · {money(c.amount)}
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <TextField name="invoiceReference" label={t("invoiceReference")} required />
                <SubmitButton variant="outline">{t("markInvoicedButton")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>

        {company && (
          <Section title={t("exports")}>
            {exports.length === 0 ? (
              <EmptyState>{t("noExports")}</EmptyState>
            ) : (
              <ul className="divide-y text-sm" data-testid="exports">
                {exports.map((b) => (
                  <li key={b.id} className={b.id === sp.exported ? "flex min-h-11 flex-wrap items-center gap-x-3 bg-emerald-50 py-1" : "flex min-h-11 flex-wrap items-center gap-x-3 py-1"}>
                    <a href={`/c/${slug}/billing/exports/${b.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline" data-export={b.id}>
                      <Download className="size-4" aria-hidden /> {b.fileName}
                    </a>
                    <span>{t(`kinds.${b.kind}`)}</span>
                    <span className="tabular-nums">{t("rows", { count: b.rowCount })} · {fmtMoney(format, b.total, b.currency)}</span>
                    {b.reexport && <StatusBadge status="PENDING_APPROVAL" label={t("reexport")} />}
                    <span className="text-xs text-muted-foreground">{fmtDateTime(format, b.createdAt)}</span>
                    <code className="w-full truncate text-[11px] text-muted-foreground" title={b.sha256}>
                      SHA-256 {b.sha256}
                    </code>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {company && (
          <Section title={t("internal")}>
            <p className="mb-3 text-sm text-muted-foreground">{t("internalIntro")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <ActionForm action={generateInternalAction.bind(null, slug)} className="flex flex-wrap items-end gap-3" showSuccess data-testid="internal-generate-form">
                <TextField name="to" label={t("until")} type="date" defaultValue={todayInDisplayZone()} required />
                <SubmitButton variant="outline">{t("generateInternal")}</SubmitButton>
              </ActionForm>
              {internal.some((c) => c.status === "OPEN") && (
                <ActionForm action={exportAction.bind(null, slug)} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="kind" value="INTERNAL" />
                  <input type="hidden" name="format" value="CSV" />
                  <SubmitButton variant="outline">{t("exportInternal")}</SubmitButton>
                </ActionForm>
              )}
            </div>
            {internal.length > 0 && (
              <ul className="mt-3 divide-y text-sm" data-testid="internal-candidates">
                {internal.map((c) => (
                  <li key={c.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                    <StatusBadge status={TONE[c.status]} label={t(`statuses.${c.status}`)} />
                    <span>{c.description}</span>
                    <span className="text-muted-foreground">{c.billToCompany?.name}</span>
                    <span className="ml-auto tabular-nums">
                      {format.number(Number(c.quantity))} {c.unit} × {money(c.unitPrice)} = <b>{money(c.amount)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="mt-5 text-sm font-medium">{t("incoming")}</h3>
            {incoming.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">–</p>
            ) : (
              <ul className="mt-1 divide-y text-sm" data-testid="incoming-internal">
                {incoming.map((c) => (
                  <li key={c.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                    <span className="font-medium">{c.company.name}</span>
                    <span>{c.description}</span>
                    <span className="ml-auto tabular-nums">{money(c.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
