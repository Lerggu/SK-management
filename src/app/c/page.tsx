import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Building2, ChevronRight } from "lucide-react";
import { companyDirectoryService } from "@/modules/companies/service";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { requireUserContext } from "@/app/_lib/context";
import { signOutAction } from "@/app/_lib/shell-actions";
import { createCompanyAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("companies"))("selectTitle") };
}

export default async function CompanyPickerPage() {
  const uctx = await requireUserContext();
  const t = await getTranslations("companies");
  const tc = await getTranslations("common");
  const [companies, orgs] = await Promise.all([companyDirectoryService.listMyCompanies(uctx), companyDirectoryService.listCreatableOrganizations(uctx)]);

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("selectTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("selectSubtitle")}</p>
      </div>
      {companies.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {companies.map((c) => (
            <li key={c.id}>
              <Link href={`/c/${c.slug}/dashboard`} className="flex min-h-16 items-center gap-3 px-4 hover:bg-muted" data-testid={`company-${c.slug}`}>
                <Building2 className="size-5 text-muted-foreground" aria-hidden />
                <span className="flex-1 font-medium">{c.name}</span>
                <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {orgs.length > 0 && (
        <section className="rounded-xl border bg-card p-4 md:p-6">
          <h2 className="mb-4 text-lg font-semibold">{t("createTitle")}</h2>
          <ActionForm action={createCompanyAction} className="grid gap-4 sm:grid-cols-2">
            <SelectField name="organizationId" label={t("organization")} options={orgs.map((o) => ({ value: o.id, label: o.name }))} defaultValue={orgs[0].id} required className="sm:col-span-2" />
            <TextField name="name" label={t("name")} required />
            <TextField name="slug" label={t("slug")} hint={t("slugHint")} required autoCapitalize="none" />
            <TextField name="businessId" label={t("businessId")} />
            <div className="sm:col-span-2">
              <SubmitButton>{tc("create")}</SubmitButton>
            </div>
          </ActionForm>
        </section>
      )}

      <form action={signOutAction}>
        <button type="submit" className="min-h-11 text-sm text-muted-foreground underline-offset-4 hover:underline">
          {tc("signOut")}
        </button>
      </form>
    </main>
  );
}
