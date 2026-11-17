"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { GripVertical, HardHat, Truck, X } from "lucide-react";
import { cn } from "@/ui/lib/utils";
import { PHASE_STYLE, SWATCH } from "../_components/task-colors";

type Bar = { left: number; width: number; clippedStart: boolean; clippedEnd: boolean } | null;
type Phase = "PLANNED" | "MISSING_RESOURCES" | "READY" | "IN_PROGRESS" | "COMPLETE" | "LATE";

export interface BoardTask {
  id: string;
  title: string;
  site: { id: string; name: string };
  start: string;
  end: string;
  phase: Phase;
  missing: number;
  deviation: boolean;
  aiSuggested: boolean;
  canAssign: boolean;
  taskType: { name: string; color: string } | null;
  openRoles: { id: string; label: string; kind: "PERSON" | "EQUIPMENT"; missing: number }[];
  bar: Bar;
}

export interface BoardResource {
  kind: "EMPLOYEE" | "EQUIPMENT";
  value: string;
  label: string;
  detail: string | null;
  bookings: { id: string; title: string; bar: Bar; taskId: string | null }[];
}

type AssignFn = (taskId: string, roleId: string, resource: string) => Promise<{ ok: boolean; message?: string; fieldErrors?: Record<string, string[]> }>;


type Tick = { left: number; label: string; major: boolean; date: string };

function Axis({ ticks }: { ticks: Tick[] }) {
  return (
    <div className="relative h-8 border-b text-[11px] text-muted-foreground" aria-hidden>
      {ticks.map((k) => (
        <span key={`${k.date}-${k.label}`} className={cn("absolute top-0 h-full border-l pl-1 leading-8", k.major ? "border-zinc-400" : "border-zinc-200")} style={{ left: `${k.left}%` }}>
          {k.label}
        </span>
      ))}
    </div>
  );
}

function Grid({ ticks }: { ticks: Tick[] }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {ticks.map((k) => (
        <span key={`${k.date}-${k.label}`} className="absolute top-0 h-full border-l border-zinc-100" style={{ left: `${k.left}%` }} />
      ))}
    </div>
  );
}

/**
 * Production calendar board. Tasks are bars on a time axis grouped by site;
 * the resource panel lists own people and equipment. Drag a resource onto a
 * task (desktop), or tap a resource and then a task (phone). The server
 * checks every assignment with the same rules as the task page.
 */
