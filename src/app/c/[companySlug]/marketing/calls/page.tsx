import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Phone } from "lucide-react";
import { CALL_STATUSES } from "@/modules/marketing/rules";
import { marketingAccess, marketingService } from "@/modules/marketing/service";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { MarketingNav } from "../_components/marketing-nav";
import { recordCallAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("marketing"))("tabs.calls") };
}

const OPEN = new Set(["TODO", "NO_ANSWER"]);

export default async function CallsPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  if (!marketingAccess(ctx).approve) notFound();
  const [calls, drafts, t, format] = await Promise.all([loadOr404(marketingService.callList(ctx)), marketingService.listMessages(ctx, { status: "DRAFT" }), getTranslations("marketing"), getFormatter()]);
  const base = `/c/${companySlug}/marketing`;
  const open = calls.filter((c) => !c.callStatus || OPEN.has(c.callStatus));
  const done = calls.filter((c) => c.callStatus && !OPEN.has(c.callStatus));
  return (
    <>
      <PageHeader title={t("title")} description={t("callsIntro")} />
      <MarketingNav ctx={ctx} active="calls" pending={drafts.length} />
      <div className="space-y-4">
        {open.length === 0 ? (
          <EmptyState>{t("noCalls")}</EmptyState>
        ) : (
          open.map((c) => (
            <Section key={c.id} title={c.lead.title}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">{c.contact.name ?? c.contact.organization}</div>
                  <div className="text-xs text-muted-foreground">
                    {[c.contact.role, c.contact.organization].filter(Boolean).join(" · ")} · {t("sentAt")} {fmtDateTime(format, c.sentAt)} ·{" "}
                    <Link href={`${base}/${c.lead.id}`} className="underline">
                      {t("openLead")}
                    </Link>
                  </div>
                </div>
                <a href={`tel:${(c.contact.phone ?? "").replace(/[^+\d]/g, "")}`} className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-primary px-4 text-base font-medium text-primary-foreground" data-testid="call-button">
                  <Phone className="size-5" aria-hidden /> {c.contact.phone}
                </a>
              </div>
              {c.callScript && (
                <details className="mt-3 rounded-lg bg-muted/40 p-3" open>
                  <summary className="cursor-pointer text-sm font-medium">{t("callScript")}</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{c.callScript}</pre>
                </details>
              )}
              <ActionForm action={recordCallAction.bind(null, companySlug, c.id)} className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end" showSuccess>
                <SelectField name="callStatus" label={t("callOutcome")} defaultValue={c.callStatus === "NO_ANSWER" ? "NO_ANSWER" : "CALLED"} options={CALL_STATUSES.filter((s) => s !== "TODO").map((s) => ({ value: s, label: t(`callStatuses.${s}`) }))} />
                <TextField name="callNote" label={t("callNote")} defaultValue={c.callNote} />
                <SubmitButton>{t("saveCall")}</SubmitButton>
              </ActionForm>
            </Section>
          ))
        )}
        {done.length > 0 && (
          <Section title={t("callsDone")}>
            <ul className="divide-y text-sm">
              {done.map((c) => (
                <li key={c.id} className="py-2">
                  <span className="font-medium">{c.contact.name ?? c.contact.organization}</span> · {c.lead.title} · {t(`callStatuses.${c.callStatus!}`)}
                  {c.callNote ? ` – ${c.callNote}` : ""}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </>
  );
}
