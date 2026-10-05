import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ActionForm, SubmitButton, TextField } from "@/ui/components/form";
import { PageHeader, Section } from "@/ui/components/page";
import { requireCompanyContext } from "@/app/_lib/context";
import { scanAction } from "../materials/actions";
import { Scanner } from "./_components/scanner";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("materials"))("scan") };
}

/** Mobile QR scan: camera when available, typed code as the fallback. */
export default async function ScanPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  await requireCompanyContext(companySlug);
  const t = await getTranslations("materials");
  return (
    <>
      <PageHeader title={t("scan")} description={t("scanIntro")} backHref={`/c/${companySlug}/materials`} backLabel={t("title")} />
      <div className="space-y-4">
        <Section title={t("camera")}>
          <Scanner formId="scan-form" />
        </Section>
        <Section title={t("typeCode")}>
          <ActionForm action={scanAction.bind(null, companySlug)} id="scan-form" className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" data-testid="scan-form">
            <TextField name="code" label={t("code")} hint={t("typeCodeHint")} required autoCapitalize="characters" autoComplete="off" className="[&_input]:h-12 [&_input]:text-lg" />
            <SubmitButton className="h-12">{t("open")}</SubmitButton>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
