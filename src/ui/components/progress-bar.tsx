import { cn } from "@/ui/lib/utils";

/** Accessible progress bar (0–100). */
export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label} className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full", v >= 100 ? "bg-emerald-600" : "bg-primary")} style={{ width: `${v}%` }} />
    </div>
  );
}
