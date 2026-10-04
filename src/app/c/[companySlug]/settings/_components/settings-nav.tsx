import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { hasPermission, type RequestContext } from "@/platform/authz";
import { cn } from "@/ui/lib/utils";

export async function SettingsNav({ ctx, active }: { ctx: RequestContext; active: "company" | "members" | "roles" | "audit" }) {
  const t = await getTranslations("settings");
  const base = `/c/${ctx.company.slug}/settings`;
  const items = [
    { key: "company" as const, href: base, show: true },
    { key: "members" as const, href: `${base}/members`, show: hasPermission(ctx, "company.members.manage") },
    { key: "roles" as const, href: `${base}/roles`, show: hasPermission(ctx, "company.roles.manage") || hasPermission(ctx, "company.members.manage") },
    { key: "audit" as const, href: `${base}/audit`, show: hasPermission(ctx, "audit.view") },
  ].filter((i) => i.show);
  return (
    <nav className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b px-4" aria-label={t("title")}>
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={active === i.key ? "page" : undefined}
          className={cn("flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium", active === i.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t(i.key)}
        </Link>
      ))}
    </nav>
  );
}
