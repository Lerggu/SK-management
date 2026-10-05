import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { taktPlanService } from "@/modules/takt/plan.service";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { cn } from "@/ui/lib/utils";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("takt"))("compareTitle") };
}

type Props = { params: Promise<{ companySlug: string; planId: string }>; searchParams: Promise<{ v?: string; against?: string }> };

export default async function ComparePage({ params, searchParams }: Props) {
  const { companySlug, planId } = await params;
  const { v, against } = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const board = await loadOr404(taktPlanService.board(ctx, planId));
  const versionId = v ?? board.selected?.id;
  const cmp = versionId ? await loadOr404(taktPlanService.compare(ctx, planId, { versionId, againstId: against ?? null })) : null;
  const [t, format] = await Promise.all([getTranslations("takt"), getFormatter()]);
  const base = `/c/${companySlug}/takt/${planId}`;
  const d = (s: string) => format.dateTime(new Date(`${s}T12:00:00Z`), { day: "numeric", month: "numeric" });
  const changed = cmp?.rows.filter((r) => r.change !== "UNCHANGED") ?? [];

  return (
    <>
      <PageHeader title={t("compareTitle")} description={board.plan.name} backHref={`${base}?v=${versionId ?? ""}`} backLabel={t("board")} />
      {!cmp ? (
        <EmptyState>{t("noVersion")}</EmptyState>
      ) : (
        <div className="space-y-4">
          <Section title={`${t("version", { number: cmp.other.versionNumber })} ↔ ${cmp.base ? t("version", { number: cmp.base.versionNumber }) : "–"}`}>
            <form className="mb-4 flex flex-wrap items-end gap-2 text-sm" method="get">
              <input type="hidden" name="v" value={cmp.other.id} />
              <label className="space-y-1">
                <span className="block font-medium">{t("against")}</span>
                <select name="against" defaultValue={cmp.base?.id ?? ""} className="h-11 rounded-lg border bg-background px-3 md:h-9">
                  {cmp.versions
                    .filter((x) => x.id !== cmp.other.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {t("version", { number: x.versionNumber })} · {t(`versionStatuses.${x.status}`)}
                      </option>
                    ))}
                </select>
              </label>
              <button type="submit" className="h-11 rounded-lg border px-4 md:h-9">
                {t("show")}
              </button>
            </form>
            {!cmp.base && <p className="text-sm text-muted-foreground">{t("noBaseline")}</p>}
            <p className="text-sm" data-testid="compare-summary">
              {t("summaryMoved", cmp.summary)} ·{" "}
              {cmp.summary.finishDelta >= 0 ? t("finishDelta", { delta: cmp.summary.finishDelta }) : t("finishEarlier", { delta: -cmp.summary.finishDelta })}
            </p>
            {changed.length > 0 && (
              <div className="-mx-4 mt-4 overflow-x-auto px-4">
                <table className="w-full min-w-[36rem] text-sm" data-testid="compare-table">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 font-medium">{t("activity")}</th>
                      <th className="py-2 font-medium">{t("baselineDates")}</th>
                      <th className="py-2 font-medium">{t("versionDates")}</th>
                      <th className="py-2 text-right font-medium">{t("delta")}</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {changed.map((r) => (
                      <tr key={r.activityId} className="border-b last:border-0" data-change={r.change}>
                        <td className="py-2">
                          <Link href={`${base}/activities/${r.activityId}`} className="inline-flex items-center gap-2 hover:underline">
                            <span aria-hidden className="size-3 rounded-sm" style={{ backgroundColor: r.activity.workPackage.color }} />
                            {r.activity.taktArea.code} · {r.activity.workPackage.code} {r.activity.name}
                          </Link>
                        </td>
                        <td className="py-2 tabular-nums">{r.base ? `${d(r.base.start)}–${d(r.base.end)}` : "–"}</td>
                        <td className="py-2 tabular-nums">{r.other ? `${d(r.other.start)}–${d(r.other.end)}` : "–"}</td>
                        <td className={cn("py-2 text-right tabular-nums", r.startDelta > 0 && "text-destructive")}>{r.change === "MOVED" ? (r.startDelta > 0 ? `+${r.startDelta}` : r.startDelta) : ""}</td>
                        <td className="py-2 text-right">
                          <StatusBadge status={r.change} label={t(`changes.${r.change}`)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}
    </>
  );
}
