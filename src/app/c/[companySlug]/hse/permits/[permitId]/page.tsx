import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { workPermitService } from "@/modules/hse/planning.service";
import { ActionButton, ActionForm, TextField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { closePermitAction, decidePermitAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hse"))("permit") };
}

export default async function PermitPage({ params }: { params: Promise<{ companySlug: string; permitId: string }> }) {
  const { companySlug, permitId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const p = await loadOr404(workPermitService.get(ctx, permitId));
  const [t, format] = await Promise.all([getTranslations("hse"), getFormatter()]);
  const user = (id: string | null) => (id ? (p.users[id] ?? "–") : null);
  return (
    <>
      <PageHeader
        title={`${t("permit")} #${p.number} · ${t(`permitTypes.${p.type}`)}`}
        description={<StatusBadge status={p.status === "REQUESTED" ? "PENDING_APPROVAL" : p.status} label={t(`permitStatuses.${p.status}`)} />}
        backHref={ctx.external ? `/c/${companySlug}/portal/${p.projectId}` : `/c/${companySlug}/hse?project=${p.projectId}`}
        backLabel={ctx.external ? t("portal") : t("title")}
      />
      <div className="space-y-4">
        <Section title={t("permit")}>
          <DetailList
            items={[
              { label: t("permitWork"), value: p.description },
              { label: t("contractor"), value: p.contractor },
              { label: t("validFrom"), value: fmtDateTime(format, p.validFrom) },
              { label: t("validTo"), value: fmtDateTime(format, p.validTo) },
              { label: t("site"), value: p.site?.name },
              { label: t("location"), value: p.location },
              { label: t("liftPlan"), value: p.liftPlan?.title },
              { label: t("precautions"), value: p.precautions },
              { label: t("requestedBy"), value: user(p.createdById) },
              { label: t("decidedBy"), value: p.decidedAt ? `${user(p.decidedById)} · ${fmtDateTime(format, p.decidedAt)}` : null },
              { label: t("decisionNote"), value: p.decisionNote },
            ]}
          />
        </Section>
        {(p.can.decide || p.can.selfDecisionBlocked || p.can.close) && (
          <Section title={t("handling")}>
            <div className="space-y-4">
              {p.can.selfDecisionBlocked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("selfApprovalBlocked")}</p>}
              {p.can.decide && (
                <ActionForm action={decidePermitAction.bind(null, companySlug, p.id)} className="space-y-3" data-testid="permit-decide-form">
                  <TextField name="note" label={t("decisionNote")} hint={t("rejectNoteHint")} />
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" name="decision" value="APPROVE" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9">
                      {t("approvePermit")}
                    </button>
                    <button type="submit" name="decision" value="REJECT" className="h-11 rounded-lg border border-destructive/40 px-4 text-sm text-destructive md:h-9">
                      {t("rejectPermit")}
                    </button>
                  </div>
                </ActionForm>
              )}
              {p.can.close && <ActionButton action={closePermitAction.bind(null, companySlug, p.id)}>{t("closePermit")}</ActionButton>}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
