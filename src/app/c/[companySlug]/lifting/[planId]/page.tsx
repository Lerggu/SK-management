import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { AlertTriangle, CheckCircle2, OctagonX } from "lucide-react";
import { liftPlanService } from "@/modules/lifting/lift.service";
import { bookingService } from "@/modules/logistics/booking.service";
import { toLocalDateTimeInput } from "@/platform/i18n/time";
import { ActionButton, ActionForm, CheckboxGroupField, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { DetailList, EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import {
  addLiftAccessoryAction,
  bookLiftCrewAction,
  cancelLiftAction,
  completeLiftAction,
  decideLiftAction,
  removeLiftAccessoryAction,
  returnLiftAction,
  reviseLiftAction,
  submitLiftAction,
  updateLiftDraftAction,
} from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("lifting"))("plan") };
}

type Plan = Awaited<ReturnType<typeof liftPlanService.get>>;
type Version = NonNullable<Plan["open"]>;
type T = Awaited<ReturnType<typeof getTranslations<"lifting">>>;

function Issues({ issues, t }: { issues: Version["issues"]; t: T }) {
  if (issues.length === 0)
    return (
      <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="lift-checks-ok">
        <CheckCircle2 className="size-4" aria-hidden /> {t("checksOk")}
      </p>
    );
  return (
    <ul className="space-y-1.5" data-testid="lift-issues">
      {issues.map((i, n) => (
        <li key={`${i.code}-${i.subject ?? n}`} data-code={i.code} data-severity={i.severity} className={i.severity === "block" ? "flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900" : "flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"}>
          {i.severity === "block" ? <OctagonX className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>
            {t(`issues.${i.code}`, { subject: i.subject ? (i.code === "INCOMPLETE" ? t(`fields.${i.subject}`) : i.subject) : "", value: i.value ?? 0 })}
          </span>
        </li>
      ))}
    </ul>
  );
}

function VersionDetails({ v, t, format }: { v: Version; t: T; format: Awaited<ReturnType<typeof getFormatter>> }) {
  return (
    <div className="space-y-4">
      <DetailList
        items={[
          { label: t("fields.loadDescription"), value: v.loadDescription },
          { label: t("fields.loadWeightKg"), value: v.loadWeightKg ? `${v.loadWeightKg} kg` : null },
          { label: t("fields.riggingWeightKg"), value: v.riggingWeightKg ? `${v.riggingWeightKg} kg` : null },
          { label: t("totalLoad"), value: v.totalLoadKg !== null ? `${format.number(v.totalLoadKg)} kg` : null },
          { label: t("fields.crane"), value: v.crane ? `${v.crane.assetNumber} ${v.crane.name}` : null },
          { label: t("fields.radiusM"), value: v.radiusM ? `${v.radiusM} m` : null },
          { label: t("fields.craneCapacityKg"), value: v.craneCapacityKg ? `${v.craneCapacityKg} kg` : null },
          { label: t("utilization"), value: v.utilizationPct !== null ? `${format.number(v.utilizationPct)} %` : null },
          { label: t("fields.cogNotes"), value: v.cogNotes },
          { label: t("fields.areaDescription"), value: v.areaDescription },
          { label: t("fields.safetyDistanceM"), value: v.safetyDistanceM ? `${v.safetyDistanceM} m` : null },
          { label: t("fields.riskDocument"), value: v.riskDocument ? `${v.riskDocument.documentNumber ?? ""} ${v.riskDocument.title}`.trim() : null },
          { label: t("changeReason"), value: v.changeReason },
        ]}
      />
      <div>
        <h3 className="mb-1 text-sm font-medium">{t("accessories")}</h3>
        {v.accessories.length === 0 ? (
          <p className="text-sm text-muted-foreground">–</p>
        ) : (
          <ul className="divide-y text-sm">
            {v.accessories.map((a) => (
              <li key={a.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                <span className="font-medium">{a.count} × {a.accessory.code}</span>
                <span>{a.accessory.name}</span>
                <span className="text-muted-foreground">WLL {a.accessory.wllKg} kg</span>
                <span className={a.accessory.inspectionDue ? "text-red-700" : "text-muted-foreground"}>
                  {t("inspection")}: {a.accessory.nextInspectionDate ?? "–"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default async function LiftPlanPage({ params }: { params: Promise<{ companySlug: string; planId: string }> }) {
  const { companySlug, planId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const p = await loadOr404(liftPlanService.get(ctx, planId));
  const [t, tc, format] = await Promise.all([getTranslations("lifting"), getTranslations("common"), getFormatter()]);
  const options = p.can.edit ? await liftPlanService.options(ctx, p.siteId) : null;
  const crew = p.can.book ? await bookingService.resourceOptions(ctx, p.projectId).catch(() => null) : null;
  const base = `/c/${companySlug}/lifting`;
  const user = (id: string | null) => p.users.find((u) => u.id === id)?.name ?? "–";
  const open = p.open;
  const shown = open ?? p.approved;
  const slug = companySlug;
  return (
    <>
      <PageHeader
        title={p.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} label={t(`planStatuses.${p.status}`)} />
            {p.approved && <StatusBadge status="APPROVED" label={t("approvedVersion", { n: p.approved.versionNumber })} />}
            {open && <StatusBadge status={open.status} label={`v${open.versionNumber} · ${t(`versionStatuses.${open.status}`)}`} />}
          </span>
        }
        backHref={`${base}?site=${p.siteId}`}
        backLabel={t("title")}
      />
      <div className="space-y-4">
        <Section title={t("lift")}>
          <DetailList
            items={[
              { label: t("site"), value: `${p.site.project.code} · ${p.site.name}` },
              { label: t("plannedStart"), value: `${fmtDateTime(format, p.plannedStart)} – ${fmtDateTime(format, p.plannedEnd)}` },
              {
                label: t("activity"),
                value: p.activity ? (
                  <Link href={`/c/${slug}/takt/${p.activity.planId}/activities/${p.activity.id}`} className="text-primary hover:underline">
                    {p.activity.taktArea.code} · {p.activity.workPackage.code} {p.activity.name}
                  </Link>
                ) : null,
              },
              {
                label: t("liftRequest"),
                value: p.request ? (
                  <Link href={`/c/${slug}/logistics/requests/${p.request.id}`} className="text-primary hover:underline">
                    {p.request.title}
                  </Link>
                ) : null,
              },
              { label: t("author"), value: user(p.createdById) },
              { label: t("completed"), value: p.completedAt ? `${user(p.completedById)} · ${fmtDateTime(format, p.completedAt)}` : null },
              { label: t("note"), value: p.completionNote },
            ]}
          />
          <p className="mt-4 text-xs text-muted-foreground">{t("approverHint")}</p>
        </Section>

        {shown && (
          <Section title={t("checks")}>
            <Issues issues={shown.issues} t={t} />
          </Section>
        )}

        {open && p.can.edit && options && (
          <Section title={t("editDraft", { n: open.versionNumber })}>
            <ActionForm action={updateLiftDraftAction.bind(null, slug, p.id)} className="grid gap-3 sm:grid-cols-2" showSuccess data-testid="lift-draft-form">
              <TextareaField name="loadDescription" label={t("fields.loadDescription")} defaultValue={open.loadDescription} className="sm:col-span-2" rows={2} />
              <TextField name="loadWeightKg" label={t("fields.loadWeightKg")} inputMode="decimal" defaultValue={open.loadWeightKg} />
              <TextField name="riggingWeightKg" label={t("fields.riggingWeightKg")} inputMode="decimal" defaultValue={open.riggingWeightKg} />
              <SelectField
                name="craneId"
                label={t("fields.crane")}
                placeholder={t("none")}
                defaultValue={open.crane?.id ?? null}
                options={options.cranes.map((c) => ({ value: c.id, label: `${c.assetNumber} ${c.name}` }))}
              />
              <TextField name="radiusM" label={t("fields.radiusM")} inputMode="decimal" defaultValue={open.radiusM} />
              <TextField name="craneCapacityKg" label={t("fields.craneCapacityKg")} hint={t("capacityHint")} inputMode="decimal" defaultValue={open.craneCapacityKg} />
              <TextField name="safetyDistanceM" label={t("fields.safetyDistanceM")} inputMode="decimal" defaultValue={open.safetyDistanceM} />
              <TextareaField name="cogNotes" label={t("fields.cogNotes")} defaultValue={open.cogNotes} rows={2} />
              <TextareaField name="areaDescription" label={t("fields.areaDescription")} defaultValue={open.areaDescription} rows={2} />
              <SelectField
                name="riskDocumentId"
                label={t("fields.riskDocument")}
                placeholder={t("none")}
                defaultValue={open.riskDocumentId}
                options={options.documents.map((d) => ({ value: d.id, label: `${d.documentNumber ?? ""} ${d.title}`.trim() }))}
                className="sm:col-span-2"
              />
              <div className="sm:col-span-2">
                <SubmitButton>{tc("save")}</SubmitButton>
              </div>
            </ActionForm>
            <div className="mt-6 border-t pt-4">
              <h3 className="mb-2 text-sm font-medium">{t("accessories")}</h3>
              {open.accessories.length > 0 && (
                <ul className="mb-3 divide-y text-sm" data-testid="lift-accessories">
                  {open.accessories.map((a) => (
                    <li key={a.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                      <span className="font-medium">{a.count} × {a.accessory.code}</span>
                      <span>{a.accessory.name}</span>
                      <span className="text-muted-foreground">WLL {a.accessory.wllKg} kg</span>
                      <ActionButton action={removeLiftAccessoryAction.bind(null, slug, p.id, a.accessory.id)} variant="ghost" className="ml-auto">
                        {t("remove")}
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              )}
              <ActionForm action={addLiftAccessoryAction.bind(null, slug, p.id)} className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end" data-testid="lift-accessory-form">
                <SelectField
                  name="accessoryId"
                  label={t("accessory")}
                  options={options.accessories.map((a) => ({ value: a.id, label: `${a.code} · ${a.name} · WLL ${a.wllKg} kg${a.inspectionDue ? ` · ${t("inspectionDue")}` : ""}` }))}
                />
                <TextField name="count" label={t("count")} type="number" min={1} max={100} defaultValue="1" inputMode="numeric" />
                <SubmitButton variant="outline">{t("addAccessory")}</SubmitButton>
              </ActionForm>
            </div>
            {p.can.submit && (
              <div className="mt-6 border-t pt-4">
                <ActionButton action={submitLiftAction.bind(null, slug, p.id)} variant="default">
                  {t("submit")}
                </ActionButton>
                <p className="mt-2 text-xs text-muted-foreground">{t("submitHint")}</p>
              </div>
            )}
          </Section>
        )}

        {open && open.status === "SUBMITTED" && (
          <Section title={t("submittedVersion", { n: open.versionNumber })}>
            <VersionDetails v={open} t={t} format={format} />
            <p className="mt-3 text-xs text-muted-foreground">{t("submittedBy", { name: user(open.submittedById), at: fmtDateTime(format, open.submittedAt) })}</p>
            {p.can.selfApprovalBlocked && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("selfApprovalBlocked")}</p>}
            {p.can.decide && (
              <ActionForm action={decideLiftAction.bind(null, slug, p.id)} className="mt-4 space-y-3 border-t pt-4" data-testid="lift-decision-form">
                <TextField name="note" label={t("decisionNote")} />
                {open.issues.length > 0 && (
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input type="checkbox" name="acknowledgeWarnings" className="size-5 accent-primary md:size-4" /> {t("acknowledgeWarnings")}
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="decision" value="APPROVE" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9">
                    {t("approve")}
                  </button>
                  <button type="submit" name="decision" value="REJECT" className="h-11 rounded-lg border border-destructive/40 px-4 text-sm text-destructive md:h-9">
                    {t("reject")}
                  </button>
                </div>
              </ActionForm>
            )}
            {p.can.returnToDraft && (
              <ActionForm action={returnLiftAction.bind(null, slug, p.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <TextField name="note" label={t("returnNote")} />
                <SubmitButton variant="outline">{t("returnToDraft")}</SubmitButton>
              </ActionForm>
            )}
          </Section>
        )}

        {p.approved && (
          <Section title={t("approvedVersion", { n: p.approved.versionNumber })}>
            <p className="mb-3 text-xs text-muted-foreground" data-testid="lift-approved-by">
              {t("approvedBy", { name: user(p.approved.decidedById), at: fmtDateTime(format, p.approved.decidedAt) })}
            </p>
            <VersionDetails v={p.approved} t={t} format={format} />
            <p className="mt-3 text-xs text-muted-foreground">{t("lockedHint")}</p>
          </Section>
        )}

        {(p.can.revise || p.can.complete || p.can.cancel) && (
          <Section title={t("actions")}>
            <div className="space-y-4">
              {p.can.complete && (
                <ActionForm action={completeLiftAction.bind(null, slug, p.id)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" data-testid="lift-complete-form">
                  <TextField name="note" label={t("completionNote")} />
                  <SubmitButton>{t("complete")}</SubmitButton>
                </ActionForm>
              )}
              {p.can.revise && (
                <ActionForm action={reviseLiftAction.bind(null, slug, p.id)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" data-testid="lift-revise-form">
                  <TextField name="reason" label={t("changeReason")} required />
                  <SubmitButton variant="outline">{t("revise")}</SubmitButton>
                </ActionForm>
              )}
              {p.can.cancel && (
                <ActionForm action={cancelLiftAction.bind(null, slug, p.id)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <TextField name="note" label={t("cancelNote")} />
                  <SubmitButton variant="outline">{t("cancel")}</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Section>
        )}

        <Section title={t("crew")}>
          {p.bookings.length === 0 ? (
            <EmptyState>{t("noCrew")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="lift-crew">
              {p.bookings.map((b) => (
                <li key={b.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                  <StatusBadge status={b.status === "REQUESTED" ? "PENDING_APPROVAL" : b.status} label={b.status} />
                  <span className="font-medium">{b.label}</span>
                  {b.detail && <span className="text-muted-foreground">{b.detail}</span>}
                  <span className="text-muted-foreground">
                    {fmtDateTime(format, b.startsAt)} – {format.dateTime(b.endsAt, { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {crew && p.status === "OPEN" && (
            <ActionForm action={bookLiftCrewAction.bind(null, slug)} className="mt-4 space-y-3 border-t pt-4" showSuccess data-testid="lift-crew-form">
              <input type="hidden" name="projectId" value={p.projectId} />
              <input type="hidden" name="siteId" value={p.siteId} />
              <input type="hidden" name="liftPlanId" value={p.id} />
              {p.activity && <input type="hidden" name="activityId" value={p.activity.id} />}
              <CheckboxGroupField name="resources" label={t("crewResources")} options={crew.own.filter((o) => o.kind === "EMPLOYEE").map((o) => ({ value: o.value, label: `${o.label}${o.detail ? ` · ${o.detail}` : ""}` }))} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField name="startsAt" label={t("plannedStart")} type="datetime-local" step={900} defaultValue={toLocalDateTimeInput(p.plannedStart)} />
                <TextField name="endsAt" label={t("plannedEnd")} type="datetime-local" step={900} defaultValue={toLocalDateTimeInput(p.plannedEnd)} />
              </div>
              <SubmitButton variant="outline">{t("bookCrew")}</SubmitButton>
            </ActionForm>
          )}
        </Section>

        <Section title={t("versions")}>
          <ul className="divide-y text-sm" data-testid="lift-versions">
            {p.versions.map((v) => (
              <li key={v.id} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1">
                <span className="font-medium">v{v.versionNumber}</span>
                <StatusBadge status={v.status} label={t(`versionStatuses.${v.status}`)} />
                {v.changeReason && <span>{v.changeReason}</span>}
                {v.decidedAt && (
                  <span className="text-muted-foreground">
                    {user(v.decidedById)} · {fmtDate(format, v.decidedAt)}
                    {v.decisionNote ? ` · ${v.decisionNote}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
