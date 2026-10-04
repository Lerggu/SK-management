import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/platform/authz";
import { PageHeader } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { EmployeeForm } from "../_components/employee-form";
import { createEmployeeAction } from "../actions";

export default async function NewEmployeePage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  await loadOr404(Promise.resolve().then(() => requirePermission(ctx, "employee.manage")));
  const [t, tc] = await Promise.all([getTranslations("workforce"), getTranslations("common")]);
  return (
    <>
      <PageHeader title={t("new")} backHref={`/c/${companySlug}/workforce`} backLabel={tc("back")} />
      <EmployeeForm action={createEmployeeAction.bind(null, companySlug)} />
    </>
  );
}
