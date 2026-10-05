import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { hseOverviewService, incidentService } from "@/modules/hse/hse.service";
import { INCIDENT_SEVERITIES, INCIDENT_TYPES } from "@/modules/hse/rules";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { addPersonAction, closeIncidentAction, recordInvestigationAction, startInvestigationAction, triageIncidentAction } from "../../actions";
import { ActionsList, NewActionForm, PhotoForm, Photos } from "../../_components/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hse"))("incident") };
}

const FLOW = ["REPORTED", "TRIAGED", "INVESTIGATING", "CLOSED"] as const;

export default async function IncidentPage({ params, searchParams }: { params: Promise<{ companySlug: string; incidentId: string }>; searchParams: Promise<{ photoError?: string }> }) {
  const { companySlug, incidentId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const i = await loadOr404(incidentService.get(ctx, incidentId));
  const [t, format] = await Promise.all([getTranslations("hse"), getFormatter()]);
  const members = i.can.addAction ? (await hseOverviewService.register(ctx, i.projectId)).members : [];
  const user = (id: string | null) => (id ? (i.users[id] ?? "–") : null);
  const step = FLOW.indexOf(i.status);
  const manage = i.can.triage || i.can.addAction;
  return (
    <>
      <PageHeader
        title={`${t("incident")} #${i.number} · ${i.title}`}
        description={<StatusBadge status={i.status === "CLOSED" ? "CLOSED" : i.status === "REPORTED" ? "OPEN" : "PENDING_APPROVAL"} label={t(`incidentStatuses.${i.status}`)} />}
        backHref={ctx.external ? `/c/${companySlug}/portal/${i.projectId}` : `/c/${companySlug}/hse?project=${i.projectId}`}
        backLabel={ctx.external ? t("portal") : t("title")}
      />
      <div className="space-y-4">
        {sp.photoError && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("photoFailed")}</p>}
        <ol className="flex flex-wrap gap-1 text-xs" data-testid="incident-flow">
          {FLOW.map((s, n) => (
            <li key={s} className={n <= step ? "rounded bg-primary/10 px-2 py-1 font-medium text-primary" : "rounded bg-muted px-2 py-1 text-muted-foreground"}>
              {t(`incidentStatuses.${s}`)}
            </li>
          ))}
        </ol>
        {i.can.requiresInvestigation && i.status !== "CLOSED" && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("investigationRequired")}</p>}
        <Section title={t("incident")}>
          <DetailList
            items={[
              { label: t("incidentType"), value: t(`incidentTypes.${i.type}`) },
              { label: t("incidentSeverityLabel"), value: <span data-testid="incident-severity">{t(`incidentSeverity.${i.severity}`)}</span> },
              { label: t("occurredAt"), value: fmtDateTime(format, i.occurredAt) },
              { label: t("site"), value: i.site?.name },
              { label: t("location"), value: i.location },
              { label: t("liftPlan"), value: i.liftPlan?.title },
              { label: t("description"), value: i.description },
              { label: t("immediateActions"), value: i.immediateActions },
              { label: t("reportedBy"), value: user(i.createdById) },
              { label: t("notified"), value: i.notifiedAt ? fmtDateTime(format, i.notifiedAt) : null },
              { label: t("triagedBy"), value: i.triagedAt ? `${user(i.triagedById)} · ${fmtDateTime(format, i.triagedAt)}` : null },
              { label: t("investigator"), value: user(i.investigatorId) },
              { label: t("rootCause"), value: i.rootCause },
              { label: t("lostDays"), value: i.lostDays },
              { label: t("closedBy"), value: i.closedAt ? `${user(i.closedById)} · ${fmtDateTime(format, i.closedAt)}` : null },
            ]}
          />
        </Section>
        <Section title={t("photos")}>
          <Photos slug={companySlug} photos={i.photos} />
          {i.can.addPhoto && (
            <div className="mt-3">
              <PhotoForm slug={companySlug} recordType="INCIDENT" recordId={i.id} />
            </div>
          )}
        </Section>
        {i.persons && (
          <Section title={t("injuredPersons")}>
            <p className="mb-2 text-xs text-muted-foreground">{t("personalDataNote")}</p>
            {i.persons.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPersons")}</p>
            ) : (
              <ul className="divide-y text-sm" data-testid="incident-persons">
                {i.persons.map((p) => (
                  <li key={p.id} className="py-2">
                    <span className="font-medium">{p.personName}</span>
                    {[p.employerName, p.bodyPart, p.injuryDescription, p.absenceDays !== null ? t("absenceDays", { n: p.absenceDays }) : null].filter(Boolean).map((x) => ` · ${x}`)}
                  </li>
                ))}
              </ul>
            )}
            {i.can.addPerson && (
              <ActionForm action={addPersonAction.bind(null, companySlug, i.id)} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="person-form">
                <TextField name="personName" label={t("personName")} required />
                <TextField name="employerName" label={t("employer")} />
                <TextField name="bodyPart" label={t("bodyPart")} />
                <TextField name="absenceDays" label={t("absenceDaysLabel")} inputMode="numeric" />
                <TextareaField name="injuryDescription" label={t("injuryDescription")} rows={2} className="sm:col-span-2" />
                <div className="sm:col-span-2">
                  <SubmitButton>{t("addPerson")}</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Section>
        )}
        {!i.ownOnly && (
          <Section title={t("correctiveActions")}>
            {i.can.actionsPending && i.actions.length > 0 && <p className="mb-2 text-xs text-muted-foreground">{t("actionsPendingHint")}</p>}
            <ActionsList slug={companySlug} actions={i.actions} userId={ctx.user.id} can={{ manage, approveActions: i.can.approveActions }} />
            {i.can.addAction && <NewActionForm slug={companySlug} sourceType="INCIDENT" sourceId={i.id} members={members} />}
          </Section>
        )}
        {(i.can.triage || i.can.startInvestigation || i.can.recordInvestigation || i.can.close || i.can.closeBlocked) && (
          <Section title={t("handling")}>
            <div className="space-y-4">
              {i.can.triage && (
                <ActionForm action={triageIncidentAction.bind(null, companySlug, i.id)} className="grid gap-3 sm:grid-cols-2" data-testid="incident-triage-form">
                  <SelectField name="type" label={t("incidentType")} defaultValue={i.type} options={INCIDENT_TYPES.map((k) => ({ value: k, label: t(`incidentTypes.${k}`) }))} />
                  <SelectField name="severity" label={t("incidentSeverityLabel")} defaultValue={i.severity} options={INCIDENT_SEVERITIES.map((k) => ({ value: k, label: t(`incidentSeverity.${k}`) }))} />
                  <TextareaField name="immediateActions" label={t("immediateActions")} defaultValue={i.immediateActions} rows={2} className="sm:col-span-2" />
                  <div className="sm:col-span-2">
                    <SubmitButton>{t("triage")}</SubmitButton>
                  </div>
                </ActionForm>
              )}
              {i.can.startInvestigation && (
                <ActionButton action={startInvestigationAction.bind(null, companySlug, i.id)} variant="default">
                  {t("startInvestigation")}
                </ActionButton>
              )}
              {i.can.recordInvestigation && (
                <ActionForm action={recordInvestigationAction.bind(null, companySlug, i.id)} className="grid gap-3 sm:grid-cols-[1fr_10rem]" showSuccess data-testid="investigation-form">
                  <TextareaField name="rootCause" label={t("rootCause")} defaultValue={i.rootCause} rows={3} />
                  <TextField name="lostDays" label={t("lostDays")} inputMode="numeric" defaultValue={i.lostDays} />
                  <div className="sm:col-span-2">
                    <SubmitButton>{t("saveInvestigation")}</SubmitButton>
                  </div>
                </ActionForm>
              )}
              {i.can.closeBlocked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("closeBlocked")}</p>}
              {i.can.close && (
                <ActionForm action={closeIncidentAction.bind(null, companySlug, i.id)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" data-testid="incident-close-form">
                  <TextField name="note" label={t("closeNote")} />
                  <SubmitButton variant="outline">{t("closeIncident")}</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
