import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { hasPermission, projectIdsWithPermission } from "@/platform/authz";
import { bookingService } from "@/modules/logistics/booking.service";
import { projectService } from "@/modules/projects/service";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { ActionForm, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { requireCompanyContext } from "@/app/_lib/context";
import { BookingRow } from "../_components/booking-row";
import { createBookingAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("logistics"))("bookings") };
}

type Props = { params: Promise<{ companySlug: string }>; searchParams: Promise<{ project?: string }> };

export default async function BookingsPage({ params, searchParams }: Props) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const t = await getTranslations("logistics");
  const bookable = projectIdsWithPermission(ctx, "booking.manage");
  const projects = (await projectService.list(ctx, {})).filter((p) => !bookable || bookable.includes(p.id));
  const projectId = projects.some((p) => p.id === sp.project) ? sp.project! : projects[0]?.id;
  const [mine, incoming, options] = await Promise.all([
    bookingService.list(ctx),
    hasPermission(ctx, "booking.manage") ? bookingService.incoming(ctx) : Promise.resolve(null),
    projectId ? bookingService.resourceOptions(ctx, projectId).catch(() => null) : Promise.resolve(null),
  ]);
  const today = todayInDisplayZone();

  return (
    <>
      <PageHeader title={t("bookings")} backHref={`/c/${companySlug}/logistics`} backLabel={t("board")} />
      <div className="space-y-4">
        {incoming && incoming.length > 0 && (
          <Section title={t("incoming")}>
            <p className="mb-3 text-sm text-muted-foreground">{t("incomingHint")}</p>
            <ul className="space-y-3" data-testid="incoming-bookings">
              {incoming.map((b) => (
                <BookingRow key={b.id} slug={companySlug} b={b} />
              ))}
            </ul>
          </Section>
        )}

        {options && projectId && (
          <Section title={t("newBooking")}>
            <form method="get" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
              <label className="space-y-1">
                <span className="block font-medium">{t("project")}</span>
                <select name="project" defaultValue={projectId} className="h-11 rounded-lg border bg-background px-3 md:h-9">
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="h-11 rounded-lg border px-4 md:h-9">
                {t("show")}
              </button>
            </form>
            <ActionForm action={createBookingAction.bind(null, companySlug)} className="space-y-4" data-testid="booking-form">
              <input type="hidden" name="projectId" value={projectId} />
              <fieldset>
                <legend className="mb-1 text-sm font-medium">{t("resources")}</legend>
                <p className="mb-2 text-xs text-muted-foreground">{t("resourcesHint")}</p>
                <div className="grid gap-4 md:grid-cols-2">
                  {(["own", "group"] as const).map((g) => (
                    <div key={g}>
                      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t(g === "own" ? "ownResources" : "groupResources")}</p>
                      {options[g].length === 0 ? (
                        <p className="text-sm text-muted-foreground">–</p>
                      ) : (
                        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                          {options[g].map((o) => (
                            <label key={o.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded px-2 hover:bg-muted md:min-h-9">
                              <input type="checkbox" name="resources" value={o.value} className="size-5 accent-primary md:size-4" />
                              <span className="text-sm">
                                {o.label}
                                <span className="text-muted-foreground">
                                  {o.detail ? ` · ${o.detail}` : ""}
                                  {"owner" in o ? ` · ${o.owner}` : ""}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField name="startsAt" label={t("startsAt")} type="datetime-local" defaultValue={`${today}T07:00`} required />
                <TextField name="endsAt" label={t("endsAt")} type="datetime-local" defaultValue={`${today}T15:30`} required />
                <TextField name="note" label={t("notes")} />
              </div>
              <SubmitButton>{t("book")}</SubmitButton>
            </ActionForm>
          </Section>
        )}

        <Section title={t("myBookings")}>
          <p className="mb-3 text-xs text-muted-foreground">{t("conflictHint")}</p>
          {mine.length === 0 ? (
            <EmptyState>{t("noBookings")}</EmptyState>
          ) : (
            <ul className="space-y-3" data-testid="my-bookings">
              {mine.map((b) => (
                <BookingRow key={b.id} slug={companySlug} b={b} />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
