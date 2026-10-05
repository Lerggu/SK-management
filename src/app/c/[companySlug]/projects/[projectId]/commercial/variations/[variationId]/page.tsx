import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { variationService } from "@/modules/commercial/project.service";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime, fmtMoney } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { approveVariationAction, clientDecisionAction, publishToClientAction, returnVariationAction, updateVariationAction, variationStepAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("commercial"))("variation") };
}

const FLOW = ["DRAFT", "INTERNAL_REVIEW", "SUBMITTED_TO_CLIENT", "APPROVED", "EXECUTED", "READY_TO_INVOICE", "INVOICED"] as const;

export default async function VariationPage({ params }: { params: Promise<{ companySlug: string; projectId: string; variationId: string }> }) {
  const { companySlug, projectId, variationId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const v = await loadOr404(variationService.get(ctx, variationId));
  const [t, tc, format] = await Promise.all([getTranslations("commercial"), getTranslations("common"), getFormatter()]);
  const money = (x: string) => fmtMoney(format, x, v.currency);
  const user = (id: string | null) => v.users.find((u) => u.id === id)?.name ?? "–";
  const slug = companySlug;
  const step = FLOW.indexOf(v.status as (typeof FLOW)[number]);
  return (
    <>
      <PageHeader
        title={`${t("variationNo", { n: v.number })} · ${v.title}`}
        description={<StatusBadge status={v.status === "REJECTED" ? "REJECTED" : v.status === "INVOICED" ? "COMPLETE" : v.status === "DRAFT" ? "DRAFT" : "PENDING_APPROVAL"} label={t(`variationStatuses.${v.status}`)} />}
        backHref={`/c/${slug}/projects/${projectId}/commercial`}
        backLabel={t("title")}
      />
      <div className="space-y-4">
        <ol className="flex flex-wrap gap-1 text-xs" data-testid="variation-flow">
          {FLOW.map((s, i) => (
            <li key={s} className={i <= step && v.status !== "REJECTED" ? "rounded bg-primary/10 px-2 py-1 font-medium text-primary" : "rounded bg-muted px-2 py-1 text-muted-foreground"}>
              {t(`variationStatuses.${s}`)}
            </li>
          ))}
        </ol>
        <Section title={t("variation")}>
          <DetailList
            items={[
              { label: t("contract"), value: v.contract?.contractNumber },
              { label: t("cause"), value: v.cause },
              { label: t("clientReference"), value: v.clientReference },
              { label: t("description"), value: v.description },
              { label: t("costTotal"), value: money(v.cost) },
              { label: t("markupPct"), value: `${v.markupPct} %` },
              { label: t("salesPrice"), value: <span data-testid="variation-price" className="font-semibold">{money(v.salesPrice)}</span> },
              { label: t("evidence"), value: v.evidenceDocument?.title },
              { label: t("submitted"), value: v.submittedAt ? `${user(v.submittedById)} · ${fmtDateTime(format, v.submittedAt)}` : null },
              { label: t("internalApproval"), value: v.internalApprovedAt ? `${user(v.internalApprovedBy)} · ${fmtDateTime(format, v.internalApprovedAt)}` : null },
              { label: t("clientDecision"), value: v.clientDecisionAt ? fmtDateTime(format, v.clientDecisionAt) : null },
              { label: t("decisionNote"), value: v.decisionNote },
            ]}
          />
        </Section>

        {v.clientApprovals.length > 0 && (
          <Section title={t("clientPortal")}>
            <ul className="divide-y text-sm" data-testid="client-approvals">
              {v.clientApprovals.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {fmtDateTime(format, c.sentAt)} · {money((c.snapshot as { salesPrice: string }).salesPrice)}
                    {c.decidedAt ? ` · ${user(c.decidedById)} · ${fmtDateTime(format, c.decidedAt)}` : ""}
                    {c.channel ? ` · ${t(`approvalChannels.${c.channel}`)}` : ""}
                  </span>
                  <StatusBadge status={c.decision === "APPROVED" ? "APPROVED" : c.decision === "REJECTED" ? "REJECTED" : c.decision === "PENDING" ? "PENDING_APPROVAL" : "CLOSED"} label={t(`clientDecisions.${c.decision}`)} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{t("clientPortalHint")}</p>
          </Section>
        )}

        {v.can.edit && (
          <Section title={t("pricing")}>
            <ActionForm action={updateVariationAction.bind(null, slug, v.id)} className="grid gap-3 sm:grid-cols-3" showSuccess data-testid="variation-draft-form">
              <TextField name="title" label={t("variationTitle")} required defaultValue={v.title} className="sm:col-span-3" />
              <TextField name="laborCost" label={t("costs.labor")} inputMode="decimal" defaultValue={v.laborCost} />
              <TextField name="equipmentCost" label={t("costs.equipment")} inputMode="decimal" defaultValue={v.equipmentCost} />
              <TextField name="materialsCost" label={t("costs.materials")} inputMode="decimal" defaultValue={v.materialsCost} />
              <TextField name="subcontractCost" label={t("costs.subcontract")} inputMode="decimal" defaultValue={v.subcontractCost} />
              <TextField name="otherCost" label={t("costs.other")} inputMode="decimal" defaultValue={v.otherCost} />
              <TextField name="markupPct" label={t("markupPct")} inputMode="decimal" defaultValue={v.markupPct} />
              <TextField name="cause" label={t("cause")} defaultValue={v.cause} className="sm:col-span-2" />
              <TextField name="clientReference" label={t("clientReference")} defaultValue={v.clientReference} />
              <TextareaField name="description" label={t("description")} defaultValue={v.description} className="sm:col-span-3" rows={3} />
              <SelectField name="evidenceDocumentId" label={t("evidence")} placeholder={t("none")} options={v.documents.map((d) => ({ value: d.id, label: `${d.documentNumber ?? ""} ${d.title}`.trim() }))} defaultValue={v.evidenceDocumentId} className="sm:col-span-3" />
              <div className="sm:col-span-3">
                <SubmitButton>{tc("save")}</SubmitButton>
              </div>
            </ActionForm>
            {v.can.submit && (
              <div className="mt-4 border-t pt-4">
                <ActionButton action={variationStepAction.bind(null, slug, v.id, "submit")} variant="default">
                  {t("submitForReview")}
                </ActionButton>
                <p className="mt-2 text-xs text-muted-foreground">{t("approverHint")}</p>
              </div>
            )}
          </Section>
        )}

        {(v.can.approveInternal || v.can.selfApprovalBlocked || v.can.returnToDraft || v.can.clientDecision || v.can.publishToClient || v.can.execute || v.can.readyToInvoice) && (
          <Section title={t("actions")}>
            <div className="space-y-4">
              {v.can.selfApprovalBlocked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("selfApprovalBlocked")}</p>}
              {v.can.approveInternal && (
                <ActionForm action={approveVariationAction.bind(null, slug, v.id)} className="space-y-3" data-testid="variation-approve-form">
                  <TextField name="note" label={t("decisionNote")} />
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" name="decision" value="APPROVE" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9">
                      {t("approveInternal")}
                    </button>
                    <button type="submit" name="decision" value="REJECT" className="h-11 rounded-lg border px-4 text-sm md:h-9">
                      {t("returnToDraft")}
                    </button>
                  </div>
                </ActionForm>
              )}
              {v.can.returnToDraft && !v.can.approveInternal && (
                <ActionForm action={returnVariationAction.bind(null, slug, v.id)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <TextField name="note" label={t("decisionNote")} />
                  <SubmitButton variant="outline">{t("returnToDraft")}</SubmitButton>
                </ActionForm>
              )}
              {v.can.clientDecision && (
                <ActionForm action={clientDecisionAction.bind(null, slug, v.id)} className="grid gap-3 sm:grid-cols-2" data-testid="variation-client-form">
                  <TextField name="clientReference" label={t("clientReference")} defaultValue={v.clientReference} hint={t("evidenceHint")} />
                  <SelectField name="evidenceDocumentId" label={t("evidence")} placeholder={t("none")} options={v.documents.map((d) => ({ value: d.id, label: `${d.documentNumber ?? ""} ${d.title}`.trim() }))} defaultValue={v.evidenceDocumentId} />
                  <TextField name="note" label={t("decisionNote")} className="sm:col-span-2" />
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <button type="submit" name="decision" value="APPROVED" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9">
                      {t("clientApproved")}
                    </button>
                    <button type="submit" name="decision" value="REJECTED" className="h-11 rounded-lg border border-destructive/40 px-4 text-sm text-destructive md:h-9">
                      {t("clientRejected")}
                    </button>
                  </div>
                </ActionForm>
              )}
              {v.can.publishToClient && (
                <ActionButton action={publishToClientAction.bind(null, slug, v.id)}>{t("publishToClient")}</ActionButton>
              )}
              {v.can.execute && (
                <ActionButton action={variationStepAction.bind(null, slug, v.id, "execute")} variant="default">
                  {t("markExecuted")}
                </ActionButton>
              )}
              {v.can.readyToInvoice && (
                <ActionButton action={variationStepAction.bind(null, slug, v.id, "ready")} variant="default">
                  {t("markReady")}
                </ActionButton>
              )}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
