import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isAppError } from "@/platform/errors";
import { taskTypeService } from "@/modules/production/service";
import { SERVICE_TYPES } from "@/modules/production/schemas";
import { TASK_COLORS } from "@/modules/production/rules";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { Badge } from "@/ui/components/badge";
import { cn } from "@/ui/lib/utils";
import { requireCompanyContext } from "@/app/_lib/context";
import { ProductionTabs } from "@/app/c/[companySlug]/_components/production-tabs";
import { productionAction, type ProductionOp } from "../production-actions";
import { SWATCH } from "../_components/task-colors";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("production.taskTypes"))("title") };
}

/** Task types and their resource needs (logistics approvers; ADR 0026). */
export default async function TaskTypesPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  let options: Awaited<ReturnType<typeof taskTypeService.options>>;
  try {
    options = await taskTypeService.options(ctx);
  } catch (e) {
    if (isAppError(e) && e.status === 403) notFound();
    throw e;
  }
  const [types, t, tl, th, tc] = await Promise.all([taskTypeService.list(ctx), getTranslations("production.taskTypes"), getTranslations("logistics"), getTranslations("hr"), getTranslations("common")]);
  const act = (op: ProductionOp, id = "-") => productionAction.bind(null, companySlug, op, id);
  const levelOptions = (["1", "2", "3", "4"] as const).map((l) => ({ value: l, label: th(`levels.${l}`) }));
  const qName = (id: string | null) => options.qualificationTypes.find((q) => q.id === id)?.name;
  const aName = (id: string | null) => options.areas.find((a) => a.id === id)?.name;
  const eName = (id: string | null) => options.equipmentTypes.find((e) => e.id === id)?.name;
  return (
    <>
      <PageHeader title={t("title")} description={t("hint")} actions={<ActionButton action={act("typeSuggested")}>{t("addSuggested")}</ActionButton>} />
      <ProductionTabs ctx={ctx} active="taskTypes" />
      <div className="space-y-4">
        {types.length === 0 && <EmptyState>{t("none")}</EmptyState>}
        {types.map((type) => (
          <Section
            key={type.id}
            title={type.name}
            actions={
              <span className="flex items-center gap-2">
                <span className={cn("inline-block size-3 rounded-full", SWATCH[type.color])} aria-hidden />
                <Badge variant="secondary" className="rounded-md">
                  {tl(`serviceTypes.${type.serviceType}`)}
                </Badge>
                <ActionButton action={act("typeArchive", type.id)} variant="ghost" confirm={tc("confirmArchive")}>
                  {tc("archive")}
                </ActionButton>
              </span>
            }
          >
            <div data-testid={`task-type-${type.name}`}>
              {type.roles.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noRoles")}</p>
              ) : (
                <ul className="divide-y text-sm">
                  {type.roles.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 py-2" data-role={r.label}>
                      <span className="font-medium">
                        {r.quantity} × {r.label}
                      </span>
                      <span className="flex-1 text-xs text-muted-foreground">
                        {[
                          r.kind === "EQUIPMENT" ? eName(r.equipmentTypeId) : null,
                          qName(r.qualificationTypeId) && `${t("card")}: ${qName(r.qualificationTypeId)}`,
                          aName(r.areaId) && `${aName(r.areaId)} ≥ ${r.minLevel}`,
                          r.trade && `${t("trade")}: ${r.trade}`,
                          r.minWeightKg !== null && `≥ ${r.minWeightKg} kg`,
                          r.maxWeightKg !== null && `≤ ${r.maxWeightKg} kg`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <ActionButton action={act("roleRemove", r.id)} variant="ghost">
                        {tc("remove")}
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-3 rounded-lg border bg-muted/20" data-testid="add-role">
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-primary md:min-h-9">{t("addRole")}</summary>
                <ActionForm action={act("roleAdd", type.id)} className="grid gap-3 border-t p-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SelectField name="kind" label={t("kind")} defaultValue="PERSON" options={(["PERSON", "EQUIPMENT"] as const).map((k) => ({ value: k, label: t(`kinds.${k}`) }))} />
                  <TextField name="label" label={t("label")} required />
                  <TextField name="quantity" label={t("quantity")} type="number" inputMode="numeric" min={1} max={20} defaultValue={1} />
                  <SelectField name="qualificationTypeId" label={t("card")} placeholder="–" options={options.qualificationTypes.map((q) => ({ value: q.id, label: q.name }))} />
                  <SelectField name="areaId" label={t("competence")} placeholder="–" options={options.areas.map((a) => ({ value: a.id, label: `${a.category} · ${a.name}` }))} />
                  <SelectField name="minLevel" label={t("minLevel")} placeholder="–" options={levelOptions} />
                  <TextField name="trade" label={t("trade")} />
                  <SelectField name="equipmentTypeId" label={t("equipmentType")} placeholder="–" options={options.equipmentTypes.map((e) => ({ value: e.id, label: e.name }))} />
                  <TextField name="minWeightKg" label={t("minWeight")} inputMode="decimal" />
                  <TextField name="maxWeightKg" label={t("maxWeight")} inputMode="decimal" />
                  <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">{t("roleHint")}</p>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <SubmitButton>{tc("add")}</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </div>
          </Section>
        ))}
        <Section title={t("addType")}>
          <ActionForm action={act("typeCreate")} className="grid gap-3 sm:grid-cols-3" data-testid="add-type">
            <TextField name="name" label={t("name")} required />
            <SelectField name="serviceType" label={tl("serviceType")} defaultValue="OTHER" options={SERVICE_TYPES.map((s) => ({ value: s, label: tl(`serviceTypes.${s}`) }))} />
            <SelectField name="color" label={t("color")} defaultValue="slate" options={TASK_COLORS.map((c) => ({ value: c, label: t(`colors.${c}`) }))} />
            <div className="sm:col-span-3">
              <SubmitButton>{tc("add")}</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
