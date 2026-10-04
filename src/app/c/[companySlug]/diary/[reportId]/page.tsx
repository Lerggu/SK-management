import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Lock } from "lucide-react";
import { diaryService } from "@/modules/diary/service";
import { ENTRY_KINDS } from "@/modules/diary/schemas";
import { ActionButton, ActionForm, FileField, SelectField, SubmitButton, TextareaField, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { addDiaryEntryAction, addPhotoAction, removeDiaryEntryAction, signDiaryAction, updateDiaryAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("diary"))("title") };
}

export default async function DiaryPage({ params }: { params: Promise<{ companySlug: string; reportId: string }> }) {
  const { companySlug, reportId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const r = await loadOr404(diaryService.get(ctx, reportId));
  const [t, tc, format] = await Promise.all([getTranslations("diary"), getTranslations("common"), getFormatter()]);
  const signed = r.status === "SIGNED";
  const canWrite = r.permissions.manage;
  const equipment = canWrite ? await diaryService.equipmentOptions(ctx, r.id) : [];
  const dateLabel = format.dateTime(r.reportDate, { weekday: "long", day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        title={`${t("title")} · ${r.site.name}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2 capitalize">
            <StatusBadge status={signed ? "APPROVED" : "DRAFT"} label={t(`statuses.${r.status}`)} />
            {dateLabel} · {r.site.project.code} {r.site.project.name}
          </span>
        }
        backHref={`/c/${companySlug}/projects/${r.site.project.id}`}
        backLabel={r.site.project.code}
      />
      <div className="space-y-4">
        {signed && (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-4 py-3 text-sm" data-testid="diary-signed">
            <Lock className="size-4" aria-hidden />
            {t("signedBy", { name: r.signer?.name ?? r.signer?.email ?? "–", date: fmtDateTime(format, r.signedAt) })}
          </p>
        )}

        <Section title={t("summary")}>
          {canWrite && !signed ? (
            <ActionForm action={updateDiaryAction.bind(null, companySlug, r.id)} className="grid gap-4" showSuccess>
              <TextField name="weather" label={t("weather")} defaultValue={r.weather} />
              <TextareaField name="summary" label={t("summary")} defaultValue={r.summary} rows={4} />
              <div>
                <SubmitButton variant="outline">{t("save")}</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase text-muted-foreground">{t("weather")}</dt>
                <dd>{r.weather ?? "–"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-muted-foreground">{t("summary")}</dt>
                <dd className="whitespace-pre-wrap">{r.summary ?? "–"}</dd>
              </div>
            </dl>
          )}
        </Section>

        <Section title={t("attendance")}>
          <p className="mb-2 text-xs text-muted-foreground">{signed ? t("attendanceFrozen") : t("attendanceHint")}</p>
          {r.attendance.length === 0 ? (
            <EmptyState>{t("noAttendance")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="attendance">
              {r.attendance.map((a) => (
                <li key={a.employeeId} className="flex min-h-11 items-center justify-between py-2">
                  <span>
                    {a.name} <span className="text-muted-foreground">({a.employeeNumber})</span>
                  </span>
                  <span className="font-semibold tabular-nums">{t("hours", { hours: format.number(Number(a.hours), { maximumFractionDigits: 2 }) })}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("entries")}>
          {r.entries.length === 0 ? (
            <EmptyState>{tc("noResults")}</EmptyState>
          ) : (
            <ul className="divide-y" data-testid="diary-entries">
              {r.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start gap-2 py-3">
                  <span className="w-32 shrink-0 text-xs font-semibold uppercase text-muted-foreground">
                    {t(`kinds.${e.kind}`)}
                    {e.isAddendum && <span className="mt-1 block text-amber-700">{t("addendum")}</span>}
                  </span>
                  <span className="min-w-0 flex-1 text-sm whitespace-pre-wrap">
                    {e.kind === "EQUIPMENT" && e.equipment ? `${e.equipment.assetNumber} · ${e.equipment.name} – ${t("hours", { hours: format.number(Number(e.hours), { maximumFractionDigits: 2 }) })}` : ""}
                    {e.description ? `${e.kind === "EQUIPMENT" ? " · " : ""}${e.description}` : ""}
                  </span>
                  {canWrite && !signed && (
                    <ActionButton action={removeDiaryEntryAction.bind(null, companySlug, r.id, e.id)} variant="ghost">
                      {t("remove")}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <ActionForm action={addDiaryEntryAction.bind(null, companySlug, r.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
              {signed && <p className="text-sm text-amber-800 sm:col-span-2">{t("signHint")}</p>}
              <SelectField name="kind" label={t("kind")} defaultValue="WORK" options={ENTRY_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))} />
              <SelectField name="equipmentId" label={t("equipment")} placeholder="–" options={equipment.map((e) => ({ value: e.id, label: `${e.assetNumber} · ${e.name}` }))} />
              <TextField name="hours" label={t("equipmentHours")} inputMode="decimal" />
              <TextareaField name="description" label={t("description")} rows={2} />
              <div className="sm:col-span-2">
                <SubmitButton variant="outline">{signed ? t("addendum") : t("addEntry")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>

        <Section title={t("photos")}>
          {r.attachments.length === 0 ? (
            <EmptyState>{t("noPhotos")}</EmptyState>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {r.attachments.map((a) => (
                <li key={a.id} className="overflow-hidden rounded-lg border">
                  <a href={`/c/${companySlug}/diary/attachments/${a.id}`} target="_blank" rel="noopener" className="block">
                    {a.contentType.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element -- authorized private image route
                      <img src={`/c/${companySlug}/diary/attachments/${a.id}`} alt={a.caption ?? a.fileName} className="aspect-square w-full object-cover" />
                    ) : (
                      <span className="flex aspect-square items-center justify-center text-sm">PDF</span>
                    )}
                  </a>
                  <p className="truncate px-2 py-1 text-xs text-muted-foreground">
                    {a.isAddendum ? `${t("addendum")} · ` : ""}
                    {a.caption ?? a.fileName}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <ActionForm action={addPhotoAction.bind(null, companySlug, r.id)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <FileField label={t("addPhoto")} accept="image/*,application/pdf" />
              <TextField name="caption" label={t("caption")} />
              <SubmitButton variant="outline">{t("uploadPhoto")}</SubmitButton>
            </ActionForm>
          )}
        </Section>

        {!signed && r.permissions.sign && (
          <Section title={t("sign")}>
            <p className="mb-3 text-sm text-muted-foreground">{t("signHint")}</p>
            <ActionButton action={signDiaryAction.bind(null, companySlug, r.id)} confirm={t("signHint")} variant="default">
              {t("sign")}
            </ActionButton>
          </Section>
        )}
      </div>
    </>
  );
}
