import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Download, Eye } from "lucide-react";
import { salesDocumentService } from "@/modules/sales/service";
import { VAT_RATES } from "@/modules/sales/rules";
import { projectService } from "@/modules/projects/service";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { DetailList, EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtDateTime, fmtMoney, isoDate } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import {
  addLineAction,
  archiveDraftAction,
  creditNoteAction,
  invoiceFromOrderAction,
  issueDocumentAction,
  removeLineAction,
  sendDocumentAction,
  updateDocumentAction,
  updateLineAction,
  voidDocumentAction,
} from "../actions";
import { TONE, shownStatus } from "../_components/tone";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("invoicing"))("title") };
}

export default async function SalesDocumentPage({ params, searchParams }: { params: Promise<{ companySlug: string; documentId: string }>; searchParams: Promise<{ line?: string }> }) {
  const { companySlug, documentId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const d = await loadOr404(salesDocumentService.get(ctx, documentId));
  const [t, tc, format] = await Promise.all([getTranslations("invoicing"), getTranslations("common"), getFormatter()]);
  const projects = d.can.edit ? (await projectService.list(ctx)).filter((p) => !p.archivedAt) : [];
  const slug = companySlug;
  const base = `/c/${slug}/invoicing`;
  const money = (v: string | null) => fmtMoney(format, v ?? "0", d.currency);
  const user = (id: string | null) => d.users.find((u) => u.id === id)?.name ?? d.users.find((u) => u.id === id)?.email ?? "–";
  const kindLabel = t(`kinds.${d.kind}`);
  const title = d.number ? `${kindLabel} ${d.number}` : `${kindLabel} (${t("draft")})`;
  const status = shownStatus(d);
  const credit = d.kind === "CREDIT_NOTE";
  const editing = d.can.edit ? d.lines.find((l) => l.id === sp.line) ?? null : null;
  const pdfHref = `${base}/${d.id}/pdf`;
  const defaultTo = d.buyerEmail ?? d.contacts[0]?.email ?? "";
  const vatOptions = [...new Set([...VAT_RATES, d.defaultVatRate.replace(/\.0+$/, "")])].map((v) => ({ value: v, label: `${v.replace(".", ",")} %` }));

  return (
    <>
      <PageHeader
        title={title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={TONE[status]} label={t(`statuses.${status}`)} />
            <span>{d.buyerName}</span>
            {d.project && (
              <Link href={`/c/${slug}/projects/${d.project.id}`} className="hover:underline">
                {d.project.code}
              </Link>
            )}
            {d.source && (
              <Link href={`${base}/${d.source.id}`} className="hover:underline">
                {t("basedOn", { kind: t(`kinds.${d.source.kind}`), number: d.source.number ?? "" })}
              </Link>
            )}
          </span>
        }
        backHref={base}
        backLabel={t("title")}
        actions={
          <>
            <a href={pdfHref} target="_blank" rel="noopener" className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm md:h-9" data-testid="pdf-preview">
              <Eye className="size-4" aria-hidden />
              {d.status === "DRAFT" ? t("preview") : t("openPdf")}
            </a>
            <a href={`${pdfHref}?download=1`} className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm md:h-9">
              <Download className="size-4" aria-hidden />
              {t("download")}
            </a>
          </>
        }
      />
      <div className="space-y-4">
        {/* ── lines ── */}
        <Section title={t("lines")}>
          <div id="lines" />
          {d.lines.length === 0 ? (
            <EmptyState>{t("noLines")}</EmptyState>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
              <table className="w-full min-w-[44rem] text-sm" data-testid="invoicing-lines">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2">{t("line.pos")}</th>
                    <th className="py-1 pr-2">{t("line.productCode")}</th>
                    <th className="py-1 pr-2">{t("line.name")}</th>
                    <th className="py-1 pr-2 text-right">{t("line.quantity")}</th>
                    <th className="py-1 pr-2">{t("line.unit")}</th>
                    <th className="py-1 pr-2 text-right">{t("line.unitPrice")}</th>
                    <th className="py-1 pr-2 text-right">{t("line.vatRate")}</th>
                    <th className="py-1 pr-2 text-right">{t("line.discountPct")}</th>
                    <th className="py-1 pr-2 text-right">{t("line.amount")}</th>
                    {d.can.edit && <th />}
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l, i) => (
                    <tr key={l.id} className="border-b align-top">
                      <td className="py-2 pr-2">{i + 1}</td>
                      <td className="py-2 pr-2">{l.productCode ?? "–"}</td>
                      <td className="py-2 pr-2">
                        <div>{l.name}</div>
                        {l.deliveryTime && (
                          <div className="text-xs text-muted-foreground">
                            {t("line.deliveryTime")}: {l.deliveryTime}
                          </div>
                        )}
                        {l.description && <div className="whitespace-pre-line text-xs text-muted-foreground">{l.description}</div>}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{format.number(Number(l.quantity), { maximumFractionDigits: 3 })}</td>
                      <td className="py-2 pr-2">{l.unit}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(l.unitPrice)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{d.vatMode === "REVERSE_CHARGE" ? "0" : format.number(Number(l.vatRate))}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{Number(l.discountPct) ? format.number(Number(l.discountPct)) : ""}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(l.amount)}</td>
                      {d.can.edit && (
                        <td className="py-1 text-right whitespace-nowrap">
                          <Link href={`?line=${l.id}#line-form`} className="inline-flex h-11 items-center px-2 text-sm hover:underline md:h-8">
                            {t("editLine")}
                          </Link>
                          <ActionButton action={removeLineAction.bind(null, slug, l.id)} variant="ghost">
                            {t("removeLine")}
                          </ActionButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <dl className="mt-3 ml-auto max-w-sm space-y-1 text-sm" data-testid="invoicing-totals">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("totals.net")}</dt>
              <dd className="tabular-nums">{money(d.totals.net)}</dd>
            </div>
            {d.totals.groups.map((g) => (
              <div key={g.rate} className="flex justify-between">
                <dt className="text-muted-foreground">{t("totals.vatAt", { rate: format.number(Number(g.rate)) })}</dt>
                <dd className="tabular-nums">{money(g.vat)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t pt-1 text-base font-semibold">
              <dt>{t("totals.gross")}</dt>
              <dd className="tabular-nums" data-testid="invoicing-gross">
                {money(d.totals.gross)}
              </dd>
            </div>
          </dl>

          {d.can.edit && (
            <ActionForm
              key={editing?.id ?? "new"}
              action={editing ? updateLineAction.bind(null, slug, d.id, editing.id) : addLineAction.bind(null, slug, d.id)}
              className="mt-4 grid scroll-mt-24 gap-3 border-t pt-4 sm:grid-cols-6 sm:items-end"
              id="line-form"
              data-testid="invoicing-line-form"
            >
              <TextField name="productCode" label={t("line.productCode")} defaultValue={editing?.productCode} />
              <TextField name="name" label={t("line.name")} required defaultValue={editing?.name} className="sm:col-span-3" />
              <TextField name="quantity" label={t("line.quantity")} inputMode="decimal" required defaultValue={editing?.formQuantity} />
              <TextField name="unit" label={t("line.unit")} defaultValue={editing?.unit ?? "kpl"} list="units" />
              <TextField name="unitPrice" label={t("line.unitPriceExcl")} inputMode="decimal" required defaultValue={editing?.unitPrice} />
              <TextField name="discountPct" label={t("line.discountPct")} inputMode="decimal" defaultValue={editing ? editing.discountPct : "0"} />
              <SelectField name="vatRate" label={t("line.vatRate")} options={vatOptions} defaultValue={editing ? editing.vatRate.replace(/\.0+$/, "") : d.defaultVatRate.replace(/\.0+$/, "")} />
              <TextField name="deliveryTime" label={t("line.deliveryTime")} hint={t("line.deliveryTimeHint")} defaultValue={editing?.deliveryTime} className="sm:col-span-3" />
              <TextareaField name="description" label={t("line.description")} rows={3} defaultValue={editing?.description} className="sm:col-span-6" />
              <datalist id="units">
                {["kpl", "m", "km", "kg", "t", "h", "pv", "vko", "kk", "erä", "rll", "m²", "m³", "l"].map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              {credit && <p className="text-xs text-muted-foreground sm:col-span-6">{t("creditHint")}</p>}
              <div className="flex flex-wrap gap-2 sm:col-span-6">
                <SubmitButton variant="outline">{editing ? t("saveLine") : t("addLine")}</SubmitButton>
                {editing && (
                  <Link href={`${base}/${d.id}#lines`} className="inline-flex h-11 items-center rounded-lg px-4 text-sm hover:underline md:h-9">
                    {tc("cancel")}
                  </Link>
                )}
              </div>
            </ActionForm>
          )}
        </Section>

        {/* ── send / issue ── */}
        {(d.can.send || d.can.issue) && (
          <Section title={d.status === "DRAFT" ? t("sendTitle") : t("resendTitle")}>
            {!d.can.mailConfigured && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("mailNotConfigured")}</p>}
            {d.can.send && d.can.mailConfigured && (
              <ActionForm action={sendDocumentAction.bind(null, slug, d.id)} className="grid gap-3 sm:grid-cols-2" showSuccess data-testid="invoicing-send-form">
                <TextField name="to" label={t("send.to")} type="email" required defaultValue={defaultTo} list="contact-emails" />
                <datalist id="contact-emails">
                  {d.contacts.map((c) => (
                    <option key={c.id} value={c.email}>
                      {c.name}
                    </option>
                  ))}
                </datalist>
                <TextField name="cc" label={t("send.cc")} hint={t("send.ccHint")} />
                <TextField name="subject" label={t("send.subject")} hint={d.defaultSubject ? t("send.subjectHint", { subject: d.defaultSubject }) : t("send.subjectDraftHint")} className="sm:col-span-2" />
                <TextareaField name="message" label={t("send.message")} hint={t("send.messageHint")} rows={4} className="sm:col-span-2" />
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <SubmitButton>{d.status === "DRAFT" ? t("send.issueAndSend") : t("send.resend")}</SubmitButton>
                  {d.status === "DRAFT" && <span className="text-xs text-muted-foreground">{t("issueHint")}</span>}
                </div>
              </ActionForm>
            )}
            {d.can.issue && (
              <div className={d.can.mailConfigured ? "mt-4 border-t pt-4" : ""}>
                <ActionButton action={issueDocumentAction.bind(null, slug, d.id)} confirm={t("issueConfirm")}>
                  {t("issueOnly")}
                </ActionButton>
              </div>
            )}
          </Section>
        )}

        {/* ── header details ── */}
        {d.can.edit ? (
          <Section title={t("details")}>
            <ActionForm action={updateDocumentAction.bind(null, slug, d.id)} className="space-y-6" showSuccess data-testid="invoicing-header-form">
              <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <legend className="mb-2 text-sm font-semibold">{t("groups.buyer")}</legend>
                <TextField name="buyerName" label={t("fields.buyerName")} required defaultValue={d.buyerName} className="lg:col-span-2" />
                <TextField name="buyerCustomerNumber" label={t("fields.buyerCustomerNumber")} defaultValue={d.buyerCustomerNumber} />
                <TextareaField name="buyerAddress" label={t("fields.buyerAddress")} rows={2} defaultValue={d.buyerAddress} />
                <TextField name="buyerPostalCode" label={t("fields.buyerPostalCode")} defaultValue={d.buyerPostalCode} />
                <TextField name="buyerCity" label={t("fields.buyerCity")} defaultValue={d.buyerCity} />
                <TextField name="buyerCountry" label={t("fields.buyerCountry")} defaultValue={d.buyerCountry} />
                <TextField name="buyerBusinessId" label={t("fields.buyerBusinessId")} defaultValue={d.buyerBusinessId} />
                <TextField name="buyerVatNumber" label={t("fields.buyerVatNumber")} defaultValue={d.buyerVatNumber} />
                <TextField name="buyerContact" label={t("fields.buyerContact")} defaultValue={d.buyerContact} />
                <TextField name="buyerEmail" label={t("fields.buyerEmail")} type="email" defaultValue={d.buyerEmail} className="lg:col-span-2" />
              </fieldset>
              <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <legend className="mb-2 text-sm font-semibold">{t("groups.delivery")}</legend>
                <TextField name="deliveryMethod" label={t("fields.deliveryMethod")} defaultValue={d.deliveryMethod} hint={t("fields.deliveryMethodHint")} />
                <TextField name="deliveryTerms" label={t("fields.deliveryTerms")} defaultValue={d.deliveryTerms} hint={t("fields.deliveryTermsHint")} />
                <TextField name="deliveryDate" label={d.kind === "ORDER_CONFIRMATION" ? t("fields.deliveryTime") : t("fields.deliveryDate")} type="date" defaultValue={isoDate(d.deliveryDate)} />
                <TextField name="deliveryInfo" label={t("fields.deliveryInfo")} defaultValue={d.deliveryInfo} />
                <TextField name="deliveryText" label={t("fields.deliveryText")} defaultValue={d.deliveryText} className="lg:col-span-2" />
                <TextareaField name="deliveryAddress" label={t("fields.deliveryAddress")} hint={t("fields.deliveryAddressHint")} rows={3} defaultValue={d.deliveryAddress} className="sm:col-span-2 lg:col-span-3" />
              </fieldset>
              <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <legend className="mb-2 text-sm font-semibold">{t("groups.references")}</legend>
                <TextField name="salesperson" label={t("fields.salesperson")} defaultValue={d.salesperson} />
                <TextField name="ourReference" label={t("fields.ourReference")} defaultValue={d.ourReference} />
                <TextField name="buyerOrderNumber" label={t("fields.buyerOrderNumber")} defaultValue={d.buyerOrderNumber} />
                <TextField name="buyerReference" label={t("fields.buyerReference")} defaultValue={d.buyerReference} />
                <TextField name="orderMark" label={t("fields.orderMark")} defaultValue={d.orderMark} />
                <SelectField name="projectId" label={t("fields.project")} placeholder={t("none")} options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} defaultValue={d.project?.id ?? null} />
              </fieldset>
              <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <legend className="mb-2 text-sm font-semibold">{t("groups.payment")}</legend>
                <TextField name="title" label={t("fields.title")} defaultValue={d.title} className="sm:col-span-2 lg:col-span-3" />
                <TextField name="issueDate" label={t("fields.issueDate")} type="date" required defaultValue={isoDate(d.issueDate)} />
                {d.kind !== "ORDER_CONFIRMATION" && <TextField name="dueDate" label={t("fields.dueDate")} type="date" defaultValue={isoDate(d.dueDate)} />}
                <TextField name="paymentTerms" label={t("fields.paymentTerms")} defaultValue={d.paymentTerms} />
                <SelectField name="vatMode" label={t("fields.vatMode")} options={(["STANDARD", "REVERSE_CHARGE"] as const).map((v) => ({ value: v, label: t(`vatModes.${v}`) }))} defaultValue={d.vatMode} />
                <SelectField name="language" label={t("fields.language")} options={(["fi", "en"] as const).map((v) => ({ value: v, label: t(`languages.${v}`) }))} defaultValue={d.language} />
                <TextareaField name="notes" label={t("fields.notes")} rows={3} defaultValue={d.notes} className="sm:col-span-2 lg:col-span-3" />
              </fieldset>
              <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <legend className="mb-2 text-sm font-semibold">{t("groups.terms")}</legend>
                <SelectField name="termsType" label={t("fields.termsType")} options={(["RENTAL", "SALE", "NONE"] as const).map((v) => ({ value: v, label: t(`termsTypes.${v}`) }))} defaultValue={d.termsType} hint={t("fields.termsTypeHint")} />
                <TextField name="termsTitle" label={t("fields.termsTitle")} defaultValue={d.termsTitle} className="lg:col-span-2" />
                <TextareaField name="terms" label={t("fields.terms")} rows={8} defaultValue={d.terms} className="sm:col-span-2 lg:col-span-3" />
              </fieldset>
              <SubmitButton>{tc("save")}</SubmitButton>
            </ActionForm>
          </Section>
        ) : (
          <Section title={t("details")}>
            <DetailList
              items={[
                { label: t("fields.issueDate"), value: fmtDate(format, d.issueDate) },
                { label: t("fields.dueDate"), value: d.dueDate && d.kind !== "ORDER_CONFIRMATION" ? fmtDate(format, d.dueDate) : null },
                { label: t("referenceNumber"), value: d.referenceNumberFormatted },
                { label: t("fields.buyerName"), value: d.buyerName },
                { label: t("fields.buyerOrderNumber"), value: d.buyerOrderNumber },
                { label: t("fields.buyerReference"), value: d.buyerReference },
                { label: t("fields.salesperson"), value: d.salesperson },
                { label: t("fields.termsType"), value: t(`termsTypes.${d.termsType}`) },
                { label: t("issued"), value: d.issuedAt ? `${user(d.issuedById)} · ${fmtDateTime(format, d.issuedAt)}` : null },
                { label: t("voided"), value: d.voidedAt ? `${user(d.voidedById)} · ${fmtDateTime(format, d.voidedAt)} · ${d.voidReason ?? ""}` : null },
                { label: "SHA-256", value: d.pdfSha256 ? <code className="text-xs break-all">{d.pdfSha256}</code> : null },
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">{t("lockedHint")}</p>
          </Section>
        )}

        {/* ── follow-ups ── */}
        {(d.can.invoiceFromOrder || d.can.creditNote || d.can.void || d.can.archive || d.derived.length > 0) && (
          <Section title={t("actions")}>
            <div className="flex flex-wrap gap-2">
              {d.can.invoiceFromOrder && (
                <ActionButton action={invoiceFromOrderAction.bind(null, slug, d.id)} variant="default">
                  {t("invoiceFromOrder")}
                </ActionButton>
              )}
              {d.can.creditNote && <ActionButton action={creditNoteAction.bind(null, slug, d.id)}>{t("creditNote")}</ActionButton>}
              {d.can.archive && (
                <ActionButton action={archiveDraftAction.bind(null, slug, d.id)} variant="ghost" confirm={t("archiveConfirm")}>
                  {t("archive")}
                </ActionButton>
              )}
            </div>
            {d.can.void && (
              <ActionForm action={voidDocumentAction.bind(null, slug, d.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <TextField name="reason" label={t("voidReason")} required />
                <SubmitButton variant="outline">{t("void")}</SubmitButton>
              </ActionForm>
            )}
            {d.derived.length > 0 && (
              <ul className="mt-4 space-y-1 border-t pt-3 text-sm">
                {d.derived.map((x) => (
                  <li key={x.id}>
                    <Link href={`${base}/${x.id}`} className="hover:underline">
                      {t("madeFrom", { kind: t(`kinds.${x.kind}`), number: x.number ?? `(${t("draft")})` })}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {d.sends.length > 0 && (
          <Section title={t("history")}>
            <ul className="divide-y text-sm" data-testid="invoicing-sends">
              {d.sends.map((x) => (
                <li key={x.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                  <span className="tabular-nums text-muted-foreground">{fmtDateTime(format, x.sentAt)}</span>
                  <span>{x.toEmail}</span>
                  {x.ccEmails.length > 0 && <span className="text-muted-foreground">cc {x.ccEmails.join(", ")}</span>}
                  <span className="text-muted-foreground">{user(x.sentById)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </>
  );
}
