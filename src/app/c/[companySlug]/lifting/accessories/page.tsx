import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { QrCode } from "lucide-react";
import { liftingAccessoryService } from "@/modules/lifting/lift.service";
import { ACCESSORY_KINDS } from "@/modules/lifting/schemas";
import { holdsAnywhere } from "@/modules/lifting/access";
import { Button } from "@/ui/components/button";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { createAccessoryAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("lifting"))("accessories") };
}

export default async function AccessoriesPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [rows, t] = await Promise.all([loadOr404(liftingAccessoryService.list(ctx)), getTranslations("lifting")]);
  const manage = holdsAnywhere(ctx, "lift.plan.manage");
  const base = `/c/${companySlug}/lifting`;
  const due = rows.filter((a) => a.inspectionDue).length;
  return (
    <>
      <PageHeader
        title={t("accessories")}
        description={t("accessoriesIntro")}
        backHref={base}
        backLabel={t("title")}
        actions={
          rows.length > 0 && (
            <Button asChild variant="outline">
              <a href={`/c/${companySlug}/materials/labels?kind=accessory`} target="_blank" rel="noopener">
                <QrCode aria-hidden /> {t("printLabels")}
              </a>
            </Button>
          )
        }
      />
      <div className="space-y-4">
        {due > 0 && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900" data-testid="accessories-due">{t("accessoriesDue", { count: due })}</p>}
        <Section title={t("register")}>
          {rows.length === 0 ? (
            <EmptyState>{t("noAccessories")}</EmptyState>
          ) : (
            <RowList>
              {rows.map((a) => (
                <RowLink
                  key={a.id}
                  href={`${base}/accessories/${a.id}`}
                  title={`${a.code} · ${a.name}`}
                  subtitle={`${t(`accessoryKinds.${a.kind}`)} · WLL ${a.wllKg} kg`}
                  meta={`${t("inspection")}: ${a.nextInspectionDate ?? "–"}`}
                  badge={a.inspectionDue ? <StatusBadge status="REJECTED" label={t("inspectionDue")} /> : <StatusBadge status={a.status} label={t(`accessoryStatuses.${a.status}`)} />}
                />
              ))}
            </RowList>
          )}
        </Section>
        {manage && (
          <Section title={t("newAccessory")}>
            <ActionForm action={createAccessoryAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-3" showSuccess data-testid="accessory-form">
              <TextField name="code" label={t("code")} required autoCapitalize="characters" />
              <TextField name="name" label={t("name")} required className="sm:col-span-2" />
              <SelectField name="kind" label={t("kind")} options={ACCESSORY_KINDS.map((k) => ({ value: k, label: t(`accessoryKinds.${k}`) }))} defaultValue="SLING" />
              <TextField name="wllKg" label={t("wllKg")} required inputMode="decimal" />
              <TextField name="nextInspectionDate" label={t("nextInspection")} type="date" />
              <TextField name="manufacturer" label={t("manufacturer")} />
              <TextField name="serialNumber" label={t("serialNumber")} />
              <div className="sm:col-span-3">
                <SubmitButton>{t("addAccessoryToRegister")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
        <p className="text-xs text-muted-foreground">
          <Link href={`/c/${companySlug}/scan`} className="text-primary hover:underline">
            {t("scanLink")}
          </Link>
        </p>
      </div>
    </>
  );
}
