import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ClipboardCheck, Eye, FileText, FileWarning } from "lucide-react";
import { portalService } from "@/modules/portal/service";
import { scheduleSummaryService } from "@/modules/takt/summary.service";
import { hseOverviewService } from "@/modules/hse/hse.service";
import { clientApprovalService } from "@/modules/commercial/client-approval.service";
import { documentService } from "@/modules/documents/service";
import { Button } from "@/ui/components/button";
import { ProgressBar } from "@/ui/components/progress-bar";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtDateTime, fmtMoney } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { MetricTiles } from "../../hse/_components/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("portal"))("title") };
}

type Props = { params: Promise<{ companySlug: string; projectId: string }>; searchParams: Promise<{ reported?: string; decided?: string }> };

export default async function PortalProjectPage({ params, searchParams }: Props) {
  const { companySlug, projectId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const project = await loadOr404(portalService.project(ctx, projectId));
  const s = project.sections;
  const [t, th, format, schedule, figures, approvals, documents, own] = await Promise.all([
    getTranslations("portal"),
    getTranslations("hse"),
    getFormatter(),
    s.client ? scheduleSummaryService.project(ctx, projectId) : Promise.resolve(null),
    s.client ? hseOverviewService.portalFigures(ctx, projectId) : Promise.resolve(null),
    s.approveVariations ? clientApprovalService.list(ctx, projectId) : Promise.resolve([]),
    s.documents ? documentService.list(ctx, { projectId }) : Promise.resolve([]),
    s.reportHse ? hseOverviewService.register(ctx, projectId) : Promise.resolve(null),
  ]);
  const base = `/c/${companySlug}`;
  const pending = approvals.filter((a) => a.decision === "PENDING");
  const decided = approvals.filter((a) => a.decision !== "PENDING");
  const q = `?project=${projectId}`;
  return (
    <>
      <PageHeader
        title={`${project.code} · ${project.name}`}
        description={[s.client ? t("clientPortal") : null, s.subcontractor ? t("subcontractorPortal") : null, project.sites.map((x) => x.name).join(", ")].filter(Boolean).join(" · ")}
        backHref={`${base}/portal`}
        backLabel={t("title")}
      />
      <div className="space-y-4">
        {sp.reported && <p role="status" className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800">{t("reportedThanks")}</p>}
        {sp.decided && <p role="status" className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800">{t("decisionSaved")}</p>}

        {s.reportHse && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="portal-quick">
            <Button asChild size="lg" className="h-14">
              <Link href={`${base}/hse/report${q}&kind=SAFETY_OBSERVATION`}>
                <Eye aria-hidden /> {th("reportObservation")}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-14">
              <Link href={`${base}/hse/report${q}&kind=NEAR_MISS`}>{th("reportNearMiss")}</Link>
            </Button>
            <Button asChild size="lg" variant="destructive" className="h-14">
              <Link href={`${base}/hse/report${q}&kind=INCIDENT`}>
                <FileWarning aria-hidden /> {th("reportIncident")}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-14">
              <Link href={`${base}/hse/report${q}&kind=PERMIT`}>
                <ClipboardCheck aria-hidden /> {th("requestPermit")}
              </Link>
            </Button>
          </div>
        )}

        {s.approveVariations && (
          <Section title={t("approvals")}>
            {pending.length === 0 ? (
              <EmptyState>{t("noPendingApprovals")}</EmptyState>
            ) : (
              <RowList>
                {pending.map((a) => (
                  <RowLink
                    key={a.id}
                    href={`${base}/portal/${projectId}/approvals/${a.id}`}
                    title={`${t("variationNo", { n: a.snapshot.number })} · ${a.snapshot.title}`}
                    subtitle={fmtMoney(format, a.snapshot.salesPrice, a.snapshot.currency)}
                    meta={fmtDateTime(format, a.sentAt)}
                    badge={<StatusBadge status="PENDING_APPROVAL" label={t("decisions.PENDING")} />}
                  />
                ))}
              </RowList>
            )}
            {decided.length > 0 && (
              <ul className="mt-3 divide-y text-sm" data-testid="decided-approvals">
                {decided.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`${base}/portal/${projectId}/approvals/${a.id}`} className="underline">
                      {t("variationNo", { n: a.snapshot.number })} · {a.snapshot.title}
                    </Link>
                    <StatusBadge status={a.decision === "APPROVED" ? "APPROVED" : a.decision === "REJECTED" ? "REJECTED" : "CLOSED"} label={t(`decisions.${a.decision}`)} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {schedule && (
          <Section title={t("schedule")}>
            {schedule.plans.length === 0 ? (
              <EmptyState>{t("noSchedule")}</EmptyState>
            ) : (
              <div className="space-y-4" data-testid="portal-schedule">
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{t("overallProgress")}</span>
                    <span className="tabular-nums">{schedule.progressPct} %</span>
                  </div>
                  <ProgressBar value={schedule.progressPct} label={t("overallProgress")} />
                  <p className="mt-1 text-xs text-muted-foreground">{t("activitiesComplete", { done: schedule.complete, total: schedule.activities })}</p>
                </div>
                <ul className="divide-y text-sm">
                  {schedule.plans.map((p) => (
                    <li key={p.id} className="py-2">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="font-medium">
                          {p.site} · {p.name}
                        </span>
                        <span className="tabular-nums">{p.progressPct} %</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {p.plannedStart && p.plannedFinish ? t("plannedSpan", { start: fmtDate(format, new Date(p.plannedStart)), finish: fmtDate(format, new Date(p.plannedFinish)) }) : t("noBaseline")}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        )}

        {figures && (
          <Section title={t("safety")}>
            <MetricTiles m={figures} />
            <p className="mt-2 text-xs text-muted-foreground">{t("safetyNote")}</p>
          </Section>
        )}

        {own && (
          <Section title={t("myReports")}>
            {own.incidents.length + own.observations.length + own.permits.length === 0 ? (
              <EmptyState>{t("noOwnReports")}</EmptyState>
            ) : (
              <RowList>
                {own.incidents.map((i) => (
                  <RowLink key={i.id} href={`${base}/hse/incidents/${i.id}`} title={`${th("incident")} #${i.number} ${i.title}`} meta={fmtDateTime(format, i.occurredAt)} badge={<StatusBadge status={i.status === "CLOSED" ? "CLOSED" : "OPEN"} label={th(`incidentStatuses.${i.status}`)} />} />
                ))}
                {own.observations.map((o) => (
                  <RowLink key={o.id} href={`${base}/hse/observations/${o.id}`} title={`${th(`kinds.${o.kind}`)} #${o.number} ${o.title}`} meta={fmtDateTime(format, o.occurredAt)} badge={<StatusBadge status={o.status === "CLOSED" ? "CLOSED" : "OPEN"} label={th(`observationStatuses.${o.status}`)} />} />
                ))}
                {own.permits.map((p) => (
                  <RowLink key={p.id} href={`${base}/hse/permits/${p.id}`} title={`${th("permit")} #${p.number} ${th(`permitTypes.${p.type}`)}`} subtitle={p.description} meta={fmtDateTime(format, p.validFrom)} badge={<StatusBadge status={p.status === "REQUESTED" ? "PENDING_APPROVAL" : p.status} label={th(`permitStatuses.${p.status}`)} />} />
                ))}
              </RowList>
            )}
          </Section>
        )}

        {s.documents && (
          <Section title={t("documents")}>
            {documents.length === 0 ? (
              <EmptyState>{t("noDocuments")}</EmptyState>
            ) : (
              <RowList>
                {documents.map((d) => (
                  <RowLink
                    key={d.id}
                    href={`${base}/documents/${d.id}`}
                    title={
                      <span className="inline-flex items-center gap-2">
                        <FileText className="size-4" aria-hidden /> {d.title}
                      </span>
                    }
                    subtitle={[d.documentNumber, d.currentVersion ? `v${d.currentVersion.versionNumber}${d.currentVersion.revisionLabel ? ` / ${d.currentVersion.revisionLabel}` : ""}` : null].filter(Boolean).join(" · ")}
                  />
                ))}
              </RowList>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
