import Link from "next/link";
import { cn } from "@/ui/lib/utils";

/** Sub-navigation tabs (scroll sideways on phones). */
export function TabBar({ items, label }: { items: { key: string; href: string; label: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1 border-b">
        {items.map((i) => (
          <li key={i.key}>
            <Link
              href={i.href}
              aria-current={i.active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap md:min-h-9",
                i.active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
