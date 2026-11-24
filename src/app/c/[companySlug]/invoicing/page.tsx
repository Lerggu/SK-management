import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";
import { salesDocumentService } from "@/modules/sales/service";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate, fmtMoney } from "@/ui/format";
import { cn } from "@/ui/lib/utils";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { createDocumentAction } from "./actions";
import { TONE, shownStatus } from "./_components/tone";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("invoicing"))("title") };
}

const KINDS = ["ORDER_CONFIRMATION", "INVOICE", "CREDIT_NOTE"] as const;
type Kind = (typeof KINDS)[number];

export default async function InvoicingPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ kind?: string; q?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const kind = KINDS.includes(sp.kind as Kind) ? (sp.kind as Kind) : undefined;
  const [t, format, options, rows] = await Promise.all([
    getTranslations("invoicing"),
    getFormatter(),
    loadOr404(salesDocumentService.options(ctx)),
    loadOr404(salesDocumentService.list(ctx, { kind, q: sp.q ?? null })),
  ]);
  const base = `/c/${companySlug}/invoicing`;
  const href = (k?: Kind) => `${base}${k ? `?kind=${k}` : ""}`;
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        actions={
          (options.canConfigure || options.enabled) && (
            <Link href={`${base}/settings`} className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm md:h-9">
              <Settings className="size-4" aria-hidden />
              {t("settings.title")}
            </Link>
          )
        }
      />
      <div className="space-y-4">
        {!options.enabled ? (
          <Section title={t("notEnabledTitle")}>
            <p className="text-sm text-muted-foreground">{options.canConfigure ? t("notEnabledAdmin") : t("notEnabled")}</p>
            {options.canConfigure && (
              <Link href={`${base}/settings`} className="mt-3 inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9">
                {t("setup")}
              </Link>
            )}
          </Section>
        ) : (
          <Section title={t("new")}>
            <ActionForm action={createDocumentAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:items-end" data-testid="invoicing-create-form">
              <SelectField
                name="kind"
                label={t("kind")}
                options={[
                  { value: "ORDER_CONFIRMATION", label: t("kinds.ORDER_CONFIRMATION") },
                  { value: "INVOICE", label: t("kinds.INVOICE") },
                ]}
                defaultValue={kind === "INVOICE" ? "INVOICE" : "ORDER_CONFIRMATION"}
              />
              <SelectField name="termsType" label={t("fields.termsType")} options={(["RENTAL", "SALE", "NONE"] as const).map((v) => ({ value: v, label: t(`termsTypes.${v}`) }))} defaultValue="NONE" />
              <SelectField name="customerId" label={t("customer")} placeholder={t("typeBuyer")} options={options.customers.map((c) => ({ value: c.id, label: c.businessId ? `${c.name} (${c.businessId})` : c.name }))} />
              <TextField name="buyerName" label={t("buyerNameNew")} hint={t("buyerNameHint")} />
              <SelectField name="projectId" label={t("fields.project")} placeholder={t("none")} options={options.projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} />
              <TextField name="title" label={t("fields.title")} />
              <div className="sm:col-span-2 lg:col-span-3">
                <SubmitButton>{t("create")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}

        <Section title={t("documents")}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <nav className="flex flex-wrap gap-1" aria-label={t("kind")}>
              {[undefined, ...KINDS].map((k) => (
                <Link
                  key={k ?? "all"}
                  href={href(k)}
                  aria-current={k === kind ? "page" : undefined}
                  className={cn("inline-flex h-11 items-center rounded-full border px-4 text-sm md:h-8", k === kind ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  {k ? t(`kindsPlural.${k}`) : t("all")}
                </Link>
              ))}
            </nav>
            <form method="get" className="ml-auto flex w-full gap-2 sm:w-auto">
              {kind && <input type="hidden" name="kind" value={kind} />}
              <input name="q" defaultValue={sp.q ?? ""} placeholder={t("search")} className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm md:h-9 sm:w-64" />
              <button type="submit" className="h-11 rounded-lg border px-4 text-sm md:h-9">
                {t("searchButton")}
              </button>
            </form>
          </div>
          {rows.length === 0 ? (
            <EmptyState>{t("empty")}</EmptyState>
          ) : (
            <ul className="divide-y" data-testid="invoicing-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`${base}/${r.id}`} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 py-2 hover:bg-muted/50 md:px-2">
                    <span className="w-36 shrink-0 font-medium">
                      {t(`kinds.${r.kind}`)} {r.number ?? <span className="text-muted-foreground">({t("draft")})</span>}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {r.buyerName}
                      {r.title && <span className="text-muted-foreground"> · {r.title}</span>}
                    </span>
                    <span className="text-sm text-muted-foreground">{fmtDate(format, r.issueDate)}</span>
                    <span className="w-28 text-right tabular-nums">{fmtMoney(format, r.total, r.currency)}</span>
                    <StatusBadge status={TONE[shownStatus(r)]} label={t(`statuses.${shownStatus(r)}`)} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
