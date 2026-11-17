import { getTranslations } from "next-intl/server";
import { TabBar } from "@/ui/components/tabs";

export type HrTab = "people" | "teams" | "rotation" | "matrix" | "qualifications" | "overview" | "settings";

/** Sub-navigation of the workforce area (scrolls sideways on phones). */
export async function HrTabs({ slug, active, show }: { slug: string; active: HrTab; show: Partial<Record<HrTab, boolean>> }) {
  const t = await getTranslations("hr.tabs");
  const base = `/c/${slug}/workforce`;
  const tabs: { key: HrTab; href: string }[] = [
    { key: "people", href: base },
    { key: "teams", href: `${base}/teams` },
    { key: "rotation", href: `${base}/rotation` },
    { key: "matrix", href: `${base}/matrix` },
    { key: "qualifications", href: `${base}/qualifications` },
    { key: "overview", href: `${base}/overview` },
    { key: "settings", href: `${base}/settings` },
  ];
  return <TabBar items={tabs.filter((x) => show[x.key] !== false).map((x) => ({ ...x, label: t(x.key), active: x.key === active }))} label={t("people")} />;
}

export { TabBar };
