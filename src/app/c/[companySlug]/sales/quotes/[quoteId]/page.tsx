import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { quoteService } from "@/modules/commercial/quote.service";
import { QUOTE_LINE_CATEGORIES } from "@/modules/commercial/rules";
import { projectService } from "@/modules/projects/service";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { DetailList, EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtDateTime, fmtMoney, isoDate } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { addQuoteLineAction, decideQuoteAction, quoteOutcomeAction, removeQuoteLineAction, returnQuoteAction, reviseQuoteAction, sendQuoteAction, submitQuoteAction, updateQuoteDraftAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sales"))("quote") };
}

const TONE: Record<string, string> = { SUBMITTED: "PENDING_APPROVAL", SENT: "IN_PROGRESS", WON: "COMPLETE", LOST: "REJECTED" };

export default async function QuotePage({ params }: { params: Promise<{ companySlug: string; quoteId: string }> }) {
  const { companySlug, quoteId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const q = await loadOr404(quoteService.get(ctx, quoteId));
  const [t, tc, format] = await Promise.all([getTranslations("sales"), getTranslations("common"), getFormatter()]);
  const v = q.versions[0];
  const money = (x: string | null) => (x === null ? "–" : fmtMoney(format, x, q.currency));
  const user = (id: string | null) => q.users.find((u) => u.id === id)?.name ?? "–";
  const projects = q.can.outcome ? await projectService.list(ctx) : [];
  const slug = companySlug;
  const base = `/c/${slug}/sales`;
  return (
    <>
      <PageHeader
        title={`${q.quoteNumber} · ${q.title}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={TONE[v.status] ?? v.status} label={`v${v.versionNumber} · ${t(`quoteStatuses.${v.status}`)}`} />
            <Link href={`${base}/customers/${q.customer.id}`} className="hover:underline">
              {q.customer.name}
            </Link>
            {q.project && (
              <Link href={`/c/${slug}/projects/${q.project.id}`} className="hover:underline">
                {q.project.code}
              </Link>
            )}
          </span>
        }
        backHref={`${base}/quotes`}
        backLabel={t("quotes")}
      />
      <div className="space-y-4">
        <Section title={t("pricing")}>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="quote-pricing">
            {(
              [
                ["base", v.pricing.base],
                ["overhead", v.pricing.overhead],
                ["risk", v.pricing.risk],
                ["cost", v.pricing.cost],
                ["margin", v.pricing.margin],
              ] as const
            ).map(([k, val]) => (
              <div key={k} className="flex justify-between border-b py-1">
                <dt className="text-muted-foreground">{t(`price.${k}`)}</dt>
                <dd className="tabular-nums">{money(val)}</dd>
              </div>
            ))}
            <div className="flex justify-between py-1 text-base font-semibold sm:col-span-2">
              <dt>{t("price.price")}</dt>
              <dd className="tabular-nums" data-testid="quote-price">
                {money(v.pricing.price)} {v.pricing.marginPct && <span className="text-sm font-normal text-muted-foreground">({t("price.marginPct", { pct: v.pricing.marginPct })})</span>}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{t("pricingHint", { overhead: v.overheadPct, risk: v.riskPct, margin: v.marginPct })}</p>
        </Section>

        <Section title={t("lines")}>
          {v.lines.length === 0 ? (
            <EmptyState>{t("noLines")}</EmptyState>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
              <table className="w-full min-w-[36rem] text-sm" data-testid="quote-lines">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2">{t("category")}</th>
                    <th className="py-1 pr-2">{t("description")}</th>
                    <th className="py-1 pr-2 text-right">{t("quantity")}</th>
                    <th className="py-1 pr-2 text-right">{t("unitCost")}</th>
                    <th className="py-1 pr-2 text-right">{t("amount")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {v.lines.map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className="py-1 pr-2">{t(`lineCategories.${l.category}`)}</td>
                      <td className="py-1 pr-2">{l.description}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">
                        {format.number(Number(l.quantity))} {l.unit}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{money(l.unitCost)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{money(l.amount)}</td>
                      <td className="py-1 text-right">
                        {q.can.edit && (
                          <ActionButton action={removeQuoteLineAction.bind(null, slug, q.id, l.id)} variant="ghost">
                            {t("remove")}
                          </ActionButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {q.can.edit && (
            <ActionForm action={addQuoteLineAction.bind(null, slug, q.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-6 sm:items-end" data-testid="quote-line-form">
              <SelectField name="category" label={t("category")} options={QUOTE_LINE_CATEGORIES.map((c) => ({ value: c, label: t(`lineCategories.${c}`) }))} defaultValue="LABOR" />
              <TextField name="description" label={t("description")} required className="sm:col-span-2" />
              <TextField name="quantity" label={t("quantity")} inputMode="decimal" required />
              <TextField name="unit" label={t("unit")} defaultValue="h" required />
              <TextField name="unitCost" label={t("unitCost")} inputMode="decimal" required />
              <div className="sm:col-span-6">
                <SubmitButton variant="outline">{t("addLine")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>

        {q.can.edit && (
          <Section title={t("editDraft", { n: v.versionNumber })}>
            <ActionForm action={updateQuoteDraftAction.bind(null, slug, q.id)} className="grid gap-3 sm:grid-cols-4" showSuccess data-testid="quote-draft-form">
              <TextField name="overheadPct" label={t("overheadPct")} inputMode="decimal" defaultValue={v.overheadPct} />
              <TextField name="riskPct" label={t("riskPct")} inputMode="decimal" defaultValue={v.riskPct} />
              <TextField name="marginPct" label={t("marginPct")} inputMode="decimal" defaultValue={v.marginPct} />
              <TextField name="validUntil" label={t("validUntil")} type="date" defaultValue={isoDate(v.validUntil)} />
              <TextareaField name="scope" label={t("scope")} defaultValue={v.scope} className="sm:col-span-4" rows={3} />
              <div className="flex flex-wrap gap-2 sm:col-span-4">
                <SubmitButton>{tc("save")}</SubmitButton>
              </div>
            </ActionForm>
            {q.can.submit && (
              <div className="mt-4 border-t pt-4">
                <ActionButton action={submitQuoteAction.bind(null, slug, q.id)} variant="default">
                  {t("submitQuote")}
                </ActionButton>
                <p className="mt-2 text-xs text-muted-foreground">{t("approverHint")}</p>
              </div>
            )}
          </Section>
        )}

        {v.status !== "DRAFT" && (
          <Section title={t("version", { n: v.versionNumber })}>
            <DetailList
              items={[
                { label: t("scope"), value: v.scope },
                { label: t("validUntil"), value: v.validUntil ? fmtDate(format, v.validUntil) : null },
                { label: t("submitted"), value: v.submittedAt ? `${user(v.submittedById)} · ${fmtDateTime(format, v.submittedAt)}` : null },
                { label: t("decided"), value: v.decidedAt ? `${user(v.decidedById)} · ${fmtDateTime(format, v.decidedAt)}` : null },
                { label: t("decisionNote"), value: v.decisionNote },
                { label: t("changeReason"), value: v.changeReason },
                { label: t("contract"), value: v.contract ? v.contract.contractNumber : null },
              ]}
            />
            {q.can.selfApprovalBlocked && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("selfApprovalBlocked")}</p>}
            {q.can.decide && (
              <ActionForm action={decideQuoteAction.bind(null, slug, q.id)} className="mt-4 space-y-3 border-t pt-4" data-testid="quote-decision-form">
                <TextField name="note" label={t("decisionNote")} />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="decision" value="APPROVE" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9">
                    {t("approveQuote")}
                  </button>
                  <button type="submit" name="decision" value="REJECT" className="h-11 rounded-lg border border-destructive/40 px-4 text-sm text-destructive md:h-9">
                    {t("reject")}
                  </button>
                </div>
              </ActionForm>
            )}
            {q.can.returnToDraft && (
              <ActionForm action={returnQuoteAction.bind(null, slug, q.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <TextField name="note" label={t("returnNote")} />
                <SubmitButton variant="outline">{t("returnToDraft")}</SubmitButton>
              </ActionForm>
            )}
            {q.can.send && (
              <div className="mt-4 border-t pt-4">
                <ActionButton action={sendQuoteAction.bind(null, slug, q.id)} variant="default">
                  {t("markSent")}
                </ActionButton>
              </div>
            )}
            {q.can.outcome && (
              <ActionForm action={quoteOutcomeAction.bind(null, slug, q.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2" data-testid="quote-outcome-form">
                <SelectField name="projectId" label={t("contractProject")} placeholder={t("none")} options={projects.filter((p) => !p.archivedAt).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} defaultValue={q.project?.id ?? null} />
                <TextField name="contractNumber" label={t("contractNumber")} hint={t("contractNumberHint")} />
                <TextField name="signedDate" label={t("signedDate")} type="date" />
                <TextField name="note" label={t("outcomeNote")} />
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <button type="submit" name="outcome" value="WON" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9">
                    {t("won")}
                  </button>
                  <button type="submit" name="outcome" value="LOST" className="h-11 rounded-lg border px-4 text-sm md:h-9">
                    {t("lost")}
                  </button>
                </div>
              </ActionForm>
            )}
            {q.can.revise && (
              <ActionForm action={reviseQuoteAction.bind(null, slug, q.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-end" data-testid="quote-revise-form">
                <TextField name="reason" label={t("changeReason")} required />
                <SubmitButton variant="outline">{t("revise")}</SubmitButton>
              </ActionForm>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{t("lockedHint")}</p>
          </Section>
        )}

        <Section title={t("versions")}>
          <ul className="divide-y text-sm" data-testid="quote-versions">
            {q.versions.map((x) => (
              <li key={x.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                <span className="font-medium">v{x.versionNumber}</span>
                <StatusBadge status={TONE[x.status] ?? x.status} label={t(`quoteStatuses.${x.status}`)} />
                <span className="tabular-nums">{money(x.pricing.price)}</span>
                {x.changeReason && <span className="text-muted-foreground">{x.changeReason}</span>}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
