/** Board chip border colour per takt status. */
export const STATUS_BORDER: Record<string, string> = {
  READY: "border-l-emerald-500",
  NOT_READY: "border-l-zinc-400",
  BLOCKED: "border-l-red-600",
  IN_PROGRESS: "border-l-sky-500",
  COMPLETE: "border-l-emerald-900",
};

export const STATUS_DOT: Record<string, string> = {
  READY: "bg-emerald-500",
  NOT_READY: "bg-zinc-400",
  BLOCKED: "bg-red-600",
  IN_PROGRESS: "bg-sky-500",
  COMPLETE: "bg-emerald-900",
};

export const TAKT_STATUSES = ["READY", "NOT_READY", "IN_PROGRESS", "BLOCKED", "COMPLETE"] as const;
