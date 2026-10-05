import { getTranslations } from "next-intl/server";

/** GET form choosing the project (no JavaScript needed). */
export async function ProjectPicker({ projects, projectId, extra }: { projects: { id: string; code: string; name: string }[]; projectId: string; extra?: Record<string, string> }) {
  const t = await getTranslations("hse");
  return (
    <form method="get" className="flex flex-wrap items-end gap-2 text-sm" data-testid="project-picker">
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="min-w-0 flex-1 space-y-1 sm:flex-none">
        <span className="block font-medium">{t("project")}</span>
        <select name="project" defaultValue={projectId} className="h-11 w-full rounded-lg border bg-background px-3 md:h-9 sm:w-72">
          {projects.map((p) => (
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
  );
}
