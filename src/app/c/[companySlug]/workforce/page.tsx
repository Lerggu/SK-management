import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { employeeService } from "@/modules/workforce/service";
import { Button } from "@/ui/components/button";
import { EmptyState, PageHeader, RowLink, RowList, SearchForm } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("workforce"))("title") };
}

export default async function WorkforcePage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ q?: string; archived?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [employees, t, tc] = await Promise.all([loadOr404(employeeService.list(ctx, { q: sp.q, includeArchived: sp.archived === "1" })), getTranslations("workforce"), getTranslations("common")]);
  return (
    <>
      <PageHeader
        title={t("title")}
        description={tc("total", { count: employees.length })}
        actions={
          hasPermission(ctx, "employee.manage") && (
            <Button asChild>
              <Link href={`/c/${companySlug}/workforce/new`}>
                <Plus aria-hidden /> {t("new")}
              </Link>
            </Button>
          )
        }
      />
      <SearchForm placeholder={tc("searchPlaceholder")} defaultValue={sp.q} includeArchived={sp.archived === "1"} includeArchivedLabel={tc("includeArchived")} searchLabel={tc("search")} />
      {employees.length === 0 ? (
        <EmptyState>{t("noEmployees")}</EmptyState>
      ) : (
        <RowList>
          {employees.map((e) => (
            <RowLink
              key={e.id}
              href={`/c/${companySlug}/workforce/${e.id}`}
              title={`${e.lastName} ${e.firstName}`}
              subtitle={[e.employeeNumber, e.trade, e.jobTitle].filter(Boolean).join(" · ")}
              badge={e.archivedAt ? <StatusBadge status="ARCHIVED" label={tc("archived")} /> : e.status !== "ACTIVE" && <StatusBadge status={e.status} label={t(`statuses.${e.status}`)} />}
              meta={t(`employmentTypes.${e.employmentType}`)}
            />
          ))}
        </RowList>
      )}
    </>
  );
}
