import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { X } from "lucide-react";
import { teamService } from "@/modules/workforce/team.service";
import { TEAM_COLORS } from "@/modules/workforce/team.schemas";
import { employeeService } from "@/modules/workforce/service";
import { hasPermission } from "@/platform/authz";
import { ActionButton, ActionForm, CheckboxGroupField, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { EmptyState, PageHeader, Section } from "@/ui/components/page";
import { cn } from "@/ui/lib/utils";
import { requireCompanyContext } from "@/app/_lib/context";
import { SWATCH } from "@/app/c/[companySlug]/logistics/_components/task-colors";
import { HrTabs } from "../_components/hr/tabs";
import { hrTabsFor, orForbidden } from "../_components/hr/access";
import { Disclosure } from "../_components/hr/disclosure";
import { teamAddMembersAction, teamArchiveAction, teamCreateAction, teamRemoveMemberAction, teamUpdateAction } from "../team-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("teams"))("title") };
}

/** Teams of employees (ADR 0029). */
export default async function TeamsPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [t, tc, tabs] = await Promise.all([getTranslations("teams"), getTranslations("common"), hrTabsFor(ctx)]);
  const data = await orForbidden(teamService.list(ctx));
  if (!data) {
    return (
      <>
        <PageHeader title={t("title")} />
        <HrTabs slug={companySlug} active="teams" show={tabs} />
        <EmptyState>{t("noAccess")}</EmptyState>
      </>
    );
  }
  const people = data.canManage && hasPermission(ctx, "employee.view") ? (await employeeService.list(ctx)).filter((e) => !e.archivedAt) : [];
  const personOptions = people.map((p) => ({ value: p.id, label: `${p.lastName} ${p.firstName}${p.team ? ` (${p.team})` : ""}` }));
  const colorOptions = TEAM_COLORS.map((c) => ({ value: c, label: t(`colors.${c}`) }));
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <HrTabs slug={companySlug} active="teams" show={tabs} />
      <div className="space-y-4">
        {data.canManage && (
          <Section title={t("create")}>
            <ActionForm action={teamCreateAction.bind(null, companySlug)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="team-form">
              <TextField name="name" label={t("name")} required />
              <SelectField name="leaderId" label={t("leader")} placeholder={t("noLeader")} options={personOptions} />
              <SelectField name="color" label={t("color")} defaultValue="sky" options={colorOptions} />
              <TextField name="description" label={t("description")} />
              <div className="sm:col-span-2 lg:col-span-4">
                <SubmitButton>{t("create")}</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        )}
        {data.teams.length === 0 ? (
          <EmptyState>{t("none")}</EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.teams.map((team) => (
              <Section
                key={team.id}
                title={team.name}
                actions={<span className={cn("inline-block size-3 rounded-full", SWATCH[team.color as keyof typeof SWATCH] ?? "bg-sky-500")} aria-hidden />}
              >
                <div className="space-y-3" data-team={team.name}>
                  {team.description && <p className="text-sm text-muted-foreground">{team.description}</p>}
                  <p className="text-sm">
                    <span className="font-medium">{t("leader")}:</span> {team.leader?.name ?? t("noLeader")}
                  </p>
                  <div>
                    <p className="mb-1 text-sm font-medium">{t("membersN", { count: team.members.length })}</p>
                    {team.members.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
                    ) : (
                      <ul className="flex flex-wrap gap-2" data-testid="team-members">
                        {team.members.map((m) => (
                          <li key={m.id} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-3 text-sm" data-member={m.name}>
                            <Link href={`/c/${companySlug}/workforce/${m.id}`} className="hover:underline">
                              {m.name}
                            </Link>
                            {m.trade && <span className="text-xs text-muted-foreground">{m.trade}</span>}
                            {team.leader?.id === m.id && <span className="rounded bg-primary/10 px-1 text-[10px] font-semibold uppercase">{t("leaderShort")}</span>}
                            {data.canManage && (
                              <ActionButton action={teamRemoveMemberAction.bind(null, companySlug, team.id, m.id)} variant="ghost" className="[&_button]:size-8 [&_button]:p-0">
                                <X className="size-4" aria-hidden />
                                <span className="sr-only">{t("remove", { name: m.name })}</span>
                              </ActionButton>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {data.canManage && (
                    <>
                      <Disclosure summary={t("addMembers")} testId="team-add">
                        <ActionForm action={teamAddMembersAction.bind(null, companySlug, team.id)} className="space-y-3">
                          <p className="text-xs text-muted-foreground">{t("moveHint")}</p>
                          <CheckboxGroupField name="employeeIds" label={t("people")} options={personOptions.filter((o) => !team.members.some((m) => m.id === o.value))} />
                          <SubmitButton>{t("addMembers")}</SubmitButton>
                        </ActionForm>
                      </Disclosure>
                      <Disclosure summary={tc("edit")} testId="team-edit">
                        <ActionForm action={teamUpdateAction.bind(null, companySlug, team.id)} className="grid gap-3 sm:grid-cols-2">
                          <TextField name="name" label={t("name")} defaultValue={team.name} required />
                          <SelectField name="leaderId" label={t("leader")} defaultValue={team.leader?.id ?? ""} placeholder={t("noLeader")} options={personOptions} />
                          <SelectField name="color" label={t("color")} defaultValue={team.color} options={colorOptions} />
                          <TextField name="description" label={t("description")} defaultValue={team.description} />
                          <div className="flex flex-wrap gap-2 sm:col-span-2">
                            <SubmitButton>{tc("save")}</SubmitButton>
                          </div>
                        </ActionForm>
                        <div className="mt-3">
                          <ActionButton action={teamArchiveAction.bind(null, companySlug, team.id)} confirm={t("confirmArchive", { name: team.name })} variant="destructive">
                            {t("archive")}
                          </ActionButton>
                        </div>
                      </Disclosure>
                    </>
                  )}
                </div>
              </Section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
