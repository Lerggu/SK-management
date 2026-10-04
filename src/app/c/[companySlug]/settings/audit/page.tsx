import { getFormatter, getTranslations } from "next-intl/server";
import { companyAdminService } from "@/modules/companies/service";
import { EmptyState, PageHeader } from "@/ui/components/page";
import { codeKey, fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SettingsNav } from "../_components/settings-nav";

function Delta({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (!keys.length) return null;
  const show = (v: unknown) => (v === null || v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <dl className="mt-1 grid gap-0.5 text-xs">
      {keys.map((k) => (
        <div key={k} className="break-all">
          <dt className="inline font-medium">{k}: </dt>
          <dd className="inline text-muted-foreground">
            {k in b && <span className="line-through">{show(b[k])}</span>}
            {k in b && k in a && " → "}
            {k in a && <span className="text-foreground">{show(a[k])}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AuditPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ entityType?: string }> }) {
  const { companySlug } = await params;
  const { entityType } = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const [events, t, ta, format] = await Promise.all([loadOr404(companyAdminService.listAuditEvents(ctx, { entityType: entityType ?? null, limit: 200 })), getTranslations("settings"), getTranslations("audit.actions"), getFormatter()]);
  return (
    <>
      <PageHeader title={t("audit")} description={t("auditHint")} />
      <SettingsNav ctx={ctx} active="audit" />
      {events.length === 0 ? (
        <EmptyState>{t("noAudit")}</EmptyState>
      ) : (
        <ol className="divide-y rounded-xl border bg-card" data-testid="audit-list">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
              <time className="w-36 shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={e.occurredAt.toISOString()}>
                {fmtDateTime(format, e.occurredAt)}
              </time>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{ta.has(codeKey(e.action)) ? ta(codeKey(e.action)) : e.action}</div>
                <div className="text-xs text-muted-foreground">
                  {e.actor ? (e.actor.name ?? e.actor.email) : t("system")} · {e.entityType}
                  {e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ""}
                </div>
                <Delta before={e.before} after={e.after} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
