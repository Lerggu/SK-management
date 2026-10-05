import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { lookaheadService } from "@/modules/takt/lookahead.service";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { cn } from "@/ui/lib/utils";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("takt"))("lookaheadTitle") };
}

type Props = { params: Promise<{ companySlug: string }>; searchParams: Promise<{ weeks?: string; project?: string; from?: string }> };

function isoWeek(s: string) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

export default async function LookaheadPage({ params, searchParams }: Props) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const weeks = sp.weeks === "6" || sp.weeks === "12" ? sp.weeks : "2";
  const la = await loadOr404(lookaheadService.compute(ctx, { weeks, projectId: sp.project ?? null, from: sp.from ?? null }));
  const t = await getTranslations("takt");
  const base = `/c/${companySlug}/takt/lookahead`;
  const q = (w: string) => `${base}?weeks=${w}${sp.project ? `&project=${sp.project}` : ""}${sp.from ? `&from=${sp.from}` : ""}`;
  const groups = (["TRADE", "EQUIPMENT_TYPE"] as const).map((k) => ({ kind: k, rows: la.rows.filter((r) => r.kind === k) })).filter((g) => g.rows.length);

  return (
    <>
      <PageHeader title={t("lookaheadTitle")} description={`${la.from} – ${la.to}`} backHref={`/c/${companySlug}/takt`} backLabel={t("title")} />
      <div className="space-y-4">
        <Section title={t("lookahead")}>
          <p className="mb-4 text-sm text-muted-foreground">{t("lookaheadHint")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <nav className="flex flex-wrap gap-2" aria-label={t("lookahead")}>
              {["2", "6", "12"].map((w) => (
                <Link
                  key={w}
                  href={q(w)}
                  aria-current={weeks === w ? "page" : undefined}
                  className={cn("inline-flex min-h-11 items-center rounded-lg border px-3 text-sm", weeks === w ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted")}
                >
                  {t(`weeks.${w}`)}
                </Link>
              ))}
            </nav>
            <form method="get" className="ml-auto flex flex-wrap items-end gap-2 text-sm">
              <input type="hidden" name="weeks" value={weeks} />
              <label className="space-y-1">
                <span className="block font-medium">{t("project")}</span>
                <select name="project" defaultValue={sp.project ?? ""} className="h-11 rounded-lg border bg-background px-3 md:h-9">
                  <option value="">{t("allProjects")}</option>
                  {la.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="h-11 rounded-lg border px-4 md:h-9">
                {t("show")}
              </button>
            </form>
          </div>
          <p className="mt-3 text-sm font-medium" data-testid="shortage-count">
            {t("shortages", { count: la.shortages })}
          </p>
        </Section>

        {groups.length === 0 ? (
          <EmptyState>{t("noDemand")}</EmptyState>
        ) : (
          groups.map((g) => (
            <Section key={g.kind} title={t(`kinds.${g.kind}`)}>
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full text-sm" data-testid={`lookahead-${g.kind}`}>
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="sticky left-0 bg-card py-2 pr-2 font-medium">{t("resource")}</th>
                      <th className="py-2 pr-2 text-right font-medium">{t("capacity")}</th>
                      {la.weekStarts.map((w) => (
                        <th key={w} className="min-w-14 py-2 text-center font-medium">
                          {t("weekShort", { week: isoWeek(w) })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.key} className="border-b last:border-0" data-resource={r.label}>
                        <th scope="row" className="sticky left-0 bg-card py-2 pr-2 text-left font-normal">
                          <span className="font-medium">{r.label}</span>
                          {r.lifting && <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-900">{t("lifting")}</span>}
                          <span className="block text-xs text-muted-foreground">{t("activitiesCount", { count: r.activities })}</span>
                        </th>
                        <td className="py-2 pr-2 text-right tabular-nums">{r.capacity}</td>
                        {r.cells.map((c) => (
                          <td
                            key={c.weekStart}
                            title={`${t("peakTitle", { peak: c.peak, days: c.days, shortage: c.shortage })} · ${t("booked", { count: c.booked })}`}
                            className={cn("py-2 text-center tabular-nums", c.peak === 0 && "text-muted-foreground", c.shortage > 0 && "bg-red-50 font-semibold text-red-800")}
                            data-shortage={c.shortage > 0 || undefined}
                          >
                            {c.peak || "·"}
                            {c.shortage > 0 && <span className="block text-[10px]">−{c.shortage}</span>}
                            {c.booked > 0 && <span className="block text-[10px] font-normal text-emerald-800">{t("booked", { count: c.booked })}</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ))
        )}
      </div>
    </>
  );
}
