import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { hasPermission } from "@/platform/authz";
import { companyAdminService } from "@/modules/companies/service";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { requireCompanyContext } from "@/app/_lib/context";
import { SettingsNav } from "./_components/settings-nav";
import { updateCompanyAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("title") };
}

export default async function SettingsPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [company, t, tc, tco, tl] = await Promise.all([companyAdminService.getSettings(ctx), getTranslations("settings"), getTranslations("common"), getTranslations("companies"), getTranslations("locale")]);
  return (
    <>
      <PageHeader title={t("title")} description={company.name} />
      <SettingsNav ctx={ctx} active="company" />
      <Section title={t("company")}>
        {hasPermission(ctx, "company.manage") ? (
          <ActionForm action={updateCompanyAction.bind(null, companySlug)} className="grid gap-4 sm:grid-cols-2" showSuccess>
            <TextField name="name" label={tco("name")} defaultValue={company.name} required />
            <TextField name="businessId" label={tco("businessId")} defaultValue={company.businessId} />
            <SelectField name="defaultLocale" label={t("defaultLocale")} defaultValue={company.defaultLocale} options={[{ value: "fi", label: tl("fi") }, { value: "en", label: tl("en") }]} />
            <div className="sm:col-span-2">
              <SubmitButton>{tc("save")}</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <DetailList items={[{ label: tco("name"), value: company.name }, { label: tco("businessId"), value: company.businessId }]} />
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          {tco("slug")}: <code>{company.slug}</code> · {company.defaultCurrency} · {company.timezone}
        </p>
      </Section>
    </>
  );
}
