import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/platform/authz";
import { PageHeader } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { EquipmentForm } from "../_components/equipment-form";
import { createEquipmentAction } from "../actions";

export default async function NewEquipmentPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  await loadOr404(Promise.resolve().then(() => requirePermission(ctx, "equipment.manage")));
  const [t, tc] = await Promise.all([getTranslations("equipment"), getTranslations("common")]);
  return (
    <>
      <PageHeader title={t("new")} backHref={`/c/${companySlug}/equipment`} backLabel={tc("back")} />
      <EquipmentForm ctx={ctx} action={createEquipmentAction.bind(null, companySlug)} />
    </>
  );
}
