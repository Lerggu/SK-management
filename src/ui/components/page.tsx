import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/ui/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mb-6 space-y-2">
      {backHref && (
        <Link href={backHref} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:min-h-0">
          <ChevronLeft className="size-4" aria-hidden />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
          {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Section({ title, actions, children, className }: { title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 md:p-5", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Definition list that stacks on phones. */
export function DetailList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 text-sm break-words">{i.value ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Responsive list: card rows on phones (big tap targets), table-like on
 * desktop. Each row is a link.
 */
export function RowList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y rounded-xl border bg-card">{children}</ul>;
}

export function RowLink({ href, title, subtitle, meta, badge }: { href: string; title: React.ReactNode; subtitle?: React.ReactNode; meta?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium break-words">{title}</span>
            {badge}
          </div>
          {subtitle && <div className="mt-0.5 text-sm text-muted-foreground break-words">{subtitle}</div>}
        </div>
        {meta && <div className="hidden shrink-0 text-right text-sm text-muted-foreground sm:block">{meta}</div>}
      </Link>
    </li>
  );
}

export function SearchForm({ placeholder, defaultValue, includeArchivedLabel, includeArchived, searchLabel }: { placeholder: string; defaultValue?: string; includeArchivedLabel: string; includeArchived?: boolean; searchLabel: string }) {
  return (
    <form className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center" role="search">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={searchLabel}
        className="h-11 flex-1 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:text-sm"
      />
      <label className="flex min-h-11 items-center gap-2 px-1 text-sm md:min-h-0">
        <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} className="size-5 accent-primary md:size-4" />
        {includeArchivedLabel}
      </label>
      <button type="submit" className="h-11 rounded-lg border px-4 text-sm font-medium hover:bg-muted md:h-9">
        {searchLabel}
      </button>
    </form>
  );
}
