import { getFormatter, getTranslations } from "next-intl/server";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField, type FormState } from "@/ui/components/form";
import { EmptyState, Section } from "@/ui/components/page";
import { fmtDate, fmtMoney } from "@/ui/format";

type Action = (state: FormState | null, formData: FormData) => Promise<FormState>;

interface Rate {
  id: string;
  rateType: "COST" | "BILLING";
  unit: "HOUR" | "DAY";
  amount: { toString(): string };
  currency: string;
  validFrom: Date;
  validTo: Date | null;
  archivedAt: Date | null;
}

/** Permissioned rate history with "add rate" form (shared by workforce and equipment). */
export async function RatesSection({
  rates,
  current,
  canManage,
  addAction,
  archiveAction,
  defaultCurrency,
}: {
  rates: Rate[];
  current: { cost: Rate | null; billing: Rate | null };
  canManage: boolean;
  addAction: Action;
  archiveAction: (rateId: string) => Action;
  defaultCurrency: string;
}) {
  const t = await getTranslations("rates");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const label = (r: Rate | null) => (r ? `${fmtMoney(format, r.amount, r.currency)} ${t(`units.${r.unit}`)}` : tc("none"));
  const visible = rates.filter((r) => !r.archivedAt);
  return (
    <Section title={t("title")}>
      <p className="mb-3 text-xs text-muted-foreground">{t("sensitiveHint")}</p>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/60 p-3">
          <div className="text-xs text-muted-foreground">{t("currentCost")}</div>
          <div className="text-lg font-semibold tabular-nums" data-testid="current-cost">{label(current.cost)}</div>
        </div>
        <div className="rounded-lg bg-muted/60 p-3">
          <div className="text-xs text-muted-foreground">{t("currentBilling")}</div>
          <div className="text-lg font-semibold tabular-nums">{label(current.billing)}</div>
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState>{t("noRates")}</EmptyState>
      ) : (
        <ul className="divide-y text-sm">
          {visible.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="w-24 font-medium">{t(`rateTypes.${r.rateType}`)}</span>
              <span className="tabular-nums">{label(r)}</span>
              <span className="flex-1 text-muted-foreground tabular-nums">
                {fmtDate(format, r.validFrom)} – {r.validTo ? fmtDate(format, r.validTo) : ""}
              </span>
              {canManage && (
                <ActionButton action={archiveAction(r.id)} confirm={tc("confirmArchive")} variant="ghost">
                  {tc("archive")}
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <ActionForm action={addAction} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
          <SelectField name="rateType" label={t("rateType")} defaultValue="COST" options={(["COST", "BILLING"] as const).map((v) => ({ value: v, label: t(`rateTypes.${v}`) }))} />
          <SelectField name="unit" label={t("unit")} defaultValue="HOUR" options={(["HOUR", "DAY"] as const).map((v) => ({ value: v, label: t(`unitNames.${v}`) }))} />
          <TextField name="amount" label={t("amount")} inputMode="decimal" required />
          <TextField name="currency" label={t("currency")} defaultValue={defaultCurrency} maxLength={3} />
          <TextField name="validFrom" label={t("validFrom")} type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <TextField name="validTo" label={t("validTo")} type="date" />
          <div className="sm:col-span-3">
            <SubmitButton>{t("addRate")}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Section>
  );
}
