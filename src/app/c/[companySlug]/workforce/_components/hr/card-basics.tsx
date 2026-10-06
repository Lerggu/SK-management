import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm, CheckboxGroupField, SelectField, SubmitButton, TextField, TextareaField } from "@/ui/components/form";
import { DetailList, EmptyState, Section } from "@/ui/components/page";
import { fmtDate } from "@/ui/format";
import { DRIVER_LICENCE_CLASSES, LANGUAGES } from "@/modules/hr/schemas";
import { Disclosure } from "./disclosure";
import { SmallBadge } from "./badges";
import type { Act, Card } from "./types";

/** Personal fields form; fields not shown are sent as hidden inputs so nothing is cleared. */
export async function PersonalForm({ card, act, show }: { card: Card; act: Act; show: ("contact" | "emergency" | "language" | "sizes")[] }) {
  const t = await getTranslations("hr");
  const e = card.employee;
  const values = {
    phone: e.phone ?? "",
    emergencyContactName: card.work?.emergency?.name ?? "",
    emergencyContactPhone: card.work?.emergency?.phone ?? "",
    preferredLanguage: card.work?.preferredLanguage ?? "",
    interpreterNeeded: card.work?.interpreterNeeded ? "on" : "",
    jacketSize: card.equipment?.sizes.jacket ?? "",
    trousersSize: card.equipment?.sizes.trousers ?? "",
    shoeSize: card.equipment?.sizes.shoe ?? "",
  };
  const hidden = (names: (keyof typeof values)[]) => names.map((n) => (values[n] ? <input key={n} type="hidden" name={n} value={values[n]} /> : null));
  return (
    <ActionForm action={act("personal", e.id)} className="grid gap-3 sm:grid-cols-2" showSuccess>
      {show.includes("contact") ? <TextField name="phone" label={t("personal.phone")} type="tel" inputMode="tel" defaultValue={values.phone} /> : hidden(["phone"])}
      {show.includes("emergency") ? (
        <>
          <TextField name="emergencyContactName" label={t("emergency.name")} defaultValue={values.emergencyContactName} autoComplete="off" />
          <TextField name="emergencyContactPhone" label={t("emergency.phone")} type="tel" inputMode="tel" defaultValue={values.emergencyContactPhone} autoComplete="off" />
        </>
      ) : (
        hidden(["emergencyContactName", "emergencyContactPhone"])
      )}
      {show.includes("language") ? (
        <>
          <SelectField name="preferredLanguage" label={t("language.preferred")} defaultValue={values.preferredLanguage} placeholder={t("none")} options={LANGUAGES.map((l) => ({ value: l, label: t(`language.names.${l}`) }))} />
          <label className="flex min-h-11 items-center gap-2 self-end text-sm md:min-h-9">
            <input type="checkbox" name="interpreterNeeded" defaultChecked={card.work?.interpreterNeeded ?? false} className="size-5 accent-primary md:size-4" />
            {t("language.interpreter")}
          </label>
        </>
      ) : (
        hidden(["preferredLanguage", "interpreterNeeded"])
      )}
      {show.includes("sizes") ? (
        <>
          <TextField name="jacketSize" label={t("clothing.jacket")} defaultValue={values.jacketSize} />
          <TextField name="trousersSize" label={t("clothing.trousers")} defaultValue={values.trousersSize} />
          <TextField name="shoeSize" label={t("clothing.shoe")} defaultValue={values.shoeSize} inputMode="numeric" />
        </>
      ) : (
        hidden(["jacketSize", "trousersSize", "shoeSize"])
      )}
      <div className="sm:col-span-2">
        <SubmitButton>{t("save")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export async function BasicsTab({
  card,
  act,
  supervisors,
  profiles,
  existingTeams,
  existingLocations,
  names,
  users,
}: {
  names: { areas: Record<string, string>; types: Record<string, string> };
  users: { id: string; name: string; email: string; linkedEmployeeId: string | null }[];
  card: Card;
  act: Act;
  supervisors: { id: string; name: string }[];
  profiles: { id: string; name: string }[];
  existingTeams: string[];
  existingLocations: string[];
}) {
  const [t, tw, format] = await Promise.all([getTranslations("hr"), getTranslations("workforce"), getFormatter()]);
  const e = card.employee;
  const profileName = card.work?.jobProfile?.name ?? profiles.find((p) => p.id === e.jobProfileId)?.name ?? null;
  return (
    <div className="space-y-4">
      <Section title={t("employment.title")}>
        <DetailList
          items={[
            { label: tw("jobTitle"), value: e.jobTitle },
            { label: t("employment.supervisor"), value: e.supervisor?.name ?? t("employment.noSupervisor") },
            { label: t("employment.team"), value: e.team },
            { label: t("employment.location"), value: e.location },
            { label: t("employment.jobProfile"), value: profileName ?? t("employment.noProfile") },
            { label: t("employment.status"), value: tw(`statuses.${e.status}`) },
            { label: tw("startDate"), value: fmtDate(format, e.startDate) },
            { label: tw("endDate"), value: fmtDate(format, e.endDate) },
            { label: tw("phone"), value: e.phone && <a href={`tel:${e.phone}`} className="underline">{e.phone}</a> },
            { label: tw("email"), value: e.email && <a href={`mailto:${e.email}`} className="underline">{e.email}</a> },
          ]}
        />
        {card.can.editEmployment && (
          <Disclosure summary={t("edit")} testId="employment-form">
            <ActionForm action={act("employment", e.id)} className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="userId"
                label={t("employment.user")}
                defaultValue={e.userId ?? ""}
                placeholder={t("employment.noUser")}
                options={users.filter((u) => !u.linkedEmployeeId || u.linkedEmployeeId === e.id).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
                className="sm:col-span-2"
              />
              <SelectField name="supervisorId" label={t("employment.supervisor")} defaultValue={e.supervisor?.id ?? ""} placeholder={t("employment.noSupervisor")} options={supervisors.filter((s) => s.id !== e.id).map((s) => ({ value: s.id, label: s.name }))} />
              <SelectField name="jobProfileId" label={t("employment.jobProfile")} defaultValue={e.jobProfileId ?? ""} placeholder={t("employment.noProfile")} options={profiles.map((p) => ({ value: p.id, label: p.name }))} />
              <TextField name="team" label={t("employment.team")} defaultValue={e.team} list="hr-teams" />
              <TextField name="location" label={t("employment.location")} defaultValue={e.location} list="hr-locations" />
              <datalist id="hr-teams">{existingTeams.map((x) => <option key={x} value={x} />)}</datalist>
              <datalist id="hr-locations">{existingLocations.map((x) => <option key={x} value={x} />)}</datalist>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t("employment.statusHint")}</p>
              <div className="sm:col-span-2">
                <SubmitButton>{t("save")}</SubmitButton>
              </div>
            </ActionForm>
          </Disclosure>
        )}
      </Section>

      {card.work?.emergency && (
        <Section title={t("emergency.title")}>
          <p className="mb-3 text-xs text-muted-foreground">{t("emergency.hint")}</p>
          <DetailList
            items={[
              { label: t("emergency.name"), value: card.work.emergency.name ?? t("emergency.none") },
              { label: t("emergency.phone"), value: card.work.emergency.phone && <a href={`tel:${card.work.emergency.phone}`} className="underline">{card.work.emergency.phone}</a> },
            ]}
          />
        </Section>
      )}

      {card.can.editPersonal && (
        <Section title={t("personal.title")}>
          <p className="text-xs text-muted-foreground">{t("personal.hint")}</p>
          <Disclosure summary={t("edit")} testId="personal-form">
            <PersonalForm card={card} act={act} show={["contact", "emergency"]} />
          </Disclosure>
        </Section>
      )}

      {card.work && (
        <Section title={t("driving.title")}>
          <DetailList
            items={[
              { label: t("driving.classes"), value: card.work.driverLicenceClasses.length ? card.work.driverLicenceClasses.join(", ") : t("driving.none") },
              { label: t("driving.rights"), value: card.work.drivingRights ?? t("driving.none") },
            ]}
          />
          {card.can.supervise && (
            <Disclosure summary={t("edit")}>
              <ActionForm action={act("driving", e.id)} className="space-y-3">
                <CheckboxGroupField name="driverLicenceClasses" label={t("driving.classes")} options={DRIVER_LICENCE_CLASSES.map((c) => ({ value: c, label: c }))} defaultValues={card.work.driverLicenceClasses} />
                <TextareaField name="drivingRights" label={t("driving.rights")} hint={t("driving.rightsHint")} defaultValue={card.work.drivingRights} />
                <SubmitButton>{t("save")}</SubmitButton>
              </ActionForm>
            </Disclosure>
          )}
        </Section>
      )}

      {card.work?.jobProfile && (
        <Section title={`${t("requirements.title")}: ${card.work.jobProfile.name}`}>
          {card.work.gaps.length === 0 ? (
            <p className="flex items-center gap-2 text-sm">
              <SmallBadge tone="ok">✓</SmallBadge> {t("requirements.allMet")}
            </p>
          ) : (
            <ul className="divide-y text-sm" data-testid="requirement-gaps">
              {card.work.gaps.map((g) => (
                <li key={g.requirement.id} className="flex flex-wrap items-center gap-2 py-2">
                  <SmallBadge tone="bad">{t(`requirements.kinds.${g.requirement.kind}`)}</SmallBadge>
                  <span className="flex-1">
                    {g.requirement.kind === "COMPETENCE" ? names.areas[g.requirement.areaId ?? ""] : g.requirement.kind === "QUALIFICATION" ? names.types[g.requirement.qualificationTypeId ?? ""] : g.requirement.orientationTopic}
                  </span>
                  <span className="text-muted-foreground">{t(`requirements.reasons.${g.reason}`, { level: g.currentLevel ?? 0, min: g.requirement.minLevel ?? 0 })}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {!card.work && <EmptyState>{t("basicOnly")}</EmptyState>}
    </div>
  );
}
