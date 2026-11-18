import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ISO2_TO_ISO3 } from "@/platform/integrations/ted";
import { marketingAccess, marketingService, searchProviderName } from "@/modules/marketing/service";
import { ActionForm, CheckboxField, CheckboxGroupField, SubmitButton, TextareaField, TextField } from "@/ui/components/form";
import { PageHeader, Section } from "@/ui/components/page";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { MarketingNav } from "../_components/marketing-nav";
import { addSuppressionAction, updateSettingsAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("marketing"))("tabs.settings") };
}

export default async function MarketingSettingsPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const access = marketingAccess(ctx);
  if (!access.manage) notFound();
  const [{ settings, members, budget }, suppressions, t, format] = await Promise.all([
    loadOr404(marketingService.getSettings(ctx)),
    marketingService.listSuppressions(ctx),
    getTranslations("marketing"),
    getFormatter(),
  ]);
  const searchProvider = searchProviderName();
  const countryNames = new Intl.DisplayNames([ctx.locale], { type: "region" });
  return (
    <>
      <PageHeader title={t("title")} description={t("settingsIntro")} />
      <MarketingNav ctx={ctx} active="settings" />
      <div className="space-y-4">
        <Section title={t("tabs.settings")}>
          <ActionForm action={updateSettingsAction.bind(null, companySlug)} className="grid gap-4 sm:grid-cols-2" showSuccess data-testid="marketing-settings">
            <div className="space-y-1 sm:col-span-2">
              <CheckboxField name="enabled" label={t("enabled")} defaultChecked={settings.enabled} />
              <CheckboxField name="autoSend" label={t("autoSend")} defaultChecked={settings.autoSend} />
              <p className="text-xs text-muted-foreground">{t("autoSendHint")}</p>
            </div>
            <div className="sm:col-span-2">
              <CheckboxGroupField name="replyToUserIds" label={t("replyTo")} options={members.map((m) => ({ value: m.id, label: m.name ? `${m.name} (${m.email})` : m.email }))} defaultValues={settings.replyToUserIds} />
              <p className="mt-1 text-xs text-muted-foreground">{t("replyToHint")}</p>
            </div>
            <TextField name="senderName" label={t("senderName")} defaultValue={settings.senderName} />
            <TextField name="minScore" label={t("minScore")} type="number" min={0} max={100} inputMode="numeric" defaultValue={settings.minScore} hint={t("minScoreHint")} />
            <TextField name="dailySendLimit" label={t("dailySendLimit")} type="number" min={0} max={200} inputMode="numeric" defaultValue={settings.dailySendLimit} />
            <TextField name="intervalHours" label={t("intervalHours")} type="number" min={1} max={168} inputMode="numeric" defaultValue={settings.intervalHours} />
            <TextField name="aiMonthlyBudgetEur" label={t("aiMonthlyBudget")} inputMode="decimal" defaultValue={String(settings.aiMonthlyBudgetEur)} hint={t("budgetUsed", { used: budget.usedEur.toFixed(2), limit: budget.limitEur.toFixed(2) })} />
            <TextareaField name="pitch" label={t("pitch")} defaultValue={settings.pitch} rows={4} hint={t("pitchHint")} className="sm:col-span-2" />
            <TextareaField name="watchCompanies" label={t("watchCompanies")} defaultValue={settings.watchCompanies.join("\n")} rows={6} hint={t("watchCompaniesHint")} className="sm:col-span-2" />
            <div className="sm:col-span-2">
              <CheckboxGroupField name="countries" label={t("countries")} options={Object.keys(ISO2_TO_ISO3).map((c) => ({ value: c, label: `${countryNames.of(c) ?? c} (${c})` }))} defaultValues={settings.countries} />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton>{t("save")}</SubmitButton>
            </div>
          </ActionForm>
        </Section>

        <Section title={t("sourcesTitle")}>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{t("sourceTed")}</li>
            <li>{t("sourceWeb")}</li>
            <li>{t("sourceGrid")}</li>
            <li>{t("sourceHilma")}</li>
            <li>{searchProvider ? t("sourceGoogleOn", { provider: searchProvider }) : t("sourceGoogleOff")}</li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t("gdprHint")}</p>
        </Section>

        <Section title={t("suppressions")}>
          <p className="mb-3 text-sm text-muted-foreground">{t("suppressionsHint")}</p>
          <ActionForm action={addSuppressionAction.bind(null, companySlug)} className="mb-3 flex flex-wrap items-end gap-2" showSuccess>
            <TextField name="email" label={t("email")} type="email" inputMode="email" autoCapitalize="none" required />
            <SubmitButton variant="outline">{t("addSuppression")}</SubmitButton>
          </ActionForm>
          {suppressions.length > 0 && (
            <ul className="divide-y text-sm" data-testid="suppressions">
              {suppressions.map((s) => (
                <li key={s.id} className="py-1.5">
                  {s.email} <span className="text-xs text-muted-foreground">· {t(`suppressionReasons.${s.reason === "UNSUBSCRIBE" ? "UNSUBSCRIBE" : "MANUAL"}`)} · {fmtDateTime(format, s.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
