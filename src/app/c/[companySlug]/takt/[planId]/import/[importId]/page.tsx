import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { scheduleImportService } from "@/modules/takt/import.service";
import { ActionButton } from "@/ui/components/form";
import { PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtBytes } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { applyImportAction, discardImportAction } from "../../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("takt"))("preview") };
}

export default async function ImportPreviewPage({ params }: { params: Promise<{ companySlug: string; planId: string; importId: string }> }) {
  const { companySlug, planId, importId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const imp = await loadOr404(scheduleImportService.get(ctx, importId));
  if (imp.planId !== planId) notFound();
  const t = await getTranslations("takt");
  const base = `/c/${companySlug}/takt/${planId}`;
  const p = imp.preview;
  return (
    <>
      <PageHeader
        title={`${t("preview")}: ${imp.fileName}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={imp.status} label={t(`importStatuses.${imp.status}`)} />
            {imp.format} · {fmtBytes(imp.sizeBytes)} · SHA-256 <code className="text-xs">{imp.sha256.slice(0, 16)}…</code>
          </span>
        }
        backHref={`${base}/import`}
        backLabel={t("importTitle")}
      />
      <div className="space-y-4">
        <Section title={p.projectName ?? imp.fileName}>
          <p className="text-sm" data-testid="import-counts">
            {t("previewCounts", p.counts)}
          </p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-muted/60 p-3">
              <dt className="text-xs text-muted-foreground">{t("areas")}</dt>
              <dd>{p.areaNames.join(", ")}</dd>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <dt className="text-xs text-muted-foreground">{t("workPackages")}</dt>
              <dd>{p.workPackageNames.join(", ")}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("targetBuilding")}: {imp.building?.name ?? "–"} · {t("areaLevel")}: {imp.options.areaLevel}
          </p>
          {imp.status === "PREVIEW" && (
            <div className="mt-4 space-y-2 border-t pt-4">
              <p className="text-sm text-muted-foreground">{t("applyHint")}</p>
              <div className="flex flex-wrap gap-2">
                <ActionButton action={applyImportAction.bind(null, companySlug, planId, imp.id)} variant="default">
                  {t("applyImport")}
                </ActionButton>
                <ActionButton action={discardImportAction.bind(null, companySlug, planId, imp.id)} variant="ghost">
                  {t("discardImport")}
                </ActionButton>
              </div>
            </div>
          )}
          <p className="mt-4 text-sm">
            <a href={`${base}/import/${imp.id}/file`} className="text-primary underline-offset-4 hover:underline">
              {t("originalFile")}
            </a>
          </p>
        </Section>
        <Section title={t("task")}>
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[40rem] text-sm" data-testid="import-rows">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 font-medium">{t("task")}</th>
                  <th className="py-2 font-medium">{t("wbsPath")}</th>
                  <th className="py-2 font-medium">{t("area")}</th>
                  <th className="py-2 font-medium">{t("workPackage")}</th>
                  <th className="py-2 font-medium">{t("planned")}</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.uid} className="border-b last:border-0" data-row-status={r.status}>
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-muted-foreground">{r.path.join(" › ") || "–"}</td>
                    <td className="py-2">{r.areaName ?? "–"}</td>
                    <td className="py-2">{r.workPackageName ?? "–"}</td>
                    <td className="py-2 tabular-nums">
                      {r.start} – {r.finish}
                    </td>
                    <td className="py-2 text-right">
                      <StatusBadge status={r.status} label={t(`rowStatuses.${r.status}`)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
