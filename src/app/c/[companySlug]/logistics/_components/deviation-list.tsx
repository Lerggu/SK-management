import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { deviationService } from "@/modules/production/deviation.service";
import { ActionButton, ActionForm, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState } from "@/ui/components/page";
import { Badge } from "@/ui/components/badge";
import { fmtDateTime } from "@/ui/format";
import { cn } from "@/ui/lib/utils";
import { productionAction } from "../production-actions";

type Row = Awaited<ReturnType<typeof deviationService.list>>[number];
const TONE = { OPEN: "bg-red-600 text-white", ACKNOWLEDGED: "bg-amber-100 text-amber-900", RESOLVED: "bg-emerald-100 text-emerald-900" } as const;

/** Deviation list with acknowledge/resolve for logistics approvers. */
export async function DeviationList({ slug, rows, showTask }: { slug: string; rows: Row[]; showTask: boolean }) {
  const [t, format] = await Promise.all([getTranslations("production.deviations"), getFormatter()]);
  if (rows.length === 0) return <EmptyState>{t("none")}</EmptyState>;
  return (
    <ul className="space-y-3" data-testid="deviation-list">
      {rows.map((d) => (
        <li key={d.id} className={cn("rounded-lg border p-3", d.status === "OPEN" && "border-red-300")} data-deviation={d.type} data-status={d.status}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className={cn("rounded-md font-medium", TONE[d.status])}>
              {t(`statuses.${d.status}`)}
            </Badge>
            <span className="font-medium">{t(`types.${d.type}`)}</span>
            {showTask && d.task && (
              <Link href={`/c/${slug}/logistics/requests/${d.task.id}`} className="text-sm text-primary underline-offset-2 hover:underline">
                {d.task.title}
              </Link>
            )}
            {showTask && d.object && (
              <Link href={`/c/${slug}/logistics/map?site=${d.object.siteId}&object=${d.object.id}`} className="text-sm text-primary underline-offset-2 hover:underline">
                {t("onMap", { object: d.object.label })}
              </Link>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {fmtDateTime(format, d.createdAt)} · {t("reportedBy")}: {d.reportedBy ?? "–"}
            </span>
          </div>
          {showTask && <p className="mt-0.5 text-xs text-muted-foreground">{d.task?.site ?? d.object?.site}</p>}
          {d.comment && <p className="mt-1 text-sm whitespace-pre-wrap">{d.comment}</p>}
          {d.photoIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {d.photoIds.map((id) => (
                <a key={id} href={`/c/${slug}/logistics/deviations/photos/${id}`} target="_blank" rel="noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authorized private photo */}
                  <img src={`/c/${slug}/logistics/deviations/photos/${id}`} alt={t(`types.${d.type}`)} className="size-20 rounded-md border object-cover" />
                </a>
              ))}
            </div>
          )}
          {d.resolution && (
            <p className="mt-1 text-sm">
              <span className="text-muted-foreground">{t("resolution")}:</span> {d.resolution}
            </p>
          )}
          {d.canManage && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
              {d.status === "OPEN" && <ActionButton action={productionAction.bind(null, slug, "deviationAcknowledge", d.id)}>{t("acknowledge")}</ActionButton>}
              <ActionForm action={productionAction.bind(null, slug, "deviationResolve", d.id)} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                <TextField name="resolution" label={t("resolution")} className="sm:flex-1" />
                <SubmitButton>{t("resolve")}</SubmitButton>
              </ActionForm>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

