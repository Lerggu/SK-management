"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ArrowUpFromLine,
  Building2,
  Construction,
  Crosshair,
  DoorOpen,
  GripVertical,
  MapPin,
  PackageOpen,
  Plus,
  SquareParking,
  Trash2,
  TriangleAlert,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/ui/lib/utils";
import { PHASE_STYLE } from "../_components/task-colors";

type Result = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]> };
type Kind = "GATE" | "UNLOADING" | "STORAGE" | "CRANE" | "LIFT_AREA" | "SITE_OFFICE" | "PARKING" | "WASTE" | "DANGER_ZONE" | "OTHER";
type Phase = keyof typeof PHASE_STYLE;

export interface MapDeviation {
  id: string;
  type: string;
  status: string;
  comment: string | null;
  createdAt: string;
}

export interface MapObject {
  id: string;
  kind: Kind;
  code: string | null;
  name: string;
  notes: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  location: { opensMinute: number | null; closesMinute: number | null } | null;
  taskIds: string[];
  deviations: MapDeviation[];
  blinking: boolean;
}

export interface MapTask {
  id: string;
  title: string;
  start: string;
  end: string;
  phase: Phase;
  missing: number;
  inRange: boolean;
  taskType: { name: string; color: string } | null;
  pin: { x: number; y: number; objectId: string | null } | null;
  deviations: MapDeviation[];
}

export interface MapActions {
  createObject: (input: Record<string, string | number | null>) => Promise<Result>;
  updateObject: (objectId: string, input: Record<string, string | null>) => Promise<Result>;
  moveObject: (objectId: string, input: { x: number; y: number; width: number | null; height: number | null }) => Promise<Result>;
  archiveObject: (objectId: string) => Promise<Result>;
  placeTask: (taskId: string, input: { x: number; y: number; objectId: string | null }) => Promise<Result>;
  unplaceTask: (taskId: string) => Promise<Result>;
  reportDeviation: (objectId: string, prev: Result | null, fd: FormData) => Promise<Result>;
}

