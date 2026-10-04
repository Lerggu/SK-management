import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { hasPermission } from "@/platform/authz";
import { equipmentService } from "@/modules/equipment/service";
import { PageHeader } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { EquipmentForm } from "../../_components/equipment-form";
import { updateEquipmentAction } from "../../actions";

export default async function EditEquipmentPage({ params }: { params: Promise<{ companySlug: string; equipmentId: string }> }) {
  const { companySlug, equipmentId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  if (!hasPermission(ctx, "equipment.manage")) notFound();
  const equipment = await loadOr404(equipmentService.get(ctx, equipmentId));
  if (equipment.archivedAt) notFound();
  const [t, tc] = await Promise.all([getTranslations("equipment"), getTranslations("common")]);
  return (
    <>
      <PageHeader title={t("edit")} description={`${equipment.assetNumber} · ${equipment.name}`} backHref={`/c/${companySlug}/equipment/${equipmentId}`} backLabel={tc("back")} />
      <EquipmentForm ctx={ctx} action={updateEquipmentAction.bind(null, companySlug, equipmentId)} equipment={equipment} />
    </>
  );
}
