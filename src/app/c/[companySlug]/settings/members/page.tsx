import { getFormatter, getTranslations } from "next-intl/server";
import { companyAdminService } from "@/modules/companies/service";
import { ActionButton, ActionForm, CheckboxGroupField, SubmitButton, TextField } from "@/ui/components/form";
import { PageHeader, Section } from "@/ui/components/page";
import { StatusBadge } from "@/ui/components/status-badge";
import { fmtDateTime } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SettingsNav } from "../_components/settings-nav";
import { inviteMemberAction, setMemberStatusAction, updateMemberRolesAction } from "../actions";

export default async function MembersPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [members, roles, t, format] = await Promise.all([loadOr404(companyAdminService.listMembers(ctx)), companyAdminService.listRoles(ctx), getTranslations("settings"), getFormatter()]);
  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }));
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
                    </span>
                    <span className="text-sm text-muted-foreground">{m.roles.map((r) => r.role.name).join(", ")}</span>
                    <StatusBadge status={m.status} label={t(`memberStatuses.${m.status}`)} />
                  </summary>
                  <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
                    <ActionForm action={updateMemberRolesAction.bind(null, companySlug, m.id)} className="space-y-3" showSuccess>
                      <CheckboxGroupField name="roleIds" label={t("memberRoles")} options={roleOptions} defaultValues={m.roles.map((r) => r.role.id)} />
                      <SubmitButton variant="outline">{t("saveRoles")}</SubmitButton>
                    </ActionForm>
                    {m.user.id !== ctx.user.id && m.status !== "INVITED" && (
                      <ActionButton action={setMemberStatusAction.bind(null, companySlug, m.id, m.status === "DISABLED" ? "ACTIVE" : "DISABLED")} variant={m.status === "DISABLED" ? "outline" : "destructive"}>
                        {m.status === "DISABLED" ? t("enable") : t("disable")}
                      </ActionButton>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
