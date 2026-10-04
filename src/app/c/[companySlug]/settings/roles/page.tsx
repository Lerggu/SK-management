import { getTranslations } from "next-intl/server";
import { hasPermission, PERMISSIONS, ALL_PERMISSIONS, SENSITIVE_PERMISSIONS } from "@/platform/authz";
import { companyAdminService } from "@/modules/companies/service";
import { ActionForm, SubmitButton } from "@/ui/components/form";
import { PageHeader, Section } from "@/ui/components/page";
import { Badge } from "@/ui/components/badge";
import { codeKey } from "@/ui/format";
import { loadOr404, requireCompanyContext } from "@/app/_lib/context";
import { SettingsNav } from "../_components/settings-nav";
import { updateRolePermissionsAction } from "../actions";

const CATEGORIES = ["company", "projects", "workforce", "equipment", "documents"] as const;

export default async function RolesPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const [roles, t] = await Promise.all([loadOr404(companyAdminService.listRoles(ctx)), getTranslations("settings")]);
  const canEdit = hasPermission(ctx, "company.roles.manage");
  return (
    <>
      <PageHeader title={t("roles")} description={t("rolesHint")} />
      <SettingsNav ctx={ctx} active="roles" />
      <div className="space-y-4">
        {roles.map((role) => (
          <Section
            key={role.id}
            title={role.name}
            actions={
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{role.projectAccess === "ALL" ? t("accessAll") : t("accessAssigned")}</Badge>
                {role.external && <Badge variant="secondary">{t("external")}</Badge>}
              </div>
            }
          >
            <ActionForm action={updateRolePermissionsAction.bind(null, companySlug, role.id)} className="space-y-4" showSuccess>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {CATEGORIES.map((cat) => (
                  <fieldset key={cat} className="space-y-1">
                    <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`permissionCategories.${cat}`)}</legend>
                    {ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].category === cat).map((p) => {
                      const sensitive = SENSITIVE_PERMISSIONS.has(p);
                      const locked = !canEdit || (role.external && sensitive);
                      return (
                        <label key={p} className="flex min-h-11 items-center gap-3 rounded-md px-1 text-sm md:min-h-8">
                          <input type="checkbox" name="permissionKeys" value={p} defaultChecked={role.permissions.includes(p)} disabled={locked} className="size-5 accent-primary md:size-4" />
                          <span className={locked ? "text-muted-foreground" : undefined}>{t(`permissions.${codeKey(p)}`)}</span>
                          {sensitive && <Badge variant="outline" className="text-[10px]">{t("sensitive")}</Badge>}
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </div>
              {canEdit && <SubmitButton variant="outline">{t("savePermissions")}</SubmitButton>}
            </ActionForm>
          </Section>
        ))}
      </div>
    </>
  );
}
