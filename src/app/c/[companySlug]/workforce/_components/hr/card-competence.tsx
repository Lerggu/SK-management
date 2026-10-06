import { getFormatter, getTranslations } from "next-intl/server";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { EmptyState, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, isoDate } from "@/ui/format";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { Disclosure } from "./disclosure";
import { LevelCell, SmallBadge } from "./badges";
import type { Act, Card, WorkData } from "./types";

type Assessment = WorkData["assessments"][number];

async function levelOptions() {
  const t = await getTranslations("hr.levels");
  return [
    { value: "", label: t("none") },
    ...(["1", "2", "3", "4"] as const).map((l) => ({ value: l, label: t(l) })),
  ];
}

/** Supervisor assessment form: new (employee id) or editing a draft. */
async function AssessmentForm({ act, card, areas, people, draft }: { act: Act; card: Card; areas: { id: string; name: string; category: string }[]; people: { id: string; name: string }[]; draft?: Assessment }) {
  const t = await getTranslations("hr.assessment");
  const levels = await levelOptions();
  const action = draft ? act("assessmentUpdate", draft.id) : act("assessmentCreate", card.employee.id);
  return (
    <ActionForm action={action} className="grid gap-3 sm:grid-cols-2">
      <SelectField name="areaId" label={t("area")} required defaultValue={draft?.areaId ?? ""} placeholder="" options={areas.map((a) => ({ value: a.id, label: `${a.category} · ${a.name}` }))} />
      <SelectField name="level" label={t("level")} defaultValue={draft?.level ? String(draft.level) : ""} options={levels} />
      <TextareaField name="observations" label={t("observations")} defaultValue={draft?.observations} className="sm:col-span-2" />
      <TextareaField name="strengths" label={t("strengths")} defaultValue={draft?.strengths} />
      <TextareaField name="developmentAreas" label={t("developmentAreas")} defaultValue={draft?.developmentAreas} />
      <TextareaField name="agreedActions" label={t("agreedActions")} defaultValue={draft?.agreedActions} className="sm:col-span-2" />
      <SelectField name="actionOwnerEmployeeId" label={t("actionOwner")} defaultValue={draft?.actionOwnerEmployeeId ?? ""} placeholder="–" options={people.map((p) => ({ value: p.id, label: p.name }))} />
      <TextField name="actionDueOn" label={t("actionDueOn")} type="date" defaultValue={isoDate(draft?.actionDueOn)} />
      <TextField name="assessedOn" label={t("assessedOn")} type="date" required defaultValue={draft ? isoDate(draft.assessedOn) : todayInDisplayZone()} />
      <TextField name="nextAssessmentOn" label={t("nextAssessmentOn")} type="date" defaultValue={isoDate(draft?.nextAssessmentOn)} />
      <p className="text-xs text-muted-foreground sm:col-span-2">{t("publishHint")}</p>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <SubmitButton variant="outline">{t("saveDraft")}</SubmitButton>
        <button type="submit" name="publish" value="on" className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:w-auto md:h-9">
          {t("publish")}
        </button>
      </div>
    </ActionForm>
  );
}

async function SelfAssessmentForm({ act, card, areas }: { act: Act; card: Card; areas: { id: string; name: string; category: string }[] }) {
  const t = await getTranslations("hr.assessment");
  const levels = await levelOptions();
  return (
    <ActionForm action={act("selfAssessment", card.employee.id)} className="grid gap-3 sm:grid-cols-2">
      <p className="text-xs text-muted-foreground sm:col-span-2">{t("selfHint")}</p>
      <SelectField name="areaId" label={t("area")} required placeholder="" options={areas.map((a) => ({ value: a.id, label: `${a.category} · ${a.name}` }))} />
      <SelectField name="level" label={t("level")} options={levels} />
      <TextareaField name="observations" label={t("observations")} className="sm:col-span-2" />
      <input type="hidden" name="assessedOn" value={todayInDisplayZone()} />
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <SubmitButton variant="outline">{t("saveDraft")}</SubmitButton>
        <button type="submit" name="publish" value="on" className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:w-auto md:h-9">
          {t("publish")}
        </button>
      </div>
    </ActionForm>
  );
}