export function CalendarBoard({ slug, ticks, tasks, resources, view, assign }: { slug: string; ticks: { left: number; label: string; major: boolean; date: string }[]; tasks: BoardTask[]; resources: BoardResource[]; view: "tasks" | "resources"; assign: AssignFn }) {
  const t = useTranslations("production.calendar");
  const tAll = useTranslations();
  const router = useRouter();
  const [selected, setSelected] = useState<BoardResource | null>(null);
  const [filter, setFilter] = useState<"ALL" | "EMPLOYEE" | "EQUIPMENT">("ALL");
  const [chooser, setChooser] = useState<{ task: BoardTask; resource: BoardResource } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const bySite = useMemo(() => {
    const groups = new Map<string, { name: string; tasks: BoardTask[] }>();
    for (const task of tasks) {
      if (!task.bar) continue;
      if (!groups.has(task.site.id)) groups.set(task.site.id, { name: task.site.name, tasks: [] });
      groups.get(task.site.id)!.tasks.push(task);
    }
    return [...groups.values()];
  }, [tasks]);

  const run = (task: BoardTask, roleId: string, resource: BoardResource) => {
    setChooser(null);
    startTransition(async () => {
      const r = await assign(task.id, roleId, resource.value);
      const err = r.fieldErrors ? Object.values(r.fieldErrors).flat()[0] : undefined;
      setMessage(r.ok ? { ok: true, text: t("assigned", { resource: resource.label, task: task.title }) } : { ok: false, text: tAll(err ?? r.message ?? "errors.generic") });
      if (r.ok) setSelected(null);
      router.refresh();
    });
  };

  const drop = (task: BoardTask, resource: BoardResource) => {
    if (!task.canAssign) return;
    const roles = task.openRoles.filter((r) => (r.kind === "PERSON") === (resource.kind === "EMPLOYEE"));
    if (roles.length === 0) return setMessage({ ok: false, text: t("noOpenNeed", { task: task.title }) });
    if (roles.length === 1) return run(task, roles[0].id, resource);
    setChooser({ task, resource });
  };

  const visibleResources = resources.filter((r) => filter === "ALL" || r.kind === filter);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-3">
        {message && (
          <p role={message.ok ? "status" : "alert"} className={cn("rounded-lg px-3 py-2 text-sm", message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900")}>
            {message.text}
          </p>
        )}
        {selected && (
          <p className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm" role="status" data-testid="selected-resource">
            {t("tapTask", { resource: selected.label })}
            <button type="button" onClick={() => setSelected(null)} className="ml-auto inline-flex size-8 items-center justify-center rounded-md hover:bg-muted" aria-label={t("clearSelection")}>
              <X className="size-4" aria-hidden />
            </button>
          </p>
        )}
        <div className="overflow-x-auto rounded-xl border bg-card">
          <div className="min-w-[44rem]">
            {view === "tasks" ? (
              <>
                <div className="grid grid-cols-[11rem_minmax(0,1fr)]">
                  <div className="border-b" />
                  <Axis ticks={ticks} />
                </div>
                {bySite.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("noTasks")}</p>}
                {bySite.map((g) => (
                  <section key={g.name} aria-label={g.name}>
                    <h3 className="border-b bg-muted/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</h3>
                    {g.tasks.map((task) => (
                      <div key={task.id} className="grid grid-cols-[11rem_minmax(0,1fr)] border-b last:border-b-0">
                        <Link href={`/c/${slug}/logistics/requests/${task.id}`} className="truncate px-3 py-2 text-sm hover:underline" title={task.title}>
                          {task.title}
                          {task.taskType && <span className="block truncate text-[11px] text-muted-foreground">{task.taskType.name}</span>}
                        </Link>
                        <div className="relative h-14">
                          <Grid ticks={ticks} />
                          <button
                            type="button"
                            data-task={task.title}
                            data-phase={task.deviation ? "DEVIATION" : task.phase}
                            disabled={pending || (!!selected && !task.canAssign)}
                            onClick={() => (selected ? drop(task, selected) : router.push(`/c/${slug}/logistics/requests/${task.id}`))}
                            onDragOver={(e) => task.canAssign && e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const r = resources.find((x) => x.value === e.dataTransfer.getData("text/plain"));
                              if (r) drop(task, r);
                            }}
                            className={cn(
                              "absolute top-2 flex h-10 items-center gap-1 overflow-hidden rounded-md border-l-4 px-2 text-left text-xs font-medium shadow-sm",
                              PHASE_STYLE[task.phase],
                              task.deviation && "deviation-blink",
                              selected && task.canAssign && "ring-2 ring-primary ring-offset-1",
                            )}
                            style={{ left: `${task.bar!.left}%`, width: `${task.bar!.width}%` }}
                            title={`${task.title} · ${t(`phases.${task.deviation ? "DEVIATION" : task.phase}`)}`}
                          >
                            {task.taskType && <span className={cn("size-2 shrink-0 rounded-full", SWATCH[task.taskType.color])} aria-hidden />}
                            <span className="truncate">{task.title}</span>
                            {task.missing > 0 && <span className="ml-auto shrink-0 rounded bg-white/70 px-1 text-[10px] text-amber-900">{t("missingShort", { count: task.missing })}</span>}
                            {task.aiSuggested && (
                              <span className="shrink-0 rounded bg-violet-700 px-1 text-[10px] font-semibold text-white" title={t("aiSuggested")} data-ai-suggested>
                                AI
                              </span>
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </section>
                ))}
              </>
            ) : (
              <>
                <div className="grid grid-cols-[11rem_minmax(0,1fr)]">
                  <div className="border-b" />
                  <Axis ticks={ticks} />
                </div>
                {visibleResources.map((r) => (
                  <div key={r.value} className="grid grid-cols-[11rem_minmax(0,1fr)] border-b last:border-b-0" data-resource-row={r.label}>
                    <div className="truncate px-3 py-2 text-sm" title={r.label}>
                      {r.label}
                      {r.detail && <span className="block truncate text-[11px] text-muted-foreground">{r.detail}</span>}
                    </div>
                    <div className="relative h-12">
                      <Grid ticks={ticks} />
                      {r.bookings
                        .filter((b) => b.bar)
                        .map((b) => (
                          <Link
                            key={b.id}
                            href={b.taskId ? `/c/${slug}/logistics/requests/${b.taskId}` : `/c/${slug}/logistics/bookings`}
                            className="absolute top-2 flex h-8 items-center overflow-hidden rounded-md border-l-4 border-sky-600 bg-sky-100 px-2 text-xs text-sky-950 hover:bg-sky-200"
                            style={{ left: `${b.bar!.left}%`, width: `${b.bar!.width}%` }}
                            title={b.title}
                          >
                            <span className="truncate">{b.title}</span>
                          </Link>
                        ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
        <ul className="flex flex-wrap gap-2 text-xs" aria-label={t("legend")}>
          {(["PLANNED", "MISSING_RESOURCES", "READY", "IN_PROGRESS", "COMPLETE", "LATE"] as const).map((p) => (
            <li key={p} className={cn("rounded-md border-l-4 px-2 py-1", PHASE_STYLE[p])}>
              {t(`phases.${p}`)}
            </li>
          ))}
          <li className="deviation-blink rounded-md px-2 py-1">{t("phases.DEVIATION")}</li>
        </ul>
      </div>

      {resources.length > 0 && (
        <aside className="rounded-xl border bg-card p-3 lg:sticky lg:top-4 lg:self-start" aria-label={t("resources")} data-testid="resource-panel">
          <h2 className="mb-1 text-sm font-semibold">{t("resources")}</h2>
          <p className="mb-2 text-xs text-muted-foreground">{t("dragHint")}</p>
          <div className="mb-2 flex gap-1" role="group" aria-label={t("filter")}>
            {(["ALL", "EMPLOYEE", "EQUIPMENT"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn("min-h-9 flex-1 rounded-md border px-2 text-xs", filter === f ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {t(`filters.${f}`)}
              </button>
            ))}
          </div>
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {visibleResources.map((r) => {
              const busy = r.bookings.length;
              const Icon = r.kind === "EMPLOYEE" ? HardHat : Truck;
              return (
                <li key={r.value}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", r.value);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setSelected(selected?.value === r.value ? null : r)}
                    aria-pressed={selected?.value === r.value}
                    data-resource={r.label}
                    className={cn("flex min-h-11 w-full cursor-grab items-center gap-2 rounded-md border px-2 text-left text-sm active:cursor-grabbing md:min-h-9", selected?.value === r.value ? "border-primary bg-primary/10" : "hover:bg-muted")}
                  >
                    <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {r.label}
                      {r.detail && <span className="block truncate text-[11px] text-muted-foreground">{r.detail}</span>}
                    </span>
                    {busy > 0 && <span className="shrink-0 rounded bg-sky-100 px-1 text-[10px] text-sky-900">{t("bookingsCount", { count: busy })}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      )}

      {chooser && (
        <div role="dialog" aria-modal="true" aria-label={t("chooseRole")} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setChooser(null)}>
          <div className="w-full max-w-sm rounded-xl bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-base font-semibold">{t("chooseRole")}</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              {chooser.resource.label} → {chooser.task.title}
            </p>
            <ul className="space-y-2">
              {chooser.task.openRoles
                .filter((r) => (r.kind === "PERSON") === (chooser.resource.kind === "EMPLOYEE"))
                .map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => run(chooser.task, r.id, chooser.resource)} className="flex min-h-11 w-full items-center justify-between rounded-lg border px-3 text-sm hover:bg-muted">
                      {r.label}
                      <span className="text-xs text-muted-foreground">{t("missingShort", { count: r.missing })}</span>
                    </button>
                  </li>
                ))}
            </ul>
            <button type="button" onClick={() => setChooser(null)} className="mt-3 min-h-11 w-full rounded-lg text-sm text-muted-foreground hover:bg-muted">
              {tAll("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
