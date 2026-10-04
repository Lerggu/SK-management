import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { AlertTriangle, Plus, Tags } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { equipmentService } from "@/modules/equipment/service";
import { Button } from "@/ui/components/button";
import { EmptyState, PageHeader, RowLink, RowList, SearchForm } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("equipment"))("title") };
}

export default async function EquipmentPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ q?: string; archived?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [rows, t, tc, format] = await Promise.all([loadOr404(equipmentService.list(ctx, { q: sp.q, includeArchived: sp.archived === "1" })), getTranslations("equipment"), getTranslations("common"), getFormatter()]);
  const now = new Date();
  return (
    <>
      <PageHeader
        title={t("title")}
        description={tc("total", { count: rows.length })}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/c/${companySlug}/equipment/types`}>
                <Tags aria-hidden /> {t("types")}
              </Link>
            </Button>
            {hasPermission(ctx, "equipment.manage") && (
              <Button asChild>
                <Link href={`/c/${companySlug}/equipment/new`}>
                  <Plus aria-hidden /> {t("new")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <SearchForm placeholder={tc("searchPlaceholder")} defaultValue={sp.q} includeArchived={sp.archived === "1"} includeArchivedLabel={tc("includeArchived")} searchLabel={tc("search")} />
      {rows.length === 0 ? (
        <EmptyState>{t("noEquipment")}</EmptyState>
      ) : (
        <RowList>
          {rows.map((e) => {
            const overdue = !e.archivedAt && e.nextInspectionDate && e.nextInspectionDate < now;
            return (
              <RowLink
                key={e.id}
                href={`/c/${companySlug}/equipment/${e.id}`}
                title={`${e.assetNumber} · ${e.name}`}
                subtitle={[e.equipmentType.name, e.currentProject ? `${e.currentProject.code}${e.currentSite ? ` › ${e.currentSite.name}` : ""}` : t("notAssigned")].join(" · ")}
                badge={
                  <>
                    {e.archivedAt ? <StatusBadge status="ARCHIVED" label={tc("archived")} /> : <StatusBadge status={e.status} label={t(`statuses.${e.status}`)} />}
                    {overdue && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                        <AlertTriangle className="size-3.5" aria-hidden />
                        {t("inspectionOverdue")}
                      </span>
                    )}
                  </>
                }
                meta={e.nextInspectionDate ? `${t("nextInspection")}: ${fmtDate(format, e.nextInspectionDate)}` : undefined}
              />
            );
          })}
        </RowList>
      )}
    </>
  );
}
