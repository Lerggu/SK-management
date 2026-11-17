import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ExternalLink, Phone, Mail } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { marketingAccess, marketingService } from "@/modules/marketing/service";
import { LEAD_STATUSES, MARKETING_CATEGORIES, MARKETING_SERVICES, MARKETING_STAGES } from "@/modules/marketing/rules";
import { ActionButton, ActionForm, CheckboxGroupField, SelectField, SubmitButton, TextareaField, TextField } from "@/ui/components/form";
import { DetailList, EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtDateTime, fmtMoney } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { LEAD_TONE } from "../_components/tone";
import { addContactAction, archiveContactAction, convertLeadAction, draftForLeadAction, updateLeadAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("marketing"))("lead") };
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function LeadPage({ params }: { params: Promise<{ companySlug: string; leadId: string }> }) {
  const { companySlug, leadId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const access = marketingAccess(ctx);
  if (!access.view) notFound();
  const [lead, t, format] = await Promise.all([loadOr404(marketingService.getLead(ctx, leadId)), getTranslations("marketing"), getFormatter()]);
  const base = `/c/${companySlug}/marketing`;
  const canConvert = access.manage && hasPermission(ctx, "crm.manage");
  return (
    <>
      <PageHeader title={lead.title} description={[t(`categories.${lead.category}`), lead.ownerOrg, [lead.location, lead.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")} backHref={base} backLabel={t("title")} />
      <div className="space-y-4">
        <Section title={t("projectInfo")}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={LEAD_TONE[lead.status]} label={t(`statuses.${lead.status}`)} />
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-sm font-semibold text-primary" data-testid="fit-score">
              {t("fitScore")}: {lead.fitScore}
            </span>
            {lead.services.map((s) => (
              <span key={s} className="rounded-md border px-2 py-0.5 text-xs">
                {t(`services.${s}`)}
              </span>
            ))}
          </div>
          {lead.summary && <p className="mb-3 text-sm">{lead.summary}</p>}
          <DetailList
            items={[
              { label: t("stage"), value: t(`stages.${lead.stage}`) },
              { label: t("ownerOrg"), value: lead.ownerOrg ?? "–" },
              { label: t("location"), value: [lead.location, lead.country].filter(Boolean).join(", ") || "–" },
              { label: t("timing"), value: [lead.timing, lead.startDate ? `${t("startDate")} ${fmtDate(format, lead.startDate)}` : null].filter(Boolean).join(" · ") || "–" },
              { label: t("tenderDeadline"), value: fmtDate(format, lead.tenderDeadline) },
              { label: t("budget"), value: lead.budget ? fmtMoney(format, lead.budget, lead.currency ?? "EUR") : (lead.budgetText ?? "–") },
              { label: t("voltage"), value: lead.voltageKv ? `${lead.voltageKv} kV` : "–" },
              { label: t("fitReason"), value: lead.fitReason ?? "–" },
              { label: t("firstSeen"), value: fmtDateTime(format, lead.firstSeenAt) },
            ]}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {access.manage && (
              <ActionButton action={draftForLeadAction.bind(null, companySlug, lead.id)} showSuccess>
                {t("draftLetters")}
              </ActionButton>
            )}
            {lead.opportunity ? (
              <Link href={`/c/${companySlug}/sales/opportunities/${lead.opportunity.id}`} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm md:min-h-9">
                {t("openOpportunity")}
              </Link>
            ) : (
              canConvert && (
                <ActionButton action={convertLeadAction.bind(null, companySlug, lead.id)} variant="default">
                  {t("convert")}
                </ActionButton>
              )
            )}
          </div>
        </Section>

        <Section title={t("sources")}>
          <ul className="space-y-2 text-sm" data-testid="lead-sources">
            {lead.sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-1.5 text-xs font-medium">{t(`sourceKinds.${s.kind}`)}</span>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 underline">
                    {s.title ?? s.url} <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : (
                  <span>{s.title ?? s.externalId}</span>
                )}
                <span className="text-xs text-muted-foreground">{fmtDate(format, s.publishedAt ?? s.retrievedAt)}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("contacts")}>
          {lead.contacts.length === 0 ? (
            <EmptyState>{t("noContacts")}</EmptyState>
          ) : (
            <ul className="divide-y" data-testid="lead-contacts">
              {lead.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium">{c.name ?? c.organization ?? t("unnamed")}</div>
                    <div className="text-xs text-muted-foreground">{[c.role, c.organization, c.responsibility].filter(Boolean).join(" · ")}</div>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="inline-flex min-h-11 items-center gap-1 underline md:min-h-0">
                          <Mail className="size-4" aria-hidden /> {c.email}
                        </a>
                      )}
                      {c.phone && (
                        <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`} className="inline-flex min-h-11 items-center gap-1 underline md:min-h-0">
                          <Phone className="size-4" aria-hidden /> {c.phone}
                        </a>
                      )}
                      {c.sourceUrl && (
                        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline md:min-h-0">
                          {t("contactSource")} <ExternalLink className="size-3" aria-hidden />
                        </a>
                      )}
                    </div>
                  </div>
                  {access.manage && (
                    <ActionButton action={archiveContactAction.bind(null, companySlug, c.id)} variant="ghost" confirm={t("confirmRemoveContact")}>
                      {t("removeContact")}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {access.manage && (
            <details className="mt-3 rounded-lg border p-3">
              <summary className="min-h-11 cursor-pointer text-sm font-medium md:min-h-0">{t("addContact")}</summary>
              <ActionForm action={addContactAction.bind(null, companySlug, lead.id)} className="mt-3 grid gap-3 sm:grid-cols-2" showSuccess data-testid="contact-form">
                <TextField name="name" label={t("contactName")} />
                <TextField name="role" label={t("contactRole")} />
                <TextField name="organization" label={t("organization")} />
                <TextField name="responsibility" label={t("responsibility")} />
                <TextField name="email" label={t("email")} type="email" inputMode="email" autoCapitalize="none" />
                <TextField name="phone" label={t("phone")} type="tel" inputMode="tel" />
                <TextField name="sourceUrl" label={t("contactSource")} type="url" inputMode="url" className="sm:col-span-2" />
                <div className="sm:col-span-2">
                  <SubmitButton>{t("addContact")}</SubmitButton>
                </div>
              </ActionForm>
            </details>
          )}
        </Section>

        <Section title={t("letters")}>
          {lead.messages.length === 0 ? (
            <EmptyState>{t("noLetters")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm">
              {lead.messages.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="flex-1">
                    {m.subject}
                    <span className="block text-xs text-muted-foreground">
                      {m.contact.name ?? m.contact.email} · {m.sentAt ? fmtDateTime(format, m.sentAt) : fmtDateTime(format, m.createdAt)}
                      {m.callStatus ? ` · ${t(`callStatuses.${m.callStatus}`)}` : ""}
                    </span>
                  </span>
                  <StatusBadge status={m.status === "SENT" ? "COMPLETE" : m.status === "DRAFT" ? "PENDING_APPROVAL" : m.status} label={t(`messageStatuses.${m.status}`)} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {access.manage && (
          <Section title={t("editLead")}>
            <ActionForm action={updateLeadAction.bind(null, companySlug, lead.id)} className="grid gap-3 sm:grid-cols-3" showSuccess data-testid="lead-edit-form">
              <TextField name="title" label={t("leadTitle")} defaultValue={lead.title} required className="sm:col-span-3" />
              <SelectField name="status" label={t("status")} defaultValue={lead.status} options={LEAD_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />
              <SelectField name="category" label={t("category")} defaultValue={lead.category} options={MARKETING_CATEGORIES.map((s) => ({ value: s, label: t(`categories.${s}`) }))} />
              <SelectField name="stage" label={t("stage")} defaultValue={lead.stage} options={MARKETING_STAGES.map((s) => ({ value: s, label: t(`stages.${s}`) }))} />
              <TextField name="ownerOrg" label={t("ownerOrg")} defaultValue={lead.ownerOrg} />
              <TextField name="location" label={t("location")} defaultValue={lead.location} />
              <TextField name="country" label={t("country")} defaultValue={lead.country} maxLength={2} />
              <TextField name="timing" label={t("timing")} defaultValue={lead.timing} />
              <TextField name="startDate" label={t("startDate")} type="date" defaultValue={iso(lead.startDate)} />
              <TextField name="tenderDeadline" label={t("tenderDeadline")} type="date" defaultValue={iso(lead.tenderDeadline)} />
              <TextField name="budget" label={t("budget")} inputMode="decimal" defaultValue={lead.budget ? String(lead.budget) : ""} />
              <TextField name="currency" label={t("currency")} defaultValue={lead.currency} maxLength={3} />
              <TextField name="budgetText" label={t("budgetText")} defaultValue={lead.budgetText} />
              <TextField name="voltageKv" label={t("voltage")} type="number" inputMode="numeric" defaultValue={lead.voltageKv} />
              <TextField name="fitScore" label={t("fitScore")} type="number" min={0} max={100} inputMode="numeric" defaultValue={lead.fitScore} />
              <TextField name="fitReason" label={t("fitReason")} defaultValue={lead.fitReason} />
              <div className="sm:col-span-3">
                <CheckboxGroupField name="services" label={t("servicesLabel")} options={MARKETING_SERVICES.map((s) => ({ value: s, label: t(`services.${s}`) }))} defaultValues={lead.services} />
              </div>
              <TextareaField name="summary" label={t("summary")} defaultValue={lead.summary} rows={4} className="sm:col-span-3" />
              <div className="sm:col-span-3">
                <SubmitButton>{t("save")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
