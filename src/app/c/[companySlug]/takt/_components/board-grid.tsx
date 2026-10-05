import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { cn } from "@/ui/lib/utils";
import { STATUS_BORDER, STATUS_DOT, TAKT_STATUSES } from "./status";

interface BoardActivity {
  id: string;
  name: string;
  status: string;
  progressPct: number;
  taktArea: { id: string };
  workPackage: { code: string; name: string; color: string };
  plannedStart: string | null;
  plannedEnd: string | null;
}

interface Building {
  id: string;
  name: string;
  taktAreas: { id: string; code: string; name: string }[];
}

/** Takt board: takt areas × working days; chips colored by work package, bordered by status. */
export async function BoardGrid({ slug, planId, dates, today, buildings, activities }: { slug: string; planId: string; dates: string[]; today: string; buildings: Building[]; activities: BoardActivity[] }) {
  const [t, format] = await Promise.all([getTranslations("takt"), getFormatter()]);
  const scheduled = activities.filter((a) => a.plannedStart);
  const dayLabel = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.`;
  const weekday = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "short" });
  return (
    <div className="space-y-3">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0" data-testid="takt-board">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-36 border-b bg-card px-2 py-1 text-left font-medium">{t("area")}</th>
              {dates.map((d, i) => (
                <th key={d} scope="col" className={cn("min-w-14 border-b px-1 py-1 text-center font-medium", d === today && "bg-primary/10 text-primary")} data-date={d}>
                  <span className="block text-[10px] uppercase text-muted-foreground">{weekday(d)}</span>
                  {dayLabel(d)}
                  <span className="block text-[10px] text-muted-foreground">#{i}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buildings.map((b) => (
              <BuildingRows key={b.id} b={b} dates={dates} today={today} activities={scheduled} slug={slug} planId={planId} statusLabel={(s) => t(`statuses.${s}`)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label={t("legend")}>
        {TAKT_STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span aria-hidden className={cn("size-3 rounded-sm", STATUS_DOT[s])} /> {t(`statuses.${s}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

function BuildingRows({
  b,
  dates,
  today,
  activities,
  slug,
  planId,
  statusLabel,
}: {
  b: Building;
  dates: string[];
  today: string;
  activities: BoardActivity[];
  slug: string;
  planId: string;
  statusLabel: (s: string) => string;
}) {
  return (
    <>
      <tr>
        <th colSpan={dates.length + 1} className="sticky left-0 bg-muted/60 px-2 py-1 text-left text-xs font-semibold">
          {b.name}
        </th>
      </tr>
      {b.taktAreas.map((area) => {
        const inArea = activities.filter((a) => a.taktArea.id === area.id);
        return (
          <tr key={area.id} data-area={area.code}>
            <th scope="row" className="sticky left-0 z-10 border-b bg-card px-2 py-1 text-left font-normal">
              <span className="font-mono">{area.code}</span> <span className="text-muted-foreground">{area.name}</span>
            </th>
            {dates.map((d) => {
              const here = inArea.filter((a) => a.plannedStart! <= d && d <= a.plannedEnd!);
              return (
                <td key={d} className={cn("h-10 border-b px-0.5 py-0.5 align-top", d === today && "bg-primary/5")}>
                  <div className="flex flex-col gap-0.5">
                    {here.map((a) => (
                      <Link
                        key={a.id}
                        href={`/c/${slug}/takt/${planId}/activities/${a.id}`}
                        title={`${a.workPackage.name} · ${statusLabel(a.status)} · ${a.progressPct} %`}
                        aria-label={`${area.code} ${a.workPackage.name}: ${statusLabel(a.status)}`}
                        className={cn("block min-h-8 rounded border-l-4 px-1 py-1 text-center font-semibold leading-tight text-white shadow-sm hover:opacity-90", STATUS_BORDER[a.status])}
                        style={{ backgroundColor: a.workPackage.color }}
                        data-chip={a.workPackage.code}
                        data-status={a.status}
                      >
                        {a.workPackage.code}
                        {a.status === "COMPLETE" ? " ✓" : a.status === "BLOCKED" ? " !" : ""}
                      </Link>
                    ))}
                  </div>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
