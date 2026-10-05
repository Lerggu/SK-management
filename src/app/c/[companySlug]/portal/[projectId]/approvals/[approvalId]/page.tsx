import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { clientApprovalService } from "@/modules/commercial/client-approval.service";
import { ActionForm, TextareaField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime, fmtMoney } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { decideApprovalAction } from "../../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("portal"))("approval") };
}

/** The frozen version the client approves; the decision is bound to its SHA-256. */
export default async function ApprovalPage({ params }: { params: Promise<{ companySlug: string; projectId: string; approvalId: string }> }) {
  const { companySlug, projectId, approvalId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const a = await loadOr404(clientApprovalService.get(ctx, approvalId));
  const [t, format] = await Promise.all([getTranslations("portal"), getFormatter()]);
  const v = a.snapshot;
  return (
    <>
      <PageHeader
        title={`${t("variationNo", { n: v.number })} · ${v.title}`}
        description={<StatusBadge status={a.decision === "PENDING" ? "PENDING_APPROVAL" : a.decision === "APPROVED" ? "APPROVED" : a.decision === "REJECTED" ? "REJECTED" : "CLOSED"} label={t(`decisions.${a.decision}`)} />}
        backHref={`/c/${companySlug}/portal/${projectId}`}
        backLabel={`${a.project.code} · ${a.project.name}`}
      />
      <div className="space-y-4">
        <Section title={t("variation")}>
          <DetailList
            items={[
              { label: t("price"), value: <span data-testid="approval-price" className="text-lg font-semibold">{fmtMoney(format, v.salesPrice, v.currency)}</span> },
              { label: t("description"), value: v.description },
              { label: t("cause"), value: v.cause },
              { label: t("clientReference"), value: v.clientReference },
              { label: t("sentAt"), value: fmtDateTime(format, a.sentAt) },
              { label: t("decidedAt"), value: a.decidedAt ? `${a.decidedBy ?? "–"} · ${fmtDateTime(format, a.decidedAt)}` : null },
              { label: t("decisionNote"), value: a.decisionNote },
            ]}
          />
          <p className="mt-3 font-mono text-[11px] break-all text-muted-foreground" data-testid="approval-hash">
            {t("fingerprint")}: {a.contentSha256}
          </p>
        </Section>
        {a.canDecide && (
          <Section title={t("yourDecision")}>
            <p className="mb-3 text-sm text-muted-foreground">{t("decisionHint")}</p>
            <ActionForm action={decideApprovalAction.bind(null, companySlug, projectId, a.id)} className="space-y-3" data-testid="approval-form">
              <input type="hidden" name="contentSha256" value={a.contentSha256} />
              <TextareaField name="note" label={t("decisionNote")} hint={t("rejectNoteHint")} rows={2} />
              <div className="grid gap-2 sm:flex">
                <button type="submit" name="decision" value="APPROVED" className="h-12 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground md:h-10">
                  {t("approve")}
                </button>
                <button type="submit" name="decision" value="REJECTED" className="h-12 rounded-lg border border-destructive/40 px-5 text-sm text-destructive md:h-10">
                  {t("reject")}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{t("notSignature")}</p>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
