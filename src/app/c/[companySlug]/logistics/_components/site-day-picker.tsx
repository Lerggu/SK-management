import { getTranslations } from "next-intl/server";

/** GET form choosing a site and a day (no JavaScript needed). */
export async function SiteDayPicker({ sites, siteId, date, showDate = true }: { sites: { id: string; name: string; project: { code: string } }[]; siteId: string; date?: string; showDate?: boolean }) {
  const t = await getTranslations("logistics");
  return (
    <form method="get" className="flex flex-wrap items-end gap-2 text-sm" data-testid="site-day-picker">
      <label className="min-w-0 flex-1 space-y-1 sm:flex-none">
        <span className="block font-medium">{t("site")}</span>
        <select name="site" defaultValue={siteId} className="h-11 w-full rounded-lg border bg-background px-3 md:h-9 sm:w-64">
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.project.code} · {s.name}
            </option>
          ))}
        </select>
      </label>
      {showDate && (
        <label className="space-y-1">
          <span className="block font-medium">{t("date")}</span>
          <input type="date" name="date" defaultValue={date} className="h-11 rounded-lg border bg-background px-3 md:h-9" />
        </label>
      )}
      <button type="submit" className="h-11 rounded-lg border px-4 md:h-9">
        {t("show")}
      </button>
    </form>
  );
}
