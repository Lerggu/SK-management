import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Pencil, UserRound } from "lucide-react";
import { hasPermission } from "@/platform/authz";
import { employeeService } from "@/modules/workforce/service";
import { hrCardService } from "@/modules/hr/card.service";
import { employeeFileService, hrFileMaxBytes } from "@/modules/hr/files.service";
import { jobProfileService, qualificationTypeService } from "@/modules/hr/settings.service";
import { Button } from "@/ui/components/button";
import { ActionButton, ActionForm, FileField, SubmitButton } from "@/ui/components/form";
import { DetailList, PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDate } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { RatesSection } from "../../_components/rates";
import { LinkedDocuments } from "../../_components/linked-documents";
import { addEmployeeRateAction, archiveEmployeeAction, archiveEmployeeRateAction } from "../actions";
import { hrAction, type HrOp } from "../hr-actions";
import { TabBar } from "../_components/hr/tabs";
import { Disclosure } from "../_components/hr/disclosure";
import { BasicsTab } from "../_components/hr/card-basics";
import { CompetenceTab } from "../_components/hr/card-competence";
import { QualificationsTab } from "../_components/hr/card-qualifications";
import { DocumentsTab, EquipmentTab, LanguagesTab } from "../_components/hr/card-other";
import type { Act } from "../_components/hr/types";

const TABS = ["basics", "competence", "qualifications", "languages", "equipment", "documents"] as const;
type Tab = (typeof TABS)[number];

