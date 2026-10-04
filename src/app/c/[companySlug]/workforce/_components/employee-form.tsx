import { getTranslations } from "next-intl/server";
import { EMPLOYMENT_TYPES, RESOURCE_STATUSES } from "@/modules/workforce/schemas";
import { ActionForm, SelectField, SubmitButton, TextareaField, TextField, type FormState } from "@/ui/components/form";
import { isoDate } from "@/ui/format";

type Action = (state: FormState | null, formData: FormData) => Promise<FormState>;

export async function EmployeeForm({
  action,
  employee,
}: {
  action: Action;
  employee?: {
    employeeNumber: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    jobTitle: string | null;
    trade: string | null;
    employmentType: string;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    notes: string | null;
  };
}) {
  const t = await getTranslations("workforce");
  const tc = await getTranslations("common");
  return (
    <ActionForm action={action} className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 md:p-6">
      <TextField name="firstName" label={t("firstName")} defaultValue={employee?.firstName} required autoComplete="off" />
      <TextField name="lastName" label={t("lastName")} defaultValue={employee?.lastName} required autoComplete="off" />
      <TextField name="employeeNumber" label={t("employeeNumber")} defaultValue={employee?.employeeNumber} required />
      <TextField name="trade" label={t("trade")} defaultValue={employee?.trade} />
      <TextField name="jobTitle" label={t("jobTitle")} defaultValue={employee?.jobTitle} />
      <SelectField name="employmentType" label={t("employmentType")} defaultValue={employee?.employmentType ?? "EMPLOYEE"} options={EMPLOYMENT_TYPES.map((v) => ({ value: v, label: t(`employmentTypes.${v}`) }))} />
      <TextField name="phone" label={t("phone")} defaultValue={employee?.phone} type="tel" inputMode="tel" autoComplete="off" />
      <TextField name="email" label={t("email")} defaultValue={employee?.email} type="email" inputMode="email" autoComplete="off" />
      <TextField name="startDate" label={t("startDate")} type="date" defaultValue={isoDate(employee?.startDate)} />
      <TextField name="endDate" label={t("endDate")} type="date" defaultValue={isoDate(employee?.endDate)} />
      <SelectField name="status" label={t("status")} defaultValue={employee?.status ?? "ACTIVE"} options={RESOURCE_STATUSES.map((v) => ({ value: v, label: t(`statuses.${v}`) }))} />
      <TextareaField name="notes" label={t("notes")} defaultValue={employee?.notes} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <SubmitButton>{employee ? tc("save") : tc("create")}</SubmitButton>
      </div>
    </ActionForm>
  );
}
