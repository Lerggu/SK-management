import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { taktPlanService } from "@/modules/takt/plan.service";
import { ActionForm, FileField, SelectField, SubmitButton } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { notFound } from "next/navigation";
import { previewImportAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("takt"))("importTitle") };
}

export default async function ImportPage({ params }: { params: Promise<{ companySlug: string; planId: string }> }) {
  const { companySlug, planId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const board = await loadOr404(taktPlanService.board(ctx, planId));
  if (!board.permissions.manage) notFound();
  const [t, format] = await Promise.all([getTranslations("takt"), getFormatter()]);
  const base = `/c/${companySlug}/takt/${planId}`;
  return (
    <>
      <PageHeader title={t("importTitle")} description={board.plan.name} backHref={base} backLabel={t("board")} />
      <div className="space-y-4">
        <Section title={t("import")}>
          <p className="mb-4 text-sm text-muted-foreground">{t("importHint")}</p>
          {board.buildings.length === 0 ? (
            <EmptyState>{t("noBuildings")}</EmptyState>
          ) : (
            <ActionForm action={previewImportAction.bind(null, companySlug, planId)} className="grid gap-4 sm:grid-cols-2">
              <SelectField name="buildingId" label={t("targetBuilding")} options={board.buildings.map((b) => ({ value: b.id, label: b.name }))} defaultValue={board.buildings[0].id} />
              <SelectField name="areaLevel" label={t("areaLevel")} options={["1", "2", "3"].map((n) => ({ value: n, label: n }))} defaultValue="1" hint={t("areaLevelHint")} />
              <div className="sm:col-span-2">
                <FileField label={t("importFile")} accept=".xml,.xer" required />
              </div>
              <div className="sm:col-span-2">
                <SubmitButton>{t("uploadPreview")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>
        {board.imports.length > 0 && (
          <Section title={t("recentImports")}>
            <ul className="divide-y text-sm">
              {board.imports.map((i) => (
                <li key={i.id} className="flex min-h-12 flex-wrap items-center gap-2 py-2">
                  <Link href={`${base}/import/${i.id}`} className="font-medium text-primary hover:underline">
                    {i.fileName}
                  </Link>
                  <span className="text-muted-foreground">{i.format}</span>
                  <StatusBadge status={i.status} label={t(`importStatuses.${i.status}`)} />
                  <span className="ml-auto text-muted-foreground">{fmtDateTime(format, i.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </>
  );
}
