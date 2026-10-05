import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { hseOverviewService } from "@/modules/hse/hse.service";
import { hseInspectionService } from "@/modules/hse/planning.service";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { fmtDate } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { ActionsList, NewActionForm, PhotoForm, Photos } from "../../_components/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hse"))("inspection") };
}

export default async function InspectionPage({ params }: { params: Promise<{ companySlug: string; inspectionId: string }> }) {
  const { companySlug, inspectionId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const i = await loadOr404(hseInspectionService.get(ctx, inspectionId));
  const [t, format] = await Promise.all([getTranslations("hse"), getFormatter()]);
  const members = i.can.addAction ? (await hseOverviewService.register(ctx, i.projectId)).members : [];
  return (
    <>
      <PageHeader title={`${t(`inspectionKinds.${i.kind}`)} ${fmtDate(format, i.inspectedOn)}`} backHref={`/c/${companySlug}/hse?project=${i.projectId}`} backLabel={t("title")} />
      <div className="space-y-4">
        <Section title={t("inspection")}>
          <DetailList
            items={[
              { label: t("inspectionIndex"), value: <span data-testid="inspection-index" className="text-lg font-semibold">{i.index === null ? "–" : `${i.index} %`}</span> },
              { label: t("correctCount"), value: i.correctCount },
              { label: t("incorrectCount"), value: i.incorrectCount },
              { label: t("notes"), value: i.notes },
              { label: t("createdBy"), value: i.createdById ? i.users[i.createdById] : null },
            ]}
          />
        </Section>
        <Section title={t("photos")}>
          <Photos slug={companySlug} photos={i.photos} />
          {i.can.addPhoto && (
            <div className="mt-3">
              <PhotoForm slug={companySlug} recordType="INSPECTION" recordId={i.id} />
            </div>
          )}
        </Section>
        <Section title={t("actions")}>
          <ActionsList slug={companySlug} actions={i.actions} userId={ctx.user.id} can={{ manage: i.can.addAction, approveActions: false }} />
          {i.can.addAction && <NewActionForm slug={companySlug} sourceType="INSPECTION" sourceId={i.id} members={members} />}
        </Section>
      </div>
    </>
  );
}
