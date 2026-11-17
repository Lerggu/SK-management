import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { RequestContext } from "@/platform/authz";
import { marketingAccess } from "@/modules/marketing/service";
import { cn } from "@/ui/lib/utils";

export async function MarketingNav({ ctx, active, pending }: { ctx: RequestContext; active: "register" | "approvals" | "calls" | "settings"; pending?: number }) {
  const t = await getTranslations("marketing");
  const access = marketingAccess(ctx);
  const base = `/c/${ctx.company.slug}/marketing`;
  const items = [
    { key: "register" as const, href: base, show: access.view },
    { key: "approvals" as const, href: `${base}/approvals`, show: access.approve },
    { key: "calls" as const, href: `${base}/calls`, show: access.approve },
    { key: "settings" as const, href: `${base}/settings`, show: access.manage },
  ].filter((i) => i.show);
  return (
    <nav className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b px-4" aria-label={t("title")}>
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={active === i.key ? "page" : undefined}
          className={cn("flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium", active === i.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t(`tabs.${i.key}`)}
          {i.key === "approvals" && pending ? <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-900">{pending}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
