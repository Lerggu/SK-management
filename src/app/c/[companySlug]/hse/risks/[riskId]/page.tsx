import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { hseOverviewService } from "@/modules/hse/hse.service";
import { riskAssessmentService } from "@/modules/hse/planning.service";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { DetailList, EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { addRiskItemAction, riskStepAction, updateRiskAssessmentAction } from "../../actions";
import { ActionsList, NewActionForm } from "../../_components/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hse"))("riskAssessment") };
}

const LEVEL_TONE: Record<string, string> = { LOW: "APPROVED", MEDIUM: "PENDING_APPROVAL", HIGH: "REJECTED", CRITICAL: "REJECTED" };
const SCALE = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));

export default async function RiskPage({ params }: { params: Promise<{ companySlug: string; riskId: string }> }) {
  const { companySlug, riskId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const r = await loadOr404(riskAssessmentService.get(ctx, riskId));
  const [t, tc, format] = await Promise.all([getTranslations("hse"), getTranslations("common"), getFormatter()]);
  const reg = r.can.addAction || r.can.edit ? await hseOverviewService.register(ctx, r.projectId) : null;
  const user = (id: string | null) => (id ? (r.users[id] ?? "–") : null);
  return (
    <>
      <PageHeader
        title={r.title}
        description={<StatusBadge status={r.status} label={t(`riskStatuses.${r.status}`)} />}
        backHref={`/c/${companySlug}/hse?project=${r.projectId}`}
        backLabel={t("title")}
      />
      <div className="space-y-4">
        <Section title={t("riskAssessment")}>
          <DetailList
            items={[
              { label: t("site"), value: r.site?.name },
              { label: t("liftPlan"), value: r.liftPlan?.title },
              { label: t("workDescription"), value: r.workDescription },
              { label: t("createdBy"), value: user(r.createdById) },
              { label: t("approvedBy"), value: r.approvedAt ? `${user(r.approvedById)} · ${fmtDateTime(format, r.approvedAt)}` : null },
            ]}
          />
          {r.can.edit && reg && (
            <details className="mt-3 rounded-lg border p-3">
              <summary className="min-h-11 cursor-pointer content-center font-medium md:min-h-0">{tc("edit")}</summary>
              <ActionForm action={updateRiskAssessmentAction.bind(null, companySlug, r.id)} className="mt-3 grid gap-3 sm:grid-cols-2" showSuccess>
                <TextField name="title" label={t("riskTitle")} required defaultValue={r.title} />
                <SelectField name="siteId" label={t("site")} placeholder={t("noSite")} defaultValue={r.siteId} options={reg.sites.map((s) => ({ value: s.id, label: s.name }))} />
                <SelectField name="liftPlanId" label={t("liftPlan")} placeholder={t("none")} defaultValue={r.liftPlanId} options={reg.liftPlans.map((l) => ({ value: l.id, label: l.title }))} className="sm:col-span-2" />
                <TextareaField name="workDescription" label={t("workDescription")} defaultValue={r.workDescription} rows={2} className="sm:col-span-2" />
                <div className="sm:col-span-2">
                  <SubmitButton>{tc("save")}</SubmitButton>
                </div>
              </ActionForm>
            </details>
          )}
        </Section>
        <Section title={t("hazards")}>
          {r.items.length === 0 ? (
            <EmptyState>{t("noHazards")}</EmptyState>
          ) : (
            <ul className="divide-y" data-testid="risk-items">
              {r.items.map((i) => (
                <li key={i.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{i.hazard}</p>
                    {i.controls && <p className="text-sm text-muted-foreground">{t("controls")}: {i.controls}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusBadge status={LEVEL_TONE[i.level]} label={`${i.likelihood}×${i.consequence} = ${i.score} · ${t(`riskLevels.${i.level}`)}`} />
                    {i.residualScore !== null && i.residualLevel && <StatusBadge status={LEVEL_TONE[i.residualLevel]} label={`${t("residual")} ${i.residualScore}`} />}
                    {r.can.edit && (
                      <ActionButton action={riskStepAction.bind(null, companySlug, r.id, "removeItem")} hidden={{ itemId: i.id }}>
                        {tc("remove")}
                      </ActionButton>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {r.can.edit && (
            <ActionForm action={addRiskItemAction.bind(null, companySlug, r.id)} className="mt-3 grid gap-3 sm:grid-cols-4" data-testid="risk-item-form">
              <TextField name="hazard" label={t("hazard")} required className="sm:col-span-4" />
              <SelectField name="likelihood" label={t("likelihood")} defaultValue="3" options={SCALE} />
              <SelectField name="consequence" label={t("consequence")} defaultValue="3" options={SCALE} />
              <SelectField name="residualLikelihood" label={t("residualLikelihood")} placeholder="–" options={SCALE} />
              <SelectField name="residualConsequence" label={t("residualConsequence")} placeholder="–" options={SCALE} />
              <TextareaField name="controls" label={t("controls")} rows={2} className="sm:col-span-4" />
              <div className="sm:col-span-4">
                <SubmitButton>{t("addHazard")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>
        <Section title={t("actions")}>
          <ActionsList slug={companySlug} actions={r.actions} userId={ctx.user.id} can={{ manage: r.can.addAction, approveActions: false }} />
          {r.can.addAction && reg && <NewActionForm slug={companySlug} sourceType="RISK_ASSESSMENT" sourceId={r.id} members={reg.members} />}
        </Section>
        {(r.can.approve || r.can.selfApprovalBlocked || r.can.archive) && (
          <Section title={t("handling")}>
            <div className="flex flex-wrap items-start gap-2">
              {r.can.selfApprovalBlocked && <p className="w-full rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("selfApprovalBlocked")}</p>}
              {r.can.approve && (
                <ActionButton action={riskStepAction.bind(null, companySlug, r.id, "approve")} variant="default">
                  {t("approveRisk")}
                </ActionButton>
              )}
              {r.can.archive && <ActionButton action={riskStepAction.bind(null, companySlug, r.id, "archive")}>{tc("archive")}</ActionButton>}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
