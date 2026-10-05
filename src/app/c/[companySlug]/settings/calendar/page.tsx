import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { workCalendarService } from "@/modules/takt/calendar.service";
import { ActionButton, ActionForm, SubmitButton, TextField } from "@/ui/components/form";
import { PageHeader, Section } from "@/ui/components/page";
import { requireCompanyContext } from "@/app/_lib/context";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { SettingsNav } from "../_components/settings-nav";
import { addFinnishHolidaysAction, addHolidayAction, removeHolidayAction, updateWeekdaysAction } from "../../takt/actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("takt"))("calendarTitle") };
}

export default async function CalendarPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [cal, t, tc, ts, format] = await Promise.all([workCalendarService.get(ctx), getTranslations("takt"), getTranslations("common"), getTranslations("settings"), getFormatter()]);
  const year = Number(todayInDisplayZone().slice(0, 4));
  const upcoming = cal.holidays.filter((h) => h.date >= `${year}-01-01`);
  return (
    <>
      <PageHeader title={ts("title")} />
      <SettingsNav ctx={ctx} active="calendar" />
      <div className="space-y-4">
        <Section title={t("calendarTitle")}>
          <p className="mb-3 text-sm text-muted-foreground">{t("calendarHint")}</p>
          {!cal.persisted && <p className="mb-3 rounded-lg border border-dashed p-3 text-sm">{t("calendarDefaults")}</p>}
          {cal.canManage ? (
            <ActionForm action={updateWeekdaysAction.bind(null, companySlug)} showSuccess>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">{t("workingDays")}</legend>
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <label key={d} className="flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-muted md:min-h-9">
                      <input type="checkbox" name="workingWeekdays" value={d} defaultChecked={cal.workingWeekdays.includes(d)} className="size-5 accent-primary md:size-4" />
                      <span className="text-sm">{t(`weekdays.${d}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <SubmitButton variant="outline">{tc("save")}</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-sm">{cal.workingWeekdays.map((d) => t(`weekdays.${d}`)).join(", ")}</p>
          )}
        </Section>
        <Section title={t("holidays")}>
          <ul className="divide-y text-sm" data-testid="holidays">
            {upcoming.map((h) => (
              <li key={`${h.date}-${h.name}`} className="flex min-h-11 items-center gap-3 py-1">
                <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{format.dateTime(new Date(`${h.date}T12:00:00Z`), { weekday: "short", day: "numeric", month: "numeric", year: "numeric" })}</span>
                <span className="flex-1">{h.name}</span>
                {cal.canManage && h.id && (
                  <ActionButton action={removeHolidayAction.bind(null, companySlug, h.id)} variant="ghost">
                    {tc("remove")}
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
          {cal.canManage && (
            <div className="mt-4 space-y-4 border-t pt-4">
              <ActionForm action={addHolidayAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                <TextField name="date" label={t("holidayDate")} type="date" required />
                <TextField name="name" label={t("holidayName")} required />
                <SubmitButton variant="outline">{t("addHoliday")}</SubmitButton>
              </ActionForm>
              <ActionForm action={addFinnishHolidaysAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-[12rem_auto] sm:items-end">
                <TextField name="year" label={t("year")} inputMode="numeric" defaultValue={String(year + 3)} />
                <SubmitButton variant="outline">{t("addFinnish")}</SubmitButton>
              </ActionForm>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
