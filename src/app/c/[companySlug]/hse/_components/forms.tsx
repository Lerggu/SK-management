import { getFormatter, getTranslations } from "next-intl/server";
import { HSE_CATEGORIES, INCIDENT_SEVERITIES, INCIDENT_TYPES, OBSERVATION_KINDS, PERMIT_TYPES, type HseMetrics } from "@/modules/hse/rules";
import { toLocalDateTimeInput } from "@/platform/i18n/time";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { ActionButton, ActionForm, FileField, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { EmptyState } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtNumber } from "@/ui/format";
import { addPhotoAction, createHseActionAction, hseActionStepAction, reportIncidentAction, reportObservationAction, requestPermitAction } from "../actions";

type Opt = { id: string; name?: string; title?: string };
const opts = (rows: Opt[]) => rows.map((r) => ({ value: r.id, label: r.name ?? r.title ?? r.id }));
const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic";

/** Safety observation / near miss: minimal typing, photo straight from the camera. */
export async function ObservationForm({ slug, projectId, sites, liftPlans = [], defaultKind = "SAFETY_OBSERVATION" }: { slug: string; projectId: string; sites: Opt[]; liftPlans?: Opt[]; defaultKind?: string }) {
  const t = await getTranslations("hse");
  return (
    <ActionForm action={reportObservationAction.bind(null, slug)} className="grid gap-3 sm:grid-cols-2" data-testid="observation-form">
      <input type="hidden" name="projectId" value={projectId} />
      <SelectField name="kind" label={t("kind")} required defaultValue={defaultKind} options={OBSERVATION_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))} />
      <SelectField name="category" label={t("category")} defaultValue="OTHER" options={HSE_CATEGORIES.map((k) => ({ value: k, label: t(`categories.${k}`) }))} />
      <TextField name="title" label={t("whatHappened")} required className="sm:col-span-2" />
      <SelectField name="severity" label={t("severity")} defaultValue="LOW" options={["LOW", "MEDIUM", "HIGH"].map((k) => ({ value: k, label: t(`severities.${k}`) }))} />
      <TextField name="occurredAt" label={t("occurredAt")} type="datetime-local" required defaultValue={toLocalDateTimeInput(new Date())} />
      {sites.length > 0 && <SelectField name="siteId" label={t("site")} placeholder={t("noSite")} options={opts(sites)} />}
      <TextField name="location" label={t("location")} />
      {liftPlans.length > 0 && <SelectField name="liftPlanId" label={t("liftPlan")} placeholder={t("none")} options={opts(liftPlans)} className="sm:col-span-2" />}
      <TextareaField name="description" label={t("description")} rows={3} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <FileField name="photo" label={t("photo")} hint={t("photoHint")} accept={PHOTO_ACCEPT} />
      </div>
      <div className="sm:col-span-2">
        <SubmitButton>{t("send")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export async function IncidentForm({ slug, projectId, sites, liftPlans = [] }: { slug: string; projectId: string; sites: Opt[]; liftPlans?: Opt[] }) {
  const t = await getTranslations("hse");
  return (
    <ActionForm action={reportIncidentAction.bind(null, slug)} className="grid gap-3 sm:grid-cols-2" data-testid="incident-form">
      <input type="hidden" name="projectId" value={projectId} />
      <SelectField name="type" label={t("incidentType")} required defaultValue="INJURY" options={INCIDENT_TYPES.map((k) => ({ value: k, label: t(`incidentTypes.${k}`) }))} />
      <SelectField name="severity" label={t("incidentSeverityLabel")} required defaultValue="FIRST_AID" options={INCIDENT_SEVERITIES.map((k) => ({ value: k, label: t(`incidentSeverity.${k}`) }))} hint={t("seriousHint")} />
      <TextField name="title" label={t("whatHappened")} required className="sm:col-span-2" />
      <TextField name="occurredAt" label={t("occurredAt")} type="datetime-local" required defaultValue={toLocalDateTimeInput(new Date())} />
      {sites.length > 0 && <SelectField name="siteId" label={t("site")} placeholder={t("noSite")} options={opts(sites)} />}
      <TextField name="location" label={t("location")} />
      {liftPlans.length > 0 && <SelectField name="liftPlanId" label={t("liftPlan")} placeholder={t("none")} options={opts(liftPlans)} />}
      <TextareaField name="description" label={t("description")} rows={3} className="sm:col-span-2" hint={t("noNamesHint")} />
      <TextareaField name="immediateActions" label={t("immediateActions")} rows={2} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <FileField name="photo" label={t("photo")} hint={t("photoHint")} accept={PHOTO_ACCEPT} />
      </div>
      <div className="sm:col-span-2">
        <SubmitButton>{t("sendIncident")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export async function PermitForm({ slug, projectId, sites, liftPlans = [] }: { slug: string; projectId: string; sites: Opt[]; liftPlans?: Opt[] }) {
  const t = await getTranslations("hse");
  const today = todayInDisplayZone();
  return (
    <ActionForm action={requestPermitAction.bind(null, slug)} className="grid gap-3 sm:grid-cols-2" data-testid="permit-form">
      <input type="hidden" name="projectId" value={projectId} />
      <SelectField name="type" label={t("permitType")} required defaultValue="HOT_WORK" options={PERMIT_TYPES.map((k) => ({ value: k, label: t(`permitTypes.${k}`) }))} />
      <TextField name="contractor" label={t("contractor")} />
      <TextField name="description" label={t("permitWork")} required className="sm:col-span-2" />
      <TextField name="validFrom" label={t("validFrom")} type="datetime-local" required defaultValue={`${today}T07:00`} />
      <TextField name="validTo" label={t("validTo")} type="datetime-local" required defaultValue={`${today}T15:00`} />
      {sites.length > 0 && <SelectField name="siteId" label={t("site")} placeholder={t("noSite")} options={opts(sites)} />}
      <TextField name="location" label={t("location")} />
      {liftPlans.length > 0 && <SelectField name="liftPlanId" label={t("liftPlan")} placeholder={t("none")} options={opts(liftPlans)} className="sm:col-span-2" />}
      <TextareaField name="precautions" label={t("precautions")} rows={2} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <SubmitButton>{t("requestPermit")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export async function PhotoForm({ slug, recordType, recordId }: { slug: string; recordType: "OBSERVATION" | "INCIDENT" | "INSPECTION" | "RISK_ASSESSMENT"; recordId: string }) {
  const t = await getTranslations("hse");
  return (
    <ActionForm action={addPhotoAction.bind(null, slug, recordType, recordId)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" showSuccess data-testid="photo-form">
      <FileField name="photo" label={t("addPhoto")} accept={PHOTO_ACCEPT} required />
      <SubmitButton variant="outline">{t("upload")}</SubmitButton>
    </ActionForm>
  );
}

export async function Photos({ slug, photos }: { slug: string; photos: { id: string; fileName: string }[] }) {
  const t = await getTranslations("hse");
  if (photos.length === 0) return <p className="text-sm text-muted-foreground">{t("noPhotos")}</p>;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="hse-photos">
      {photos.map((p) => (
        <li key={p.id}>
          <a href={`/c/${slug}/hse/photos/${p.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border">
            {/* eslint-disable-next-line @next/next/no-img-element -- authorized download route */}
            <img src={`/c/${slug}/hse/photos/${p.id}`} alt={p.fileName} className="aspect-square w-full object-cover" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export interface ActionRow {
  id: string;
  title: string;
  status: string;
  sourceType: string;
  dueDate: Date | null;
  assigneeId: string | null;
  doneNote?: string | null;
  overdue?: boolean;
  assignee?: { user: { name: string | null; email: string } } | null;
}

/** Corrective actions with the steps the member may take. */
export async function ActionsList({ slug, actions, userId, can }: { slug: string; actions: ActionRow[]; userId: string; can: { manage: boolean; approveActions: boolean } }) {
  const [t, format] = await Promise.all([getTranslations("hse"), getFormatter()]);
  if (actions.length === 0) return <EmptyState>{t("noActions")}</EmptyState>;
  return (
    <ul className="divide-y" data-testid="hse-actions">
      {actions.map((a) => {
        const verifier = a.sourceType === "INCIDENT" ? can.approveActions : can.manage;
        return (
          <li key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">{a.title}</p>
              <p className="text-xs text-muted-foreground">
                {[a.assignee?.user.name ?? a.assignee?.user.email, a.dueDate ? `${t("due")} ${fmtDate(format, a.dueDate)}` : null, a.doneNote].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {a.overdue && <StatusBadge status="REJECTED" label={t("overdue")} />}
              <StatusBadge status={a.status === "VERIFIED" ? "APPROVED" : a.status === "DONE" ? "PENDING_APPROVAL" : "OPEN"} label={t(`actionStatuses.${a.status}`)} />
              {a.status === "OPEN" && (can.manage || a.assigneeId === userId) && (
                <ActionButton action={hseActionStepAction.bind(null, slug, a.id, "done")}>{t("markDone")}</ActionButton>
              )}
              {a.status === "DONE" && verifier && (
                <>
                  <ActionButton action={hseActionStepAction.bind(null, slug, a.id, "verify")} variant="default">
                    {t("approveAction")}
                  </ActionButton>
                  <ActionButton action={hseActionStepAction.bind(null, slug, a.id, "reopen")}>{t("reopen")}</ActionButton>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Key figure tiles (internal register and the client portal). */
export async function MetricTiles({ m }: { m: Pick<HseMetrics, "ltif" | "reportRate" | "nearMisses" | "safetyObservations" | "incidents" | "lostTimeInjuries" | "openActions" | "overdueActions" | "toolboxTalks" | "latestInspectionIndex" | "hours"> }) {
  const [t, format] = await Promise.all([getTranslations("hse"), getFormatter()]);
  const n = (v: number | null, d = 1) => (v === null ? "–" : fmtNumber(format, v, d));
  const tiles = [
    { key: "ltif", label: t("metrics.ltif"), value: n(m.ltif), hint: t("metrics.ltifHint") },
    { key: "reportRate", label: t("metrics.reportRate"), value: n(m.reportRate, 2), hint: t("metrics.reportRateHint") },
    { key: "mvr", label: t("metrics.mvr"), value: m.latestInspectionIndex === null ? "–" : `${n(m.latestInspectionIndex)} %` },
    { key: "observations", label: t("metrics.observations"), value: String(m.safetyObservations + m.nearMisses), hint: t("metrics.nearMisses", { n: m.nearMisses }) },
    { key: "incidents", label: t("metrics.incidents"), value: String(m.incidents), hint: t("metrics.lti", { n: m.lostTimeInjuries }) },
    { key: "actions", label: t("metrics.openActions"), value: String(m.openActions), hint: t("metrics.overdue", { n: m.overdueActions }) },
    { key: "toolbox", label: t("metrics.toolboxTalks"), value: String(m.toolboxTalks) },
    { key: "hours", label: t("metrics.hours"), value: n(m.hours, 0) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="hse-metrics">
      {tiles.map((x) => (
        <div key={x.key} className="rounded-lg border bg-background p-3" data-testid={`metric-${x.key}`}>
          <dt className="text-xs text-muted-foreground">{x.label}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{x.value}</dd>
          {x.hint && <dd className="text-xs text-muted-foreground">{x.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** New corrective action for a record (hse.manage). */
export async function NewActionForm({ slug, sourceType, sourceId, members }: { slug: string; sourceType: "OBSERVATION" | "INCIDENT" | "INSPECTION" | "RISK_ASSESSMENT"; sourceId: string; members: { userId: string; name: string }[] }) {
  const [t, tc] = await Promise.all([getTranslations("hse"), getTranslations("common")]);
  return (
    <details className="mt-3 rounded-lg border p-3">
      <summary className="min-h-11 cursor-pointer content-center font-medium md:min-h-0">{t("newAction")}</summary>
      <ActionForm action={createHseActionAction.bind(null, slug)} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="action-form">
        <input type="hidden" name="sourceType" value={sourceType} />
        <input type="hidden" name="sourceId" value={sourceId} />
        <TextField name="title" label={t("actionTitle")} required className="sm:col-span-2" />
        <SelectField name="assigneeId" label={t("assignee")} placeholder={t("none")} options={members.map((m) => ({ value: m.userId, label: m.name }))} />
        <TextField name="dueDate" label={t("dueDate")} type="date" />
        <div className="sm:col-span-2">
          <SubmitButton>{tc("create")}</SubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}
