import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasPermission } from "@/platform/authz";
import { competenceAreaService, hrSettingsService, jobProfileService, qualificationTypeService } from "@/modules/hr/settings.service";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { requireCompanyContext } from "@/app/_lib/context";
import { hrAction, runRemindersAction, type HrOp } from "../hr-actions";
import { HrTabs } from "../_components/hr/tabs";
import { hrTabsFor } from "../_components/hr/access";
import { Disclosure } from "../_components/hr/disclosure";
import { SmallBadge } from "../_components/hr/badges";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hr.settings"))("title") };
}

/** HR administration (hr.manage): competence areas, card types, job requirements, reminders. */
export default async function HrSettingsPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ sent?: string; failed?: string; noAddress?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  if (ctx.external || !hasPermission(ctx, "hr.manage")) notFound();
  const [tabs, t, th, tc, settings, areas, types, profiles] = await Promise.all([
    hrTabsFor(ctx),
    getTranslations("hr.settings"),
    getTranslations("hr"),
    getTranslations("common"),
    hrSettingsService.get(ctx),
    competenceAreaService.list(ctx, { includeArchived: true }),
    qualificationTypeService.list(ctx, { includeArchived: true }),
    jobProfileService.list(ctx),
  ]);
  const act = (op: HrOp, id = "-") => hrAction.bind(null, companySlug, op, id);
  const activeAreas = areas.filter((a) => !a.archivedAt);
  const activeTypes = types.filter((x) => !x.archivedAt);
  const levelOptions = (["1", "2", "3", "4"] as const).map((l) => ({ value: l, label: th(`levels.${l}`) }));
  const scopeOptions = (["COMPANY", "SITE", "EQUIPMENT"] as const).map((s) => ({ value: s, label: th(`orientation.scopes.${s}`) }));
  return (
    <>
      <PageHeader title={t("title")} />
      <HrTabs slug={companySlug} active="settings" show={tabs} />
      <div className="space-y-4">
        <Section title={t("reminders")}>
          <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${settings.mailConfigured ? "bg-emerald-50 text-emerald-900" : "bg-amber-100 text-amber-900"}`} role="status" data-testid="mail-status">
            {settings.mailConfigured ? t("mailOn") : t("mailOff")}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">{t("schedule")}</p>
          <ActionForm action={act("settingsUpdate")} className="flex flex-col gap-2 sm:flex-row sm:items-end" showSuccess>
            <TextField name="reminderEmail" label={t("reminderEmail")} hint={t("reminderEmailHint")} type="email" inputMode="email" defaultValue={settings.reminderEmail} className="sm:flex-1" />
            <SubmitButton>{tc("save")}</SubmitButton>
          </ActionForm>
          <div className="mt-3">
            <ActionButton action={runRemindersAction.bind(null, companySlug)}>{t("runNow")}</ActionButton>
            {sp.sent !== undefined && (
              <p className="mt-2 text-sm" role="status" data-testid="reminder-run-result">
                {t("runResult", { sent: sp.sent ?? "0", failed: sp.failed ?? "0", noAddress: sp.noAddress ?? "0" })}
              </p>
            )}
          </div>
        </Section>

        <Section title={t("areas")} actions={<ActionButton action={act("areaSuggested")}>{t("addSuggested")}</ActionButton>}>
          <p className="mb-3 text-xs text-muted-foreground">{t("areasHint")}</p>
          {areas.length === 0 ? (
            <EmptyState>{th("matrix.noAreas")}</EmptyState>
          ) : (
            <ul className="divide-y" data-testid="area-list">
              {areas.map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={a.archivedAt ? "text-muted-foreground line-through" : "font-medium"}>{a.name}</span>
                    <span className="text-xs text-muted-foreground">{a.category}</span>
                    {a.isKey && <SmallBadge tone="ok">{t("isKey")}</SmallBadge>}
                    {a.archivedAt && <SmallBadge tone="muted">{t("archivedAreas")}</SmallBadge>}
                    <span className="ml-auto flex gap-1">
                      {a.archivedAt ? (
                        <ActionButton action={act("areaRestore", a.id)} variant="ghost">
                          {t("restore")}
                        </ActionButton>
                      ) : (
                        <ActionButton action={act("areaArchive", a.id)} variant="ghost">
                          {t("archiveArea")}
                        </ActionButton>
                      )}
                    </span>
                  </div>
                  {!a.archivedAt && (
                    <Disclosure summary={tc("edit")}>
                      <ActionForm action={act("areaUpdate", a.id)} className="grid gap-3 sm:grid-cols-2">
                        <TextField name="category" label={t("category")} required defaultValue={a.category} />
                        <TextField name="name" label={t("areaName")} required defaultValue={a.name} />
                        <TextField name="description" label={t("description")} defaultValue={a.description} />
                        <TextField name="sortOrder" label={t("sortOrder")} type="number" inputMode="numeric" defaultValue={a.sortOrder} />
                        <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
                          <input type="checkbox" name="isKey" defaultChecked={a.isKey} className="size-5 accent-primary md:size-4" />
                          {t("isKey")}
                        </label>
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
          <Disclosure summary={t("addArea")} testId="add-area">
            <ActionForm action={act("areaCreate")} className="grid gap-3 sm:grid-cols-2">
              <TextField name="category" label={t("category")} required list="hr-area-categories" />
              <datalist id="hr-area-categories">
                {[...new Set(areas.map((a) => a.category))].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <TextField name="name" label={t("areaName")} required />
              <TextField name="description" label={t("description")} />
              <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
                <input type="checkbox" name="isKey" className="size-5 accent-primary md:size-4" />
                {t("isKey")}
              </label>
              <div className="sm:col-span-2">
                <SubmitButton>{tc("add")}</SubmitButton>
              </div>
            </ActionForm>
          </Disclosure>
        </Section>

        <Section title={t("types")} actions={<ActionButton action={act("typeSuggested")}>{t("addSuggestedTypes")}</ActionButton>}>
          {types.length === 0 ? (
            <EmptyState>{th("qualification.none")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="type-list">
              {types.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className={x.archivedAt ? "text-muted-foreground line-through" : "font-medium"}>{x.name}</span>
                  <span className="text-xs text-muted-foreground">{[x.defaultIssuer, x.defaultValidityMonths ? t("months", { n: x.defaultValidityMonths }) : null].filter(Boolean).join(" · ")}</span>
                  <span className="ml-auto">
                    {x.archivedAt ? (
                      <ActionButton action={act("typeRestore", x.id)} variant="ghost">
                        {t("restore")}
                      </ActionButton>
                    ) : (
                      <ActionButton action={act("typeArchive", x.id)} variant="ghost">
                        {t("archiveArea")}
                      </ActionButton>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Disclosure summary={t("addType")} testId="add-type">
            <ActionForm action={act("typeCreate")} className="grid gap-3 sm:grid-cols-3">
              <TextField name="name" label={t("typeName")} required />
              <TextField name="defaultIssuer" label={t("defaultIssuer")} />
              <TextField name="defaultValidityMonths" label={t("defaultValidity")} type="number" inputMode="numeric" />
              <div className="sm:col-span-3">
                <SubmitButton>{tc("add")}</SubmitButton>
              </div>
            </ActionForm>
          </Disclosure>
        </Section>

        <Section title={t("profiles")}>
          <p className="mb-3 text-xs text-muted-foreground">{t("profilesHint")}</p>
          {profiles.length === 0 ? (
            <EmptyState>{th("employment.noProfile")}</EmptyState>
          ) : (
            <ul className="space-y-3" data-testid="profile-list">
              {profiles.map((p) => (
                <li key={p.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-auto">
                      <ActionButton action={act("profileArchive", p.id)} variant="ghost" confirm={tc("confirmArchive")}>
                        {tc("archive")}
                      </ActionButton>
                    </span>
                  </div>
                  {p.requirements.length > 0 && (
                    <ul className="mt-2 divide-y text-sm">
                      {p.requirements.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
                          <SmallBadge tone="muted">{th(`requirements.kinds.${r.kind}`)}</SmallBadge>
                          <span className="flex-1">
                            {r.kind === "COMPETENCE"
                              ? `${areas.find((a) => a.id === r.areaId)?.name ?? ""} ≥ ${r.minLevel}`
                              : r.kind === "QUALIFICATION"
                                ? (types.find((x) => x.id === r.qualificationTypeId)?.name ?? "")
                                : `${th(`orientation.scopes.${r.orientationScope ?? "COMPANY"}`)}: ${r.orientationTopic}`}
                          </span>
                          <ActionButton action={act("requirementRemove", r.id)} variant="ghost">
                            {t("removeRequirement")}
                          </ActionButton>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Disclosure summary={t("addRequirement")}>
                    <div className="grid gap-3 lg:grid-cols-3">
                      <ActionForm action={act("requirementAdd", p.id)} className="space-y-2 rounded-lg border p-3">
                        <input type="hidden" name="kind" value="COMPETENCE" />
                        <SelectField name="areaId" label={th("requirements.kinds.COMPETENCE")} required placeholder="" options={activeAreas.map((a) => ({ value: a.id, label: `${a.category} · ${a.name}` }))} />
                        <SelectField name="minLevel" label={th("requirements.minLevel")} defaultValue="3" options={levelOptions} />
                        <SubmitButton>{tc("add")}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={act("requirementAdd", p.id)} className="space-y-2 rounded-lg border p-3">
                        <input type="hidden" name="kind" value="QUALIFICATION" />
                        <SelectField name="qualificationTypeId" label={th("requirements.kinds.QUALIFICATION")} required placeholder="" options={activeTypes.map((x) => ({ value: x.id, label: x.name }))} />
                        <SubmitButton>{tc("add")}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={act("requirementAdd", p.id)} className="space-y-2 rounded-lg border p-3">
                        <input type="hidden" name="kind" value="ORIENTATION" />
                        <SelectField name="orientationScope" label={th("orientation.scope")} defaultValue="COMPANY" options={scopeOptions} />
                        <TextField name="orientationTopic" label={th("orientation.topic")} required />
                        <SubmitButton>{tc("add")}</SubmitButton>
                      </ActionForm>
                    </div>
                  </Disclosure>
                </li>
              ))}
            </ul>
          )}
          <Disclosure summary={t("addProfile")} testId="add-profile">
            <ActionForm action={act("profileCreate")} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <TextField name="name" label={t("profileName")} required className="sm:flex-1" />
              <SubmitButton>{tc("add")}</SubmitButton>
            </ActionForm>
          </Disclosure>
        </Section>
      </div>
    </>
  );
}
