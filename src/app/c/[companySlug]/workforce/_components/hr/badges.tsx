import { Badge } from "@/ui/components/badge";
import { cn } from "@/ui/lib/utils";

const VALIDITY_TONES: Record<string, string> = {
  VALID: "bg-emerald-100 text-emerald-900",
  EXPIRING: "bg-amber-100 text-amber-900",
  EXPIRED: "bg-red-100 text-red-900",
  NO_EXPIRY: "bg-sky-100 text-sky-900",
  UNKNOWN: "bg-zinc-100 text-zinc-700",
};

/** Validity with text and colour (never colour alone). */
export function ValidityBadge({ state, label }: { state: string; label: string }) {
  return (
    <Badge variant="secondary" className={cn("rounded-md font-medium", VALIDITY_TONES[state])} data-validity={state}>
      {label}
    </Badge>
  );
}

const LEVEL_TONES: Record<string, string> = {
  "1": "bg-red-100 text-red-900",
  "2": "bg-amber-100 text-amber-900",
  "3": "bg-emerald-100 text-emerald-900",
  "4": "bg-emerald-700 text-white",
};

/**
 * Competence level cell. A missing or "not assessed" value is drawn with a
 * dashed outline and a dash, so it is never mistaken for a low level.
 */
export function LevelCell({ level, title, className }: { level: number | null | undefined; title: string; className?: string }) {
  const key = level ? String(level) : null;
  return (
    <span
      title={title}
      aria-label={title}
      data-level={key ?? "none"}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md text-sm font-semibold tabular-nums",
        key ? LEVEL_TONES[key] : "border border-dashed border-zinc-300 text-zinc-400",
        className,
      )}
    >
      {key ?? "–"}
    </span>
  );
}

export function SmallBadge({ tone, children }: { tone: "ok" | "warn" | "muted" | "bad"; children: React.ReactNode }) {
  const tones = { ok: "bg-emerald-100 text-emerald-900", warn: "bg-amber-100 text-amber-900", muted: "bg-zinc-100 text-zinc-700", bad: "bg-red-100 text-red-900" };
  return (
    <Badge variant="secondary" className={cn("rounded-md font-medium", tones[tone])}>
      {children}
    </Badge>
  );
}
