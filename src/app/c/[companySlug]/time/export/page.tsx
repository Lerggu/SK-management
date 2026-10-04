import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { addDays, isoDateString } from "@/modules/timesheets/rules";
import { ActionForm, SubmitButton, TextField } from "@/ui/components/form";
import { PageHeader, Section } from "@/ui/components/page";
import { requireCompanyContext } from "@/app/_lib/context";
import { exportAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("time"))("export") };
}

export default async function ExportPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ batch?: string }> }) {
  const { companySlug } = await params;
  const { batch } = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  if (!hasPermission(ctx, "timesheet.export")) notFound();
  const t = await getTranslations("time");
  const now = new Date();
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const batchOk = batch && /^[0-9a-f-]{36}$/.test(batch);

  return (
    <>
      <PageHeader title={t("export")} description={t("exportHint")} backHref={`/c/${companySlug}/time`} backLabel={t("title")} />
      {batchOk && (
        <a
          href={`/c/${companySlug}/time/export/${batch}`}
          className="mb-4 flex min-h-12 items-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-600/10 px-4 text-sm font-medium text-emerald-900"
          data-testid="export-download"
        >
          <Download className="size-4" aria-hidden /> CSV
        </a>
      )}
      <Section title={t("export")}>
        <ActionForm action={exportAction.bind(null, companySlug)} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <TextField name="from" label={t("exportFrom")} type="date" defaultValue={isoDateString(firstOfMonth)} required />
          <TextField name="to" label={t("exportTo")} type="date" defaultValue={isoDateString(addDays(now, 0))} required />
          <SubmitButton>{t("exportButton")}</SubmitButton>
        </ActionForm>
      </Section>
    </>
  );
}
