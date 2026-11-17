"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { GripVertical, X } from "lucide-react";
import { cn } from "@/ui/lib/utils";

export type Status = "WORK" | "OFF" | "VACATION" | "SICK" | "TRAINING" | "OTHER" | "ABSENT";
type Entry = { status: Status; siteId: string | null; note: string | null };
export interface RotationPerson {
  id: string;
  name: string;
  trade: string | null;
  days: Record<string, Entry>;
  workDays: number;
}
export interface RotationDay {
  date: string;
  weekday: number;
  weekend: boolean;
  holiday: string | null;
  today: boolean;
}
type Result = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]> };
type SetFn = (input: { employeeId: string; from: string; until: string; status: Exclude<Status, "ABSENT">; siteId: string | null; note: string | null }) => Promise<Result>;
type ClearFn = (input: { employeeId: string; from: string; until: string }) => Promise<Result>;

/** Status colours; every status also has a text label and a letter. */
export const STATUS_STYLE: Record<Status, string> = {
  WORK: "bg-emerald-100 text-emerald-900 border-emerald-300",
  OFF: "bg-zinc-100 text-zinc-700 border-zinc-300",
  VACATION: "bg-sky-100 text-sky-900 border-sky-300",
  SICK: "bg-red-100 text-red-900 border-red-300",
  TRAINING: "bg-violet-100 text-violet-900 border-violet-300",
  OTHER: "bg-amber-100 text-amber-900 border-amber-300",
  ABSENT: "bg-orange-100 text-orange-900 border-orange-300",
};
const EDITABLE: Exclude<Status, "ABSENT">[] = ["WORK", "OFF", "VACATION", "SICK", "TRAINING", "OTHER"];

type Row = { key: string; label: string; status: Status; siteId: string | null; days: Record<string, string[]> };
type Dialog = { person: RotationPerson; status: Exclude<Status, "ABSENT">; siteId: string | null; from: string; until: string; note: string };

/**
 * Rotation calendar. Sites view: rows are sites and statuses, people are
 * dragged from the side panel into a cell (desktop) or tapped and then the
 * cell (phone); a dialog sets the period. People view: one row per person,
 * cells coloured by status. Read-only without rotation.manage.
 */
