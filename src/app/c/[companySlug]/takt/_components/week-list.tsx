import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionButton } from "@/ui/components/form";
import { EmptyState } from "@/ui/components/page";
import { ProgressBar } from "@/ui/components/progress-bar";
import { StatusBadge } from "@/ui/components/status-badge";
import { recordProgressAction } from "../actions";

interface WeekActivity {
  id: string;
  name: string;
  workPackage: { code: string; name: string; color: string };
  taktArea: { code: string; name: string };
  progressPct: number;
  status: string;
  plannedStart: string | null;
  plannedEnd: string | null;
}

/** Mobile-first list of this week's activities with quick progress buttons. */
export async function WeekList({ slug, planId, activities, canProgress }: { slug: string; planId: string; activities: WeekActivity[]; canProgress: boolean }) {
  const t = await getTranslations("takt");
  if (activities.length === 0) return <EmptyState>{t("noActivitiesThisWeek")}</EmptyState>;
  return (
    <ul className="grid gap-3 lg:grid-cols-2" data-testid="week-list">
      {activities.map((a) => (
        <li key={a.id} className="rounded-lg border p-3" data-activity={a.id} data-status={a.status}>
          <Link href={`/c/${slug}/takt/${planId}/activities/${a.id}`} className="flex min-h-11 items-start gap-3">
            <span aria-hidden className="mt-1 size-4 shrink-0 rounded" style={{ backgroundColor: a.workPackage.color }} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">
                {a.taktArea.code} · {a.name}
              </span>
              <span className="block text-sm text-muted-foreground">
                {a.taktArea.name}
                {a.plannedStart ? ` · ${a.plannedStart.slice(8, 10)}.${a.plannedStart.slice(5, 7)}.–${a.plannedEnd!.slice(8, 10)}.${a.plannedEnd!.slice(5, 7)}.` : ""}
              </span>
            </span>
            <StatusBadge status={a.status} label={t(`statuses.${a.status}`)} />
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar value={a.progressPct} label={t("progress")} />
            <span className="w-10 shrink-0 text-right text-sm tabular-nums">{a.progressPct} %</span>
          </div>
          {canProgress && a.status !== "COMPLETE" && (
            <div className="mt-3 grid grid-cols-4 gap-2" aria-label={t("quickProgress")}>
              {[25, 50, 75, 100].map((pct) => (
                <ActionButton
                  key={pct}
                  action={recordProgressAction.bind(null, slug, a.id)}
                  hidden={{ progressPct: String(pct) }}
                  variant={pct === 100 ? "default" : "outline"}
                  className="w-full [&_button]:h-12 [&_button]:w-full md:[&_button]:h-9"
                >
                  {pct} %
                </ActionButton>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
