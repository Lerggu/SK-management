import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/ui/lib/utils";

export type HrTab = "people" | "matrix" | "qualifications" | "overview" | "settings";

/** Sub-navigation of the workforce area (scrolls sideways on phones). */
export async function HrTabs({ slug, active, show }: { slug: string; active: HrTab; show: Partial<Record<HrTab, boolean>> }) {
  const t = await getTranslations("hr.tabs");
  const base = `/c/${slug}/workforce`;
  const tabs: { key: HrTab; href: string }[] = [
    { key: "people", href: base },
    { key: "matrix", href: `${base}/matrix` },
    { key: "qualifications", href: `${base}/qualifications` },
    { key: "overview", href: `${base}/overview` },
    { key: "settings", href: `${base}/settings` },
  ];
  return <TabBar items={tabs.filter((x) => show[x.key] !== false).map((x) => ({ ...x, label: t(x.key), active: x.key === active }))} label={t("people")} />;
}

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
