import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { taktActivityService } from "@/modules/takt/activity.service";
import { CONSTRAINT_TYPES, DEPENDENCY_TYPES } from "@/modules/takt/schemas";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { DetailList, EmptyState, PageHeader, Section } from "@/ui/components/page";
import { ProgressBar } from "@/ui/components/progress-bar";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import {
  addConstraintAction,
  addDependencyAction,
  archiveActivityAction,
  clearConstraintAction,
  recordProgressAction,
  removeAssignmentAction,
  removeDependencyAction,
  setAssignmentAction,
  setBlockedAction,
  updateActivityAction,
} from "../../../actions";
import { taktPlanService } from "@/modules/takt/plan.service";
import { bookingService } from "@/modules/logistics/booking.service";
import { createBookingAction } from "../../../../logistics/actions";
import { materialTraceService } from "@/modules/lifting/material.service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("takt"))("activity") };
}

type Props = { params: Promise<{ companySlug: string; planId: string; activityId: string }> };

export default async function ActivityPage({ params }: Props) {
  const { companySlug, planId, activityId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const d = await loadOr404(taktActivityService.get(ctx, activityId));
  if (d.plan.id !== planId) notFound();
  const [t, tc, format] = await Promise.all([getTranslations("takt"), getTranslations("common"), getFormatter()]);
  const a = d.activity;
  const perms = d.permissions;
  const board = perms.manage ? await taktPlanService.board(ctx, planId) : null;
  const draft = board?.versions.find((x) => x.status === "DRAFT") ?? null;
  const draftAssignment = draft && board?.selected?.id === draft.id ? board.activities.find((x) => x.id === a.id)?.assignment : null;
  const base = `/c/${companySlug}/takt/${planId}`;
  const [tl, resourceOptions] = await Promise.all([getTranslations("logistics"), perms.book ? bookingService.resourceOptions(ctx, d.plan.projectId).catch(() => null) : Promise.resolve(null)]);
  const lg = `/c/${companySlug}/logistics`;
  const [trace, tm] = await Promise.all([materialTraceService.activity(ctx, a.id).catch(() => null), getTranslations("materials")]);
  const hasTrace = !!trace && trace.lifts.length + trace.batches.length + trace.drums.length + trace.pulls.length > 0;
  const dtf = (x: Date) => format.dateTime(x, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const depLabel = (x: { taktArea: { code: string }; workPackage: { code: string; name: string }; name: string }) => `${x.taktArea.code} · ${x.workPackage.code} ${x.name}`;

  return (
    <>
      <PageHeader
        title={`${a.taktArea.code} · ${a.name}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} label={t(`statuses.${d.status}`)} />
            {d.reasons.map((r) => (
              <span key={r} className="text-sm">
                {t(`reasons.${r}`)}
              </span>
            ))}
          </span>
        }
        backHref={base}
        backLabel={d.plan.name}
      />
      <div className="space-y-4">
        <Section title={tc("details")}>
          <DetailList
            items={[
              { label: t("area"), value: `${a.taktArea.code} · ${a.taktArea.name} (${a.taktArea.building.name})` },
              { label: t("workPackage"), value: `${a.workPackage.code} · ${a.workPackage.name}` },
              {
                label: t("planned"),
                value: (
                  <>
                    {d.baselineSpan ? <span className="block">{t("baselinePlanned", { start: fmtDate(format, new Date(d.baselineSpan.start)), end: fmtDate(format, new Date(d.baselineSpan.end)) })}</span> : null}
                    {d.openSpan ? <span className="block">{t("draftPlanned", { number: d.openSpan.versionNumber, start: fmtDate(format, new Date(d.openSpan.start)), end: fmtDate(format, new Date(d.openSpan.end)) })}</span> : null}
                    {!d.baselineSpan && !d.openSpan ? t("notScheduled") : null}
                  </>
                ),
              },
              { label: t("actual"), value: a.actualStart ? `${fmtDate(format, a.actualStart)} – ${a.actualEnd ? fmtDate(format, a.actualEnd) : "…"}` : "–" },
              { label: t("crew"), value: a.crewSize > 0 ? t("crewValue", { size: a.crewSize, trade: a.crewTrade ?? a.workPackage.trade ?? "–" }) : "–" },
              { label: t("equipment"), value: a.equipmentType ? `${a.equipmentCount} × ${a.equipmentType.name}` : "–" },
            ]}
          />
          <div className="mt-4 flex items-center gap-2">
            <ProgressBar value={a.progressPct} label={t("progress")} />
            <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums" data-testid="progress-pct">
              {a.progressPct} %
            </span>
          </div>
          {a.blocked && (
            <div role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm">
              <p className="font-medium">
                {t("blocked")}: {a.delayReason}
              </p>
              {a.recoveryAction && (
                <p>
                  {t("recoveryAction")}: {a.recoveryAction}
                </p>
              )}
            </div>
          )}
        </Section>

        {perms.progress && (
          <Section title={t("recordProgress")}>
            <ActionForm action={recordProgressAction.bind(null, companySlug, a.id)} className="grid gap-3 sm:grid-cols-[8rem_10rem_1fr_auto] sm:items-end" data-testid="progress-form">
              <SelectField name="progressPct" label={t("progressPct")} options={[0, 10, 25, 50, 75, 90, 100].map((n) => ({ value: String(n), label: `${n} %` }))} defaultValue={String(Math.min(100, Math.ceil((a.progressPct + 1) / 25) * 25))} />
              <TextField name="reportDate" label={t("reportDate")} type="date" defaultValue={d.today} />
              <TextField name="note" label={t("note")} />
              <SubmitButton>{t("recordProgress")}</SubmitButton>
            </ActionForm>
            <ActionForm action={setBlockedAction.bind(null, companySlug, a.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
              <input type="hidden" name="blocked" value={a.blocked ? "" : "on"} />
              {!a.blocked && <TextField name="delayReason" label={t("delayReason")} required />}
              <TextField name="recoveryAction" label={t("recoveryAction")} defaultValue={a.recoveryAction} />
              <div className="sm:col-span-2">
                <SubmitButton variant={a.blocked ? "default" : "outline"}>{a.blocked ? t("unblock") : t("markBlocked")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}

        <Section title={t("constraints")}>
          {a.constraints.length === 0 ? (
            <EmptyState>{t("noConstraints")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="constraints">
              {a.constraints.map((c) => (
                <li key={c.id} className="flex min-h-12 flex-wrap items-center gap-2 py-2" data-status={c.status}>
                  <StatusBadge status={c.status} label={t(`constraintStatuses.${c.status}`)} />
                  <span className="font-medium">{t(`constraintTypes.${c.type}`)}</span>
                  <span className="min-w-0 flex-1">{c.description}</span>
                  {c.dueDate && <span className="text-muted-foreground">{fmtDate(format, c.dueDate)}</span>}
                  {perms.progress && c.status === "OPEN" && (
                    <ActionButton action={clearConstraintAction.bind(null, companySlug, c.id)} variant="outline">
                      {t("clear")}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {perms.progress && (
            <ActionForm action={addConstraintAction.bind(null, companySlug, a.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[12rem_1fr_10rem_auto] sm:items-end">
              <SelectField name="type" label={t("constraintType")} options={CONSTRAINT_TYPES.map((c) => ({ value: c, label: t(`constraintTypes.${c}`) }))} defaultValue="MATERIAL" />
              <TextField name="description" label={tc("notes")} required />
              <TextField name="dueDate" label={t("dueDate")} type="date" />
              <SubmitButton variant="outline">{t("addConstraint")}</SubmitButton>
            </ActionForm>
          )}
        </Section>

        <Section title={t("dependencies")}>
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <h3 className="mb-1 font-medium">{t("predecessors")}</h3>
              {a.predecessors.length === 0 ? (
                <p className="text-muted-foreground">{t("noDependencies")}</p>
              ) : (
                <ul className="space-y-1">
                  {a.predecessors.map((p) => (
                    <li key={p.id} className="flex min-h-9 items-center gap-2">
                      <span className="font-mono text-xs">{p.type}{p.lagDays ? ` ${p.lagDays > 0 ? "+" : ""}${p.lagDays}` : ""}</span>
                      <span className="flex-1">{depLabel(p.predecessor)}</span>
                      {perms.manage && (
                        <ActionButton action={removeDependencyAction.bind(null, companySlug, p.id)} variant="ghost">
                          {tc("remove")}
                        </ActionButton>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-1 font-medium">{t("successors")}</h3>
              {a.successors.length === 0 ? (
                <p className="text-muted-foreground">{t("noDependencies")}</p>
              ) : (
                <ul className="space-y-1">
                  {a.successors.map((s) => (
                    <li key={s.id} className="flex min-h-9 items-center gap-2">
                      <span className="font-mono text-xs">{s.type}</span>
                      <span>{depLabel(s.successor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {perms.manage && d.otherActivities.length > 0 && (
            <ActionForm action={addDependencyAction.bind(null, companySlug, a.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_10rem_7rem_auto] sm:items-end">
              <SelectField name="predecessorId" label={t("predecessor")} options={d.otherActivities.map((o) => ({ value: o.id, label: o.label }))} />
              <SelectField name="type" label={t("dependencyType")} options={DEPENDENCY_TYPES.map((x) => ({ value: x, label: `${x} · ${t(`dependencyTypes.${x}`)}` }))} defaultValue="FS" />
              <TextField name="lagDays" label={t("lagDays")} inputMode="numeric" defaultValue="0" />
              <SubmitButton variant="outline">{t("addDependency")}</SubmitButton>
            </ActionForm>
          )}
        </Section>

        {perms.manage && (
          <Section title={t("editActivity")}>
            <ActionForm action={updateActivityAction.bind(null, companySlug, a.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end" showSuccess>
              <TextField name="name" label={tc("name")} defaultValue={a.name} required className="lg:col-span-2" />
              <TextField name="crewTrade" label={t("trade")} defaultValue={a.crewTrade} />
              <TextField name="crewSize" label={t("crewSize")} inputMode="numeric" defaultValue={a.crewSize} />
              <SelectField name="equipmentTypeId" label={t("equipmentType")} placeholder="–" options={d.equipmentTypes.map((e) => ({ value: e.id, label: e.name }))} defaultValue={a.equipmentTypeId} />
              <TextField name="equipmentCount" label={t("equipmentCount")} inputMode="numeric" defaultValue={a.equipmentCount} />
              <div className="sm:col-span-2 lg:col-span-5">
                <SubmitButton variant="outline">{tc("save")}</SubmitButton>
              </div>
            </ActionForm>
            {draft && (
              <div className="mt-4 border-t pt-4">
                <h3 className="mb-2 text-sm font-semibold">
                  {t("schedule")} · {t("version", { number: draft.versionNumber })}
                </h3>
                <ActionForm action={setAssignmentAction.bind(null, companySlug, draft.id, a.id)} className="grid gap-3 sm:grid-cols-[10rem_10rem_auto] sm:items-end">
                  <TextField name="startCycle" label={t("startCycle")} inputMode="numeric" defaultValue={draftAssignment?.startCycle ?? 0} hint={t("scheduleHint")} />
                  <TextField name="durationCycles" label={t("durationLabel")} inputMode="numeric" defaultValue={draftAssignment?.durationCycles ?? a.workPackage.defaultDurationCycles} />
                  <SubmitButton variant="outline">{t("saveSchedule")}</SubmitButton>
                </ActionForm>
                {draftAssignment && (
                  <div className="mt-2">
                    <ActionButton action={removeAssignmentAction.bind(null, companySlug, draft.id, a.id)} variant="ghost">
                      {t("removeFromVersion")}
                    </ActionButton>
                  </div>
                )}
              </div>
            )}
            <div className="mt-4 border-t pt-4">
              <ActionButton action={archiveActivityAction.bind(null, companySlug, planId, a.id)} confirm={tc("confirmArchive")} variant="destructive">
                {t("archiveActivity")}
              </ActionButton>
            </div>
          </Section>
        )}

        {d.logistics && (
          <Section title={t("logistics")}>
            {d.requirements.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-1 text-sm font-semibold">{t("requirements")}</h3>
                <ul className="flex flex-wrap gap-2 text-sm" data-testid="activity-requirements">
                  {d.requirements.map((r) => (
                    <li key={r.id} className="rounded-md bg-muted px-2 py-1">
                      {r.quantity} × {r.kind === "TRADE" ? r.trade : r.equipmentType?.name} · {fmtDate(format, r.startDate)}–{fmtDate(format, r.endDate)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.logistics.requests.length + d.logistics.deliveries.length + d.logistics.bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noLogistics")}</p>
            ) : (
              <ul className="divide-y text-sm" data-testid="activity-logistics">
                {d.logistics.requests.map((r) => (
                  <li key={r.id} className="flex min-h-11 flex-wrap items-center gap-2 py-1">
                    <StatusBadge status={r.status === "COMPLETE" ? "COMPLETED" : r.status} label={tl(`requestStatuses.${r.status}`)} />
                    <a href={`${lg}/requests/${r.id}`} className="font-medium hover:underline">{r.title}</a>
                    <span className="text-muted-foreground">{tl(`serviceTypes.${r.serviceType}`)} · {dtf(r.requestedStart)}</span>
                  </li>
                ))}
                {d.logistics.deliveries.map((x) => (
                  <li key={x.id} className="flex min-h-11 flex-wrap items-center gap-2 py-1">
                    <StatusBadge status={x.status === "INSTALLED" ? "COMPLETED" : x.status} label={tl(`deliveryStatuses.${x.status}`)} />
                    <a href={`${lg}/deliveries/${x.id}`} className="font-medium hover:underline">{x.material}</a>
                    <span className="text-muted-foreground">{x.supplier} · {dtf(x.slotStart)}</span>
                  </li>
                ))}
                {d.logistics.bookings.map((b) => (
                  <li key={b.id} className="flex min-h-11 flex-wrap items-center gap-2 py-1">
                    <StatusBadge status={b.status === "REQUESTED" ? "PENDING_APPROVAL" : b.status} label={tl(`bookingStatuses.${b.status}`)} />
                    <span className="font-medium">{b.employee ? `${b.employee.lastName} ${b.employee.firstName}` : `${b.equipment!.assetNumber} ${b.equipment!.name}`}</span>
                    <span className="text-muted-foreground">{dtf(b.startsAt)}–{dtf(b.endsAt)} · {b.ownerCompany.name}</span>
                  </li>
                ))}
              </ul>
            )}
            {resourceOptions && (
              <ActionForm action={createBookingAction.bind(null, companySlug)} className="mt-4 space-y-3 border-t pt-4" data-testid="activity-booking-form">
                <h3 className="text-sm font-semibold">{t("bookResource")}</h3>
                <input type="hidden" name="projectId" value={d.plan.projectId} />
                <input type="hidden" name="activityId" value={a.id} />
                {d.requirements.length > 0 && (
                  <SelectField name="requirementId" label={t("requirements")} placeholder="–" options={d.requirements.map((r) => ({ value: r.id, label: `${r.quantity} × ${r.kind === "TRADE" ? r.trade : r.equipmentType?.name}` }))} />
                )}
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {[...resourceOptions.own, ...resourceOptions.group].map((o) => (
                    <label key={o.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded px-2 hover:bg-muted md:min-h-9">
                      <input type="checkbox" name="resources" value={o.value} className="size-5 accent-primary md:size-4" />
                      <span className="text-sm">
                        {o.label}
                        <span className="text-muted-foreground">{o.detail ? ` · ${o.detail}` : ""}{"owner" in o ? ` · ${o.owner}` : ""}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <TextField name="startsAt" label={tl("startsAt")} type="datetime-local" defaultValue={`${d.baselineSpan?.start ?? d.today}T07:00`} required />
                  <TextField name="endsAt" label={tl("endsAt")} type="datetime-local" defaultValue={`${d.baselineSpan?.end ?? d.today}T15:30`} required />
                  <SubmitButton variant="outline">{tl("book")}</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Section>
        )}

        {trace && (trace.permissions.material || trace.permissions.lifts) && (
          <Section title={tm("trace")}>
            {!hasTrace ? (
              <EmptyState>{tm("noTrace")}</EmptyState>
            ) : (
              <div className="space-y-4 text-sm" data-testid="activity-trace">
                {trace.lifts.length > 0 && (
                  <div>
                    <h3 className="mb-1 font-medium">{tm("lifts")}</h3>
                    <ul className="divide-y">
                      {trace.lifts.map((l) => (
                        <li key={l.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                          <a href={`/c/${companySlug}/lifting/${l.id}`} className="font-medium hover:underline">{l.title}</a>
                          <StatusBadge status={l.status === "OPEN" ? (l.approved ? "APPROVED" : "DRAFT") : l.status} label={tm(`liftState.${l.status === "OPEN" ? (l.approved ? "APPROVED" : "PENDING") : l.status}`)} />
                          <span className="text-muted-foreground">{fmtDateTime(format, l.plannedStart)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {trace.batches.length > 0 && (
                  <div>
                    <h3 className="mb-1 font-medium">{tm("batches")}</h3>
                    <ul className="divide-y">
                      {trace.batches.map((b) => (
                        <li key={b.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                          <a href={`/c/${companySlug}/materials/batches/${b.id}`} className="font-medium hover:underline">{b.code} · {b.material}</a>
                          <span>{b.quantity} {b.unit}</span>
                          <StatusBadge status={b.status} label={tm(`statuses.${b.status}`)} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(trace.drums.length > 0 || trace.pulls.length > 0) && (
                  <div>
                    <h3 className="mb-1 font-medium">{tm("cablePulledTotal", { metres: format.number(trace.totalPulledM) })}</h3>
                    <ul className="divide-y">
                      {trace.pulls.map((p) => (
                        <li key={p.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                          <span className="font-semibold tabular-nums">{format.number(Number(p.lengthM))} m</span>
                          <a href={`/c/${companySlug}/materials/drums/${p.drum.id}`} className="hover:underline">{p.drum.code} · {p.drum.cableType}</a>
                          <span className="text-muted-foreground">{p.pulledOn}</span>
                        </li>
                      ))}
                      {trace.drums
                        .filter((x) => !trace.pulls.some((p) => p.drum.id === x.id))
                        .map((x) => (
                          <li key={x.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                            <a href={`/c/${companySlug}/materials/drums/${x.id}`} className="hover:underline">{x.code} · {x.cableType}</a>
                            <span className="text-muted-foreground">{tm("reservedRemaining", { metres: x.remainingM })}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        <Section title={t("progressHistory")}>
          {a.progress.length === 0 ? (
            <EmptyState>{t("noProgress")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="progress-history">
              {a.progress.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{fmtDate(format, p.reportDate)}</span>
                  <span className="w-12 shrink-0 font-semibold tabular-nums">{p.progressPct} %</span>
                  <span className="min-w-0 flex-1">{p.note}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.by?.name ?? p.by?.email ?? ""} · {fmtDateTime(format, p.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
