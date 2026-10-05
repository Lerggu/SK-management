import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { GitCompare, Upload } from "lucide-react";
import { taktPlanService } from "@/modules/takt/plan.service";
import { taktActivityService } from "@/modules/takt/activity.service";
import { Button } from "@/ui/components/button";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, isoDate } from "@/ui/format";
import { cn } from "@/ui/lib/utils";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { BoardGrid } from "../_components/board-grid";
import { WeekList } from "../_components/week-list";
import {
  approveAction,
  createActivityAction,
  createDraftAction,
  discardDraftAction,
  generateTrainAction,
  proposeAction,
  returnToDraftAction,
  shiftWorkPackageAction,
  updateDraftAction,
} from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("takt"))("board") };
}

type Props = { params: Promise<{ companySlug: string; planId: string }>; searchParams: Promise<{ v?: string }> };

export default async function TaktBoardPage({ params, searchParams }: Props) {
  const { companySlug, planId } = await params;
  const { v } = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const board = await loadOr404(taktPlanService.board(ctx, planId, { versionId: v ?? null }));
  const [week, t, tc, format] = await Promise.all([taktActivityService.listForWeek(ctx, planId), getTranslations("takt"), getTranslations("common"), getFormatter()]);
  const base = `/c/${companySlug}/takt/${planId}`;
  const sel = board.selected;
  const perms = board.permissions;
  const isDraft = sel?.status === "DRAFT";
  const hasOpen = board.versions.some((x) => x.status === "DRAFT" || x.status === "PROPOSED");
  const hasBaseline = board.versions.some((x) => x.status === "BASELINE");
  const unscheduled = board.activities.filter((a) => !a.assignment);
  const areas = board.buildings.flatMap((b) => b.taktAreas.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })));

  return (
    <>
      <PageHeader
        title={board.plan.name}
        description={`${board.plan.site.project.code} · ${board.plan.site.project.name} · ${board.plan.site.name}`}
        backHref={`/c/${companySlug}/projects/${board.plan.projectId}/takt`}
        backLabel={board.plan.site.project.code}
        actions={
          <>
            {sel && sel.status !== "BASELINE" && hasBaseline && (
              <Button asChild variant="outline">
                <Link href={`${base}/compare?v=${sel.id}`}>
                  <GitCompare aria-hidden /> {t("compare")}
                </Link>
              </Button>
            )}
            {perms.manage && (
              <Button asChild variant="outline">
                <Link href={`${base}/import`}>
                  <Upload aria-hidden /> {t("import")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      {/* Phones: this week's work first; desktop: the board first. */}
      <div className="flex flex-col gap-4">
        <Section title={t("thisWeek")} className="order-1 md:order-3">
          <WeekList slug={companySlug} planId={planId} activities={week.activities} canProgress={perms.progress} />
        </Section>

        <Section title={t("versions")} className="order-2">
          <ul className="flex flex-wrap gap-2" data-testid="versions">
            {board.versions.map((x) => (
              <li key={x.id}>
                <Link
                  href={`${base}?v=${x.id}`}
                  aria-current={sel?.id === x.id ? "page" : undefined}
                  className={cn("inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm", sel?.id === x.id ? "border-primary bg-primary/5" : "hover:bg-muted")}
                  data-version={x.versionNumber}
                >
                  {t("version", { number: x.versionNumber })}
                  <StatusBadge status={x.status} label={t(`versionStatuses.${x.status}`)} />
                </Link>
              </li>
            ))}
          </ul>
          {sel && (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-muted-foreground">
                {t("planStart", { date: fmtDate(format, sel.startDate) })}
                {sel.reason ? ` · ${t("reason")}: ${sel.reason}` : ""}
                {sel.approvedAt ? ` · ${t("approvedBy", { name: board.versions.find((x) => x.id === sel.id)?.approvedBy?.name ?? "–", date: fmtDate(format, sel.approvedAt) })}` : ""}
              </p>
              {sel.returnedNote && sel.status === "DRAFT" && (
                <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                  {t("returnedNote", { note: sel.returnedNote })}
                </p>
              )}
            </div>
          )}

          {/* Draft tools */}
          {sel && isDraft && perms.manage && (
            <div className="mt-4 space-y-4 border-t pt-4" data-testid="draft-tools">
              <ActionForm action={updateDraftAction.bind(null, companySlug, sel.id)} className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                <TextField name="startDate" label={t("startDate")} type="date" defaultValue={isoDate(sel.startDate)} required />
                <TextField name="reason" label={t("reason")} defaultValue={sel.reason} />
                <SubmitButton variant="outline">{t("saveDraft")}</SubmitButton>
              </ActionForm>
              <ActionForm action={generateTrainAction.bind(null, companySlug, sel.id)} className="grid gap-3 sm:grid-cols-[10rem_14rem_auto] sm:items-end">
                <TextField name="startCycle" label={t("startCycle")} inputMode="numeric" defaultValue="0" />
                <TextField name="bufferCycles" label={t("bufferCycles")} inputMode="numeric" defaultValue="0" />
                <SubmitButton variant="outline">{t("generateTrain")}</SubmitButton>
                <p className="text-xs text-muted-foreground sm:col-span-3">{t("generateTrainHint")}</p>
              </ActionForm>
              {board.workPackages.length > 0 && (
                <ActionForm action={shiftWorkPackageAction.bind(null, companySlug, sel.id)} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
                  <SelectField name="workPackageId" label={t("shiftWagon")} options={board.workPackages.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} defaultValue={board.workPackages[0].id} />
                  <TextField name="days" label={t("shiftDays")} inputMode="numeric" defaultValue="1" />
                  <SubmitButton variant="outline">{t("shift")}</SubmitButton>
                </ActionForm>
              )}
              {board.workPackages.length > 0 && areas.length > 0 && (
                <ActionForm action={createActivityAction.bind(null, companySlug, planId)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <SelectField name="workPackageId" label={t("workPackage")} options={board.workPackages.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
                  <SelectField name="taktAreaId" label={t("area")} options={areas} />
                  <SubmitButton variant="outline">{tc("add")}</SubmitButton>
                </ActionForm>
              )}
              <div className="flex flex-wrap gap-2">
                <ActionButton action={proposeAction.bind(null, companySlug, sel.id)} variant="default">
                  {t("propose")}
                </ActionButton>
                {hasBaseline && (
                  <ActionButton action={discardDraftAction.bind(null, companySlug, sel.id)} confirm={tc("confirmArchive")} variant="ghost">
                    {t("discardDraft")}
                  </ActionButton>
                )}
              </div>
            </div>
          )}

          {/* Approval */}
          {sel?.status === "PROPOSED" && (perms.approve || perms.manage) && (
            <div className="mt-4 space-y-3 border-t pt-4" data-testid="approval-tools">
              {perms.approve && (
                <ActionButton action={approveAction.bind(null, companySlug, sel.id)} confirm={t("approveConfirm")} variant="default">
                  {t("approve")}
                </ActionButton>
              )}
              <ActionForm action={returnToDraftAction.bind(null, companySlug, sel.id)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <TextField name="note" label={t("returnNote")} required />
                <SubmitButton variant="outline">{t("returnToDraft")}</SubmitButton>
              </ActionForm>
            </div>
          )}

          {/* New version from the baseline */}
          {perms.manage && hasBaseline && !hasOpen && (
            <ActionForm action={createDraftAction.bind(null, companySlug, planId)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <TextField name="reason" label={t("reason")} required />
              <SubmitButton>{t("newVersion")}</SubmitButton>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t("newVersionHint")}</p>
            </ActionForm>
          )}
        </Section>

        <Section title={sel ? `${t("board")} · ${t("version", { number: sel.versionNumber })}` : t("board")} className="order-3 md:order-1">
          <p className="mb-3 text-xs text-muted-foreground">{t("boardHint")}</p>
          {board.cycleDates.length === 0 ? (
            <EmptyState>{t("noVersion")}</EmptyState>
          ) : (
            <BoardGrid slug={companySlug} planId={planId} dates={board.cycleDates} today={board.today} buildings={board.buildings} activities={board.activities} />
          )}
          {unscheduled.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">{t("unscheduled")}</h3>
              <ul className="flex flex-wrap gap-2 text-sm">
                {unscheduled.map((a) => (
                  <li key={a.id}>
                    <Link href={`${base}/activities/${a.id}`} className="inline-flex min-h-9 items-center gap-2 rounded-md border px-2 hover:bg-muted">
                      <span aria-hidden className="size-3 rounded-sm" style={{ backgroundColor: a.workPackage.color }} />
                      {a.taktArea.code} · {a.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
