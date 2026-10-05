import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { QrCode } from "lucide-react";
import { liftingAccessoryService } from "@/modules/lifting/lift.service";
import { ACCESSORY_KINDS } from "@/modules/lifting/schemas";
import { holdsAnywhere } from "@/modules/lifting/access";
import { Button } from "@/ui/components/button";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { archiveAccessoryAction, updateAccessoryAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("lifting"))("accessory") };
}

export default async function AccessoryPage({ params }: { params: Promise<{ companySlug: string; accessoryId: string }> }) {
  const { companySlug, accessoryId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const a = await loadOr404(liftingAccessoryService.get(ctx, accessoryId));
  const [t, tc] = await Promise.all([getTranslations("lifting"), getTranslations("common")]);
  const manage = holdsAnywhere(ctx, "lift.plan.manage") && !a.archivedAt;
  return (
    <>
      <PageHeader
        title={`${a.code} · ${a.name}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {a.archivedAt ? <StatusBadge status="ARCHIVED" label={tc("archived")} /> : <StatusBadge status={a.status} label={t(`accessoryStatuses.${a.status}`)} />}
            {a.inspectionDue && <StatusBadge status="REJECTED" label={t("inspectionDue")} />}
          </span>
        }
        backHref={`/c/${companySlug}/lifting/accessories`}
        backLabel={t("accessories")}
        actions={
          <Button asChild variant="outline">
            <a href={`/c/${companySlug}/materials/labels?kind=accessory&ids=${a.id}`} target="_blank" rel="noopener">
              <QrCode aria-hidden /> {t("printLabel")}
            </a>
          </Button>
        }
      />
      <div className="space-y-4">
        <Section title={t("accessory")}>
          <DetailList
            items={[
              { label: t("kind"), value: t(`accessoryKinds.${a.kind}`) },
              { label: t("wllKg"), value: `${a.wllKg} kg` },
              { label: t("nextInspection"), value: a.nextInspectionDate },
              { label: t("manufacturer"), value: a.manufacturer },
              { label: t("serialNumber"), value: a.serialNumber },
              { label: t("note"), value: a.notes },
            ]}
          />
        </Section>
        {manage && (
          <Section title={tc("edit")}>
            <ActionForm action={updateAccessoryAction.bind(null, companySlug, a.id)} className="grid gap-3 sm:grid-cols-3" showSuccess data-testid="accessory-edit-form">
              <TextField name="name" label={t("name")} required defaultValue={a.name} className="sm:col-span-2" />
              <SelectField name="kind" label={t("kind")} options={ACCESSORY_KINDS.map((k) => ({ value: k, label: t(`accessoryKinds.${k}`) }))} defaultValue={a.kind} />
              <TextField name="wllKg" label={t("wllKg")} required inputMode="decimal" defaultValue={a.wllKg} />
              <TextField name="nextInspectionDate" label={t("nextInspection")} type="date" defaultValue={a.nextInspectionDate} />
              <SelectField name="status" label={t("status")} options={(["ACTIVE", "INACTIVE"] as const).map((s) => ({ value: s, label: t(`accessoryStatuses.${s}`) }))} defaultValue={a.status} />
              <TextField name="manufacturer" label={t("manufacturer")} defaultValue={a.manufacturer} />
              <TextField name="serialNumber" label={t("serialNumber")} defaultValue={a.serialNumber} />
              <TextField name="notes" label={t("note")} defaultValue={a.notes} />
              <div className="flex flex-wrap gap-2 sm:col-span-3">
                <SubmitButton>{tc("save")}</SubmitButton>
              </div>
            </ActionForm>
            <div className="mt-4 border-t pt-4">
              <ActionButton action={archiveAccessoryAction.bind(null, companySlug, a.id)} confirm={tc("confirmArchive")} variant="ghost">
                {tc("archive")}
              </ActionButton>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
