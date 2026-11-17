import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { marketingAccess, marketingService } from "@/modules/marketing/service";
import { ActionButton, ActionForm, SubmitButton, TextareaField, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { MarketingNav } from "../_components/marketing-nav";
import { approveMessageAction, rejectMessageAction, updateMessageAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("marketing"))("tabs.approvals") };
}

const VIEWS = ["DRAFT", "APPROVED", "SENT", "FAILED", "REJECTED"] as const;
const NOTICES = new Set(["sent", "approvedQueued", "errors.mailNotConfigured", "errors.noReplyTo", "errors.dailyLimit", "errors.suppressed"]);

export default async function ApprovalsPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ view?: string; notice?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  if (!marketingAccess(ctx).approve) notFound();
  const view = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as (typeof VIEWS)[number]) : "DRAFT";
  const [messages, drafts, t, format] = await Promise.all([
    loadOr404(marketingService.listMessages(ctx, { status: view })),
    view === "DRAFT" ? null : marketingService.listMessages(ctx, { status: "DRAFT" }),
    getTranslations("marketing"),
    getFormatter(),
  ]);
  const base = `/c/${companySlug}/marketing`;
  const pending = view === "DRAFT" ? messages.length : (drafts?.length ?? 0);
  return (
    <>
      <PageHeader title={t("title")} description={t("approvalsIntro")} />
      <MarketingNav ctx={ctx} active="approvals" pending={pending} />
      {sp.notice && NOTICES.has(sp.notice) && (
        <p role="status" data-testid="approval-notice" className={`mb-4 rounded-lg border px-3 py-2 text-sm ${sp.notice === "sent" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {t(sp.notice)}
        </p>
      )}
      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("tabs.approvals")}>
        {VIEWS.map((v) => (
          <Link key={v} href={`${base}/approvals?view=${v}`} aria-current={v === view ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm md:min-h-8 ${v === view ? "border-primary bg-primary/10 font-medium" : ""}`}>
            {t(`messageStatuses.${v}`)}
          </Link>
        ))}
      </nav>
      {messages.length === 0 ? (
        <EmptyState>{view === "DRAFT" ? t("noDrafts") : t("noMessages")}</EmptyState>
      ) : (
        <div className="space-y-4" data-testid="letters">
          {messages.map((m) => (
            <Section key={m.id} title={m.lead.title}>
              <p className="mb-3 text-xs text-muted-foreground">
                {t("to")}: {[m.contact.name, m.contact.role, m.contact.organization].filter(Boolean).join(" · ")} &lt;{m.contact.email}&gt; · {t("fitScore")} {m.lead.fitScore} ·{" "}
                <Link href={`${base}/${m.lead.id}`} className="underline">
                  {t("openLead")}
                </Link>
                {m.sentAt ? ` · ${t("sentAt")} ${fmtDateTime(format, m.sentAt)}` : ""}
                {m.error ? ` · ${m.error.startsWith("marketing.") ? t(m.error.replace("marketing.", "")) : m.error}` : ""}
              </p>
              {m.status === "DRAFT" ? (
                <>
                  <ActionForm action={updateMessageAction.bind(null, companySlug, m.id)} className="space-y-3" showSuccess data-testid="letter-form">
                    <TextField name="subject" label={t("subject")} defaultValue={m.subject} required />
                    <TextareaField name="body" label={t("body")} defaultValue={m.body} rows={10} />
                    <TextareaField name="callScript" label={t("callScript")} defaultValue={m.callScript} rows={4} />
                    <SubmitButton variant="outline">{t("saveDraft")}</SubmitButton>
                  </ActionForm>
                  <p className="mt-2 text-xs text-muted-foreground">{t("signatureHint")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionButton action={approveMessageAction.bind(null, companySlug, m.id)} variant="default" showSuccess>
                      {t("approveSend")}
                    </ActionButton>
                    <ActionButton action={rejectMessageAction.bind(null, companySlug, m.id)} variant="ghost">
                      {t("reject")}
                    </ActionButton>
                  </div>
                </>
              ) : (
                <>
                  <p className="font-medium">{m.subject}</p>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{m.body}</pre>
                  {(m.status === "FAILED" || m.status === "APPROVED") && (
                    <div className="mt-3">
                      <ActionButton action={rejectMessageAction.bind(null, companySlug, m.id)} variant="ghost">
                        {t("reject")}
                      </ActionButton>
                    </div>
                  )}
                </>
              )}
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
