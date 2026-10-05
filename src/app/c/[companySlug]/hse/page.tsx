import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { AlertTriangle, ClipboardCheck, Eye, FileWarning } from "lucide-react";
import { hseOverviewService } from "@/modules/hse/hse.service";
import { INSPECTION_KINDS, inspectionIndex } from "@/modules/hse/rules";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { Button } from "@/ui/components/button";
import { ActionForm, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { createInspectionAction, createRiskAssessmentAction, createToolboxTalkAction } from "./actions";
import { ActionsList, MetricTiles } from "./_components/forms";
import { ProjectPicker } from "./_components/project-picker";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hse"))("title") };
}

type Props = { params: Promise<{ companySlug: string }>; searchParams: Promise<{ project?: string }> };

const statusTone = (s: string) => (s === "CLOSED" ? "CLOSED" : s === "OPEN" || s === "REPORTED" ? "OPEN" : s === "INVESTIGATING" ? "PENDING_APPROVAL" : "IN_PROGRESS");

export default async function HsePage({ params, searchParams }: Props) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [projects, urgent, t, tc, format] = await Promise.all([hseOverviewService.projects(ctx), hseOverviewService.urgent(ctx), getTranslations("hse"), getTranslations("common"), getFormatter()]);
  const base = `/c/${companySlug}/hse`;
  const header = <PageHeader title={t("title")} description={t("intro")} />;
  if (projects.length === 0) {
    return (
      <>
        {header}
        <EmptyState>{t("noProjects")}</EmptyState>
      </>
    );
  }
  const projectId = projects.some((p) => p.id === sp.project) ? sp.project! : projects[0].id;
  const r = await loadOr404(hseOverviewService.register(ctx, projectId));
  const q = `?project=${projectId}`;
  const today = todayInDisplayZone();
  return (
    <>
      {header}
      <div className="space-y-4">
        {urgent.length > 0 && (
          <section className="rounded-xl border border-red-300 bg-red-50 p-4" data-testid="hse-urgent" aria-labelledby="urgent-title">
            <h2 id="urgent-title" className="flex items-center gap-2 font-semibold text-red-900">
              <AlertTriangle className="size-5" aria-hidden /> {t("urgentTitle")}
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              {urgent.map((u) => (
                <li key={u.id}>
                  <Link href={`${base}/incidents/${u.id}`} className="font-medium text-red-900 underline">
                    {u.project.code} #{u.number} {u.title}
                  </Link>{" "}
                  · {t(`incidentSeverity.${u.severity}`)} · {t(`incidentStatuses.${u.status}`)}
                </li>
              ))}
            </ul>
          </section>
        )}
        <ProjectPicker projects={projects} projectId={projectId} />

        {/* Fast actions: large touch targets for site personnel. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="hse-quick">
          <Button asChild size="lg" className="h-14">
            <Link href={`${base}/report${q}&kind=SAFETY_OBSERVATION`}>
              <Eye aria-hidden /> {t("reportObservation")}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-14">
            <Link href={`${base}/report${q}&kind=NEAR_MISS`}>{t("reportNearMiss")}</Link>
          </Button>
          <Button asChild size="lg" variant="destructive" className="h-14">
            <Link href={`${base}/report${q}&kind=INCIDENT`}>
              <FileWarning aria-hidden /> {t("reportIncident")}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-14">
            <Link href={`${base}/report${q}&kind=PERMIT`}>
              <ClipboardCheck aria-hidden /> {t("requestPermit")}
            </Link>
          </Button>
        </div>

        {r.metrics && (
          <Section title={t("keyFigures")}>
            <MetricTiles m={r.metrics} />
            <p className="mt-2 text-xs text-muted-foreground">{t("hoursNote")}</p>
          </Section>
        )}

        <Section title={t("incidents")}>
          {r.incidents.length === 0 ? (
            <EmptyState>{t("noIncidents")}</EmptyState>
          ) : (
            <RowList>
              {r.incidents.map((i) => (
                <RowLink
                  key={i.id}
                  href={`${base}/incidents/${i.id}`}
                  title={`#${i.number} ${i.title}`}
                  subtitle={`${t(`incidentTypes.${i.type}`)} · ${t(`incidentSeverity.${i.severity}`)}`}
                  meta={fmtDateTime(format, i.occurredAt)}
                  badge={<StatusBadge status={statusTone(i.status)} label={t(`incidentStatuses.${i.status}`)} />}
                />
              ))}
            </RowList>
          )}
        </Section>

        <Section title={t("observations")}>
          {r.observations.length === 0 ? (
            <EmptyState>{t("noObservations")}</EmptyState>
          ) : (
            <RowList>
              {r.observations.map((o) => (
                <RowLink
                  key={o.id}
                  href={`${base}/observations/${o.id}`}
                  title={`#${o.number} ${o.title}`}
                  subtitle={`${t(`kinds.${o.kind}`)} · ${t(`categories.${o.category}`)} · ${t(`severities.${o.severity}`)}`}
                  meta={fmtDateTime(format, o.occurredAt)}
                  badge={<StatusBadge status={statusTone(o.status)} label={t(`observationStatuses.${o.status}`)} />}
                />
              ))}
            </RowList>
          )}
        </Section>

        {!r.can.ownOnly && (
          <Section title={t("actions")}>
            <ActionsList slug={companySlug} actions={r.actions.filter((a) => a.status !== "VERIFIED")} userId={ctx.user.id} can={r.can} />
          </Section>
        )}

        <Section title={t("permits")}>
          {r.permits.length === 0 ? (
            <EmptyState>{t("noPermits")}</EmptyState>
          ) : (
            <RowList>
              {r.permits.map((p) => (
                <RowLink
                  key={p.id}
                  href={`${base}/permits/${p.id}`}
                  title={`#${p.number} ${t(`permitTypes.${p.type}`)}`}
                  subtitle={[p.description, p.contractor].filter(Boolean).join(" · ")}
                  meta={`${fmtDateTime(format, p.validFrom)} – ${fmtDateTime(format, p.validTo)}`}
                  badge={<StatusBadge status={p.status === "REQUESTED" ? "PENDING_APPROVAL" : p.status} label={t(`permitStatuses.${p.status}`)} />}
                />
              ))}
            </RowList>
          )}
        </Section>

        {!r.can.ownOnly && (
          <>
            <Section title={t("riskAssessments")}>
              {r.riskAssessments.length === 0 ? (
                <EmptyState>{t("noRiskAssessments")}</EmptyState>
              ) : (
                <RowList>
                  {r.riskAssessments.map((x) => (
                    <RowLink key={x.id} href={`${base}/risks/${x.id}`} title={x.title} subtitle={t("hazardCount", { n: x._count.items })} badge={<StatusBadge status={x.status} label={t(`riskStatuses.${x.status}`)} />} />
                  ))}
                </RowList>
              )}
              {r.can.manage && (
                <details className="mt-3 rounded-lg border p-3">
                  <summary className="min-h-11 cursor-pointer content-center font-medium md:min-h-0">{t("newRiskAssessment")}</summary>
                  <ActionForm action={createRiskAssessmentAction.bind(null, companySlug)} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="risk-form">
                    <input type="hidden" name="projectId" value={projectId} />
                    <TextField name="title" label={t("riskTitle")} required />
                    <SelectField name="siteId" label={t("site")} placeholder={t("noSite")} options={r.sites.map((s) => ({ value: s.id, label: s.name }))} />
                    <TextareaField name="workDescription" label={t("workDescription")} rows={2} className="sm:col-span-2" />
                    <div className="sm:col-span-2">
                      <SubmitButton>{tc("create")}</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              )}
            </Section>

            <Section title={t("inspections")}>
              {r.inspections.length === 0 ? (
                <EmptyState>{t("noInspections")}</EmptyState>
              ) : (
                <RowList>
                  {r.inspections.map((i) => (
                    <RowLink
                      key={i.id}
                      href={`${base}/inspections/${i.id}`}
                      title={`${t(`inspectionKinds.${i.kind}`)} ${fmtDate(format, i.inspectedOn)}`}
                      subtitle={t("inspectionCounts", { correct: i.correctCount, incorrect: i.incorrectCount })}
                      meta={`${inspectionIndex(i.correctCount, i.incorrectCount) ?? "–"} %`}
                    />
                  ))}
                </RowList>
              )}
              {r.can.manage && (
                <details className="mt-3 rounded-lg border p-3">
                  <summary className="min-h-11 cursor-pointer content-center font-medium md:min-h-0">{t("newInspection")}</summary>
                  <ActionForm action={createInspectionAction.bind(null, companySlug)} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="inspection-form">
                    <input type="hidden" name="projectId" value={projectId} />
                    <SelectField name="kind" label={t("inspectionKind")} defaultValue="MVR" options={INSPECTION_KINDS.map((k) => ({ value: k, label: t(`inspectionKinds.${k}`) }))} />
                    <TextField name="inspectedOn" label={t("inspectedOn")} type="date" required defaultValue={today} />
                    <TextField name="correctCount" label={t("correctCount")} inputMode="numeric" required />
                    <TextField name="incorrectCount" label={t("incorrectCount")} inputMode="numeric" required />
                    <SelectField name="siteId" label={t("site")} placeholder={t("noSite")} options={r.sites.map((s) => ({ value: s.id, label: s.name }))} />
                    <TextareaField name="notes" label={t("notes")} rows={2} className="sm:col-span-2" />
                    <div className="sm:col-span-2">
                      <SubmitButton>{tc("save")}</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              )}
            </Section>

            <Section title={t("toolboxTalks")}>
              {r.toolboxTalks.length === 0 ? (
                <EmptyState>{t("noToolboxTalks")}</EmptyState>
              ) : (
                <ul className="divide-y text-sm" data-testid="toolbox-list">
                  {r.toolboxTalks.map((x) => (
                    <li key={x.id} className="flex flex-wrap justify-between gap-2 py-2">
                      <span className="font-medium">{x.topic}</span>
                      <span className="text-muted-foreground">
                        {fmtDate(format, x.heldOn)} · {t("attendees", { n: x.attendeeCount })}
                        {x.presenter ? ` · ${x.presenter}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {r.can.create && (
                <details className="mt-3 rounded-lg border p-3">
                  <summary className="min-h-11 cursor-pointer content-center font-medium md:min-h-0">{t("newToolboxTalk")}</summary>
                  <ActionForm action={createToolboxTalkAction.bind(null, companySlug)} className="mt-3 grid gap-3 sm:grid-cols-2" showSuccess data-testid="toolbox-form">
                    <input type="hidden" name="projectId" value={projectId} />
                    <TextField name="topic" label={t("topic")} required />
                    <TextField name="heldOn" label={t("heldOn")} type="date" required defaultValue={today} />
                    <TextField name="attendeeCount" label={t("attendeeCount")} inputMode="numeric" required />
                    <TextField name="presenter" label={t("presenter")} />
                    <div className="sm:col-span-2">
                      <SubmitButton>{tc("save")}</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              )}
            </Section>
          </>
        )}
      </div>
    </>
  );
}
