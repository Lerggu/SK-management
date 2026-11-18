import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { marketingAccess, marketingService } from "@/modules/marketing/service";
import { LEAD_STATUSES, MARKETING_CATEGORIES } from "@/modules/marketing/rules";
import { ActionButton, ActionForm, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, RowLink, RowList, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime, fmtMoney } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { MarketingNav } from "./_components/marketing-nav";
import { LEAD_TONE } from "./_components/tone";
import { createLeadAction, startDiscoveryAction } from "./actions";

const RUN_SOURCES = new Set(["TED", "FI_INVESTMENTS", "FI_GRID_PERMITS", "SE_INVESTMENTS", "SE_GRID_PERMITS", "WATCHLIST", "DATA_CENTERS", "INDUSTRY", "GRID", "FI_PROCUREMENT"]);

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("marketing"))("title") };
}


export default async function MarketingPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ q?: string; status?: string; category?: string; all?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const access = marketingAccess(ctx);
  if (!access.view) notFound();
  const [overview, leads, t, format] = await Promise.all([
    loadOr404(marketingService.overview(ctx)),
    loadOr404(marketingService.listLeads(ctx, { q: sp.q, status: sp.status ?? "", category: sp.category ?? "", includeClosed: sp.all === "1" })),
    getTranslations("marketing"),
    getFormatter(),
  ]);
  const base = `/c/${companySlug}/marketing`;
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <MarketingNav ctx={ctx} active="register" pending={overview.pendingApprovals} />
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="marketing-kpis">
          <Kpi label={t("agentStatus")} value={overview.enabled ? t("agentOn") : t("agentOff")} hint={overview.lastRunAt ? `${t("lastRun")}: ${fmtDateTime(format, overview.lastRunAt)}` : t("neverRun")} />
          <Kpi label={t("leadsOpen")} value={String(leads.length)} hint={t("autoSendState", { state: overview.autoSend ? t("on") : t("off") })} />
          <Kpi label={t("pendingApprovals")} value={String(overview.pendingApprovals)} hint={t("openCalls", { count: overview.openCalls })} />
          <Kpi label={t("aiBudget")} value={`${overview.budget.usedEur.toFixed(2)} / ${overview.budget.limitEur.toFixed(2)} €`} hint={t("aiBudgetHint")} />
        </div>

        {access.manage && (
          <Section title={t("agents")}>
            <p className="mb-3 text-sm text-muted-foreground">{t("agentsHint")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <ActionButton action={startDiscoveryAction.bind(null, companySlug)} variant="default" showSuccess>
                {t("runNow")}
              </ActionButton>
            </div>
            {overview.runs.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-medium">{t("recentRuns")}</h3>
                <ul className="divide-y text-xs" data-testid="last-run">
                  {overview.runs.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                      <span className="tabular-nums text-muted-foreground">{fmtDateTime(format, r.startedAt)}</span>
                      <span className="font-medium">{r.kind === "DISCOVERY" ? t(`runSources.${RUN_SOURCES.has(r.source ?? "") ? r.source : "OTHER"}`) : t("runSources.DRAFT")}</span>
                      <span className={r.status === "SUCCEEDED" ? "text-emerald-700" : r.status === "RUNNING" ? "text-sky-700" : "text-destructive"}>{t(`runStatuses.${r.status}`)}</span>
                      {r.error && <span className="basis-full text-muted-foreground">{r.error.startsWith("marketing.") ? t(r.error.replace("marketing.", "")) : r.error}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        )}

        <Section title={t("register")}>
          <form method="get" className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <input name="q" defaultValue={sp.q ?? ""} placeholder={t("search")} className="h-11 min-w-0 rounded-lg border bg-background px-3 md:h-9" />
            <select name="status" defaultValue={sp.status ?? ""} className="h-11 rounded-lg border bg-background px-2 md:h-9" aria-label={t("status")}>
              <option value="">{t("allOpen")}</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`statuses.${s}`)}
                </option>
              ))}
            </select>
            <select name="category" defaultValue={sp.category ?? ""} className="h-11 rounded-lg border bg-background px-2 md:h-9" aria-label={t("category")}>
              <option value="">{t("allCategories")}</option>
              {MARKETING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
            <button type="submit" className="h-11 rounded-lg border px-4 md:h-9">
              {t("filter")}
            </button>
          </form>
          {leads.length === 0 ? (
            <EmptyState>{t("noLeads")}</EmptyState>
          ) : (
            <RowList>
              {leads.map((l) => (
                <RowLink
                  key={l.id}
                  href={`${base}/${l.id}`}
                  title={
                    <span className="flex items-center gap-2">
                      <span className="inline-flex min-w-9 justify-center rounded-md bg-primary/10 px-1.5 text-xs font-semibold tabular-nums text-primary" title={t("fitScore")}>
                        {l.fitScore}
                      </span>
                      {l.title}
                    </span>
                  }
                  subtitle={[t(`categories.${l.category}`), l.ownerOrg, [l.location, l.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                  meta={[l.budget ? fmtMoney(format, l.budget, l.currency ?? "EUR") : l.budgetText, l.timing, t("contactsCount", { count: l._count.contacts })].filter(Boolean).join(" · ")}
                  badge={<StatusBadge status={LEAD_TONE[l.status]} label={t(`statuses.${l.status}`)} />}
                />
              ))}
            </RowList>
          )}
        </Section>

        {access.manage && (
          <Section title={t("addLead")}>
            <ActionForm action={createLeadAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-3" data-testid="lead-form">
              <TextField name="title" label={t("leadTitle")} required className="sm:col-span-2" />
              <TextField name="country" label={t("country")} maxLength={2} autoCapitalize="characters" />
              <TextField name="ownerOrg" label={t("ownerOrg")} />
              <TextField name="location" label={t("location")} />
              <TextField name="sourceUrl" label={t("sourceUrl")} type="url" inputMode="url" />
              <div className="sm:col-span-3">
                <SubmitButton>{t("addLead")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