/** Icon and colours of each object kind (always shown with a text label too). */
export const KIND_STYLE: Record<Kind, { icon: LucideIcon; chip: string; area: string }> = {
  GATE: { icon: DoorOpen, chip: "bg-[#0b2545] text-white border-white", area: "bg-[#0b2545]/15 border-[#0b2545]" },
  UNLOADING: { icon: PackageOpen, chip: "bg-sky-600 text-white border-white", area: "bg-sky-500/15 border-sky-600" },
  STORAGE: { icon: Warehouse, chip: "bg-amber-600 text-white border-white", area: "bg-amber-400/20 border-amber-600" },
  CRANE: { icon: Construction, chip: "bg-orange-500 text-white border-white", area: "bg-orange-400/20 border-orange-500" },
  LIFT_AREA: { icon: ArrowUpFromLine, chip: "bg-orange-600 text-white border-white", area: "bg-orange-500/15 border-orange-600 border-dashed" },
  SITE_OFFICE: { icon: Building2, chip: "bg-teal-600 text-white border-white", area: "bg-teal-500/15 border-teal-600" },
  PARKING: { icon: SquareParking, chip: "bg-indigo-600 text-white border-white", area: "bg-indigo-400/15 border-indigo-600" },
  WASTE: { icon: Trash2, chip: "bg-zinc-600 text-white border-white", area: "bg-zinc-400/20 border-zinc-600" },
  DANGER_ZONE: { icon: TriangleAlert, chip: "bg-red-700 text-white border-white", area: "bg-red-500/15 border-red-700 border-dashed" },
  OTHER: { icon: MapPin, chip: "bg-violet-600 text-white border-white", area: "bg-violet-400/15 border-violet-600" },
};
const KINDS = Object.keys(KIND_STYLE) as Kind[];
const LOCATION_KINDS: Kind[] = ["GATE", "UNLOADING", "STORAGE"];
const AREA_KINDS: Kind[] = ["STORAGE", "LIFT_AREA", "PARKING", "DANGER_ZONE"];

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const round = (v: number) => Math.round(v * 1e5) / 1e5;
const clock = (m: number | null) => (m === null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

type Box = { x: number; y: number; width: number | null; height: number | null };
type Drag =
  | { kind: "object"; id: string; pointerId: number; startX: number; startY: number; orig: Box; moved: boolean; resize: boolean }
  | { kind: "task"; id: string; pointerId: number; startX: number; startY: number; moved: boolean };
type Mode = null | { type: "place-task"; taskId: string } | { type: "new-object"; draft: Record<string, string> };
type Selection = null | { type: "object"; id: string } | { type: "task"; id: string };

/**
 * Site map board (ADR 0034). The overview image with objects and tasks on
 * it. Drag an object to move it (or an area's corner to resize it), drag a
 * task from the list onto the map or onto an object, or tap a task and then
 * the map on a phone. Objects with an open deviation, their own or a task's
 * at them, blink red.
 */
export function SiteMapBoard({
  slug,
  imageUrl,
  aspect,
  objects,
  tasks,
  locations,
  canEdit,
  canReport,
  deviationTypes,
  initialObjectId,
  actions,
}: {
  slug: string;
  imageUrl: string | null;
  aspect: number;
  objects: MapObject[];
  tasks: MapTask[];
  locations: { id: string; kind: string; name: string }[];
  canEdit: boolean;
  canReport: boolean;
  deviationTypes: readonly string[];
  initialObjectId: string | null;
  actions: MapActions;
}) {
  const t = useTranslations("production.map");
  const tDev = useTranslations("production.deviations");
  const tCal = useTranslations("production.calendar");
  const tAll = useTranslations();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const mapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [pins, setPins] = useState<Record<string, { x: number; y: number; objectId: string | null } | null>>({});
  const [ghost, setGhost] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [selection, setSelection] = useState<Selection>(initialObjectId ? { type: "object", id: initialObjectId } : null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Server data replaces local drag positions after every refresh.
  const [seen, setSeen] = useState({ objects, tasks });
  if (seen.objects !== objects || seen.tasks !== tasks) {
    setSeen({ objects, tasks });
    setBoxes({});
    setPins({});
  }

  const objectBox = (o: MapObject): Box => boxes[o.id] ?? { x: o.x, y: o.y, width: o.width, height: o.height };
  const pinOf = (task: MapTask) => (task.id in pins ? pins[task.id] : task.pin);
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const taskById = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks]);

  const errorText = (r: Result) => {
    const keys = Object.values(r.fieldErrors ?? {}).flat();
    return keys.length ? keys.map((k) => tAll(k)).join(" ") : tAll(r.message ?? "errors.generic");
  };

  async function run(fn: () => Promise<Result>, okText?: string) {
    setBusy(true);
    try {
      const r = await fn();
      setMessage(r.ok ? (okText ? { ok: true, text: okText } : null) : { ok: false, text: errorText(r) });
      startTransition(() => router.refresh());
      return r.ok;
    } finally {
      setBusy(false);
    }
  }

  /** Pointer position as fractions of the map image. */
  function fraction(clientX: number, clientY: number) {
    const rect = mapRef.current!.getBoundingClientRect();
    return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height), inside: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom };
  }

  function objectAt(clientX: number, clientY: number): MapObject | null {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const id = (el as HTMLElement).dataset?.objectId;
      if (id && byId.has(id)) return byId.get(id)!;
    }
    return null;
  }

  /** Where a task dropped on an object goes: the centre of a point, or the drop point inside an area. */
  function dropPosition(clientX: number, clientY: number) {
    const f = fraction(clientX, clientY);
    const o = objectAt(clientX, clientY);
    if (!o) return { x: round(f.x), y: round(f.y), objectId: null, inside: f.inside };
    const b = objectBox(o);
    return b.width === null ? { x: b.x, y: b.y, objectId: o.id, inside: true } : { x: round(f.x), y: round(f.y), objectId: o.id, inside: true };
  }

  function placeTask(taskId: string, pos: { x: number; y: number; objectId: string | null }) {
    setPins((p) => ({ ...p, [taskId]: pos }));
    const o = pos.objectId ? byId.get(pos.objectId) : null;
    const title = taskById.get(taskId)?.title ?? "";
    void run(() => actions.placeTask(taskId, pos), o ? t("placedAt", { task: title, object: o.code ?? o.name }) : t("placed", { task: title }));
  }

  // ── object drag (move / resize) ─────────────────────────────────
  function onObjectPointerDown(e: React.PointerEvent, o: MapObject, resize = false) {
    e.stopPropagation();
    if (mode) return;
    if (!canEdit) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: "object", id: o.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, orig: objectBox(o), moved: false, resize };
  }

  function onObjectPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.kind !== "object" || d.pointerId !== e.pointerId) return;
    const rect = mapRef.current!.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / rect.width;
    const dy = (e.clientY - d.startY) / rect.height;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
    d.moved = true;
    const o = d.orig;
    const next: Box = d.resize
      ? { ...o, width: round(clamp(o.width! + dx, 0.01, 1 - o.x)), height: round(clamp(o.height! + dy, 0.01, 1 - o.y)) }
      : { ...o, x: round(clamp(o.x + dx, 0, 1 - (o.width ?? 0))), y: round(clamp(o.y + dy, 0, 1 - (o.height ?? 0))) };
    setBoxes((b) => ({ ...b, [d.id]: next }));
  }

  function onObjectPointerUp(e: React.PointerEvent, o: MapObject) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.kind !== "object" || d.id !== o.id) {
      if (!canEdit && !mode) setSelection({ type: "object", id: o.id });
      return;
    }
    if (!d.moved) {
      setSelection({ type: "object", id: o.id });
      return;
    }
    const b = boxes[o.id] ?? d.orig;
    void run(() => actions.moveObject(o.id, { x: b.x, y: b.y, width: b.width, height: b.height }));
  }

  // ── task drag (from the list or a pin) ──────────────────────────
  function onTaskPointerDown(e: React.PointerEvent, taskId: string) {
    e.stopPropagation();
    if (!canEdit) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: "task", id: taskId, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
  }

  function onTaskPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.kind !== "task" || d.pointerId !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
    d.moved = true;
    setGhost({ taskId: d.id, x: e.clientX, y: e.clientY });
  }

  function onTaskPointerUp(e: React.PointerEvent, taskId: string) {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    if (!d || d.kind !== "task" || !d.moved) {
      // A tap selects the task; with edit rights the next tap on the map places it.
      setSelection({ type: "task", id: taskId });
      if (canEdit && imageUrl) setMode({ type: "place-task", taskId });
      return;
    }
    const pos = dropPosition(e.clientX, e.clientY);
    if (pos.inside) placeTask(taskId, { x: pos.x, y: pos.y, objectId: pos.objectId });
  }

  // ── taps on the map (placing) ───────────────────────────────────
  async function onMapClick(e: React.MouseEvent) {
    if (!mode || busy) return;
    if (mode.type === "place-task") {
      const pos = dropPosition(e.clientX, e.clientY);
      setMode(null);
      placeTask(mode.taskId, { x: pos.x, y: pos.y, objectId: pos.objectId });
      return;
    }
    const f = fraction(e.clientX, e.clientY);
    const draft = mode.draft;
    const kind = draft.kind as Kind;
    const area = AREA_KINDS.includes(kind);
    const width = area ? 0.08 : null;
    // A square in pixels: the height fraction scales with the image's width/height ratio.
    const height = area ? 0.08 * aspect : null;
    const x = round(area ? clamp(f.x - width! / 2, 0, 1 - width!) : f.x);
    const y = round(area ? clamp(f.y - height! / 2, 0, 1 - height!) : f.y);
    const ok = await run(
      () => actions.createObject({ ...draft, x, y, width: width === null ? null : round(width), height: height === null ? null : round(Math.min(height, 0.5)) }),
      t("objectAdded", { name: draft.code ? `${draft.code} ${draft.name}` : draft.name }),
    );
    if (ok) setMode(null);
  }

  const selectedObject = selection?.type === "object" ? byId.get(selection.id) ?? null : null;
  const selectedTask = selection?.type === "task" ? taskById.get(selection.id) ?? null : null;
  const unplaced = tasks.filter((x) => !pinOf(x) && x.inRange);
  const placed = tasks.filter((x) => pinOf(x));
  const blinkingCount = objects.filter((o) => o.blinking).length;
  // Tasks pinned to the same object are stacked under it.
  const stackIndex = (task: MapTask) => {
    const p = pinOf(task);
    if (!p?.objectId) return 0;
    return placed.filter((x) => pinOf(x)?.objectId === p.objectId).findIndex((x) => x.id === task.id);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" data-testid="site-map-board">
      <div className="min-w-0 space-y-2">
        {mode && (
          <div className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" role="status" data-testid="map-mode">
            <Crosshair className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{mode.type === "place-task" ? t("tapToPlaceTask", { task: taskById.get(mode.taskId)?.title ?? "" }) : t("tapToPlaceObject")}</span>
            <button type="button" onClick={() => setMode(null)} className="inline-flex min-h-9 items-center gap-1 rounded-md bg-white/15 px-2" aria-label={t("cancel")}>
              <X className="size-4" aria-hidden />
              {t("cancel")}
            </button>
          </div>
        )}
        {message && (
          <p role={message.ok ? "status" : "alert"} className={cn("rounded-lg px-3 py-2 text-sm", message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900")} data-testid="map-message">
            {message.text}
          </p>
        )}
        {imageUrl ? (
          <div className="overflow-auto rounded-lg border bg-muted">
            <div
              ref={mapRef}
              className={cn("relative w-full min-w-[40rem] touch-none select-none lg:min-w-0", mode && "cursor-crosshair")}
              style={{ aspectRatio: String(aspect || 1.5) }}
              onClick={onMapClick}
              data-testid="site-map"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- authorized private image */}
              <img src={imageUrl} alt={t("mapAlt")} className="pointer-events-none absolute inset-0 size-full object-fill" draggable={false} />
              {objects.map((o) => {
                const b = objectBox(o);
                const style = KIND_STYLE[o.kind];
                const Icon = style.icon;
                const label = o.code ?? o.name;
                const selected = selectedObject?.id === o.id;
                const common = {
                  "data-object-id": o.id,
                  "data-blinking": o.blinking ? "true" : "false",
                  onPointerDown: (e: React.PointerEvent) => onObjectPointerDown(e, o),
                  onPointerMove: onObjectPointerMove,
                  onPointerUp: (e: React.PointerEvent) => onObjectPointerUp(e, o),
                  onClick: (e: React.MouseEvent) => {
                    if (!mode) e.stopPropagation();
                  },
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelection({ type: "object", id: o.id });
                    }
                  },
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `${tAll(`production.map.kinds.${o.kind}`)} ${o.code ? `${o.code} ` : ""}${o.name}${o.blinking ? `, ${t("hasDeviation")}` : ""}`,
                };
                if (b.width !== null && b.height !== null) {
                  return (
                    <div
                      key={o.id}
                      {...common}
                      className={cn("absolute rounded-sm border-2", style.area, canEdit && !mode && "cursor-move", selected && "ring-2 ring-primary ring-offset-1", o.blinking && "deviation-blink")}
                      style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` }}
                    >
                      <span className={cn("absolute left-1 top-1 inline-flex max-w-[calc(100%-0.5rem)] items-center gap-1 truncate rounded px-1 text-[11px] font-semibold", style.chip, o.blinking && "deviation-blink")}>
                        <Icon className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">{label}</span>
                      </span>
                      {canEdit && !mode && (
                        <span
                          className="absolute -bottom-2 -right-2 size-5 cursor-nwse-resize rounded-full border-2 border-white bg-primary shadow"
                          onPointerDown={(e) => onObjectPointerDown(e, o, true)}
                          onPointerMove={onObjectPointerMove}
                          onPointerUp={(e) => onObjectPointerUp(e, o)}
                          aria-hidden
                        />
                      )}
                    </div>
                  );
                }
                return (
                  <div
                    key={o.id}
                    {...common}
                    className={cn(
                      "absolute inline-flex min-h-8 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border-2 px-2 text-xs font-bold shadow-md",
                      style.chip,
                      canEdit && !mode && "cursor-move",
                      selected && "ring-2 ring-primary ring-offset-2",
                      o.blinking && "deviation-blink",
                    )}
                    style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%` }}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span>{label}</span>
                  </div>
                );
              })}
              {placed.map((task) => {
                const p = pinOf(task)!;
                const i = stackIndex(task);
                const deviating = task.deviations.length > 0;
                return (
                  <button
                    key={task.id}
                    type="button"
                    data-task-id={task.id}
                    onPointerDown={(e) => onTaskPointerDown(e, task.id)}
                    onPointerMove={onTaskPointerMove}
                    onPointerUp={(e) => onTaskPointerUp(e, task.id)}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "absolute z-10 inline-flex max-w-[11rem] -translate-x-1/2 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium shadow",
                      PHASE_STYLE[task.phase],
                      !task.inRange && "opacity-50",
                      selectedTask?.id === task.id && "ring-2 ring-primary",
                      deviating && "deviation-blink",
                      canEdit && "cursor-grab",
                    )}
                    style={{ left: `${p.x * 100}%`, top: `calc(${p.y * 100}% + ${p.objectId ? 18 + i * 24 : -10}px)` }}
                    title={task.title}
                  >
                    <span className="truncate">{task.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex aspect-[3/2] items-center justify-center rounded-lg border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground" data-testid="site-map-empty">
            {canEdit ? t("noMapEdit") : t("noMap")}
          </div>
        )}
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label={t("legend")}>
          {KINDS.map((k) => {
            const Icon = KIND_STYLE[k].icon;
            return (
              <li key={k} className="inline-flex items-center gap-1">
                <span className={cn("inline-flex size-4 items-center justify-center rounded-full", KIND_STYLE[k].chip)}>
                  <Icon className="size-2.5" aria-hidden />
                </span>
                {t(`kinds.${k}`)}
              </li>
            );
          })}
          <li className="inline-flex items-center gap-1">
            <span className="deviation-blink inline-block size-3 rounded-full" aria-hidden />
            {t("blinkLegend")}
          </li>
        </ul>
      </div>

      {/* ── side panel ── */}
      <aside className="space-y-4" data-testid="site-map-panel">
        {blinkingCount > 0 && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900" data-testid="map-deviation-count">
            {t("deviationsOnMap", { n: blinkingCount })}
          </p>
        )}

        {selectedObject && (
          <ObjectPanel
            key={selectedObject.id}
            o={selectedObject}
            tasks={selectedObject.taskIds.map((id) => taskById.get(id)).filter((x): x is MapTask => !!x)}
            slug={slug}
            canEdit={canEdit}
            canReport={canReport}
            deviationTypes={deviationTypes}
            onClose={() => setSelection(null)}
            onDone={(text) => {
              setMessage({ ok: true, text });
              startTransition(() => router.refresh());
            }}
            run={run}
            actions={actions}
          />
        )}

        {selectedTask && (
          <section className="rounded-lg border p-3" data-testid="map-task-panel">
            <div className="flex items-start gap-2">
              <h2 className="flex-1 text-sm font-semibold">{selectedTask.title}</h2>
              <button type="button" onClick={() => setSelection(null)} className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted" aria-label={t("close")}>
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(selectedTask.start).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })} – {new Date(selectedTask.end).toLocaleTimeString(undefined, { timeStyle: "short" })}
            </p>
            <p className="mt-2">
              <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-xs", PHASE_STYLE[selectedTask.phase])}>{tCal(`phases.${selectedTask.phase}`)}</span>
              {selectedTask.missing > 0 && <span className="ml-2 text-xs text-amber-800">{t("missing", { n: selectedTask.missing })}</span>}
            </p>
            {selectedTask.deviations.map((d) => (
              <p key={d.id} className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-900">
                {tDev(`types.${d.type}`)}
                {d.comment ? ` – ${d.comment}` : ""}
              </p>
            ))}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/c/${slug}/logistics/requests/${selectedTask.id}`} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm md:min-h-9">
                {t("openTask")}
              </Link>
              {canEdit && imageUrl && (
                <button type="button" onClick={() => setMode({ type: "place-task", taskId: selectedTask.id })} className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm md:min-h-9">
                  <Crosshair className="size-4" aria-hidden />
                  {pinOf(selectedTask) ? t("move") : t("placeOnMap")}
                </button>
              )}
              {canEdit && pinOf(selectedTask) && (
                <button
                  type="button"
                  onClick={() => {
                    setPins((p) => ({ ...p, [selectedTask.id]: null }));
                    void run(() => actions.unplaceTask(selectedTask.id));
                  }}
                  className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-destructive hover:underline md:min-h-9"
                >
                  {t("removeFromMap")}
                </button>
              )}
            </div>
          </section>
        )}

        <section className="rounded-lg border p-3">
          <h2 className="text-sm font-semibold">{t("tasks")}</h2>
          {canEdit && imageUrl && <p className="mt-1 text-xs text-muted-foreground">{t("dragHint")}</p>}
          {tasks.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("noTasks")}</p>
          ) : (
            <>
              {unplaced.length > 0 && <h3 className="mt-3 text-xs font-semibold uppercase text-muted-foreground">{t("notOnMap")}</h3>}
              <ul className="mt-1 space-y-1" data-testid="map-unplaced-tasks">
                {unplaced.map((task) => (
                  <TaskItem key={task.id} task={task} canEdit={canEdit && !!imageUrl} onPointerDown={onTaskPointerDown} onPointerMove={onTaskPointerMove} onPointerUp={onTaskPointerUp} />
                ))}
              </ul>
              {placed.length > 0 && <h3 className="mt-3 text-xs font-semibold uppercase text-muted-foreground">{t("onMap")}</h3>}
              <ul className="mt-1 space-y-1" data-testid="map-placed-tasks">
                {placed.map((task) => {
                  const o = pinOf(task)?.objectId ? byId.get(pinOf(task)!.objectId!) : null;
                  return <TaskItem key={task.id} task={task} at={o ? (o.code ?? o.name) : null} canEdit={canEdit} onPointerDown={onTaskPointerDown} onPointerMove={onTaskPointerMove} onPointerUp={onTaskPointerUp} />;
                })}
              </ul>
            </>
          )}
        </section>

        {canEdit && imageUrl && <NewObject locations={locations} onStart={(draft) => setMode({ type: "new-object", draft })} active={mode?.type === "new-object"} />}

        <section className="rounded-lg border p-3">
          <h2 className="text-sm font-semibold">{t("objects")}</h2>
          {objects.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("noObjects")}</p>
          ) : (
            <ul className="mt-2 divide-y" data-testid="map-objects">
              {objects.map((o) => {
                const Icon = KIND_STYLE[o.kind].icon;
                return (
                  <li key={o.id}>
                    <button type="button" onClick={() => setSelection({ type: "object", id: o.id })} className="flex min-h-11 w-full items-center gap-2 text-left text-sm">
                      <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full", KIND_STYLE[o.kind].chip, o.blinking && "deviation-blink")}>
                        <Icon className="size-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {o.code && <span className="font-semibold">{o.code} </span>}
                        {o.name}
                      </span>
                      {o.blinking && <span className="text-xs font-semibold text-red-700">{t("deviation")}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </aside>

      {ghost && (
        <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-md border bg-background px-2 py-1 text-xs font-medium shadow-lg" style={{ left: ghost.x, top: ghost.y }} aria-hidden>
          {taskById.get(ghost.taskId)?.title}
        </div>
      )}
    </div>
  );
}

function TaskItem({
  task,
  at,
  canEdit,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  task: MapTask;
  at?: string | null;
  canEdit: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent, id: string) => void;
}) {
  const t = useTranslations("production.calendar");
  return (
    <li>
      <button
        type="button"
        data-map-task={task.id}
        onPointerDown={(e) => onPointerDown(e, task.id)}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerUp(e, task.id)}
        className={cn("flex min-h-11 w-full touch-none items-center gap-2 rounded-md border px-2 text-left text-sm", PHASE_STYLE[task.phase], task.deviations.length > 0 && "deviation-blink", canEdit && "cursor-grab")}
      >
        {canEdit && <GripVertical className="size-4 shrink-0 opacity-60" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{task.title}</span>
          <span className="block truncate text-xs opacity-80">
            {new Date(task.start).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
            {at ? ` · ${at}` : ""} · {t(`phases.${task.phase}`)}
          </span>
        </span>
      </button>
    </li>
  );
}

function NewObject({ locations, onStart, active }: { locations: { id: string; kind: string; name: string }[]; onStart: (draft: Record<string, string>) => void; active: boolean }) {
  const t = useTranslations("production.map");
  const [kind, setKind] = useState<Kind>("GATE");
  const [locationId, setLocationId] = useState("");
  const usable = locations.filter((l) => l.kind === kind);
  return (
    <section className="rounded-lg border p-3" data-testid="map-new-object">
      <h2 className="text-sm font-semibold">{t("addObject")}</h2>
      <form
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const draft = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]).filter(([, v]) => v !== ""));
          onStart(draft);
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">{t("kind")}</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setLocationId("");
            }}
            className="mt-1 h-11 w-full rounded-lg border bg-background px-2 md:h-9"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>
        {LOCATION_KINDS.includes(kind) && usable.length > 0 && (
          <label className="block text-sm">
            <span className="font-medium">{t("existingLocation")}</span>
            <select name="locationId" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 h-11 w-full rounded-lg border bg-background px-2 md:h-9">
              <option value="">{t("newLocation")}</option>
              {usable.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-[5rem_1fr] gap-2">
          <label className="block text-sm">
            <span className="font-medium">{t("code")}</span>
            <input name="code" maxLength={12} placeholder={kind === "GATE" ? "P1" : ""} className="mt-1 h-11 w-full rounded-lg border bg-background px-2 md:h-9" />
          </label>
          <label className="block text-sm">
            <span className="font-medium">{t("name")}</span>
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={usable.find((l) => l.id === locationId)?.name ?? ""}
              key={locationId}
              className="mt-1 h-11 w-full rounded-lg border bg-background px-2 md:h-9"
            />
          </label>
        </div>
        {kind === "GATE" && !locationId && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="font-medium">{t("opens")}</span>
              <input name="opens" type="time" className="mt-1 h-11 w-full rounded-lg border bg-background px-2 md:h-9" />
            </label>
            <label className="block text-sm">
              <span className="font-medium">{t("closes")}</span>
              <input name="closes" type="time" className="mt-1 h-11 w-full rounded-lg border bg-background px-2 md:h-9" />
            </label>
          </div>
        )}
        <button type="submit" disabled={active} className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60 md:min-h-9">
          <Plus className="size-4" aria-hidden />
          {t("placeObject")}
        </button>
      </form>
    </section>
  );
}

function ObjectPanel({
  o,
  tasks,
  slug,
  canEdit,
  canReport,
  deviationTypes,
  onClose,
  onDone,
  run,
  actions,
}: {
  o: MapObject;
  tasks: MapTask[];
  slug: string;
  canEdit: boolean;
  canReport: boolean;
  deviationTypes: readonly string[];
  onClose: () => void;
  onDone: (text: string) => void;
  run: (fn: () => Promise<Result>, okText?: string) => Promise<boolean>;
  actions: MapActions;
}) {
  const t = useTranslations("production.map");
  const tDev = useTranslations("production.deviations");
  const tAll = useTranslations();
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [type, setType] = useState<string>(deviationTypes[0] ?? "OTHER");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const Icon = KIND_STYLE[o.kind].icon;
  return (
    <section className={cn("rounded-lg border p-3", o.blinking && "border-red-400")} data-testid="map-object-panel">
      <div className="flex items-start gap-2">
        <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", KIND_STYLE[o.kind].chip, o.blinking && "deviation-blink")}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            {o.code && <span>{o.code} </span>}
            {o.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(`kinds.${o.kind}`)}
            {o.location?.opensMinute != null && o.location.closesMinute != null && ` · ${t("hours", { from: clock(o.location.opensMinute), to: clock(o.location.closesMinute) })}`}
          </p>
        </div>
        <button type="button" onClick={onClose} className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted" aria-label={t("close")}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {o.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{o.notes}</p>}

      {o.deviations.length > 0 && (
        <ul className="mt-3 space-y-1" data-testid="map-object-deviations">
          {o.deviations.map((d) => (
            <li key={d.id} className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-900">
              <span className="font-semibold">{tDev(`types.${d.type}`)}</span> · {tDev(`statuses.${d.status}`)}
              {d.comment ? ` – ${d.comment}` : ""}
            </li>
          ))}
          <li>
            <Link href={`/c/${slug}/logistics/deviations`} className="text-xs text-primary hover:underline">
              {t("handleDeviations")}
            </Link>
          </li>
        </ul>
      )}
      {tasks.some((x) => x.deviations.length > 0) && <p className="mt-2 text-xs text-red-800">{t("taskDeviationHere")}</p>}

      {tasks.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t("tasksHere")}</h3>
          <ul className="mt-1 space-y-1">
            {tasks.map((x) => (
              <li key={x.id}>
                <Link href={`/c/${slug}/logistics/requests/${x.id}`} className={cn("block rounded-md border px-2 py-1 text-xs hover:underline", PHASE_STYLE[x.phase], x.deviations.length > 0 && "deviation-blink")}>
                  {x.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canReport && !reporting && (
          <button type="button" onClick={() => setReporting(true)} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-red-600 px-3 text-sm font-medium text-white md:min-h-9" data-testid="map-report-deviation">
            <TriangleAlert className="size-4" aria-hidden />
            {tDev("report")}
          </button>
        )}
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm md:min-h-9">
            {t("edit")}
          </button>
        )}
      </div>

      {reporting && (
        <form
          className="mt-3 space-y-2 border-t pt-3"
          data-testid="map-deviation-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setSending(true);
            setError(null);
            const fd = new FormData(e.currentTarget);
            fd.set("type", type);
            try {
              const r = await actions.reportDeviation(o.id, null, fd);
              if (r.ok) {
                setReporting(false);
                onDone(t("deviationReported"));
              } else setError(Object.values(r.fieldErrors ?? {}).flat().map((k) => tAll(k)).join(" ") || tAll(r.message ?? "errors.generic"));
            } finally {
              setSending(false);
            }
          }}
        >
          <fieldset>
            <legend className="text-sm font-medium">{t("whatDeviation")}</legend>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {deviationTypes.map((dt) => (
                <button key={dt} type="button" onClick={() => setType(dt)} aria-pressed={type === dt} className={cn("min-h-11 rounded-lg border px-2 text-left text-xs font-medium", type === dt ? "border-red-600 bg-red-600 text-white" : "hover:bg-muted")}>
                  {tDev(`types.${dt}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm">
            <span className="font-medium">{tDev("comment")}</span>
            <textarea name="comment" rows={2} maxLength={1000} className="mt-1 w-full rounded-lg border bg-background px-2 py-1" />
          </label>
          <label className="block text-sm">
            <span className="font-medium">{tDev("photo")}</span>
            <input name="photo" type="file" accept="image/*" capture="environment" className="mt-1 block w-full text-sm" />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={sending} className="inline-flex min-h-11 items-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white disabled:opacity-60 md:min-h-9">
              {tDev("send")}
            </button>
            <button type="button" onClick={() => setReporting(false)} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm md:min-h-9">
              {t("cancel")}
            </button>
          </div>
        </form>
      )}

      {editing && (
        <form
          className="mt-3 space-y-2 border-t pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const ok = await run(() => actions.updateObject(o.id, { code: String(fd.get("code") ?? ""), name: String(fd.get("name") ?? ""), notes: String(fd.get("notes") ?? "") }), t("saved"));
            if (ok) setEditing(false);
          }}
        >
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <label className="block text-sm">
              <span className="font-medium">{t("code")}</span>
              <input name="code" defaultValue={o.code ?? ""} maxLength={12} className="mt-1 h-11 w-full rounded-lg border bg-background px-2 md:h-9" />
            </label>
            <label className="block text-sm">
              <span className="font-medium">{t("name")}</span>
              <input name="name" defaultValue={o.name} required maxLength={80} className="mt-1 h-11 w-full rounded-lg border bg-background px-2 md:h-9" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-medium">{t("notes")}</span>
            <textarea name="notes" defaultValue={o.notes ?? ""} rows={2} maxLength={500} className="mt-1 w-full rounded-lg border bg-background px-2 py-1" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground md:min-h-9">
              {t("save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm md:min-h-9">
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(t("removeConfirm"))) return;
                const ok = await run(() => actions.archiveObject(o.id), t("removed"));
                if (ok) onClose();
              }}
              className="ml-auto inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-destructive hover:underline md:min-h-9"
            >
              {t("remove")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
