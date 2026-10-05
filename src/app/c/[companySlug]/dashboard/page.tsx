import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { AlertTriangle, BookOpen, ClipboardCheck, Clock, FileText, FolderKanban, MapPin, Plus, Truck, Users } from "lucide-react";
import { hasPermission, projectIdsWithPermission, projectPermissions } from "@/platform/authz";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { timesheetService } from "@/modules/timesheets/service";
import { projectService, siteService } from "@/modules/projects/service";
import { D } from "@/modules/finance/calculations";
import { hasTimeAccess } from "@/app/_lib/nav";
import { openDiaryAction } from "../diary/actions";
import { ActionButton } from "@/ui/components/form";
import { dashboardService } from "@/modules/companies/dashboard";
import { companyAdminService } from "@/modules/companies/service";
import { PageHeader, Section } from "@/ui/components/page";
import { codeKey, fmtDate, fmtDateTime } from "@/ui/format";
import { requireCompanyContext } from "@/app/_lib/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("dashboard"))("title") };
}

function Stat({ label, value, href, icon: Icon }: { label: string; value: number | null; href?: string; icon: typeof Users }) {
  if (value === null) return null;
  const body = (
    <div className="flex h-full items-center gap-3 rounded-xl border bg-card p-4">
      <Icon className="size-6 shrink-0 text-muted-foreground" aria-hidden />
      <div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function DashboardPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const base = `/c/${companySlug}`;
  const [summary, t, ta, format] = await Promise.all([dashboardService.summary(ctx), getTranslations("dashboard"), getTranslations("audit.actions"), getFormatter()]);
  await companyAdminService.rememberCompany(ctx);

  // ── Today (mobile-first site view) ──
  const today = todayInDisplayZone();
  const timeAccess = hasTimeAccess(ctx);
  const myWeek = timeAccess ? await timesheetService.listWeek(ctx, { date: today }).catch(() => null) : null;
  const myHoursToday = myWeek ? myWeek.entries.filter((e) => e.workDate.toISOString().slice(0, 10) === today).reduce((sum, e) => sum.plus(e.hours), D(0)) : null;
  const approveProjects = projectIdsWithPermission(ctx, "timesheet.approve");
  const approvals = approveProjects === undefined || approveProjects.length > 0 ? await timesheetService.listForApproval(ctx).catch(() => []) : null;
  const diarySites: { id: string; label: string }[] = [];
  for (const p of (await projectService.list(ctx)).filter((p) => !p.archivedAt && projectPermissions(ctx, p.id).has("diary.manage")).slice(0, 4)) {
    for (const site of await siteService.list(ctx, p.id)) diarySites.push({ id: site.id, label: `${p.code} › ${site.name}` });
  }
  const showToday = timeAccess || diarySites.length > 0;

  const quick = [
    hasPermission(ctx, "project.manage") && { href: `${base}/projects/new`, label: t("newProject") },
    hasPermission(ctx, "employee.manage") && { href: `${base}/workforce/new`, label: t("newEmployee") },
    hasPermission(ctx, "equipment.manage") && { href: `${base}/equipment/new`, label: t("newEquipment") },
    (hasPermission(ctx, "documents.manage") || ctx.projectGrants.size > 0) && { href: `${base}/documents/new`, label: t("newDocument") },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <>
      <PageHeader title={t("welcome", { name: ctx.user.name ?? ctx.user.email })} description={ctx.company.name} />
      {showToday && (
        <section className="mb-6 rounded-xl border bg-card p-4" aria-labelledby="today" data-testid="today">
          <h2 id="today" className="mb-3 text-base font-semibold">
            {t("today")}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {timeAccess && (
              <Link href={`${base}/time`} className="flex min-h-14 items-center gap-3 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground hover:bg-primary/90">
                <Clock className="size-5" aria-hidden />
                <span className="flex-1">{t("logHours")}</span>
                {myHoursToday && <span className="text-sm font-normal opacity-90">{t("myHoursToday", { hours: format.number(Number(myHoursToday.toString()), { maximumFractionDigits: 2 }) })}</span>}
              </Link>
            )}
            {approvals && approvals.length > 0 && (
              <Link href={`${base}/time/approvals`} className="flex min-h-14 items-center gap-3 rounded-xl border px-4 text-sm font-medium hover:bg-muted">
                <ClipboardCheck className="size-5 text-primary" aria-hidden />
                {t("approvalsWaiting", { count: approvals.length })}
              </Link>
            )}
          </div>
          {diarySites.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-sm text-muted-foreground">{t("diaryToday")}</p>
              <div className="flex flex-wrap gap-2">
                {diarySites.map((site) => (
                  <ActionButton key={site.id} action={openDiaryAction.bind(null, companySlug, site.id, today)} variant="outline">
                    <BookOpen aria-hidden /> {site.label}
                  </ActionButton>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("projects")} value={summary.projects} href={`${base}/projects`} icon={FolderKanban} />
        <Stat label={t("sites")} value={summary.sites} icon={MapPin} />
        <Stat label={t("employees")} value={summary.employees} href={`${base}/workforce`} icon={Users} />
        <Stat label={t("equipment")} value={summary.equipment} href={`${base}/equipment`} icon={Truck} />
        <Stat label={t("pendingApprovals")} value={summary.pendingApprovals} href={`${base}/documents`} icon={FileText} />
      </div>

      {quick.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("quickActions")}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {quick.map((q) => (
              <Link key={q.href} href={q.href} className="flex min-h-12 items-center gap-2 rounded-xl border bg-card px-4 text-sm font-medium hover:bg-muted">
                <Plus className="size-4" aria-hidden />
                {q.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {summary.inspectionsDue && (
          <Section title={t("inspectionsDue")}>
            {summary.inspectionsDue.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noInspections")}</p>
            ) : (
              <ul className="divide-y">
                {summary.inspectionsDue.map((e) => {
                  const overdue = e.nextInspectionDate && e.nextInspectionDate < new Date();
                  return (
                    <li key={e.id}>
                      <Link href={`${base}/equipment/${e.id}`} className="flex min-h-12 items-center gap-2 py-2 text-sm hover:underline">
                        {overdue && <AlertTriangle className="size-4 text-amber-600" aria-hidden />}
                        <span className="flex-1">
                          {e.assetNumber} · {e.name}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{fmtDate(format, e.nextInspectionDate)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        )}
        {summary.recentAudit && (
          <Section title={t("recentActivity")}>
            <ul className="divide-y text-sm">
              {summary.recentAudit.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
                  <span>{ta.has(codeKey(e.action)) ? ta(codeKey(e.action)) : e.action}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtDateTime(format, e.occurredAt)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">{t("comingLater")}</p>
    </>
  );
}
