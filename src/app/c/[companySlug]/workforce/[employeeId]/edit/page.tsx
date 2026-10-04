import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { hasPermission } from "@/platform/authz";
import { employeeService } from "@/modules/workforce/service";
import { PageHeader } from "@/ui/components/page";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { EmployeeForm } from "../../_components/employee-form";
import { updateEmployeeAction } from "../../actions";

export default async function EditEmployeePage({ params }: { params: Promise<{ companySlug: string; employeeId: string }> }) {
  const { companySlug, employeeId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  if (!hasPermission(ctx, "employee.manage")) notFound();
  const employee = await loadOr404(employeeService.get(ctx, employeeId));
  if (employee.archivedAt) notFound();
  const [t, tc] = await Promise.all([getTranslations("workforce"), getTranslations("common")]);
  return (
    <>
      <PageHeader title={t("edit")} description={`${employee.firstName} ${employee.lastName}`} backHref={`/c/${companySlug}/workforce/${employeeId}`} backLabel={tc("back")} />
      <EmployeeForm action={updateEmployeeAction.bind(null, companySlug, employeeId)} employee={employee} />
    </>
  );
}
