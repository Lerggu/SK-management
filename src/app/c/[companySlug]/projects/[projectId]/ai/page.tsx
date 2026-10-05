import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { aiProjectControllerService } from "@/modules/ai/service";
import { ActionButton, ActionForm, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime, fmtMoney } from "@/ui/format";
import { cn } from "@/ui/lib/utils";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { askAction, decideRecommendationAction, reviewAction, setBudgetAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ai"))("title") };
}

const SEVERITY_TONE: Record<string, string> = {
  INFO: "border-l-sky-500",
  WARNING: "border-l-amber-500",
  CRITICAL: "border-l-red-600",
};
const KIND_TONE: Record<string, string> = { FACT: "CURRENT", FORECAST: "PLANNED", AI_RECOMMENDATION: "PROPOSED" };
const RUN_TONE: Record<string, string> = { SUCCEEDED: "APPROVED", FAILED: "REJECTED", BLOCKED_BUDGET: "ON_HOLD" };
const REC_TONE: Record<string, string> = { PROPOSED: "PROPOSED", ACCEPTED: "APPROVED", DISMISSED: "DISCARDED" };

export default async function AiControllerPage({ params }: { params: Promise<{ companySlug: string; projectId: string }> }) {
  const { companySlug, projectId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const o = await loadOr404(aiProjectControllerService.overview(ctx, projectId));
  const [t, format] = await Promise.all([getTranslations("ai"), getFormatter()]);
  const base = `/c/${companySlug}/projects/${projectId}`;
  const eur = (v: string) => fmtMoney(format, v, "EUR");
  const open = o.recommendations.filter((r) => r.status === "PROPOSED");
  const decided = o.recommendations.filter((r) => r.status !== "PROPOSED");
  const toolName = (n: string) => (t.has(`toolNames.${n}`) ? t(`toolNames.${n}`) : n);
  const runError = (e: string | null) => (e?.startsWith("ai.errors.") ? t(e.slice(3)) : t("errors.failed"));
  const canRun = !!o.provider && !o.budget.exhausted;

  return (
    <>
      <PageHeader title={t("title")} description={`${o.project.code} · ${o.project.name}`} backHref={base} backLabel={o.project.code} />
      <div className="space-y-4">
        <Section title={t("title")}>
          <div className="space-y-2 text-sm" data-testid="ai-notice">
            <p>{t("intro")}</p>
            <p className="font-medium">{t("advisory")}</p>
            {o.provider ? (
              <p className="text-xs text-muted-foreground">{o.provider.name === "fake" ? t("testProvider") : t("dataNotice", { provider: `Anthropic Claude · ${o.provider.model}` })}</p>
            ) : (
              <p className="text-xs text-destructive">{t("unavailable")}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("tools")}: {o.tools.map(toolName).join(", ")}
            </p>
          </div>

          <div className="mt-4 rounded-lg border p-3" data-testid="ai-budget">
            <div className="text-xs text-muted-foreground">{t("budget")}</div>
            <div className="text-sm font-medium tabular-nums">{t("budgetUsed", { used: eur(o.budget.usedEur), limit: eur(o.budget.limitEur) })}</div>
            {o.budget.exhausted && <p className="mt-1 text-xs text-destructive">{t("budgetExhausted")}</p>}
            {o.canManageBudget && (
              <ActionForm action={setBudgetAction.bind(null, companySlug, projectId)} className="mt-2 flex flex-wrap items-end gap-2" showSuccess>
                <TextField name="monthlyBudgetEur" label={t("monthlyBudget")} defaultValue={o.budget.limitEur} inputMode="decimal" className="w-40" />
                <SubmitButton variant="outline">{t("saveBudget")}</SubmitButton>
              </ActionForm>
            )}
          </div>

          {canRun && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("reviewHint")}</p>
                <ActionButton action={reviewAction.bind(null, companySlug, projectId)} variant="default" className="w-full sm:w-auto">
                  <Sparkles aria-hidden /> {t("review")}
                </ActionButton>
              </div>
              <ActionForm action={askAction.bind(null, companySlug, projectId)} className="space-y-2" data-testid="ai-ask-form">
                <TextareaField name="question" label={t("question")} hint={t("questionPlaceholder")} rows={2} />
                <SubmitButton>{t("ask")}</SubmitButton>
              </ActionForm>
            </div>
          )}
        </Section>

        <Section title={t("recommendations")}>
          {open.length === 0 ? (
            <EmptyState>{t("noRecommendations")}</EmptyState>
          ) : (
            <ul className="space-y-3" data-testid="ai-recommendations">
              {open.map((r) => (
                <li key={r.id} className={cn("rounded-lg border border-l-4 p-3", SEVERITY_TONE[r.severity])} data-recommendation={r.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={r.severity === "CRITICAL" ? "REJECTED" : r.severity === "WARNING" ? "PENDING_APPROVAL" : "PLANNED"} label={t(`severities.${r.severity}`)} />
                    <span className="font-medium">{r.title}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm">{r.detail}</p>
                  {r.evidence.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("evidence")}: {r.evidence.map(toolName).join(", ")}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <ActionButton action={decideRecommendationAction.bind(null, companySlug, projectId, r.id)} hidden={{ decision: "ACCEPTED" }} variant="default">
                      {t("accept")}
                    </ActionButton>
                    <ActionButton action={decideRecommendationAction.bind(null, companySlug, projectId, r.id)} hidden={{ decision: "DISMISSED" }}>
                      {t("dismiss")}
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {decided.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="min-h-11 cursor-pointer py-2 font-medium">
                {t("decided")} ({decided.length})
              </summary>
              <ul className="divide-y">
                {decided.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                    <StatusBadge status={REC_TONE[r.status]} label={t(`recStatuses.${r.status}`)} />
                    <span>{r.title}</span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(format, r.decidedAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>

        <Section title={t("runs")}>
          {o.runs.length === 0 ? (
            <EmptyState>{t("noRuns")}</EmptyState>
          ) : (
            <ul className="space-y-3" data-testid="ai-runs">
              {o.runs.map((run) => (
                <li key={run.id} className="rounded-lg border p-3" data-run={run.id}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusBadge status={RUN_TONE[run.status]} label={t(`runStatuses.${run.status}`)} />
                    <span className="font-medium">{t(`runKinds.${run.kind}`)}</span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(format, run.createdAt)}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t("cost")} {eur(run.costEur)} · {t("model")} {run.model}
                    </span>
                  </div>
                  {run.question && <p className="mt-1 text-sm italic">“{run.question}”</p>}
                  {run.status !== "SUCCEEDED" && <p className="mt-1 text-sm text-destructive">{runError(run.error)}</p>}
                  {run.result && (
                    <>
                      <p className="mt-2 whitespace-pre-line text-sm">{run.result.summary}</p>
                      {run.result.items.length > 0 && (
                        <ul className="mt-2 divide-y text-sm">
                          {run.result.items.map((item, i) => (
                            <li key={i} className="py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge status={KIND_TONE[item.kind]} label={t(`kinds.${item.kind}`)} />
                                <span className="font-medium">{item.title}</span>
                              </div>
                              <p className="mt-0.5 whitespace-pre-line">{item.detail}</p>
                              {item.evidence.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  {t("evidence")}: {item.evidence.map(toolName).join(", ")}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
