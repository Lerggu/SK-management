import { getFormatter, getTranslations } from "next-intl/server";
import { ALL_PERMISSIONS, COMPANY_ONLY_PERMISSIONS, EXTERNAL_ONLY_PERMISSIONS, hasPermission, PERMISSIONS, SENSITIVE_PERMISSIONS } from "@/platform/authz";
import { companyAdminService } from "@/modules/companies/service";
import { Badge } from "@/ui/components/badge";
import { codeKey } from "@/ui/format";
import { ActionButton, ActionForm, CheckboxGroupField, SubmitButton, TextField } from "@/ui/components/form";
import { PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SettingsNav } from "../_components/settings-nav";
import { inviteMemberAction, resendInviteAction, setMemberPermissionsAction, setMemberStatusAction, updateMemberRolesAction } from "../actions";

export default async function MembersPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [members, roles, t, format] = await Promise.all([loadOr404(companyAdminService.listMembers(ctx)), companyAdminService.listRoles(ctx), getTranslations("settings"), getFormatter()]);
  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }));
  const canGrant = hasPermission(ctx, "company.roles.manage");
  const categories = [...new Set(ALL_PERMISSIONS.map((p) => PERMISSIONS[p].category))];
  /** Extra permissions a member may receive: never portal ones; for external members never sensitive or company-wide ones. */
  const grantable = (external: boolean) => ALL_PERMISSIONS.filter((p) => !EXTERNAL_ONLY_PERMISSIONS.has(p) && (!external || (!SENSITIVE_PERMISSIONS.has(p) && !COMPANY_ONLY_PERMISSIONS.has(p))));
  return (
    <>
      <PageHeader title={t("title")} description={ctx.company.name} />
      <SettingsNav ctx={ctx} active="members" />
      <div className="space-y-4">
        <Section title={t("invite")}>
          <p className="mb-3 text-sm text-muted-foreground">{t("inviteHint")}</p>
          <ActionForm action={inviteMemberAction.bind(null, companySlug)} className="grid gap-4 sm:grid-cols-2" showSuccess>
            <TextField name="email" label={t("email")} type="email" inputMode="email" autoCapitalize="none" required />
            <TextField name="name" label={t("name")} />
            <div className="sm:col-span-2">
              <CheckboxGroupField name="roleIds" label={t("memberRoles")} options={roleOptions} />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton>{t("invite")}</SubmitButton>
            </div>
          </ActionForm>
        </Section>
        <Section title={t("members")}>
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.id} className="py-4">
                <details>
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2">
                    <span className="flex-1 font-medium">
                      {m.user.name ?? m.user.email}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {m.user.email} · {t("lastSignIn")}: {m.user.lastSignInAt ? fmtDateTime(format, m.user.lastSignInAt) : t("never")}
                      </span>
                      {(m.user.organization || m.user.phone || m.user.jobTitle) && (
                        <span className="block text-xs font-normal text-muted-foreground" data-testid="member-registration">
                          {[m.user.organization, m.user.jobTitle, m.user.phone].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-muted-foreground">{m.roles.map((r) => r.role.name).join(", ")}</span>
                    {m.external && <Badge variant="secondary">{t("external")}</Badge>}
                    {m.extraPermissions.length > 0 && <Badge variant="outline">{t("extraPermissionsN", { count: m.extraPermissions.length })}</Badge>}
                    {!m.user.registeredAt && m.status !== "INVITED" && <Badge variant="outline">{t("notRegistered")}</Badge>}
                    <StatusBadge status={m.status} label={t(`memberStatuses.${m.status}`)} />
                  </summary>
                  <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
                    {m.user.registeredAt && (
                      <p className="text-xs text-muted-foreground">
                        {t("registeredAt")}: {fmtDateTime(format, m.user.registeredAt)}
                      </p>
                    )}
                    <ActionForm action={updateMemberRolesAction.bind(null, companySlug, m.id)} className="space-y-3" showSuccess>
                      <CheckboxGroupField name="roleIds" label={t("memberRoles")} options={roleOptions} defaultValues={m.roles.map((r) => r.role.id)} />
                      <SubmitButton variant="outline">{t("saveRoles")}</SubmitButton>
                    </ActionForm>
                    {canGrant && (
                      <details className="rounded-lg border bg-card p-3" data-testid="extra-permissions">
                        <summary className="cursor-pointer text-sm font-medium">{t("extraPermissions")}</summary>
                        <p className="mt-2 text-xs text-muted-foreground">{m.external ? t("extraPermissionsExternalHint") : t("extraPermissionsHint")}</p>
                        <ActionForm action={setMemberPermissionsAction.bind(null, companySlug, m.id)} className="mt-3 space-y-3" showSuccess>
                          <div className="grid gap-3 md:grid-cols-2">
                            {categories.map((cat) => {
                              const keys = grantable(m.external).filter((p) => PERMISSIONS[p].category === cat);
                              if (keys.length === 0) return null;
                              return (
                                <fieldset key={cat} className="space-y-1">
                                  <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`permissionCategories.${cat}`)}</legend>
                                  {keys.map((p) => (
                                    <label key={p} className="flex min-h-11 items-center gap-3 rounded-md px-1 text-sm md:min-h-8">
                                      <input type="checkbox" name="permissionKeys" value={p} defaultChecked={m.extraPermissions.includes(p)} className="size-5 accent-primary md:size-4" />
                                      <span>{t(`permissions.${codeKey(p)}`)}</span>
                                      {SENSITIVE_PERMISSIONS.has(p) && <Badge variant="outline" className="text-[10px]">{t("sensitive")}</Badge>}
                                    </label>
                                  ))}
                                </fieldset>
                              );
                            })}
                          </div>
                          <SubmitButton variant="outline">{t("saveExtraPermissions")}</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                    {m.user.id !== ctx.user.id && m.status !== "INVITED" && (
                      <ActionButton action={setMemberStatusAction.bind(null, companySlug, m.id, m.status === "DISABLED" ? "ACTIVE" : "DISABLED")} variant={m.status === "DISABLED" ? "outline" : "destructive"}>
                        {m.status === "DISABLED" ? t("enable") : t("disable")}
                      </ActionButton>
                    )}
                  </div>
                </details>
                {m.status === "INVITED" && (
                  <div className="mt-2" data-testid="resend-invite">
                    <ActionButton action={resendInviteAction.bind(null, companySlug, m.id)} showSuccess>
                      {t("resendInvite")}
                    </ActionButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