export async function CompetenceTab({ card, act, people }: { card: Card; act: Act; people: { id: string; name: string }[] }) {
  const [t, tl, format] = await Promise.all([getTranslations("hr"), getTranslations("hr.levels"), getFormatter()]);
  const work = card.work!;
  const activeAreas = work.competence.filter((c) => !c.area.archivedAt).map((c) => c.area);
  const levelTitle = (l: number | null | undefined) => (l ? tl(String(l) as "1") : tl("none"));
  return (
    <div className="space-y-4">
      <Section title={t("competence.title")}>
        <p className="mb-3 text-xs text-muted-foreground">{t("competence.sideBySide")}</p>
        {work.competence.length === 0 ? (
          <EmptyState>{t("competence.noAreas")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm" data-testid="competence-table">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t("competence.area")}</th>
                  <th className="px-2 py-2 font-medium">{t("competence.supervisorLevel")}</th>
                  <th className="px-2 py-2 font-medium">{t("competence.selfLevel")}</th>
                  <th className="px-2 py-2 font-medium">{t("competence.next")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {work.competence.map((c) => (
                  <tr key={c.area.id} data-area={c.area.name}>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{c.area.name}</div>
                      <div className="text-xs text-muted-foreground">{c.area.category}</div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <LevelCell level={c.supervisor?.level} title={levelTitle(c.supervisor?.level)} />
                        <span className="text-xs text-muted-foreground">{c.supervisor ? fmtDate(format, c.supervisor.assessedOn) : t("matrix.notAssessed")}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <LevelCell level={c.self?.level} title={levelTitle(c.self?.level)} />
                        <span className="text-xs text-muted-foreground">{c.self ? fmtDate(format, c.self.assessedOn) : ""}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">{fmtDate(format, c.supervisor?.nextAssessmentOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t("assessment.title")}>
        {card.can.supervise && activeAreas.length > 0 && (
          <Disclosure summary={t("assessment.new")} testId="new-assessment">
            <AssessmentForm act={act} card={card} areas={activeAreas} people={people} />
          </Disclosure>
        )}
        {card.can.selfService && activeAreas.length > 0 && (
          <Disclosure summary={t("assessment.newSelf")} testId="new-self-assessment">
            <SelfAssessmentForm act={act} card={card} areas={activeAreas} />
          </Disclosure>
        )}
        <h3 className="mt-4 mb-2 text-sm font-semibold">{t("assessment.history")}</h3>
        {work.assessments.length === 0 ? (
          <EmptyState>{t("assessment.noHistory")}</EmptyState>
        ) : (
          <ul className="space-y-3" data-testid="assessment-history">
            {work.assessments.map((a) => (
              <li key={a.id} className="rounded-lg border p-3" data-status={a.status} data-kind={a.kind}>
                <div className="flex flex-wrap items-center gap-2">
                  <LevelCell level={a.level} title={levelTitle(a.level)} />
                  <span className="font-medium">{a.areaName}</span>
                  <SmallBadge tone={a.kind === "SELF" ? "muted" : "ok"}>{t(`assessment.kinds.${a.kind}`)}</SmallBadge>
                  <StatusBadge status={a.status === "PUBLISHED" ? "APPROVED" : "DRAFT"} label={t(`assessment.statuses.${a.status}`)} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmtDate(format, a.assessedOn)} · {a.assessorName ?? ""}
                  </span>
                </div>
                <p className="mt-1 text-sm">{levelTitle(a.level)}</p>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  {(
                    [
                      ["observations", a.observations],
                      ["strengths", a.strengths],
                      ["developmentAreas", a.developmentAreas],
                      ["agreedActions", a.agreedActions],
                    ] as const
                  )
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k} className={k === "observations" || k === "agreedActions" ? "sm:col-span-2" : ""}>
                        <dt className="text-xs font-medium text-muted-foreground">{t(`assessment.${k}`)}</dt>
                        <dd className="whitespace-pre-wrap">{v}</dd>
                      </div>
                    ))}
                  {a.agreedActions && (
                    <div className="sm:col-span-2 text-xs text-muted-foreground">
                      {t("assessment.actionOwner")}: {a.actionOwnerName ?? "–"} · {t("assessment.actionDueOn")}: {fmtDate(format, a.actionDueOn)} ·{" "}
                      {a.actionDoneAt ? `${t("assessment.actionDoneAt")} ${fmtDate(format, a.actionDoneAt)}` : t("assessment.openAction")}
                    </div>
                  )}
                  {a.nextAssessmentOn && (
                    <div className="text-xs text-muted-foreground">
                      {t("assessment.nextAssessmentOn")}: {fmtDate(format, a.nextAssessmentOn)}
                    </div>
                  )}
                  {a.employeeComment && (
                    <div className="sm:col-span-2 rounded-md bg-muted/60 p-2">
                      <dt className="text-xs font-medium text-muted-foreground">{t("assessment.commented")}</dt>
                      <dd className="whitespace-pre-wrap">{a.employeeComment}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.editable && (
                    <>
                      <ActionButton action={act("assessmentPublish", a.id)} variant="default">
                        {t("assessment.publish")}
                      </ActionButton>
                      <ActionButton action={act("assessmentDiscard", a.id)} variant="ghost">
                        {t("assessment.discard")}
                      </ActionButton>
                    </>
                  )}
                  {card.can.supervise && a.kind === "SUPERVISOR" && a.status === "PUBLISHED" && a.agreedActions && !a.actionDoneAt && (
                    <ActionButton action={act("assessmentActionDone", a.id)}>{t("assessment.actionDone")}</ActionButton>
                  )}
                </div>
                {a.editable && a.kind === "SUPERVISOR" && (
                  <Disclosure summary={t("assessment.edit")}>
                    <AssessmentForm act={act} card={card} areas={activeAreas} people={people} draft={a} />
                  </Disclosure>
                )}
                {a.commentable && (
                  <Disclosure summary={t("assessment.comment")} testId="assessment-comment">
                    <ActionForm action={act("assessmentComment", a.id)} className="space-y-2">
                      <p className="text-xs text-muted-foreground">{t("assessment.commentHint")}</p>
                      <TextareaField name="comment" label={t("assessment.comment")} defaultValue={a.employeeComment} />
                      <SubmitButton>{t("assessment.addComment")}</SubmitButton>
                    </ActionForm>
                  </Disclosure>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
