/** Swatches for the task type colour (also used by the calendar). */
export const SWATCH: Record<string, string> = {
  slate: "bg-slate-500",
  sky: "bg-sky-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-600",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  orange: "bg-orange-500",
  teal: "bg-teal-600",
};

/** Calendar colours of the task phases (always shown with a text label). */
export const PHASE_STYLE: Record<"PLANNED" | "MISSING_RESOURCES" | "READY" | "IN_PROGRESS" | "COMPLETE" | "LATE", string> = {
  PLANNED: "bg-sky-100 text-sky-950 border-sky-400",
  MISSING_RESOURCES: "bg-amber-100 text-amber-950 border-amber-500",
  READY: "bg-emerald-100 text-emerald-950 border-emerald-600",
  IN_PROGRESS: "bg-blue-600 text-white border-blue-800",
  COMPLETE: "bg-zinc-200 text-zinc-700 border-zinc-400",
  LATE: "bg-red-100 text-red-950 border-red-600",
};
