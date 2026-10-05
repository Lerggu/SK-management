import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { timesheetService } from "@/modules/timesheets/service";
import { D } from "@/modules/finance/calculations";
import { formatClock } from "@/modules/timesheets/rules";
import { ActionForm } from "@/ui/components/form";
import { EmptyState, PageHeader } from "@/ui/components/page";
import { Button } from "@/ui/components/button";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { decideAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("time"))("approvals") };
}

export default async function ApprovalsPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [entries, t, format] = await Promise.all([loadOr404(timesheetService.listForApproval(ctx)), getTranslations("time"), getFormatter()]);
  const groups = new Map<string, typeof entries>();
  for (const e of entries) groups.set(e.employeeId, [...(groups.get(e.employeeId) ?? []), e]);
  const fmtH = (d: { toString(): string }) => format.number(Number(d.toString()), { maximumFractionDigits: 2 });

  return (
    <>
      <PageHeader title={t("approvals")} description={t("approvalsHint")} backHref={`/c/${companySlug}/time`} backLabel={t("title")} />
      {entries.length === 0 ? (
        <EmptyState>{t("noApprovals")}</EmptyState>
      ) : (
        <ActionForm action={decideAction.bind(null, companySlug)} className="space-y-4" showSuccess>
          {[...groups.values()].map((list) => {
            const emp = list[0].employee;
            const sum = list.reduce((s, e) => s.plus(e.hours), D(0));
            return (
              <fieldset key={emp.id} className="rounded-xl border bg-card p-4" data-testid="approval-group">
                <legend className="px-1 text-base font-semibold">
                  {emp.lastName} {emp.firstName} <span className="text-sm font-normal text-muted-foreground">· {t("approvalCount", { count: list.length, hours: fmtH(sum) })}</span>
                </legend>
                <ul className="divide-y">
                  {list.map((e) => (
                    <li key={e.id}>
                      <label className="flex min-h-14 cursor-pointer items-center gap-3 py-2">
                        <input type="checkbox" name="entryIds" value={e.id} defaultChecked className="size-5 accent-primary md:size-4" />
                        <span className="w-28 shrink-0 text-sm tabular-nums">{format.dateTime(e.workDate, { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" })}</span>
                        <span className="w-16 shrink-0 font-semibold tabular-nums">{fmtH(e.hours)} h</span>
                        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                          {e.project.code}
                          {e.site ? ` › ${e.site.name}` : ""}
                          {e.startMinute !== null && e.endMinute !== null ? ` · ${formatClock(e.startMinute)}–${formatClock(e.endMinute)}` : ""}
                          {e.workClass !== "NORMAL" ? ` · ${t(`workClasses.${e.workClass}`)}` : ""}
                          {e.correctionOfId ? ` · ${t("correctionOf")}` : ""}
                          {e.note ? ` · ${e.note}` : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })}
          <div className="sticky bottom-20 z-10 flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm sm:flex-row sm:items-end md:bottom-4">
            <Button type="submit" name="decision" value="APPROVE" className="sm:w-auto">
              {t("approve")}
            </Button>
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm">
                <span className="mb-1 block font-medium">{t("rejectReason")}</span>
                <input name="reason" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm" />
              </label>
              <Button type="submit" name="decision" value="REJECT" variant="destructive">
                {t("reject")}
              </Button>
            </div>
          </div>
        </ActionForm>
      )}
    </>
  );
}
