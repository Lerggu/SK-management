import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { DOCUMENT_CATEGORIES } from "@/modules/documents/schemas";
import { documentService } from "@/modules/documents/service";
import { Button } from "@/ui/components/button";
import { EmptyState, PageHeader, RowLink, RowList } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { requireCompanyContext } from "@/app/_lib/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("documents"))("title") };
}

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ q?: string; category?: string; archived?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const category = (DOCUMENT_CATEGORIES as readonly string[]).includes(sp.category ?? "") ? sp.category : undefined;
  const [docs, t, tc, format] = await Promise.all([documentService.list(ctx, { q: sp.q, category, includeArchived: sp.archived === "1" }), getTranslations("documents"), getTranslations("common"), getFormatter()]);
  return (
    <>
      <PageHeader
        title={t("title")}
        description={tc("total", { count: docs.length })}
        actions={
          <Button asChild>
            <Link href={`/c/${companySlug}/documents/new`}>
              <Plus aria-hidden /> {t("new")}
            </Link>
          </Button>
        }
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center" role="search">
        <input type="search" name="q" defaultValue={sp.q} placeholder={tc("searchPlaceholder")} aria-label={tc("search")} className="h-11 rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm" />
        <select name="category" defaultValue={category ?? ""} aria-label={t("category")} className="h-11 rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm">
          <option value="">{t("category")}: –</option>
          {DOCUMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`categories.${c}`)}
            </option>
          ))}
        </select>
        <label className="flex min-h-11 items-center gap-2 px-1 text-sm md:min-h-0">
          <input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} className="size-5 accent-primary md:size-4" />
          {tc("includeArchived")}
        </label>
        <button type="submit" className="h-11 rounded-lg border px-4 text-sm font-medium hover:bg-muted md:h-9">
          {tc("search")}
        </button>
      </form>
      {docs.length === 0 ? (
        <EmptyState>{t("noDocuments")}</EmptyState>
      ) : (
        <RowList>
          {docs.map((d) => (
            <RowLink
              key={d.id}
              href={`/c/${companySlug}/documents/${d.id}`}
              title={d.title}
              subtitle={[t(`categories.${d.category}`), d.documentNumber, d.project ? `${d.project.code}${d.site ? ` › ${d.site.name}` : ""}` : t("companyLevel"), d.currentVersion ? `${t("version", { number: d.currentVersion.versionNumber })}${d.currentVersion.revisionLabel ? ` (${d.currentVersion.revisionLabel})` : ""}` : null]
                .filter(Boolean)
                .join(" · ")}
              badge={d.archivedAt ? <StatusBadge status="ARCHIVED" label={tc("archived")} /> : d.currentVersion && <StatusBadge status={d.currentVersion.approvalState} label={t(`approvalStates.${d.currentVersion.approvalState}`)} />}
              meta={fmtDateTime(format, d.updatedAt)}
            />
          ))}
        </RowList>
      )}
    </>
  );
}
