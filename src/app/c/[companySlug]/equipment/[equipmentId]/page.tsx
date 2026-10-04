import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { equipmentService } from "@/modules/equipment/service";
import { Button } from "@/ui/components/button";
import { ActionButton } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtNumber } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { RatesSection } from "../../_components/rates";
import { LinkedDocuments } from "../../_components/linked-documents";
import { addEquipmentRateAction, archiveEquipmentAction, archiveEquipmentRateAction } from "../actions";

export default async function EquipmentDetailPage({ params }: { params: Promise<{ companySlug: string; equipmentId: string }> }) {
  const { companySlug, equipmentId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const e = await loadOr404(equipmentService.get(ctx, equipmentId));
  const [t, tc, format] = await Promise.all([getTranslations("equipment"), getTranslations("common"), getFormatter()]);
  const canManage = hasPermission(ctx, "equipment.manage") && !e.archivedAt;
  const overdue = e.nextInspectionDate && e.nextInspectionDate < new Date();

  return (
    <>
      <PageHeader
        title={`${e.assetNumber} · ${e.name}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {e.archivedAt ? <StatusBadge status="ARCHIVED" label={tc("archived")} /> : <StatusBadge status={e.status} label={t(`statuses.${e.status}`)} />}
            {e.equipmentType.name}
          </span>
        }
        backHref={`/c/${companySlug}/equipment`}
        backLabel={t("title")}
        actions={
          canManage && (
            <>
              <Button asChild variant="outline">
                <Link href={`/c/${companySlug}/equipment/${e.id}/edit`}>
                  <Pencil aria-hidden /> {tc("edit")}
                </Link>
              </Button>
              <ActionButton action={archiveEquipmentAction.bind(null, companySlug, e.id)} confirm={tc("confirmArchive")} variant="destructive">
                {tc("archive")}
              </ActionButton>
            </>
          )
        }
      />
      <div className="space-y-4">
        <Section title={tc("details")}>
          <DetailList
            items={[
              { label: t("type"), value: `${e.equipmentType.name} (${t(`categories.${e.equipmentType.category}`)})` },
              {
                label: t("location"),
                value: e.currentProject ? (
                  <Link className="underline" href={`/c/${companySlug}/projects/${e.currentProject.id}`}>
                    {e.currentProject.code} · {e.currentProject.name}
                    {e.currentSite ? ` › ${e.currentSite.name}` : ""}
                  </Link>
                ) : (
                  t("notAssigned")
                ),
              },
              { label: t("meterHours"), value: fmtNumber(format, e.meterHours) },
              { label: t("nextInspection"), value: <span className={overdue ? "font-semibold text-amber-700" : undefined}>{fmtDate(format, e.nextInspectionDate)}{overdue ? ` · ${t("inspectionOverdue")}` : ""}</span> },
              { label: t("manufacturer"), value: e.manufacturer },
              { label: t("model"), value: e.model },
              { label: t("serialNumber"), value: e.serialNumber },
              { label: t("registrationNumber"), value: e.registrationNumber },
              { label: t("notes"), value: e.notes },
            ]}
          />
        </Section>
        {"rates" in e && (
          <RatesSection
            rates={e.rates}
            current={e.currentRates}
            canManage={hasPermission(ctx, "equipment.rates.manage") && !e.archivedAt}
            addAction={addEquipmentRateAction.bind(null, companySlug, e.id)}
            archiveAction={(rateId: string) => archiveEquipmentRateAction.bind(null, companySlug, e.id, rateId)}
            defaultCurrency={ctx.company.defaultCurrency}
          />
        )}
        <LinkedDocuments ctx={ctx} entityType="EQUIPMENT" entityId={e.id} title={t("documents")} />
      </div>
    </>
  );
}
