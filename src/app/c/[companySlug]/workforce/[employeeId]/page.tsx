import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { employeeService } from "@/modules/workforce/service";
import { Button } from "@/ui/components/button";
import { ActionButton } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { RatesSection } from "../../_components/rates";
import { LinkedDocuments } from "../../_components/linked-documents";
import { addEmployeeRateAction, archiveEmployeeAction, archiveEmployeeRateAction } from "../actions";

export default async function EmployeePage({ params }: { params: Promise<{ companySlug: string; employeeId: string }> }) {
  const { companySlug, employeeId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const employee = await loadOr404(employeeService.get(ctx, employeeId));
  const [t, tc, format] = await Promise.all([getTranslations("workforce"), getTranslations("common"), getFormatter()]);
  const canManage = hasPermission(ctx, "employee.manage") && !employee.archivedAt;

  return (
    <>
      <PageHeader
        title={`${employee.firstName} ${employee.lastName}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {employee.archivedAt ? <StatusBadge status="ARCHIVED" label={tc("archived")} /> : <StatusBadge status={employee.status} label={t(`statuses.${employee.status}`)} />}
            {[employee.employeeNumber, employee.trade].filter(Boolean).join(" · ")}
          </span>
        }
        backHref={`/c/${companySlug}/workforce`}
        backLabel={t("title")}
        actions={
          canManage && (
            <>
              <Button asChild variant="outline">
                <Link href={`/c/${companySlug}/workforce/${employee.id}/edit`}>
                  <Pencil aria-hidden /> {tc("edit")}
                </Link>
              </Button>
              <ActionButton action={archiveEmployeeAction.bind(null, companySlug, employee.id)} confirm={tc("confirmArchive")} variant="destructive">
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
              { label: t("employeeNumber"), value: employee.employeeNumber },
              { label: t("employmentType"), value: t(`employmentTypes.${employee.employmentType}`) },
              { label: t("trade"), value: employee.trade },
              { label: t("jobTitle"), value: employee.jobTitle },
              { label: t("phone"), value: employee.phone && <a href={`tel:${employee.phone}`} className="underline">{employee.phone}</a> },
              { label: t("email"), value: employee.email && <a href={`mailto:${employee.email}`} className="underline">{employee.email}</a> },
              { label: t("startDate"), value: fmtDate(format, employee.startDate) },
              { label: t("endDate"), value: fmtDate(format, employee.endDate) },
              { label: t("notes"), value: employee.notes },
            ]}
          />
        </Section>
        {"rates" in employee && (
          <RatesSection
            rates={employee.rates}
            current={employee.currentRates}
            canManage={hasPermission(ctx, "employee.rates.manage") && !employee.archivedAt}
            addAction={addEmployeeRateAction.bind(null, companySlug, employee.id)}
            archiveAction={(rateId: string) => archiveEmployeeRateAction.bind(null, companySlug, employee.id, rateId)}
            defaultCurrency={ctx.company.defaultCurrency}
          />
        )}
        <LinkedDocuments ctx={ctx} entityType="EMPLOYEE" entityId={employee.id} title={t("documents")} />
      </div>
    </>
  );
}
