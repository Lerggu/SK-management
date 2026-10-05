import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarRange } from "lucide-react";
import { taktPlanService } from "@/modules/takt/plan.service";
import { Button } from "@/ui/components/button";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate } from "@/ui/format";
import { requireCompanyContext } from "@/app/_lib/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("takt"))("title") };
}

export default async function TaktPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [plans, t, format] = await Promise.all([taktPlanService.list(ctx), getTranslations("takt"), getFormatter()]);
  const base = `/c/${companySlug}/takt`;
  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Button asChild variant="outline">
            <Link href={`${base}/lookahead`}>
              <CalendarRange aria-hidden /> {t("lookahead")}
            </Link>
          </Button>
        }
      />
      <Section title={t("plans")}>
        {plans.length === 0 ? (
          <EmptyState>{t("noPlans")}</EmptyState>
        ) : (
          <RowList>
            {plans.map((p) => {
              const current = p.versions.find((v) => v.status === "DRAFT" || v.status === "PROPOSED") ?? p.versions.find((v) => v.status === "BASELINE") ?? p.versions[0];
              return (
                <RowLink
                  key={p.id}
                  href={`${base}/${p.id}`}
                  title={p.name}
                  subtitle={`${p.site.project.code} · ${p.site.project.name} · ${p.site.name}`}
                  meta={[current ? t("planStart", { date: fmtDate(format, current.startDate) }) : t("noVersion"), t("activitiesN", { count: p._count.activities })].join(" · ")}
                  badge={current ? <StatusBadge status={current.status} label={`${t("version", { number: current.versionNumber })} · ${t(`versionStatuses.${current.status}`)}`} /> : undefined}
                />
              );
            })}
          </RowList>
        )}
      </Section>
    </>
  );
}
