import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { customerService } from "@/modules/commercial/crm.service";
import { ActionButton, ActionForm, SubmitButton, TextField } from "@/ui/components/form";
import { DetailList, EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtMoney } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { addContactAction, archiveContactAction, updateCustomerAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sales"))("customer") };
}

export default async function CustomerPage({ params }: { params: Promise<{ companySlug: string; customerId: string }> }) {
  const { companySlug, customerId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const c = await loadOr404(customerService.get(ctx, customerId));
  const [t, tc, format] = await Promise.all([getTranslations("sales"), getTranslations("common"), getFormatter()]);
  const base = `/c/${companySlug}`;
  return (
    <>
      <PageHeader title={c.name} description={[c.businessId, c.city].filter(Boolean).join(" · ")} backHref={`${base}/sales`} backLabel={t("title")} />
      <div className="space-y-4">
        <Section title={t("customer")}>
          <DetailList
            items={[
              { label: t("businessId"), value: c.businessId },
              { label: t("address"), value: [c.address, c.postalCode, c.city].filter(Boolean).join(", ") || null },
              { label: t("notes"), value: c.notes },
            ]}
          />
        </Section>
        <Section title={t("contacts")}>
          {c.contacts.length === 0 ? (
            <EmptyState>{t("noContacts")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="contacts">
              {c.contacts.map((p) => (
                <li key={p.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                  <span className="font-medium">{p.name}</span>
                  {p.title && <span className="text-muted-foreground">{p.title}</span>}
                  {p.email && <a href={`mailto:${p.email}`} className="text-primary hover:underline">{p.email}</a>}
                  {p.phone && <a href={`tel:${p.phone}`} className="text-primary hover:underline">{p.phone}</a>}
                  {c.permissions.manage && (
                    <ActionButton action={archiveContactAction.bind(null, companySlug, p.id)} variant="ghost" className="ml-auto">
                      {tc("archive")}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {c.permissions.manage && (
            <ActionForm action={addContactAction.bind(null, companySlug, c.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-4 sm:items-end" showSuccess>
              <TextField name="name" label={t("contactName")} required />
              <TextField name="title" label={t("contactTitle")} />
              <TextField name="email" label={t("email")} type="email" />
              <TextField name="phone" label={t("phone")} type="tel" />
              <div className="sm:col-span-4">
                <SubmitButton variant="outline">{t("addContact")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>
        <Section title={t("opportunities")}>
          {c.opportunities.length === 0 ? (
            <EmptyState>{t("noOpportunities")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm">
              {c.opportunities.map((o) => (
                <li key={o.id}>
                  <Link href={`${base}/sales/opportunities/${o.id}`} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1 hover:underline">
                    <StatusBadge status={o.stage === "WON" ? "APPROVED" : o.stage === "LOST" ? "REJECTED" : "DRAFT"} label={t(`stages.${o.stage}`)} />
                    <span className="font-medium">{o.title}</span>
                    {o.estimatedValue && <span className="text-muted-foreground">{fmtMoney(format, o.estimatedValue, o.currency)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {c.projects.length > 0 && (
          <Section title={t("projects")}>
            <ul className="divide-y text-sm">
              {c.projects.map((p) => (
                <li key={p.id}>
                  <Link href={`${base}/projects/${p.id}`} className="flex min-h-11 items-center gap-2 py-1 hover:underline">
                    {p.code} · {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {c.permissions.manage && (
          <Section title={tc("edit")}>
            <ActionForm action={updateCustomerAction.bind(null, companySlug, c.id)} className="grid gap-3 sm:grid-cols-3" showSuccess>
              <TextField name="name" label={t("customerName")} required defaultValue={c.name} className="sm:col-span-2" />
              <TextField name="businessId" label={t("businessId")} defaultValue={c.businessId} />
              <TextField name="address" label={t("address")} defaultValue={c.address} />
              <TextField name="postalCode" label={t("postalCode")} defaultValue={c.postalCode} />
              <TextField name="city" label={t("city")} defaultValue={c.city} />
              <TextField name="notes" label={t("notes")} defaultValue={c.notes} className="sm:col-span-3" />
              <div className="sm:col-span-3">
                <SubmitButton>{tc("save")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
