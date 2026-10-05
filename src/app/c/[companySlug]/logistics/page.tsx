import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarClock, DoorOpen, Warehouse } from "lucide-react";
import { logisticsBoardService, logisticsRequestService } from "@/modules/logistics/logistics.service";
import { taktPlanService } from "@/modules/takt/plan.service";
import { PRIORITIES, SERVICE_TYPES } from "@/modules/logistics/schemas";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { formatMinute } from "@/platform/i18n/time";
import { Button } from "@/ui/components/button";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { cn } from "@/ui/lib/utils";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SiteDayPicker } from "./_components/site-day-picker";
import { createDeliveryAction, createRequestAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("logistics"))("board") };
}

type Props = { params: Promise<{ companySlug: string }>; searchParams: Promise<{ site?: string; date?: string }> };

const DELIVERY_TONE: Record<string, string> = {
  PLANNED: "border-zinc-400 bg-zinc-50",
  CONFIRMED: "border-sky-500 bg-sky-50",
  ARRIVED_GATE: "border-amber-500 bg-amber-50",
  CHECKED_IN: "border-amber-500 bg-amber-50",
  UNLOADING: "border-amber-600 bg-amber-100",
  STORED: "border-emerald-600 bg-emerald-50",
  MOVED_TO_WORKFACE: "border-emerald-700 bg-emerald-50",
  INSTALLED: "border-emerald-800 bg-emerald-100",
};

