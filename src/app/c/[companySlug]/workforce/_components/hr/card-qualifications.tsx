import { getFormatter, getTranslations } from "next-intl/server";
import { Paperclip } from "lucide-react";
import { ActionButton, ActionForm, FileField, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { EmptyState, Section } from "@/ui/components/page";
import { fmtDate, fmtDateTime, isoDate } from "@/ui/format";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { Disclosure } from "./disclosure";
import { SmallBadge, ValidityBadge } from "./badges";
import type { Act, Card, CardFile, WorkData } from "./types";

const ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";

/** Attachments of one record, with preview/download and an attach form. */
export async function Attachments({ slug, files, act, employeeId, target, canAttach }: { slug: string; files: CardFile[]; act: Act; employeeId: string; target: { type: "QUALIFICATION" | "TRAINING" | "ORIENTATION" | "AUTHORIZATION" | "ITEM"; id: string; kind: string }; canAttach: boolean }) {
  const t = await getTranslations("hr.files");
  const mine = files.filter((f) => f.targetType === target.type && f.targetId === target.id);
  return (
    <div className="mt-2">
      {mine.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-sm">
          {mine.map((f) => (
            <li key={f.id}>
              <a href={`/c/${slug}/workforce/files/${f.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 rounded-md border px-2 underline-offset-2 hover:underline md:min-h-8">
                <Paperclip className="size-3.5" aria-hidden /> {f.displayName}
              </a>
            </li>
          ))}
        </ul>
      )}
      {canAttach && (
        <Disclosure summary={t("attach")}>
          <ActionForm action={act("fileUpload", employeeId)} className="space-y-2">
            <input type="hidden" name="targetType" value={target.type} />
            <input type="hidden" name="targetId" value={target.id} />
            <input type="hidden" name="kind" value={target.kind} />
            <FileField label={t("file")} accept={ACCEPT} required />
            <SubmitButton>{t("upload")}</SubmitButton>
          </ActionForm>
        </Disclosure>
      )}
    </div>
  );
}

async function ReminderInfo({ q }: { q: { reminder: WorkData["qualifications"][number]["reminder"] } }) {
  const [t, format] = await Promise.all([getTranslations("hr.reminder"), getFormatter()]);
  const r = q.reminder;
  if (!r) return null;
  return (
    <div className="mt-1 space-y-1 text-xs" data-testid="reminder-info">
      <p className="text-muted-foreground">🔔 {t("on", { date: fmtDate(format, new Date(`${r.dueOn}T00:00:00Z`)) })}</p>
      {r.deliveries.map((d) => (
        <p key={d.recipientKind} className="text-muted-foreground">
          {t(`recipients.${d.recipientKind}`)}: {t(`statuses.${d.status}`)} {d.sentAt ? fmtDateTime(format, d.sentAt) : ""}
        </p>
      ))}
      {r.missingOwnerEmail && <p className="rounded bg-amber-100 px-2 py-1 text-amber-900" role="note">{t("missingOwner")}</p>}
      {r.missingMaintenanceEmail && <p className="rounded bg-amber-100 px-2 py-1 text-amber-900" role="note">{t("missingMaintenance")}</p>}
      {!r.mailConfigured && <p className="rounded bg-amber-100 px-2 py-1 text-amber-900" role="note">{t("mailOff")}</p>}
    </div>
  );
}

async function QualificationForm({ act, op, id, types, q }: { act: Act; op: "qualificationAdd" | "qualificationUpdate" | "qualificationRenew"; id: string; types: { id: string; name: string }[]; q?: WorkData["qualifications"][number] }) {
  const [t, tc] = await Promise.all([getTranslations("hr.qualification"), getTranslations("common")]);
  const renew = op === "qualificationRenew";
  return (
    <ActionForm action={act(op, id)} className="grid gap-3 sm:grid-cols-2">
      {renew && <p className="text-xs text-muted-foreground sm:col-span-2">{t("renewHint")}</p>}
      <SelectField name="typeId" label={t("type")} defaultValue={q?.typeId ?? ""} placeholder={t("otherType")} options={types.map((x) => ({ value: x.id, label: x.name }))} />
      <TextField name="name" label={t("name")} hint={t("nameHint")} defaultValue={q?.name} />
      <TextField name="issuer" label={t("issuer")} defaultValue={q?.issuer} />
      <TextField name="cardNumber" label={t("cardNumber")} defaultValue={renew ? "" : q?.cardNumber} />
      <TextField name="issuedOn" label={t("issuedOn")} type="date" defaultValue={renew ? todayInDisplayZone() : isoDate(q?.issuedOn)} />
      <TextField name="expiresOn" label={t("expiresOn")} type="date" defaultValue={renew ? "" : isoDate(q?.expiresOn)} />
      <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
        <input type="checkbox" name="noExpiry" defaultChecked={!renew && (q?.noExpiry ?? false)} className="size-5 accent-primary md:size-4" />
        {t("noExpiry")}
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2 md:min-h-9">
        <input type="checkbox" name="remindBeforeExpiry" defaultChecked={q?.remindBeforeExpiry ?? true} className="size-5 accent-primary md:size-4" />
        {t("remind")}
      </label>
      <TextareaField name="notes" label={tc("notes")} defaultValue={q?.notes} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <SubmitButton>{renew ? t("renew") : tc("save")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

async function TrainingForm({ act, op, id, x }: { act: Act; op: "trainingAdd" | "trainingUpdate"; id: string; x?: WorkData["trainings"][number] }) {
  const [t, tq, tc] = await Promise.all([getTranslations("hr.training"), getTranslations("hr.qualification"), getTranslations("common")]);
  return (
    <ActionForm action={act(op, id)} className="grid gap-3 sm:grid-cols-2">
      <TextField name="name" label={t("name")} required defaultValue={x?.name} />
      <TextField name="provider" label={t("provider")} defaultValue={x?.provider} />
      <SelectField name="status" label={t("status")} defaultValue={x?.status ?? "COMPLETED"} options={(["COMPLETED", "PLANNED"] as const).map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />
      <TextField name="plannedOn" label={t("plannedOn")} type="date" defaultValue={isoDate(x?.plannedOn)} />
      <TextField name="completedOn" label={t("completedOn")} type="date" defaultValue={isoDate(x?.completedOn)} />
      <TextField name="expiresOn" label={t("expiresOn")} type="date" defaultValue={isoDate(x?.expiresOn)} />
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2 md:min-h-9">
        <input type="checkbox" name="remindBeforeExpiry" defaultChecked={x?.remindBeforeExpiry ?? false} className="size-5 accent-primary md:size-4" />
        {tq("remind")}
      </label>
      <TextareaField name="notes" label={tc("notes")} defaultValue={x?.notes} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <SubmitButton>{tc("save")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export async function QualificationsTab({ slug, card, act, files, types }: { slug: string; card: Card; act: Act; files: CardFile[]; types: { id: string; name: string }[] }) {
  const [t, tc, format] = await Promise.all([getTranslations("hr"), getTranslations("common"), getFormatter()]);
  const work = card.work!;
  const id = card.employee.id;
  const canAdd = card.can.supervise || card.can.selfService;
  const current = work.qualifications.filter((q) => !q.replacedAt);
  const replaced = work.qualifications.filter((q) => q.replacedAt);
  const verifiedBadge = (r: { verifiedAt: Date | null }) => (r.verifiedAt ? null : <SmallBadge tone="warn">{t("verification.unverified")}</SmallBadge>);
  return (
    <div className="space-y-4">
      <Section title={t("qualification.title")}>
        {canAdd && (
          <Disclosure summary={t("qualification.add")} testId="add-qualification">
            {!card.can.supervise && <p className="mb-2 text-xs text-muted-foreground">{t("verification.hint")}</p>}
            <QualificationForm act={act} op="qualificationAdd" id={id} types={types} />
          </Disclosure>
        )}
        {current.length === 0 ? (
          <EmptyState>{t("qualification.none")}</EmptyState>
        ) : (
          <ul className="mt-3 divide-y" data-testid="qualification-list">
            {current.map((q) => (
              <li key={q.id} className="py-3" data-validity={q.validity}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{q.name}</span>
                  <ValidityBadge state={q.validity} label={t(`validity.${q.validity}`)} />
                  {verifiedBadge(q)}
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {[q.issuer, q.cardNumber && `${t("qualification.cardNumber")} ${q.cardNumber}`, q.issuedOn && `${t("qualification.issuedOn")} ${fmtDate(format, q.issuedOn)}`, q.noExpiry ? t("qualification.noExpiry") : `${t("qualification.expiresOn")} ${fmtDate(format, q.expiresOn)}`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {q.notes && <p className="mt-1 text-sm whitespace-pre-wrap">{q.notes}</p>}
                <ReminderInfo q={q} />
                <Attachments slug={slug} files={files} act={act} employeeId={id} target={{ type: "QUALIFICATION", id: q.id, kind: "CARD_IMAGE" }} canAttach={!card.employee.archivedAt && (card.can.supervise || card.can.selfService)} />
                <div className="mt-2 flex flex-wrap gap-2">
                  {card.can.supervise && !q.verifiedAt && <ActionButton action={act("qualificationVerify", q.id)}>{t("verification.verify")}</ActionButton>}
                  {(card.can.admin || (q.editable && !q.verifiedAt && card.can.selfService)) && (
                    <ActionButton action={act("qualificationArchive", q.id)} variant="ghost" confirm={tc("confirmArchive")}>
                      {tc("archive")}
                    </ActionButton>
                  )}
                </div>
                {q.editable && (
                  <Disclosure summary={t("edit")}>
                    <QualificationForm act={act} op="qualificationUpdate" id={q.id} types={types} q={q} />
                  </Disclosure>
                )}
                {canAdd && (
                  <Disclosure summary={t("qualification.renew")} testId="renew-qualification">
                    <QualificationForm act={act} op="qualificationRenew" id={q.id} types={types} q={q} />
                  </Disclosure>
                )}
              </li>
            ))}
          </ul>
        )}
        {replaced.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="min-h-11 cursor-pointer text-muted-foreground md:min-h-0">{t("qualification.replaced")} ({replaced.length})</summary>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {replaced.map((q) => (
                <li key={q.id}>
                  {q.name} · {q.noExpiry ? t("qualification.noExpiry") : fmtDate(format, q.expiresOn)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title={t("training.title")}>
        {canAdd && (
          <Disclosure summary={t("training.add")} testId="add-training">
            <TrainingForm act={act} op="trainingAdd" id={id} />
          </Disclosure>
        )}
        {work.trainings.length === 0 ? (
          <EmptyState>{t("training.none")}</EmptyState>
        ) : (
          <ul className="mt-3 divide-y">
            {work.trainings.map((x) => (
              <li key={x.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{x.name}</span>
                  <SmallBadge tone={x.status === "PLANNED" ? "warn" : "ok"}>{t(`training.statuses.${x.status}`)}</SmallBadge>
                  {x.validity && x.expiresOn && <ValidityBadge state={x.validity} label={t(`validity.${x.validity}`)} />}
                  {verifiedBadge(x)}
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {[x.provider, x.status === "PLANNED" ? x.plannedOn && `${t("training.plannedOn")} ${fmtDate(format, x.plannedOn)}` : `${t("training.completedOn")} ${fmtDate(format, x.completedOn)}`, x.expiresOn && `${t("training.expiresOn")} ${fmtDate(format, x.expiresOn)}`].filter(Boolean).join(" · ")}
                </div>
                <ReminderInfo q={x} />
                <Attachments slug={slug} files={files} act={act} employeeId={id} target={{ type: "TRAINING", id: x.id, kind: "TRAINING_CERTIFICATE" }} canAttach={!card.employee.archivedAt && canAdd} />
                <div className="mt-2 flex flex-wrap gap-2">
                  {card.can.supervise && !x.verifiedAt && <ActionButton action={act("trainingVerify", x.id)}>{t("verification.verify")}</ActionButton>}
                  {(card.can.admin || (x.editable && !x.verifiedAt && card.can.selfService)) && (
                    <ActionButton action={act("trainingArchive", x.id)} variant="ghost" confirm={tc("confirmArchive")}>
                      {tc("archive")}
                    </ActionButton>
                  )}
                </div>
                {x.editable && (
                  <Disclosure summary={t("edit")}>
                    <TrainingForm act={act} op="trainingUpdate" id={x.id} x={x} />
                  </Disclosure>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <OrientationsSection slug={slug} card={card} act={act} files={files} />
      <AuthorizationsSection slug={slug} card={card} act={act} files={files} />
    </div>
  );
}

async function OrientationsSection({ slug, card, act, files }: { slug: string; card: Card; act: Act; files: CardFile[] }) {
  const [t, tc, format] = await Promise.all([getTranslations("hr.orientation"), getTranslations("common"), getFormatter()]);
  const work = card.work!;
  return (
    <Section title={t("title")}>
      {card.can.supervise && (
        <Disclosure summary={t("add")} testId="add-orientation">
          <ActionForm action={act("orientationAdd", card.employee.id)} className="grid gap-3 sm:grid-cols-2">
            <SelectField name="scope" label={t("scope")} defaultValue="SITE" options={(["COMPANY", "SITE", "EQUIPMENT"] as const).map((s) => ({ value: s, label: t(`scopes.${s}`) }))} />
            <TextField name="topic" label={t("topic")} required />
            <TextField name="target" label={t("target")} hint={t("targetHint")} />
            <TextField name="instructorName" label={t("instructor")} required />
            <SelectField name="status" label={t("status")} defaultValue="DONE" options={(["DONE", "IN_PROGRESS"] as const).map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />
            <TextField name="completedOn" label={t("completedOn")} type="date" defaultValue={todayInDisplayZone()} />
            <TextField name="renewalDueOn" label={t("renewalDueOn")} type="date" />
            <div className="sm:col-span-2">
              <SubmitButton>{tc("save")}</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      )}
      {work.orientations.length === 0 ? (
        <EmptyState>{t("none")}</EmptyState>
      ) : (
        <ul className="mt-3 divide-y">
          {work.orientations.map((o) => (
            <li key={o.id} className="py-3" data-testid="orientation">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{o.topic}</span>
                <SmallBadge tone="muted">{t(`scopes.${o.scope}`)}</SmallBadge>
                <SmallBadge tone={o.status === "DONE" ? "ok" : "warn"}>{t(`statuses.${o.status}`)}</SmallBadge>
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {[o.target, `${t("instructor")}: ${o.instructorName}`, o.completedOn && fmtDate(format, o.completedOn), o.renewalDueOn && `${t("renewalDueOn")} ${fmtDate(format, o.renewalDueOn)}`].filter(Boolean).join(" · ")}
              </div>
              <p className="mt-1 text-xs">{o.acknowledgedAt ? t("acknowledged", { date: fmtDate(format, o.acknowledgedAt) }) : t("notAcknowledged")}</p>
              <Attachments slug={slug} files={files} act={act} employeeId={card.employee.id} target={{ type: "ORIENTATION", id: o.id, kind: "ORIENTATION" }} canAttach={!card.employee.archivedAt && (card.can.supervise || card.can.selfService)} />
              <div className="mt-2 flex flex-wrap gap-2">
                {card.can.selfService && !o.acknowledgedAt && (
                  <ActionButton action={act("orientationAcknowledge", o.id)} variant="default">
                    {t("acknowledge")}
                  </ActionButton>
                )}
                {card.can.admin && (
                  <ActionButton action={act("orientationArchive", o.id)} variant="ghost" confirm={tc("confirmArchive")}>
                    {tc("archive")}
                  </ActionButton>
                )}
              </div>
              {card.can.supervise && (
                <Disclosure summary={tc("edit")}>
                  <ActionForm action={act("orientationUpdate", o.id)} className="grid gap-3 sm:grid-cols-2">
                    <SelectField name="scope" label={t("scope")} defaultValue={o.scope} options={(["COMPANY", "SITE", "EQUIPMENT"] as const).map((s) => ({ value: s, label: t(`scopes.${s}`) }))} />
                    <TextField name="topic" label={t("topic")} required defaultValue={o.topic} />
                    <TextField name="target" label={t("target")} defaultValue={o.target} />
                    <TextField name="instructorName" label={t("instructor")} required defaultValue={o.instructorName} />
                    <SelectField name="status" label={t("status")} defaultValue={o.status} options={(["DONE", "IN_PROGRESS"] as const).map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />
                    <TextField name="completedOn" label={t("completedOn")} type="date" defaultValue={isoDate(o.completedOn)} />
                    <TextField name="renewalDueOn" label={t("renewalDueOn")} type="date" defaultValue={isoDate(o.renewalDueOn)} />
                    <div className="sm:col-span-2">
                      <SubmitButton>{tc("save")}</SubmitButton>
                    </div>
                  </ActionForm>
                </Disclosure>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

async function AuthorizationsSection({ slug, card, act, files }: { slug: string; card: Card; act: Act; files: CardFile[] }) {
  const [t, th, tc, format] = await Promise.all([getTranslations("hr.authorization"), getTranslations("hr"), getTranslations("common"), getFormatter()]);
  const work = card.work!;
  return (
    <Section title={t("title")}>
      <p className="mb-2 text-xs text-muted-foreground">{t("hint")}</p>
      {card.can.supervise && (
        <Disclosure summary={t("add")} testId="add-authorization">
          <ActionForm action={act("authorizationAdd", card.employee.id)} className="grid gap-3 sm:grid-cols-2">
            <TextField name="target" label={t("target")} required />
            <SelectField name="equipmentTypeId" label={t("equipmentType")} placeholder="–" options={work.equipmentTypes.map((e) => ({ value: e.id, label: e.name }))} />
            <TextField name="grantedOn" label={t("grantedOn")} type="date" required defaultValue={todayInDisplayZone()} />
            <TextField name="expiresOn" label={t("expiresOn")} type="date" />
            <TextareaField name="notes" label={tc("notes")} className="sm:col-span-2" />
            <div className="sm:col-span-2">
              <SubmitButton>{tc("save")}</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      )}
      {work.authorizations.length === 0 ? (
        <EmptyState>{t("none")}</EmptyState>
      ) : (
        <ul className="mt-3 divide-y">
          {work.authorizations.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.target}</span>
                {a.expiresOn && <ValidityBadge state={a.validity} label={th(`validity.${a.validity}`)} />}
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {t("grantedBy")}: {a.grantedByName ?? "–"} · {fmtDate(format, a.grantedOn)}
                {a.expiresOn ? ` – ${fmtDate(format, a.expiresOn)}` : ""}
              </div>
              {a.notes && <p className="mt-1 text-sm whitespace-pre-wrap">{a.notes}</p>}
              <Attachments slug={slug} files={files} act={act} employeeId={card.employee.id} target={{ type: "AUTHORIZATION", id: a.id, kind: "AUTHORIZATION" }} canAttach={!card.employee.archivedAt && card.can.supervise} />
              {card.can.supervise && (
                <div className="mt-2">
                  <ActionButton action={act("authorizationArchive", a.id)} variant="ghost" confirm={tc("confirmArchive")}>
                    {tc("archive")}
                  </ActionButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

