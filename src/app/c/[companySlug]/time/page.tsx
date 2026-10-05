import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, ClipboardCheck, Download } from "lucide-react";
import { ValidationError } from "@/platform/errors";
import { hasPermission, projectIdsWithPermission, projectPermissions } from "@/platform/authz";
import { timesheetService } from "@/modules/timesheets/service";
import { D } from "@/modules/finance/calculations";
import { WORK_CLASSES } from "@/modules/timesheets/schemas";
import { addDays, formatClock, isoDateString, isoWeekNumber, weekStart } from "@/modules/timesheets/rules";
import { ActionButton, ActionForm, CheckboxGroupField, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { QuickHours } from "@/ui/components/quick-hours";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { Button } from "@/ui/components/button";
import { requireCompanyContext } from "@/app/_lib/context";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { locationOptions } from "@/app/_lib/locations";
import { archiveEntryAction, correctionAction, createCrewAction, createEntryAction, submitWeekAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("time"))("title") };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function TimePage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ date?: string; employee?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [t, tc, format] = await Promise.all([getTranslations("time"), getTranslations("common"), getFormatter()]);
  const today = todayInDisplayZone();
  const date = sp.date && ISO.test(sp.date) ? sp.date : today;
  const monday = weekStart(new Date(`${date}T00:00:00Z`));
  const base = `/c/${companySlug}/time`;

  const options = await timesheetService.entryOptions(ctx);
  const viewedEmployeeId = sp.employee && options.crewEmployees.some((e) => e.id === sp.employee) ? sp.employee : null;
  let week: Awaited<ReturnType<typeof timesheetService.listWeek>> | null = null;
  try {
    week = await timesheetService.listWeek(ctx, { employeeId: viewedEmployeeId, date });
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
  }
  const entryLocations = await locationOptions(ctx, viewedEmployeeId ? "timesheet.manage" : "timesheet.submit");
  const crewLocations = options.canManageCrew ? await locationOptions(ctx, "timesheet.manage") : [];
  const approveProjects = projectIdsWithPermission(ctx, "timesheet.approve");
  const canApprove = approveProjects === undefined || approveProjects.length > 0;
  const canExport = hasPermission(ctx, "timesheet.export");
  const classOptions = WORK_CLASSES.map((c) => ({ value: c, label: t(`workClasses.${c}`) }));
  const query = (d: Date) => `${base}?date=${isoDateString(d)}${viewedEmployeeId ? `&employee=${viewedEmployeeId}` : ""}`;

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const total = (week?.entries ?? []).reduce((s, e) => s.plus(e.hours), D(0));
  const hasDrafts = (week?.entries ?? []).some((e) => e.status === "DRAFT" || e.status === "REJECTED");
  const fmtH = (d: { toString(): string }) => format.number(Number(d.toString()), { maximumFractionDigits: 2 });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("weekOf", { week: isoWeekNumber(monday), from: format.dateTime(monday, { day: "numeric", month: "numeric", timeZone: "UTC" }), to: format.dateTime(addDays(monday, 6), { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }) })}
        actions={
          <>
            {canApprove && (
              <Button asChild variant="outline">
                <Link href={`${base}/approvals`}>
                  <ClipboardCheck aria-hidden /> {t("approvals")}
                </Link>
              </Button>
            )}
            {canExport && (
              <Button asChild variant="outline">
                <Link href={`${base}/export`}>
                  <Download aria-hidden /> {t("export")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label={t("prevWeek")}>
          <Link href={query(addDays(monday, -7))}>
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={query(new Date())}>{t("thisWeek")}</Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label={t("nextWeek")}>
          <Link href={query(addDays(monday, 7))}>
            <ChevronRight aria-hidden />
          </Link>
        </Button>
        {options.canManageCrew && (
          <form className="flex flex-1 items-center gap-2 sm:flex-none">
            <input type="hidden" name="date" value={date} />
            <select name="employee" defaultValue={viewedEmployeeId ?? ""} aria-label={t("employee")} className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm">
              <option value="">{t("self")}</option>
              {options.crewEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.lastName} {e.firstName} ({e.employeeNumber})
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              {tc("open")}
            </Button>
          </form>
        )}
      </div>

      <div className="space-y-4">
        {!week ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">{t("noEmployeeRecord")}</p>
        ) : (
          <>
            <Section title={`${t("addEntry")}${viewedEmployeeId ? ` – ${week.employee.lastName} ${week.employee.firstName}` : ""}`}>
              {entryLocations.length === 0 ? (
                <EmptyState>{tc("noResults")}</EmptyState>
              ) : (
                <ActionForm action={createEntryAction.bind(null, companySlug, viewedEmployeeId)} className="grid gap-4 sm:grid-cols-2" showSuccess>
                  <SelectField name="location" label={t("project")} options={entryLocations} defaultValue={entryLocations[0]?.value} required className="sm:col-span-2" />
                  <TextField name="workDate" label={t("date")} type="date" defaultValue={date === today || !sp.date ? today : date} required />
                  <div className="space-y-2">
                    <TextField name="hours" label={t("hours")} inputMode="decimal" placeholder="8" />
                    <QuickHours label={t("quickHours")} />
                  </div>
                  <details className="sm:col-span-2">
                    <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted-foreground md:min-h-0">{t("orTimes")}</summary>
                    <div className="mt-2 grid grid-cols-2 gap-4">
                      <TextField name="startTime" label={t("startTime")} type="time" />
                      <TextField name="endTime" label={t("endTime")} type="time" />
                    </div>
                  </details>
                  <SelectField name="workClass" label={t("workClass")} defaultValue="NORMAL" options={classOptions} />
                  <TextField name="note" label={t("note")} />
                  <div className="sm:col-span-2">
                    <SubmitButton>{t("addEntry")}</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </Section>

            <Section
              title={t("weekTotal", { hours: fmtH(total) })}
              actions={
                hasDrafts && (
                  <ActionButton action={submitWeekAction.bind(null, companySlug, viewedEmployeeId, date)} variant="default">
                    {t("submitWeek")}
                  </ActionButton>
                )
              }
            >
              {week.entries.length === 0 ? (
                <EmptyState>{t("noEntries")}</EmptyState>
              ) : (
                <ol className="space-y-3" data-testid="week-entries">
                  {days.map((d) => {
                    const entries = week!.entries.filter((e) => isoDateString(e.workDate) === isoDateString(d));
                    if (entries.length === 0) return null;
                    const dayTotal = entries.reduce((s, e) => s.plus(e.hours), D(0));
                    return (
                      <li key={d.toISOString()}>
                        <div className="mb-1 flex justify-between text-sm font-medium">
                          <span className="capitalize">{format.dateTime(d, { weekday: "long", day: "numeric", month: "numeric", timeZone: "UTC" })}</span>
                          <span className="tabular-nums">{t("dayTotal", { hours: fmtH(dayTotal) })}</span>
                        </div>
                        <ul className="divide-y rounded-lg border">
                          {entries.map((e) => {
                            const perms = projectPermissions(ctx, e.projectId);
                            const canCorrect = (e.status === "APPROVED" || e.status === "EXPORTED") && !e.correctionOfId && (perms.has("timesheet.manage") || perms.has("timesheet.approve"));
                            return (
                              <li key={e.id} className="space-y-2 p-3" data-status={e.status}>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-base font-semibold tabular-nums">{fmtH(e.hours)} h</span>
                                  <StatusBadge status={e.status} label={t(`statuses.${e.status}`)} />
                                  {e.workClass !== "NORMAL" && <span className="text-xs font-medium text-muted-foreground">{t(`workClasses.${e.workClass}`)}</span>}
                                  {e.correctionOfId && <span className="text-xs font-medium text-amber-700">{t("correctionOf")}</span>}
                                  <span className="flex-1 text-sm text-muted-foreground">
                                    {e.project.code}
                                    {e.site ? ` › ${e.site.name}` : ""}
                                    {e.startMinute !== null && e.endMinute !== null ? ` · ${formatClock(e.startMinute)}–${formatClock(e.endMinute)}` : ""}
                                  </span>
                                  {(e.status === "DRAFT" || e.status === "REJECTED") && (
                                    <ActionButton action={archiveEntryAction.bind(null, companySlug, e.id)} confirm={tc("confirmArchive")} variant="ghost">
                                      {t("delete")}
                                    </ActionButton>
                                  )}
                                </div>
                                {e.note && <p className="text-sm">{e.note}</p>}
                                {e.status === "REJECTED" && e.rejectionReason && <p className="text-sm text-destructive">{t("rejectedReason", { reason: e.rejectionReason })}</p>}
                                {canCorrect && (
                                  <details>
                                    <summary className="min-h-11 cursor-pointer py-2 text-sm text-primary md:min-h-0">{t("correction")}</summary>
                                    <ActionForm action={correctionAction.bind(null, companySlug, e.id)} className="mt-2 grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
                                      <p className="text-xs text-muted-foreground sm:col-span-3">{t("correctionHint")}</p>
                                      <TextField name="hours" label={t("correctionHours")} inputMode="decimal" placeholder="-0,5" required />
                                      <TextField name="note" label={t("note")} required />
                                      <SubmitButton variant="outline">{t("createCorrection")}</SubmitButton>
                                    </ActionForm>
                                  </details>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Section>
          </>
        )}

        {options.canManageCrew && crewLocations.length > 0 && (
          <Section title={t("crewTitle")}>
            <p className="mb-3 text-sm text-muted-foreground">{t("crewHint")}</p>
            <ActionForm action={createCrewAction.bind(null, companySlug)} className="grid gap-4 sm:grid-cols-2" showSuccess>
              <div className="sm:col-span-2">
                <CheckboxGroupField name="employeeIds" label={t("people")} options={options.crewEmployees.map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }))} />
              </div>
              <SelectField name="location" label={t("project")} options={crewLocations} defaultValue={crewLocations[0]?.value} required className="sm:col-span-2" />
              <TextField name="workDate" label={t("date")} type="date" defaultValue={today} required />
              <TextField name="hours" label={t("hours")} inputMode="decimal" placeholder="8" />
              <SelectField name="workClass" label={t("workClass")} defaultValue="NORMAL" options={classOptions} />
              <TextField name="note" label={t("note")} />
              <div className="sm:col-span-2">
                <SubmitButton>{t("crewSubmit")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