export default async function LogisticsPage({ params, searchParams }: Props) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [sites, t, tc] = await Promise.all([logisticsBoardService.sites(ctx), getTranslations("logistics"), getTranslations("common")]);
  const base = `/c/${companySlug}/logistics`;
  if (sites.length === 0) {
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState>{t("noSites")}</EmptyState>
      </>
    );
  }
  const siteId = sites.some((s) => s.id === sp.site) ? sp.site! : sites[0].id;
  const date = sp.date || todayInDisplayZone();
  const board = await loadOr404(logisticsBoardService.day(ctx, { siteId, date }));
  const format = await getFormatter();
  const perms = board.permissions;
  const plans = (await taktPlanService.list(ctx)).filter((p) => p.siteId === siteId);
  const activityOptions = (await Promise.all(plans.map((p) => taktPlanService.board(ctx, p.id).catch(() => null))))
    .flatMap((b) => b?.activities ?? [])
    .map((a) => ({ value: a.id, label: `${a.taktArea.code} · ${a.workPackage.code} ${a.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const approvedRequests = (await logisticsRequestService.list(ctx, { siteId, status: "APPROVED" })).map((r) => ({ value: r.id, label: r.title }));
  const time = (d: Date) => format.dateTime(d, { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <PageHeader
        title={t("board")}
        description={`${board.site.project.code} · ${board.site.name}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`${base}/gate?site=${siteId}`}>
                <DoorOpen aria-hidden /> {t("gateView")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`${base}/bookings`}>
                <CalendarClock aria-hidden /> {t("bookings")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`${base}/setup?site=${siteId}`}>
                <Warehouse aria-hidden /> {t("setup")}
              </Link>
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        <Section title={t("deliveries")}>
          <SiteDayPicker sites={sites} siteId={siteId} date={date} />
          <p className="mt-3 text-xs text-muted-foreground">{t("slotHint")}</p>
          {board.gates.length === 0 ? (
            <div className="mt-3">
              <EmptyState>{t("noGates")}</EmptyState>
            </div>
          ) : (
            <div className="-mx-4 mt-3 overflow-x-auto px-4 md:mx-0 md:px-0">
              <table className="border-separate border-spacing-0 text-xs" data-testid="gate-timeline">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-28 border-b bg-card px-2 py-1 text-left font-medium">{t("gate")}</th>
                    {board.slots.map((s) => (
                      <th key={s.minute} className="min-w-16 border-b px-1 py-1 text-left font-medium tabular-nums">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {board.gates.map((g) => {
                    const cells: React.ReactNode[] = [];
                    for (let i = 0; i < board.slots.length; i++) {
                      const m = board.slots[i].minute;
                      const d = board.deliveries.find((x) => x.gate.id === g.id && x.startMinute === m && x.status !== "CANCELLED");
                      if (d) {
                        const span = Math.max(1, Math.round((d.endMinute - d.startMinute) / 30));
                        cells.push(
                          <td key={m} colSpan={span} className="border-b p-0.5 align-top">
                            <Link href={`${base}/deliveries/${d.id}`} className={cn("block min-h-12 rounded border-l-4 px-1.5 py-1 leading-tight hover:opacity-90", DELIVERY_TONE[d.status])} data-delivery={d.id} data-status={d.status}>
                              <span className="block font-semibold">{d.material}</span>
                              <span className="block text-muted-foreground">
                                {d.startLabel}–{d.endLabel} · {t(`deliveryStatuses.${d.status}`)}
                              </span>
                            </Link>
                          </td>,
                        );
                        i += span - 1;
                        continue;
                      }
                      const closed = m < g.opensMinute! || m >= g.closesMinute!;
                      cells.push(<td key={m} className={cn("h-14 border-b border-l border-dashed", closed && "bg-muted/70")} />);
                    }
                    return (
                      <tr key={g.id} data-gate={g.name}>
                        <th scope="row" className="sticky left-0 z-10 border-b bg-card px-2 py-1 text-left font-normal">
                          <span className="font-medium">{g.name}</span>
                          <span className="block text-muted-foreground">{t("hours", { opens: formatMinute(g.opensMinute!), closes: formatMinute(g.closesMinute!) })}</span>
                        </th>
                        {cells}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {board.deliveries.length === 0 && board.gates.length > 0 && <p className="mt-3 text-sm text-muted-foreground">{t("noDeliveries")}</p>}

          {perms.deliver && board.gates.length > 0 && (
            <ActionForm action={createDeliveryAction.bind(null, companySlug)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="delivery-form">
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="date" value={date} />
              <SelectField name="gateId" label={t("gate")} options={board.gates.map((g) => ({ value: g.id, label: g.name }))} defaultValue={board.gates[0].id} />
              <TextField name="startTime" label={t("startTime")} type="time" step={1800} defaultValue="07:00" required />
              <TextField name="slots" label={t("slots")} inputMode="numeric" defaultValue="1" />
              <TextField name="supplier" label={t("supplier")} required />
              <TextField name="material" label={t("material")} required className="sm:col-span-2" />
              <TextField name="quantity" label={t("quantity")} />
              <TextField name="weightKg" label={t("weightKg")} inputMode="decimal" />
              <TextField name="carrier" label={t("carrier")} />
              <TextField name="vehicle" label={t("vehicle")} />
              <SelectField name="unloadingId" label={t("unloading")} placeholder="–" options={board.unloading.map((l) => ({ value: l.id, label: l.name }))} />
              <SelectField name="storageId" label={t("storage")} placeholder="–" options={board.storage.map((l) => ({ value: l.id, label: l.name }))} />
              <SelectField name="activityId" label={t("activity")} placeholder="–" options={activityOptions} hint={t("activityHint")} className="sm:col-span-2" />
              <SelectField name="requestId" label={t("request")} placeholder="–" options={approvedRequests} className="sm:col-span-2" />
              <div className="sm:col-span-2 lg:col-span-4">
                <SubmitButton>{t("schedule")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>

        <Section title={t("requests")}>
          {board.requests.length === 0 ? (
            <EmptyState>{t("noRequests")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="request-list">
              {board.requests.map((r) => (
                <li key={r.id}>
                  <Link href={`${base}/requests/${r.id}`} className="flex min-h-12 flex-wrap items-center gap-2 py-2 hover:bg-muted/60">
                    <StatusBadge status={r.status === "REQUESTED" || r.status === "REVIEW" ? "PENDING_APPROVAL" : r.status === "COMPLETE" ? "COMPLETED" : r.status} label={t(`requestStatuses.${r.status}`)} />
                    <span className="font-medium">{r.title}</span>
                    <span className="text-muted-foreground">
                      {t(`serviceTypes.${r.serviceType}`)} · {time(r.requestedStart)}–{time(r.requestedEnd)}
                      {r.activity ? ` · ${r.activity.taktArea.code} ${r.activity.name}` : ""}
                    </span>
                    {r.priority !== "NORMAL" && <span className={cn("ml-auto rounded px-1.5 text-xs", r.priority === "CRITICAL" || r.priority === "HIGH" ? "bg-red-100 text-red-900" : "bg-muted")}>{t(`priorities.${r.priority}`)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {perms.request && (
            <ActionForm action={createRequestAction.bind(null, companySlug)} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="request-form">
              <input type="hidden" name="siteId" value={siteId} />
              <SelectField name="serviceType" label={t("serviceType")} options={SERVICE_TYPES.map((s) => ({ value: s, label: t(`serviceTypes.${s}`) }))} defaultValue="DELIVERY" />
              <TextField name="title" label={t("requestTitle")} required className="lg:col-span-3" />
              <TextField name="requestedStart" label={t("requestedStart")} type="datetime-local" defaultValue={`${date}T07:00`} required />
              <TextField name="requestedEnd" label={t("requestedEnd")} type="datetime-local" defaultValue={`${date}T08:00`} required />
              <SelectField name="priority" label={t("priority")} options={PRIORITIES.map((p) => ({ value: p, label: t(`priorities.${p}`) }))} defaultValue="NORMAL" />
              <TextField name="weightKg" label={t("weightKg")} inputMode="decimal" />
              <TextField name="loadDescription" label={t("loadDescription")} className="sm:col-span-2" />
              <TextField name="dimensions" label={t("dimensions")} />
              <SelectField name="equipmentTypeId" label={t("equipmentType")} placeholder="–" options={board.equipmentTypes.map((e) => ({ value: e.id, label: e.name }))} />
              <TextField name="pickup" label={t("pickup")} />
              <TextField name="destination" label={t("destination")} />
              <SelectField name="activityId" label={t("activity")} placeholder="–" options={activityOptions} className="sm:col-span-2" />
              <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2 lg:col-span-4 md:min-h-0">
                <input type="checkbox" name="submit" defaultChecked className="size-5 accent-primary md:size-4" />
                {t("submitNow")}
              </label>
              <div className="sm:col-span-2 lg:col-span-4">
                <SubmitButton>{t("createRequest")}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>

        <Section title={t("myBookings")} actions={<Link href={`${base}/bookings`} className="text-sm text-primary hover:underline">{tc("open")}</Link>}>
          {board.bookings.length === 0 ? (
            <EmptyState>{t("noBookings")}</EmptyState>
          ) : (
            <ul className="divide-y text-sm" data-testid="day-bookings">
              {board.bookings.map((b) => (
                <li key={b.id} className="flex min-h-11 flex-wrap items-center gap-2 py-1">
                  <StatusBadge status={b.status === "REQUESTED" ? "PENDING_APPROVAL" : b.status} label={t(`bookingStatuses.${b.status}`)} />
                  <span className="font-medium">{b.label}</span>
                  <span className="text-muted-foreground">
                    {time(b.startsAt)}–{time(b.endsAt)}
                    {b.owner.id !== ctx.company.id ? ` · ${t("owner")}: ${b.owner.name}` : ""}
                    {b.activity ? ` · ${b.activity.taktArea.code} ${b.activity.name}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
