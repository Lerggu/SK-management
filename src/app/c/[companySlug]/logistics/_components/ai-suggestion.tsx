import { getFormatter, getTranslations } from "next-intl/server";
import type { logisticsAiService } from "@/modules/production/ai.service";
import { ActionButton } from "@/ui/components/form";
import { Section } from "@/ui/components/page";
import { Badge } from "@/ui/components/badge";
import { cn } from "@/ui/lib/utils";
import { productionAction } from "../production-actions";

type Suggestion = Awaited<ReturnType<typeof logisticsAiService.suggestion>>;

/**
 * AI staffing suggestion of a task (ADR 0026, phase 4): the AI proposes, a
 * person accepts; every pick is booked through the staffing rules again.
 */
export async function AiSuggestionSection({ slug, taskId, s }: { slug: string; taskId: string; s: Suggestion }) {
  const [t, ta, format] = await Promise.all([getTranslations("production.ai"), getTranslations("ai"), getFormatter()]);
  const run = s.suggestion;
  if (!run && !s.canRun) return null;
  return (
    <Section title={t("title")}>
      <div className="space-y-3" data-testid="ai-suggestion">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {!s.available && <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">{t("unavailable")}</p>}
        {run ? (
          <div className="rounded-lg border p-3" data-status={run.status}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="rounded-md">
                {ta(`runStatuses.${run.status}`)}
              </Badge>
              <span>{format.dateTime(run.createdAt, { dateStyle: "short", timeStyle: "short" })}</span>
              {run.provider === "fake" && <span>{t("testProvider")}</span>}
            </div>
            {run.error && <p className="text-sm text-red-700">{ta.has(run.error.replace(/^ai\./, "")) ? ta(run.error.replace(/^ai\./, "")) : ta("errors.failed")}</p>}
            {run.summary && <p className="text-sm">{run.summary}</p>}
            {run.picks.length > 0 && (
              <ul className="mt-2 divide-y rounded-md border" data-testid="ai-picks">
                {run.picks.map((p) => (
                  <li key={`${p.roleId}-${p.resource}`} className={cn("flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm", !p.applicable && "text-muted-foreground")} data-pick={p.label} data-applicable={p.applicable}>
                    <span className="font-medium">{p.roleLabel}</span>
                    <span>→ {p.label}</span>
                    <span className="min-w-0 flex-1 text-xs text-muted-foreground">{p.reason}</span>
                    {!p.applicable && (
                      <Badge variant="secondary" className="rounded-md text-xs">
                        {t("notApplicable")}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {run.rejected > 0 && <p className="mt-2 text-xs text-muted-foreground">{t("rejected", { count: run.rejected })}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {s.canAccept && run && (
            <ActionButton action={productionAction.bind(null, slug, "aiAccept", run.id)} variant="default">
              {t("accept")}
            </ActionButton>
          )}
          {s.canRun && s.available && (
            <ActionButton action={productionAction.bind(null, slug, "aiSuggest", taskId)}>{run ? t("again") : t("suggest")}</ActionButton>
          )}
        </div>
      </div>
    </Section>
  );
}
