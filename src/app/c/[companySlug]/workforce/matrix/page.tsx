import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { hrOverviewService } from "@/modules/hr/overview.service";
import { jobProfileService } from "@/modules/hr/settings.service";
import { EmptyState, PageHeader } from "@/ui/components/page";
import { fmtDate } from "@/ui/format";
import { requireCompanyContext } from "@/app/_lib/context";
import { HrTabs } from "../_components/hr/tabs";
import { hrTabsFor, orForbidden } from "../_components/hr/access";
import { LevelCell } from "../_components/hr/badges";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hr.matrix"))("title") };
}

/** Competence matrix: people in rows, competence areas in columns. */
export default async function MatrixPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ all?: string; team?: string; jobProfileId?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [tabs, t, tl, tw, format] = await Promise.all([hrTabsFor(ctx), getTranslations("hr"), getTranslations("hr.levels"), getTranslations("workforce"), getFormatter()]);
  const [matrix, profiles] = await Promise.all([orForbidden(hrOverviewService.matrix(ctx, { allAreas: sp.all === "1", team: sp.team, jobProfileId: sp.jobProfileId })), orForbidden(jobProfileService.list(ctx))]);
  const levelTitle = (l: number | null | undefined) => (l ? tl(String(l) as "1") : tl("none"));
  const query = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ all: sp.all, team: sp.team, jobProfileId: sp.jobProfileId, ...o }).filter((e): e is [string, string] => !!e[1]));
    const s = p.toString();
    return `/c/${companySlug}/workforce/matrix${s ? `?${s}` : ""}`;
  };
  return (
    <>
      <PageHeader title={t("matrix.title")} description={t("matrix.description")} />
      <HrTabs slug={companySlug} active="matrix" show={tabs} />
      {!matrix ? (
        <EmptyState>{t("basicOnly")}</EmptyState>
      ) : (
        <>
          <form className="mb-3 flex flex-wrap items-end gap-2" role="search">
            {sp.all && <input type="hidden" name="all" value="1" />}
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("search.team")}</span>
              <select name="team" defaultValue={sp.team ?? ""} className="h-11 rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm">
                <option value="">{t("matrix.allTeams")}</option>
                {matrix.teams.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("search.jobProfile")}</span>
              <select name="jobProfileId" defaultValue={sp.jobProfileId ?? ""} className="h-11 rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm">
                <option value="">{t("matrix.allProfiles")}</option>
                {(profiles ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-11 rounded-lg border px-4 text-sm font-medium hover:bg-muted md:h-9">
              {t("matrix.filter")}
            </button>
            <Link href={query({ all: sp.all === "1" ? undefined : "1" })} className="inline-flex h-11 items-center rounded-lg px-3 text-sm text-primary underline-offset-2 hover:underline md:h-9">
              {sp.all === "1" ? t("matrix.keyAreas") : t("matrix.allAreas")}
            </Link>
          </form>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label={t("matrix.legend")}>
            {[null, 1, 2, 3, 4].map((l) => (
              <span key={String(l)} className="inline-flex items-center gap-1">
                <LevelCell level={l} title={levelTitle(l)} className="size-6 text-xs" /> {levelTitle(l)}
              </span>
            ))}
          </div>
          {matrix.areas.length === 0 ? (
            <EmptyState>{t("matrix.noAreas")}</EmptyState>
          ) : matrix.rows.length === 0 ? (
            <EmptyState>{t("matrix.noRows")}</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="text-sm" data-testid="competence-matrix">
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="sticky left-0 z-10 min-w-40 bg-card px-3 py-2 text-left font-medium">
                      {t("matrix.employee")}
                    </th>
                    {matrix.areas.map((a) => (
                      <th key={a.id} scope="col" className="min-w-24 px-2 py-2 text-left align-bottom text-xs font-medium">
                        <span className="block text-muted-foreground">{a.category}</span>
                        {a.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {matrix.rows.map((r) => (
                    <tr key={r.employee.id}>
                      <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal">
                        <Link href={`/c/${companySlug}/workforce/${r.employee.id}?tab=competence`} className="font-medium underline-offset-2 hover:underline">
                          {r.employee.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{[r.employee.jobTitle, r.employee.team].filter(Boolean).join(" · ")}</div>
                      </th>
                      {matrix.areas.map((a) => {
                        const c = r.cells[a.id];
                        const title = c ? `${levelTitle(c.level)} · ${t("matrix.assessedOn", { date: fmtDate(format, c.assessedOn) })}` : t("matrix.notAssessed");
                        return (
                          <td key={a.id} className="px-2 py-2">
                            <LevelCell level={c?.level} title={title} />
                            {c && <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{fmtDate(format, c.assessedOn)}</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{tw("title")}: {matrix.rows.length}</p>
        </>
      )}
    </>
  );
}