export function RotationBoard({
  days,
  people,
  sites,
  unassigned,
  statusRows,
  canManage,
  setRange,
  clearRange,
}: {
  days: RotationDay[];
  people: RotationPerson[];
  sites: { id: string; name: string; days: Record<string, string[]> }[];
  unassigned: Record<string, string[]>;
  statusRows: { status: Status; days: Record<string, string[]> }[];
  canManage: boolean;
  setRange: SetFn;
  clearRange: ClearFn;
}) {
  const t = useTranslations("rotation");
  const tAll = useTranslations();
  const router = useRouter();
  const [view, setView] = useState<"sites" | "people">("sites");
  const [selected, setSelected] = useState<RotationPerson | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const siteName = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);

  const rows: Row[] = [
    ...sites.map((s) => ({ key: `site:${s.id}`, label: s.name, status: "WORK" as const, siteId: s.id, days: s.days })),
    { key: "work", label: t("workNoSite"), status: "WORK", siteId: null, days: unassigned },
    ...statusRows.map((r) => ({ key: `status:${r.status}`, label: t(`statuses.${r.status}`), status: r.status, siteId: null, days: r.days })),
  ];

  const open = (person: RotationPerson, day: string, status: Status, siteId: string | null) => {
    if (!canManage || status === "ABSENT") return;
    const e = person.days[day];
    setDialog({ person, status, siteId, from: day, until: day, note: e?.note ?? "" });
    setSelected(null);
  };

  const result = (r: Result, okText: string) => {
    const err = r.fieldErrors ? Object.values(r.fieldErrors).flat()[0] : undefined;
    setMessage(r.ok ? { ok: true, text: okText } : { ok: false, text: tAll(err ?? r.message ?? "errors.generic") });
    if (r.ok) setDialog(null);
    router.refresh();
  };

  const save = () => {
    if (!dialog) return;
    const d = dialog;
    startTransition(async () => {
      const r = await setRange({ employeeId: d.person.id, from: d.from, until: d.until, status: d.status, siteId: d.status === "WORK" ? d.siteId : null, note: d.note || null });
      result(r, t("saved", { name: d.person.name }));
    });
  };

  const clear = () => {
    if (!dialog) return;
    const d = dialog;
    startTransition(async () => result(await clearRange({ employeeId: d.person.id, from: d.from, until: d.until }), t("cleared", { name: d.person.name })));
  };

  const dropOn = (row: Row, day: string, personId: string | null) => {
    const person = personId ? byId.get(personId) : selected;
    if (person) open(person, day, row.status, row.siteId);
  };

  const dayHeader = (
    <div className="contents">
      <div className="sticky left-0 z-10 border-b bg-card" />
      {days.map((d) => (
        <div key={d.date} className={cn("border-b border-l px-1 py-1 text-center text-[11px] leading-tight", d.weekend || d.holiday ? "bg-muted/60" : "", d.today && "bg-primary/10 font-semibold")} title={d.holiday ?? undefined}>
          <div>{t(`weekdays.${d.weekday}`)}</div>
          <div>{`${Number(d.date.slice(8))}.${Number(d.date.slice(5, 7))}.`}</div>
          {d.holiday && <div className="truncate text-[10px] text-red-700">{d.holiday}</div>}
        </div>
      ))}
    </div>
  );
  const grid = { gridTemplateColumns: `11rem repeat(${days.length}, minmax(4.75rem, 1fr))` };
  const filtered = people.filter((p) => !query || `${p.name} ${p.trade ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className={cn("grid gap-4", canManage && "lg:grid-cols-[minmax(0,1fr)_15rem]")}>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label={t("view")}>
            {(["sites", "people"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className={cn("inline-flex min-h-11 items-center rounded-lg border px-3 text-sm md:min-h-9", view === v && "bg-primary text-primary-foreground")}>
                {t(`views.${v}`)}
              </button>
            ))}
          </div>
          <ul className="flex flex-wrap gap-1 text-xs" aria-label={t("legend")}>
            {(canManage ? EDITABLE : (["WORK", "OFF", "VACATION", "TRAINING", "ABSENT"] as Status[])).map((s) => (
              <li key={s} className={cn("rounded border px-1.5 py-0.5", STATUS_STYLE[s])}>
                {t(`letters.${s}`)} = {t(`statuses.${s}`)}
              </li>
            ))}
          </ul>
        </div>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={cn("rounded-lg px-3 py-2 text-sm", message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900")}>
            {message.text}
          </p>
        )}
        {selected && (
          <p className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm" role="status" data-testid="selected-person">
            {t("tapCell", { name: selected.name })}
            <button type="button" onClick={() => setSelected(null)} className="ml-auto inline-flex size-8 items-center justify-center rounded-md hover:bg-muted" aria-label={t("clearSelection")}>
              <X className="size-4" aria-hidden />
            </button>
          </p>
        )}
        <div className="overflow-x-auto rounded-xl border bg-card" data-testid="rotation-grid" data-view={view}>
          {view === "sites" ? (
            <div className="grid" style={grid}>
              {dayHeader}
              {rows.map((row) => (
                <div key={row.key} className="contents" data-row={row.label}>
                  <div className={cn("sticky left-0 z-10 flex items-center gap-1 border-b bg-card px-2 py-1 text-xs font-medium", row.siteId === null && row.status !== "WORK" && "text-muted-foreground")}>
                    <span className={cn("size-2.5 shrink-0 rounded-full border", STATUS_STYLE[row.status])} aria-hidden />
                    <span className="truncate" title={row.label}>
                      {row.label}
                    </span>
                  </div>
                  {days.map((d) => {
                    const ids = row.days[d.date] ?? [];
                    return (
                      <div
                        key={d.date}
                        data-cell={`${row.label}|${d.date}`}
                        className={cn("min-h-12 border-b border-l p-0.5", (d.weekend || d.holiday) && "bg-muted/40", canManage && "cursor-pointer hover:bg-primary/5")}
                        onClick={() => selected && dropOn(row, d.date, null)}
                        onDragOver={(e) => canManage && e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          dropOn(row, d.date, e.dataTransfer.getData("text/person"));
                        }}
                      >
                        {row.siteId && ids.length > 0 && <div className="text-right text-[10px] font-semibold text-emerald-800">{ids.length}</div>}
                        <ul className="space-y-0.5">
                          {ids.map((id) => {
                            const p = byId.get(id);
                            if (!p) return null;
                            return (
                              <li key={id}>
                                <button
                                  type="button"
                                  disabled={!canManage}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    open(p, d.date, p.days[d.date]?.status ?? row.status, p.days[d.date]?.siteId ?? row.siteId);
                                  }}
                                  className={cn("block w-full truncate rounded border px-1 text-left text-[11px] leading-5", STATUS_STYLE[row.status])}
                                  title={p.days[d.date]?.note ? `${p.name} – ${p.days[d.date]?.note}` : p.name}
                                  data-person={p.name}
                                >
                                  {p.name}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid" style={grid}>
              {dayHeader}
              {people.length === 0 && <p className="col-span-full px-4 py-8 text-center text-sm text-muted-foreground">{t("noPeople")}</p>}
              {people.map((p) => (
                <div key={p.id} className="contents" data-person-row={p.name}>
                  <div className="sticky left-0 z-10 border-b bg-card px-2 py-1 text-xs">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="truncate text-muted-foreground">{t("workDaysN", { count: p.workDays })}</div>
                  </div>
                  {days.map((d) => {
                    const e = p.days[d.date];
                    return (
                      <button
                        key={d.date}
                        type="button"
                        disabled={!canManage}
                        onClick={() => open(p, d.date, e?.status ?? "WORK", e?.siteId ?? null)}
                        className={cn("min-h-11 border-b border-l px-1 text-center text-[11px]", e ? STATUS_STYLE[e.status] : d.weekend || d.holiday ? "bg-muted/40" : "", canManage && "hover:ring-1 hover:ring-primary")}
                        title={e ? `${t(`statuses.${e.status}`)}${e.siteId ? ` · ${siteName.get(e.siteId) ?? ""}` : ""}${e.note ? ` – ${e.note}` : ""}` : undefined}
                        data-day={d.date}
                        data-status={e?.status ?? ""}
                      >
                        {e ? t(`letters.${e.status}`) : ""}
                        {e?.siteId && <span className="block truncate text-[10px]">{(siteName.get(e.siteId) ?? "").split(" · ")[0]}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {canManage && (
        <aside className="space-y-2 lg:sticky lg:top-4 lg:self-start" data-testid="people-panel">
          <h2 className="text-sm font-semibold">{t("people")}</h2>
          <p className="text-xs text-muted-foreground">{t("panelHint")}</p>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-11 w-full rounded-lg border bg-background px-3 text-base md:h-9 md:text-sm" />
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/person", p.id)}
                  onClick={() => setSelected(selected?.id === p.id ? null : p)}
                  aria-pressed={selected?.id === p.id}
                  className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg border bg-card px-2 text-left text-sm hover:bg-muted md:min-h-9", selected?.id === p.id && "border-primary ring-2 ring-primary")}
                  data-panel-person={p.name}
                >
                  <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.trade && <span className="truncate text-xs text-muted-foreground">{p.trade}</span>}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("dialogTitle", { name: dialog.person.name })}>
          <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-card p-4 shadow-xl sm:rounded-2xl" data-testid="rotation-dialog">
            <h2 className="text-base font-semibold">{t("dialogTitle", { name: dialog.person.name })}</h2>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t("status")}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {EDITABLE.map((s) => (
                  <button key={s} type="button" onClick={() => setDialog({ ...dialog, status: s })} aria-pressed={dialog.status === s} className={cn("min-h-11 rounded-lg border px-2 text-sm", STATUS_STYLE[s], dialog.status === s && "ring-2 ring-primary")}>
                    {t(`statuses.${s}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            {dialog.status === "WORK" && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium">{t("site")}</span>
                <select value={dialog.siteId ?? ""} onChange={(e) => setDialog({ ...dialog, siteId: e.target.value || null })} className="h-11 w-full rounded-lg border bg-background px-3 text-base md:text-sm">
                  <option value="">{t("noSite")}</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">{t("from")}</span>
                <input type="date" value={dialog.from} onChange={(e) => setDialog({ ...dialog, from: e.target.value })} className="h-11 w-full rounded-lg border bg-background px-2 text-base md:text-sm" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">{t("until")}</span>
                <input type="date" value={dialog.until} min={dialog.from} onChange={(e) => setDialog({ ...dialog, until: e.target.value })} className="h-11 w-full rounded-lg border bg-background px-2 text-base md:text-sm" />
              </label>
            </div>
            {dialog.status !== "WORK" && dialog.status !== "OFF" && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium">{t("note")}</span>
                <input value={dialog.note} maxLength={200} onChange={(e) => setDialog({ ...dialog, note: e.target.value })} className="h-11 w-full rounded-lg border bg-background px-3 text-base md:text-sm" />
              </label>
            )}
            {dialog.status === "SICK" && <p className="text-xs text-muted-foreground">{t("sickNotice")}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" disabled={pending} onClick={save} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {t("save")}
              </button>
              <button type="button" disabled={pending} onClick={clear} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm disabled:opacity-60">
                {t("clear")}
              </button>
              <button type="button" onClick={() => setDialog(null)} className="ml-auto inline-flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-muted">
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
