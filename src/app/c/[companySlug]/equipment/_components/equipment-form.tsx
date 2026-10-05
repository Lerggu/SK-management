import { getTranslations } from "next-intl/server";
import type { RequestContext } from "@/platform/authz";
import { EQUIPMENT_STATUSES } from "@/modules/equipment/schemas";
import { equipmentTypeService } from "@/modules/equipment/service";
import { projectService, siteService } from "@/modules/projects/service";
import { ActionForm, SelectField, SubmitButton, TextareaField, TextField, type FormState } from "@/ui/components/form";
import { isoDate } from "@/ui/format";

type Action = (state: FormState | null, formData: FormData) => Promise<FormState>;

export async function EquipmentForm({
  ctx,
  action,
  equipment,
}: {
  ctx: RequestContext;
  action: Action;
  equipment?: {
    equipmentTypeId: string;
    assetNumber: string;
    name: string;
    manufacturer: string | null;
    model: string | null;
    serialNumber: string | null;
    registrationNumber: string | null;
    status: string;
    currentProjectId: string | null;
    currentSiteId: string | null;
    meterHours: { toString(): string } | null;
    nextInspectionDate: Date | null;
    notes: string | null;
    shareableInGroup?: boolean;
  };
}) {
  const [t, tc, types, projects] = await Promise.all([getTranslations("equipment"), getTranslations("common"), equipmentTypeService.list(ctx), projectService.list(ctx)]);
  const locations: { value: string; label: string }[] = [];
  for (const p of projects) {
    locations.push({ value: `p:${p.id}`, label: `${p.code} · ${p.name}` });
    for (const s of await siteService.list(ctx, p.id)) locations.push({ value: `s:${p.id}:${s.id}`, label: `${p.code} › ${s.name}` });
  }
  const current = equipment?.currentSiteId ? `s:${equipment.currentProjectId}:${equipment.currentSiteId}` : equipment?.currentProjectId ? `p:${equipment.currentProjectId}` : "";

  return (
    <ActionForm action={action} className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 md:p-6">
      <TextField name="name" label={t("name")} defaultValue={equipment?.name} required />
      <TextField name="assetNumber" label={t("assetNumber")} defaultValue={equipment?.assetNumber} required autoCapitalize="characters" />
      <SelectField name="equipmentTypeId" label={t("type")} placeholder={tc("select")} required defaultValue={equipment?.equipmentTypeId} options={types.map((ty) => ({ value: ty.id, label: `${ty.name} (${t(`categories.${ty.category}`)})` }))} hint={types.length === 0 ? t("noTypes") : undefined} />
      <SelectField name="status" label={t("status")} defaultValue={equipment?.status ?? "AVAILABLE"} options={EQUIPMENT_STATUSES.map((v) => ({ value: v, label: t(`statuses.${v}`) }))} />
      <SelectField name="location" label={t("location")} defaultValue={current} placeholder={t("notAssigned")} options={locations} className="sm:col-span-2" />
      <TextField name="meterHours" label={t("meterHours")} defaultValue={equipment?.meterHours?.toString()} inputMode="decimal" />
      <TextField name="nextInspectionDate" label={t("nextInspection")} type="date" defaultValue={isoDate(equipment?.nextInspectionDate)} />
      <TextField name="manufacturer" label={t("manufacturer")} defaultValue={equipment?.manufacturer} />
      <TextField name="model" label={t("model")} defaultValue={equipment?.model} />
      <TextField name="serialNumber" label={t("serialNumber")} defaultValue={equipment?.serialNumber} />
      <TextField name="registrationNumber" label={t("registrationNumber")} defaultValue={equipment?.registrationNumber} autoCapitalize="characters" />
      <TextareaField name="notes" label={t("notes")} defaultValue={equipment?.notes} className="sm:col-span-2" />
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2 md:min-h-0">
        <input type="checkbox" name="shareableInGroup" defaultChecked={equipment?.shareableInGroup ?? false} className="size-5 accent-primary md:size-4" />
        {t("shareableInGroup")}
      </label>
      <div className="sm:col-span-2">
        <SubmitButton>{equipment ? tc("save") : tc("create")}</SubmitButton>
      </div>
    </ActionForm>
  );
}