/** Personnel card ("henkilöstökortti"): sections are shown by the caller's HR access. */
export default async function EmployeePage({ params, searchParams }: { params: Promise<{ companySlug: string; employeeId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { companySlug, employeeId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const card = await loadOr404(hrCardService.get(ctx, employeeId));
  const canViewEmployees = hasPermission(ctx, "employee.view");
  const [t, th, tc, format, employee, files, profiles, types, people, users] = await Promise.all([
    getTranslations("workforce"),
    getTranslations("hr"),
    getTranslations("common"),
    getFormatter(),
    canViewEmployees ? employeeService.get(ctx, employeeId) : Promise.resolve(null),
    card.work ? employeeFileService.list(ctx, employeeId) : Promise.resolve([]),
    card.work ? jobProfileService.list(ctx) : Promise.resolve([]),
    card.work ? qualificationTypeService.list(ctx) : Promise.resolve([]),
    canViewEmployees ? employeeService.list(ctx) : Promise.resolve([]),
    card.can.editEmployment ? hrCardService.linkableUsers(ctx) : Promise.resolve([]),
  ]);
  const act: Act = (op: HrOp, id: string) => hrAction.bind(null, companySlug, op, id);
  const available: Record<Tab, boolean> = {
    basics: true,
    competence: !!card.work,
    qualifications: !!card.work,
    languages: !!card.work,
    equipment: !!card.equipment,
    documents: !!card.work,
  };
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") && available[sp.tab as Tab] ? (sp.tab as Tab) : "basics";
  const base = `/c/${companySlug}/workforce/${employeeId}`;
  const e = card.employee;
  const canManage = hasPermission(ctx, "employee.manage") && !e.archivedAt;
  const peopleOptions = people.map((p) => ({ id: p.id, name: `${p.lastName} ${p.firstName}` }));
  const maxMb = Math.floor(hrFileMaxBytes() / 1024 / 1024);
  const names = {
    areas: Object.fromEntries((card.work?.competence ?? []).map((c) => [c.area.id, c.area.name])),
    types: Object.fromEntries(types.map((x) => [x.id, x.name])),
  };

  return (
    <>
      <PageHeader
        title={`${e.firstName} ${e.lastName}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {e.archivedAt ? <StatusBadge status="ARCHIVED" label={tc("archived")} /> : <StatusBadge status={e.status} label={t(`statuses.${e.status}`)} />}
            {[e.employeeNumber, e.jobTitle ?? e.trade, e.team].filter(Boolean).join(" · ")}
          </span>
        }
        backHref={canViewEmployees ? `/c/${companySlug}/workforce` : undefined}
        backLabel={t("title")}
        actions={
          canManage && (
            <>
              <Button asChild variant="outline">
                <Link href={`${base}/edit`}>
                  <Pencil aria-hidden /> {tc("edit")}
                </Link>
              </Button>
              <ActionButton action={archiveEmployeeAction.bind(null, companySlug, e.id)} confirm={tc("confirmArchive")} variant="destructive">
                {tc("archive")}
              </ActionButton>
            </>
          )
        }
      />

      <div className="mb-4 flex items-start gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted" data-testid="profile-photo">
          {e.photoFileId ? (
            // eslint-disable-next-line @next/next/no-img-element -- authorized private file, not optimizable
            <img src={`/c/${companySlug}/workforce/files/${e.photoFileId}`} alt={th("photo.alt", { name: `${e.firstName} ${e.lastName}` })} className="size-full object-cover" />
          ) : (
            <UserRound className="size-10 text-muted-foreground" aria-hidden />
          )}
        </div>
        {card.can.uploadPhoto && (
          <div className="min-w-0 flex-1">
            <Disclosure summary={th("photo.upload")} testId="photo-upload">
              <ActionForm action={act("photo", e.id)} className="space-y-2">
                <FileField label={th("photo.title")} hint={th("photo.hint", { mb: maxMb })} accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" required />
                <SubmitButton>{th("save")}</SubmitButton>
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </div>

      <TabBar label={th("card")} items={TABS.filter((x) => available[x]).map((x) => ({ key: x, href: x === "basics" ? base : `${base}?tab=${x}`, label: th(`cardTabs.${x}`), active: x === tab }))} />

      {tab === "basics" && (
        <div className="space-y-4">
          <BasicsTab card={card} act={act} supervisors={peopleOptions} profiles={profiles.map((p) => ({ id: p.id, name: p.name }))} existingTeams={[...new Set(people.map((p) => p.team).filter((x): x is string => !!x))]} existingLocations={[...new Set(people.map((p) => p.location).filter((x): x is string => !!x))]} names={names} users={users} />
          {employee && (
            <Section title={tc("details")}>
              <DetailList
                items={[
                  { label: t("employmentType"), value: t(`employmentTypes.${employee.employmentType}`) },
                  { label: t("trade"), value: employee.trade },
                  { label: t("startDate"), value: fmtDate(format, employee.startDate) },
                  { label: t("notes"), value: employee.notes },
                ]}
              />
            </Section>
          )}
          {employee && "rates" in employee && (
            <RatesSection
              rates={employee.rates}
              current={employee.currentRates}
              canManage={hasPermission(ctx, "employee.rates.manage") && !employee.archivedAt}
              addAction={addEmployeeRateAction.bind(null, companySlug, employee.id)}
              archiveAction={(rateId: string) => archiveEmployeeRateAction.bind(null, companySlug, employee.id, rateId)}
              defaultCurrency={ctx.company.defaultCurrency}
            />
          )}
          {employee && <LinkedDocuments ctx={ctx} entityType="EMPLOYEE" entityId={employee.id} title={t("documents")} />}
        </div>
      )}
      {tab === "competence" && <CompetenceTab card={card} act={act} people={peopleOptions} />}
      {tab === "qualifications" && <QualificationsTab slug={companySlug} card={card} act={act} files={files} types={types.map((x) => ({ id: x.id, name: x.name }))} />}
      {tab === "languages" && <LanguagesTab card={card} act={act} />}
      {tab === "equipment" && <EquipmentTab slug={companySlug} card={card} act={act} files={files} />}
      {tab === "documents" && <DocumentsTab slug={companySlug} card={card} act={act} files={files} maxMb={maxMb} />}
    </>
  );
}
