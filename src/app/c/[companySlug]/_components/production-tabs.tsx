import { getTranslations } from "next-intl/server";
import type { RequestContext } from "@/platform/authz";
import { TabBar } from "@/ui/components/tabs";
import { hasLogisticsAccess, hasTaktAccess } from "@/app/_lib/nav";

export type ProductionTab = "takt" | "lookahead" | "calendar" | "map" | "deviations" | "logistics" | "bookings" | "risks" | "taskTypes";

/** Production control ("Tuotannonohjaus"): takt schedule and logistics under one menu item. */
export async function ProductionTabs({ ctx, active, site, date }: { ctx: RequestContext; active: ProductionTab; site?: string; date?: string }) {
  const t = await getTranslations("production.tabs");
  const base = `/c/${ctx.company.slug}`;
  // Site-based tabs keep the site and day the member is looking at.
  const q = new URLSearchParams(Object.entries({ site, date }).filter((e): e is [string, string] => !!e[1])).toString();
  const withQ = (href: string) => (q ? `${href}?${q}` : href);
  const logistics = hasLogisticsAccess(ctx);
  const manageTypes = logistics && (ctx.permissions.has("logistics.approve") || [...ctx.projectGrants.values()].some((g) => g.has("logistics.approve")));
  const tabs: { key: ProductionTab; href: string; show: boolean }[] = [
    { key: "takt", href: `${base}/takt`, show: hasTaktAccess(ctx) },
    { key: "lookahead", href: `${base}/takt/lookahead`, show: hasTaktAccess(ctx) },
    { key: "calendar", href: withQ(`${base}/logistics/calendar`), show: logistics },
    { key: "map", href: withQ(`${base}/logistics/map`), show: logistics },
    { key: "deviations", href: `${base}/logistics/deviations`, show: logistics },
    { key: "logistics", href: withQ(`${base}/logistics`), show: logistics },
    { key: "bookings", href: `${base}/logistics/bookings`, show: logistics },
    { key: "risks", href: `${base}/logistics/risks`, show: logistics },
    { key: "taskTypes", href: `${base}/logistics/task-types`, show: manageTypes },
  ];
  return <TabBar label={t("label")} items={tabs.filter((x) => x.show).map((x) => ({ key: x.key, href: x.href, label: t(x.key), active: x.key === active }))} />;
}
