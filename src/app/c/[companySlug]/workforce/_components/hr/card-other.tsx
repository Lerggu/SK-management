import { getFormatter, getTranslations } from "next-intl/server";
import { Download, Eye } from "lucide-react";
import { ActionButton, ActionForm, FileField, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { DetailList, EmptyState, Section } from "@/ui/components/page";
import { fmtBytes, fmtDate, isoDate } from "@/ui/format";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { LANGUAGES } from "@/modules/hr/schemas";
import { LANGUAGE_LEVELS } from "@/modules/hr/rules";
import { Disclosure } from "./disclosure";
import { SmallBadge } from "./badges";
import { PersonalForm } from "./card-basics";
import { Attachments } from "./card-qualifications";
import type { Act, Card, CardFile } from "./types";

const SKILLS = ["speaking", "understanding", "reading", "writing"] as const;

export async function LanguagesTab({ card, act }: { card: Card; act: Act }) {
  const [t, tc] = await Promise.all([getTranslations("hr.language"), getTranslations("common")]);
  const work = card.work!;
  const name = (code: string) => ((LANGUAGES as readonly string[]).includes(code) ? t(`names.${code}` as "names.fi") : code.toUpperCase());
  const sources = [card.can.selfService && "SELF", card.can.supervise && "SUPERVISOR"].filter(Boolean) as ("SELF" | "SUPERVISOR")[];
  const levelOptions = LANGUAGE_LEVELS.map((l) => ({ value: l, label: t(`levels.${l}`) }));
  return (
    <div className="space-y-4">
      <Section title={t("communicationTitle")}>
        <DetailList
          items={[
            { label: t("preferred"), value: work.preferredLanguage ? name(work.preferredLanguage) : null },
            { label: t("interpreter"), value: work.interpreterNeeded ? tc("yes") : tc("no") },
          ]}
        />
        {card.can.editPersonal && (
          <Disclosure summary={tc("edit")}>
            <PersonalForm card={card} act={act} show={["language"]} />
          </Disclosure>
        )}
      </Section>
      <Section title={t("title")}>
        {work.languages.length === 0 ? (
          <EmptyState>{t("none")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm" data-testid="language-table">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">{t("language")}</th>
                  {SKILLS.map((s) => (
                    <th key={s} className="px-2 py-2 font-medium">
                      {t(s)}
                    </th>
                  ))}
                  <th className="px-2 py-2 font-medium">{t("source")}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y">
                {work.languages.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-2 font-medium">{name(l.language)}</td>
                    {SKILLS.map((s) => (
                      <td key={s} className="px-2 py-2">
                        {t(`levels.${l[s]}`)}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {t(`sources.${l.source}`)}
                      {l.notes && <div className="text-foreground">{l.notes}</div>}
                    </td>
                    <td className="py-2 text-right">
                      {((l.source === "SELF" && (card.can.selfService || card.can.admin)) || (l.source === "SUPERVISOR" && card.can.supervise)) && (
                        <ActionButton action={act("languageRemove", l.id)} variant="ghost" confirm={tc("confirmArchive")}>
                          {tc("remove")}
                        </ActionButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sources.length > 0 && (
          <Disclosure summary={t("add")} testId="add-language">
            <ActionForm action={act("languageSave", card.employee.id)} className="grid gap-3 sm:grid-cols-2">
              <SelectField name="language" label={t("language")} required options={[...LANGUAGES.map((l) => ({ value: l, label: t(`names.${l}`) })), { value: "other", label: t("other") }]} />
              <TextField name="otherLanguage" label={t("other")} maxLength={3} />
              {SKILLS.map((s) => (
                <SelectField key={s} name={s} label={t(s)} defaultValue="NOT_ASSESSED" options={levelOptions} />
              ))}
              <SelectField name="source" label={t("source")} defaultValue={sources[0]} options={sources.map((s) => ({ value: s, label: t(`sources.${s}`) }))} />
              <TextField name="notes" label={t("notes")} />
              <div className="sm:col-span-2">
                <SubmitButton>{tc("save")}</SubmitButton>
              </div>
            </ActionForm>
          </Disclosure>
        )}
      </Section>
    </div>
  );
}

export async function EquipmentTab({ slug, card, act, files }: { slug: string; card: Card; act: Act; files: CardFile[] }) {
  const [t, tc, format] = await Promise.all([getTranslations("hr"), getTranslations("common"), getFormatter()]);
  const eq = card.equipment!;
  const ending = card.employee.status !== "ACTIVE" || (card.employee.endDate && isoDate(card.employee.endDate) <= todayInDisplayZone());
  const withEmployee = eq.items.filter((i) => i.status === "WITH_EMPLOYEE");
  const itemTypes = (["PHONE", "COMPUTER", "HARNESS", "TOOL", "KEY", "OTHER"] as const).map((v) => ({ value: v, label: t(`item.types.${v}`) }));
  const itemStatuses = (["WITH_EMPLOYEE", "RETURNED", "LOST", "RETIRED"] as const).map((v) => ({ value: v, label: t(`item.statuses.${v}`) }));
  return (
    <div className="space-y-4">
      {(ending || card.employee.endDate) && withEmployee.length > 0 && (
        <Section title={t("item.toReturn")} className="border-amber-300 bg-amber-50">
          <p className="mb-2 text-sm">{t("item.toReturnHint")}</p>
          <ul className="list-disc pl-5 text-sm" data-testid="items-to-return">
            {withEmployee.map((i) => (
              <li key={i.id}>
                {i.name}
                {i.serialNumber ? ` (${i.serialNumber})` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={t("clothing.title")}>
        <h3 className="mb-2 text-sm font-semibold">{t("clothing.sizes")}</h3>
        <DetailList
          items={[
            { label: t("clothing.jacket"), value: eq.sizes.jacket },
            { label: t("clothing.trousers"), value: eq.sizes.trousers },
            { label: t("clothing.shoe"), value: eq.sizes.shoe },
          ]}
        />
        {card.can.editPersonal && (
          <Disclosure summary={tc("edit")}>
            <PersonalForm card={card} act={act} show={["sizes"]} />
          </Disclosure>
        )}
        <h3 className="mt-4 mb-2 text-sm font-semibold">{t("clothing.history")}</h3>
        {eq.clothing.length === 0 ? (
          <EmptyState>{t("clothing.none")}</EmptyState>
        ) : (
          <ul className="divide-y text-sm" data-testid="clothing-history">
            {eq.clothing.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className={c.archivedAt ? "line-through text-muted-foreground" : "font-medium"}>{c.product}</span>
                <span className="text-muted-foreground">
                  {[c.size, t("clothing.pcs", { count: c.quantity }), fmtDate(format, c.issuedOn)].filter(Boolean).join(" · ")}
                </span>
                {c.archivedAt && <SmallBadge tone="muted">{t("clothing.cancelled")}</SmallBadge>}
                {c.notes && <span className="w-full text-xs text-muted-foreground">{c.notes}</span>}
                {card.can.admin && !c.archivedAt && (
                  <ActionButton action={act("clothingCancel", c.id)} variant="ghost" confirm={tc("confirmArchive")} className="ml-auto">
                    {t("clothing.cancel")}
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {card.can.admin && (
          <Disclosure summary={t("clothing.issue")} testId="issue-clothing">
            <ActionForm action={act("clothingIssue", card.employee.id)} className="grid gap-3 sm:grid-cols-2">
              <TextField name="product" label={t("clothing.product")} required />
              <TextField name="size" label={t("clothing.size")} />
              <TextField name="quantity" label={t("clothing.quantity")} type="number" inputMode="numeric" min={1} defaultValue={1} />
              <TextField name="issuedOn" label={t("clothing.issuedOn")} type="date" required defaultValue={todayInDisplayZone()} />
              <TextField name="notes" label={tc("notes")} className="sm:col-span-2" />
              <div className="sm:col-span-2">
                <SubmitButton>{tc("save")}</SubmitButton>
              </div>
            </ActionForm>
          </Disclosure>
        )}
      </Section>

      <Section title={t("item.title")}>
        {eq.items.length === 0 ? (
          <EmptyState>{t("item.none")}</EmptyState>
        ) : (
          <ul className="divide-y" data-testid="company-items">
            {eq.items.map((i) => (
              <li key={i.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.name}</span>
                  <SmallBadge tone="muted">{t(`item.types.${i.itemType}`)}</SmallBadge>
                  <SmallBadge tone={i.status === "WITH_EMPLOYEE" ? "ok" : i.status === "LOST" ? "bad" : "muted"}>{t(`item.statuses.${i.status}`)}</SmallBadge>
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {[[i.brand, i.model].filter(Boolean).join(" "), i.serialNumber, `${t("item.issuedOn")} ${fmtDate(format, i.issuedOn)}`, i.conditionAtIssue, i.returnedOn && `${t("item.returnedOn")} ${fmtDate(format, i.returnedOn)}`, i.nextInspectionOn && `${t("item.nextInspectionOn")} ${fmtDate(format, i.nextInspectionOn)}`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {i.notes && <p className="mt-1 text-sm whitespace-pre-wrap">{i.notes}</p>}
                <p className="mt-1 text-xs">{i.acknowledgedAt ? t("item.acknowledged", { date: fmtDate(format, i.acknowledgedAt) }) : t("item.notAcknowledged")}</p>
                <Attachments slug={slug} files={files} act={act} employeeId={card.employee.id} target={{ type: "ITEM", id: i.id, kind: "ITEM" }} canAttach={card.can.admin} />
                <div className="mt-2 flex flex-wrap gap-2">
                  {card.can.selfService && !i.acknowledgedAt && (
                    <ActionButton action={act("itemAcknowledge", i.id)} variant="default">
                      {t("item.acknowledge")}
                    </ActionButton>
                  )}
                </div>
                {card.can.admin && (
                  <Disclosure summary={t("item.edit")}>
                    <ItemForm act={act} op="itemUpdate" id={i.id} itemTypes={itemTypes} itemStatuses={itemStatuses} item={i} />
                  </Disclosure>
                )}
              </li>
            ))}
          </ul>
        )}
        {card.can.admin && (
          <Disclosure summary={t("item.add")} testId="add-item">
            <ItemForm act={act} op="itemAdd" id={card.employee.id} itemTypes={itemTypes} itemStatuses={itemStatuses} />
          </Disclosure>
        )}
      </Section>
    </div>
  );
}

async function ItemForm({ act, op, id, itemTypes, itemStatuses, item }: { act: Act; op: "itemAdd" | "itemUpdate"; id: string; itemTypes: { value: string; label: string }[]; itemStatuses: { value: string; label: string }[]; item?: NonNullable<Card["equipment"]>["items"][number] }) {
  const [t, tc] = await Promise.all([getTranslations("hr.item"), getTranslations("common")]);
  return (
    <ActionForm action={act(op, id)} className="grid gap-3 sm:grid-cols-2">
      <TextField name="name" label={t("name")} required defaultValue={item?.name} />
      <SelectField name="itemType" label={t("type")} defaultValue={item?.itemType ?? "OTHER"} options={itemTypes} />
      <TextField name="brand" label={t("brand")} defaultValue={item?.brand} />
      <TextField name="model" label={t("model")} defaultValue={item?.model} />
      <TextField name="serialNumber" label={t("serialNumber")} defaultValue={item?.serialNumber} />
      <TextField name="issuedOn" label={t("issuedOn")} type="date" required defaultValue={item ? isoDate(item.issuedOn) : todayInDisplayZone()} />
      <TextField name="conditionAtIssue" label={t("condition")} defaultValue={item?.conditionAtIssue} />
      <SelectField name="status" label={t("status")} defaultValue={item?.status ?? "WITH_EMPLOYEE"} options={itemStatuses} />
      <TextField name="returnedOn" label={t("returnedOn")} type="date" defaultValue={isoDate(item?.returnedOn)} />
      <TextField name="nextInspectionOn" label={t("nextInspectionOn")} type="date" defaultValue={isoDate(item?.nextInspectionOn)} />
      <TextareaField name="notes" label={tc("notes")} defaultValue={item?.notes} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <SubmitButton>{tc("save")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export async function DocumentsTab({ slug, card, act, files, maxMb }: { slug: string; card: Card; act: Act; files: CardFile[]; maxMb: number }) {
  const [t, tc, format] = await Promise.all([getTranslations("hr.files"), getTranslations("common"), getFormatter()]);
  const kinds = (["CERTIFICATE", "CARD_IMAGE", "TRAINING_CERTIFICATE", "ORIENTATION", "OTHER"] as const).map((k) => ({ value: k, label: t(`kinds.${k}`) }));
  const canUpload = card.can.admin || card.can.selfService;
  return (
    <Section title={t("title")}>
      <p className="mb-3 text-xs text-muted-foreground">{t("hint", { mb: maxMb })}</p>
      {files.length === 0 ? (
        <EmptyState>{t("none")}</EmptyState>
      ) : (
        <ul className="divide-y" data-testid="hr-files">
          {files.map((f) => (
            <li key={f.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-all">{f.displayName}</span>
                <SmallBadge tone="muted">{t(`kinds.${f.kind}`)}</SmallBadge>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t("addedAt")} {fmtDate(format, f.createdAt)} · {t("addedBy")} {f.createdByName ?? "–"} · {fmtBytes(f.sizeBytes)}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <a href={`/c/${slug}/workforce/files/${f.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm hover:bg-muted md:min-h-9">
                  <Eye className="size-4" aria-hidden /> {t("preview")}
                </a>
                <a href={`/c/${slug}/workforce/files/${f.id}?download=1`} className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm hover:bg-muted md:min-h-9">
                  <Download className="size-4" aria-hidden /> {tc("download")}
                </a>
                {f.canManage && (
                  <ActionButton action={act("fileArchive", f.id)} variant="ghost" confirm={t("confirmRemove")}>
                    {t("remove")}
                  </ActionButton>
                )}
              </div>
              {f.canManage && (
                <Disclosure summary={t("rename")}>
                  <ActionForm action={act("fileRename", f.id)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <TextField name="displayName" label={t("displayName")} defaultValue={f.displayName} required className="sm:flex-1" />
                    <SubmitButton>{tc("save")}</SubmitButton>
                  </ActionForm>
                </Disclosure>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <Disclosure summary={t("upload")} testId="upload-file">
          <ActionForm action={act("fileUpload", card.employee.id)} className="grid gap-3 sm:grid-cols-2">
            <SelectField name="kind" label={t("kind")} defaultValue="OTHER" options={kinds} />
            <TextField name="displayName" label={t("displayName")} />
            <div className="sm:col-span-2">
              <FileField label={t("file")} accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" required />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton>{t("upload")}</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      )}
    </Section>
  );
}
