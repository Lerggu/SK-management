import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { billingSettingsService } from "@/modules/sales/service";
import { ActionForm, CheckboxField, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { updateBillingSettingsAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("invoicing"))("settings.title") };
}

export default async function BillingSettingsPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [t, tc, { settings: s, canEdit, templates }] = await Promise.all([getTranslations("invoicing"), getTranslations("common"), loadOr404(billingSettingsService.get(ctx))]);
  const base = `/c/${companySlug}/invoicing`;
  const S = (k: string) => t(`settings.${k}`);

  if (!canEdit) {
    return (
      <>
        <PageHeader title={S("title")} backHref={base} backLabel={t("title")} />
        <Section title={S("seller")}>
          {s ? (
            <DetailList
              items={[
                { label: S("legalName"), value: s.legalName },
                { label: S("businessId"), value: s.businessId },
                { label: S("address"), value: `${s.streetAddress}, ${s.postalCode} ${s.city}` },
                { label: S("iban"), value: s.ibanFormatted },
                { label: S("paymentTermDays"), value: String(s.paymentTermDays) },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("notEnabled")}</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{S("readOnly")}</p>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader title={S("title")} description={S("intro")} backHref={base} backLabel={t("title")} />
      <ActionForm action={updateBillingSettingsAction.bind(null, companySlug)} className="space-y-4" showSuccess data-testid="billing-settings-form">
        <Section title={S("seller")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField name="legalName" label={S("legalName")} required defaultValue={s?.legalName ?? ctx.company.name} />
            <TextField name="businessId" label={S("businessId")} required defaultValue={s?.businessId} placeholder="1234567-8" />
            <TextField name="vatNumber" label={S("vatNumber")} hint={S("vatNumberHint")} defaultValue={s?.vatNumber} />
            <TextField name="streetAddress" label={S("streetAddress")} required defaultValue={s?.streetAddress} />
            <TextField name="postalCode" label={S("postalCode")} required defaultValue={s?.postalCode} />
            <TextField name="city" label={S("city")} required defaultValue={s?.city} />
            <TextField name="country" label={S("country")} defaultValue={s?.country ?? "Suomi"} />
            <TextField name="domicile" label={S("domicile")} defaultValue={s?.domicile} />
            <TextField name="phone" label={S("phone")} defaultValue={s?.phone} />
            <TextField name="email" label={S("email")} type="email" hint={S("emailHint")} defaultValue={s?.email} />
            <TextField name="website" label={S("website")} defaultValue={s?.website} />
            <SelectField name="logo" label={S("logo")} options={(["SK_INFRA", "NONE"] as const).map((v) => ({ value: v, label: S(`logos.${v}`) }))} defaultValue={s?.logo ?? "SK_INFRA"} />
          </div>
        </Section>

        <Section title={S("bank")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField name="iban" label={S("iban")} required defaultValue={s?.ibanFormatted} placeholder="FI00 0000 0000 0000 00" />
            <TextField name="bic" label={S("bic")} defaultValue={s?.bic} />
            <TextField name="bankName" label={S("bankName")} defaultValue={s?.bankName} />
            <TextField name="einvoiceAddress" label={S("einvoiceAddress")} defaultValue={s?.einvoiceAddress} />
            <TextField name="einvoiceOperator" label={S("einvoiceOperator")} defaultValue={s?.einvoiceOperator} />
          </div>
        </Section>

        <Section title={S("defaults")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField name="paymentTermDays" label={S("paymentTermDays")} inputMode="numeric" defaultValue={s?.paymentTermDays ?? 14} />
            <TextField name="penaltyInterest" label={S("penaltyInterest")} defaultValue={s?.penaltyInterest ?? "Viivästyskorko korkolain mukaan"} />
            <TextField name="defaultVatRate" label={S("defaultVatRate")} inputMode="decimal" defaultValue={s?.defaultVatRate ?? "25.5"} />
            <TextField name="nextOrderNumber" label={S("nextOrderNumber")} inputMode="numeric" required defaultValue={s?.nextOrderNumber ?? 1001} />
            <TextField name="nextInvoiceNumber" label={S("nextInvoiceNumber")} inputMode="numeric" required defaultValue={s?.nextInvoiceNumber ?? 10001} hint={S("numberingHint")} />
            <TextField name="footerNote" label={S("footerNote")} defaultValue={s?.footerNote} />
          </div>
        </Section>

        <Section title={S("terms")}>
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{S("termsHint")}</p>
          <div className="grid gap-3">
            <TextField name="rentalTermsTitle" label={S("rentalTermsTitle")} defaultValue={s?.rentalTermsTitle ?? "VUOKRAUSEHDOT"} />
            <TextareaField name="rentalTerms" label={S("rentalTerms")} rows={14} defaultValue={s?.rentalTerms ?? templates.rental} />
            <TextField name="salesTermsTitle" label={S("salesTermsTitle")} defaultValue={s?.salesTermsTitle ?? "MYYNTIEHDOT"} />
            <TextareaField name="salesTerms" label={S("salesTerms")} rows={14} defaultValue={s?.salesTerms ?? templates.sales} />
          </div>
        </Section>

        <Section title={S("activation")}>
          <CheckboxField name="enabled" label={S("enabled")} defaultChecked={s?.enabled ?? true} />
          <div className="mt-4">
            <SubmitButton>{tc("save")}</SubmitButton>
          </div>
        </Section>
      </ActionForm>
    </>
  );
}
