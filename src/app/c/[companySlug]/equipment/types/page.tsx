import { getTranslations } from "next-intl/server";
import { hasPermission } from "@/platform/authz";
import { EQUIPMENT_CATEGORIES } from "@/modules/equipment/schemas";
import { equipmentTypeService } from "@/modules/equipment/service";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { archiveTypeAction, createTypeAction } from "../actions";

export default async function EquipmentTypesPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [types, t, tc] = await Promise.all([loadOr404(equipmentTypeService.list(ctx)), getTranslations("equipment"), getTranslations("common")]);
  const canManage = hasPermission(ctx, "equipment.manage");
  return (
    <>
      <PageHeader title={t("types")} backHref={`/c/${companySlug}/equipment`} backLabel={t("title")} />
      <div className="space-y-4">
        <Section title={t("types")}>
          {types.length === 0 ? (
            <EmptyState>{t("noTypes")}</EmptyState>
          ) : (
            <ul className="divide-y">
              {types.map((ty) => (
                <li key={ty.id} className="flex min-h-14 flex-wrap items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{ty.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {t(`categories.${ty.category}`)} · {t("equipmentCount", { count: ty.equipmentCount })}
                    </div>
                  </div>
                  {canManage && (
                    <ActionButton action={archiveTypeAction.bind(null, companySlug, ty.id)} confirm={tc("confirmArchive")} variant="ghost">
                      {tc("archive")}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
        {canManage && (
          <Section title={t("newType")}>
            <ActionForm action={createTypeAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <TextField name="name" label={t("typeName")} required />
              <SelectField name="category" label={t("category")} defaultValue="OTHER" options={EQUIPMENT_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))} />
              <SubmitButton>{tc("add")}</SubmitButton>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
