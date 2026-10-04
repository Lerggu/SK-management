import { getTranslations } from "next-intl/server";
import { PROJECT_STATUSES, SITE_STATUSES } from "@/modules/projects/schemas";
import { ActionForm, SelectField, SubmitButton, TextareaField, TextField, type FormState } from "@/ui/components/form";
import { isoDate } from "@/ui/format";

type Action = (state: FormState | null, formData: FormData) => Promise<FormState>;

export async function ProjectForm({
  action,
  project,
}: {
  action: Action;
  project?: { code: string; name: string; customerName: string | null; description: string | null; status: string; startDate: Date | null; endDate: Date | null };
}) {
  const t = await getTranslations("projects");
  const tc = await getTranslations("common");
  return (
    <ActionForm action={action} className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 md:p-6">
      <TextField name="code" label={t("code")} defaultValue={project?.code} required autoCapitalize="characters" />
      <TextField name="name" label={t("name")} defaultValue={project?.name} required />
      <TextField name="customerName" label={t("customer")} defaultValue={project?.customerName} />
      <SelectField name="status" label={t("status")} defaultValue={project?.status ?? "PLANNED"} options={PROJECT_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />
      <TextField name="startDate" label={t("startDate")} type="date" defaultValue={isoDate(project?.startDate)} />
      <TextField name="endDate" label={t("endDate")} type="date" defaultValue={isoDate(project?.endDate)} />
      <TextareaField name="description" label={t("description")} defaultValue={project?.description} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <SubmitButton>{project ? tc("save") : tc("create")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export async function SiteForm({
  action,
  site,
}: {
  action: Action;
  site?: { code: string | null; name: string; address: string | null; postalCode: string | null; city: string | null; latitude: { toString(): string } | null; longitude: { toString(): string } | null; status: string; notes: string | null };
}) {
  const t = await getTranslations("projects");
  const tc = await getTranslations("common");
  return (
    <ActionForm action={action} className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 md:p-6">
      <TextField name="name" label={t("siteName")} defaultValue={site?.name} required />
      <TextField name="code" label={t("siteCode")} defaultValue={site?.code} />
      <TextField name="address" label={t("address")} defaultValue={site?.address} autoComplete="street-address" />
      <TextField name="postalCode" label={t("postalCode")} defaultValue={site?.postalCode} inputMode="numeric" />
      <TextField name="city" label={t("city")} defaultValue={site?.city} />
      <SelectField name="status" label={tc("status")} defaultValue={site?.status ?? "ACTIVE"} options={SITE_STATUSES.map((s) => ({ value: s, label: t(`siteStatuses.${s}`) }))} />
      <TextField name="latitude" label={t("latitude")} defaultValue={site?.latitude?.toString()} inputMode="decimal" />
      <TextField name="longitude" label={t("longitude")} defaultValue={site?.longitude?.toString()} inputMode="decimal" />
      <TextareaField name="notes" label={tc("notes")} defaultValue={site?.notes} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <SubmitButton>{site ? tc("save") : tc("create")}</SubmitButton>
      </div>
    </ActionForm>
  );
}
