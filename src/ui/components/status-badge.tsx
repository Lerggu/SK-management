import { Badge } from "@/ui/components/badge";
import { cn } from "@/ui/lib/utils";

const TONES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-900",
  AVAILABLE: "bg-emerald-100 text-emerald-900",
  APPROVED: "bg-emerald-100 text-emerald-900",
  CURRENT: "bg-emerald-100 text-emerald-900",
  IN_USE: "bg-sky-100 text-sky-900",
  PLANNED: "bg-sky-100 text-sky-900",
  PENDING_APPROVAL: "bg-amber-100 text-amber-900",
  INVITED: "bg-amber-100 text-amber-900",
  MAINTENANCE: "bg-amber-100 text-amber-900",
  ON_HOLD: "bg-amber-100 text-amber-900",
  DRAFT: "bg-zinc-100 text-zinc-800",
  COMPLETED: "bg-zinc-100 text-zinc-800",
  SUPERSEDED: "bg-zinc-200 text-zinc-700",
  INACTIVE: "bg-zinc-100 text-zinc-700",
  CLOSED: "bg-zinc-100 text-zinc-700",
  REJECTED: "bg-red-100 text-red-900",
  DISABLED: "bg-red-100 text-red-900",
  OUT_OF_SERVICE: "bg-red-100 text-red-900",
  ARCHIVED: "bg-zinc-200 text-zinc-700",
  // V3 takt
  READY: "bg-emerald-100 text-emerald-900",
  NOT_READY: "bg-zinc-100 text-zinc-800",
  BLOCKED: "bg-red-100 text-red-900",
  IN_PROGRESS: "bg-sky-100 text-sky-900",
  COMPLETE: "bg-emerald-700 text-white",
  PROPOSED: "bg-amber-100 text-amber-900",
  BASELINE: "bg-emerald-100 text-emerald-900",
  OPEN: "bg-amber-100 text-amber-900",
  CLEARED: "bg-emerald-100 text-emerald-900",
  MOVED: "bg-amber-100 text-amber-900",
  ADDED: "bg-sky-100 text-sky-900",
  REMOVED: "bg-red-100 text-red-900",
  UNCHANGED: "bg-zinc-100 text-zinc-700",
  PREVIEW: "bg-amber-100 text-amber-900",
  APPLIED: "bg-emerald-100 text-emerald-900",
  DISCARDED: "bg-zinc-200 text-zinc-700",
  OK: "bg-emerald-100 text-emerald-900",
  MERGED: "bg-sky-100 text-sky-900",
  UNMAPPED: "bg-amber-100 text-amber-900",
  MILESTONE: "bg-zinc-100 text-zinc-700",
};

export function StatusBadge({ status, label, className }: { status: string; label: string; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("rounded-md font-medium", TONES[status], className)} data-status={status}>
      {label}
    </Badge>
  );
}
