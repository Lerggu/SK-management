import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { hseObservationService, hseOverviewService } from "@/modules/hse/hse.service";
import { HSE_CATEGORIES } from "@/modules/hse/rules";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { closeObservationAction, triageObservationAction } from "../../actions";
import { ActionsList, NewActionForm, PhotoForm, Photos } from "../../_components/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hse"))("observation") };
}

export default async function ObservationPage({ params, searchParams }: { params: Promise<{ companySlug: string; observationId: string }>; searchParams: Promise<{ photoError?: string }> }) {
  const { companySlug, observationId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const o = await loadOr404(hseObservationService.get(ctx, observationId));
  const [t, format] = await Promise.all([getTranslations("hse"), getFormatter()]);
  const members = o.can.addAction ? (await hseOverviewService.register(ctx, o.projectId)).members : [];
  const user = (id: string | null) => (id ? (o.users[id] ?? "–") : null);
  return (
    <>
      <PageHeader
        title={`#${o.number} ${o.title}`}
        description={<StatusBadge status={o.status === "CLOSED" ? "CLOSED" : "OPEN"} label={t(`observationStatuses.${o.status}`)} />}
        backHref={ctx.external ? `/c/${companySlug}/portal/${o.projectId}` : `/c/${companySlug}/hse?project=${o.projectId}`}
        backLabel={ctx.external ? t("portal") : t("title")}
      />
      <div className="space-y-4">
        {sp.photoError && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("photoFailed")}</p>}
        <Section title={t(`kinds.${o.kind}`)}>
          <DetailList
            items={[
              { label: t("category"), value: t(`categories.${o.category}`) },
              { label: t("severity"), value: t(`severities.${o.severity}`) },
              { label: t("occurredAt"), value: fmtDateTime(format, o.occurredAt) },
              { label: t("site"), value: o.site?.name },
              { label: t("location"), value: o.location },
              { label: t("liftPlan"), value: o.liftPlan?.title },
              { label: t("description"), value: o.description },
              { label: t("reportedBy"), value: user(o.createdById) },
              { label: t("triagedBy"), value: o.triagedAt ? `${user(o.triagedById)} · ${fmtDateTime(format, o.triagedAt)}` : null },
              { label: t("closedBy"), value: o.closedAt ? `${user(o.closedById)} · ${fmtDateTime(format, o.closedAt)}` : null },
              { label: t("closeNote"), value: o.closeNote },
            ]}
          />
        </Section>
        <Section title={t("photos")}>
          <Photos slug={companySlug} photos={o.photos} />
          {o.can.addPhoto && (
            <div className="mt-3">
              <PhotoForm slug={companySlug} recordType="OBSERVATION" recordId={o.id} />
            </div>
          )}
        </Section>
        {!o.ownOnly && (
          <Section title={t("actions")}>
            <ActionsList slug={companySlug} actions={o.actions} userId={ctx.user.id} can={{ manage: o.can.triage || o.can.close, approveActions: false }} />
            {o.can.addAction && <NewActionForm slug={companySlug} sourceType="OBSERVATION" sourceId={o.id} members={members} />}
          </Section>
        )}
        {(o.can.triage || o.can.close) && (
          <Section title={t("handling")}>
            <div className="space-y-4">
              {o.can.triage && (
                <ActionForm action={triageObservationAction.bind(null, companySlug, o.id)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" data-testid="triage-form">
                  <SelectField name="category" label={t("category")} defaultValue={o.category} options={HSE_CATEGORIES.map((k) => ({ value: k, label: t(`categories.${k}`) }))} />
                  <SelectField name="severity" label={t("severity")} defaultValue={o.severity} options={["LOW", "MEDIUM", "HIGH"].map((k) => ({ value: k, label: t(`severities.${k}`) }))} />
                  <SubmitButton>{t("triage")}</SubmitButton>
                </ActionForm>
              )}
              {o.can.close && (
                <ActionForm action={closeObservationAction.bind(null, companySlug, o.id)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" data-testid="close-form">
                  <TextField name="note" label={t("closeNote")} />
                  <SubmitButton variant="outline">{t("close")}</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
