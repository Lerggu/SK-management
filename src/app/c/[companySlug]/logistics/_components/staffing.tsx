import { getTranslations } from "next-intl/server";
import type { staffingService } from "@/modules/production/service";
import { ActionButton, ActionForm, SelectField, SubmitButton } from "@/ui/components/form";
import { EmptyState, Section } from "@/ui/components/page";
import { Badge } from "@/ui/components/badge";
import { cn } from "@/ui/lib/utils";
import { productionAction } from "../production-actions";

type Staffing = Awaited<ReturnType<typeof staffingService.get>>;

const READINESS_TONE = { READY: "bg-emerald-100 text-emerald-900", MISSING: "bg-amber-100 text-amber-900", NO_TYPE: "bg-zinc-100 text-zinc-700" } as const;
const WARN = "bg-amber-100 text-amber-900";
const BAD = "bg-red-100 text-red-900";

/** Resource needs of a logistics task, assigned resources and rule-based candidates (ADR 0026). */
export async function StaffingSection({ slug, s, taskTypes }: { slug: string; s: Staffing; taskTypes: { id: string; name: string }[] }) {
  const t = await getTranslations("production.staffing");
  const act = (op: "setTaskType" | "assign", id: string) => productionAction.bind(null, slug, op, id);
  return (
    <Section
      title={t("title")}
      actions={
        <Badge variant="secondary" className={cn("rounded-md font-medium", READINESS_TONE[s.readiness])} data-testid="readiness" data-readiness={s.readiness}>
          {t(`readiness.${s.readiness}`)}
        </Badge>
      }
    >
      {s.canEdit && (
        <ActionForm action={act("setTaskType", s.request.id)} className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <SelectField name="taskTypeId" label={t("taskType")} defaultValue={s.taskType?.id ?? ""} placeholder="–" options={taskTypes.map((x) => ({ value: x.id, label: x.name }))} className="sm:flex-1" />
          <SubmitButton variant="outline">{t("setType")}</SubmitButton>
        </ActionForm>
      )}
      {s.weightUnknown && (
        <p className="mb-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900" role="note">
          {t("weightUnknown")}
        </p>
      )}
      {!s.taskType ? (
        <EmptyState>{t("noType")}</EmptyState>
      ) : s.needs.length === 0 ? (
        <EmptyState>{t("noNeeds")}</EmptyState>
      ) : (
        <ul className="space-y-3" data-testid="staffing-needs">
          {s.needs.map((n) => (
            <li key={n.role.id} className="rounded-lg border p-3" data-need={n.role.label} data-missing={n.missing}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{n.role.label}</span>
                <span className="text-sm text-muted-foreground">
                  {n.assigned.length} / {n.role.quantity}
                </span>
                {n.missing > 0 ? (
                  <Badge variant="secondary" className={cn("rounded-md", WARN)}>
                    {t("missing", { count: n.missing })}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="rounded-md bg-emerald-100 text-emerald-900">
                    {t("covered")}
                  </Badge>
                )}
              </div>
              {n.assigned.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                  {n.assigned.map((a) => (
                    <li key={a.bookingId} className="rounded-md bg-muted px-2 py-1">
                      {a.label}
                      {a.status === "REQUESTED" && <span className="ml-1 text-xs text-muted-foreground">({t("pending")})</span>}
                    </li>
                  ))}
                </ul>
              )}
              {s.canBook && n.missing > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("candidates")}</p>
                  {n.candidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("noCandidates")}</p>
                  ) : (
                    <ul className="divide-y rounded-md border" data-testid="candidates">
                      {n.candidates.slice(0, 8).map((c) => (
                        <li key={c.value} className="flex flex-wrap items-center gap-2 px-2 py-1.5" data-candidate={c.label}>
                          <span className={cn("min-w-0 flex-1 text-sm", c.blocking && "text-muted-foreground")}>
                            {c.label}
                            {c.detail && <span className="ml-1 text-xs text-muted-foreground">{c.detail}</span>}
                          </span>
                          {c.issues.map((i) => (
                            <Badge key={i} variant="secondary" className={cn("rounded-md text-xs", c.blocking && i !== "BUSY" ? BAD : WARN)}>
                              {t(`issues.${i}`)}
                            </Badge>
                          ))}
                          {!c.blocking && (
                            <ActionButton action={act("assign", s.request.id)} hidden={{ roleId: n.role.id, resource: c.value }} variant={c.issues.length === 0 ? "default" : "outline"}>
                              {t("assign")}
                            </ActionButton>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
