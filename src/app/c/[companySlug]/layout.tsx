import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { companyDirectoryService } from "@/modules/companies/service";
import { hrCardService } from "@/modules/hr/card.service";
import { AppShell } from "@/ui/shell/app-shell";
import { getLocale, requireCompanyContext, requireUserContext } from "@/app/_lib/context";
import { externalPathAllowed, navItems } from "@/app/_lib/nav";
import { setLocaleAction, signOutAction } from "@/app/_lib/shell-actions";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  // External members (Client, Subcontractor) are kept in the portal.
  if (!externalPathAllowed(ctx, (await headers()).get("x-pathname"))) redirect(`/c/${companySlug}/portal`);
  const uctx = await requireUserContext();
  const [companies, t, tc, tl, locale, myEmployeeId] = await Promise.all([
    companyDirectoryService.listMyCompanies(uctx),
    getTranslations("nav"),
    getTranslations("common"),
    getTranslations("locale"),
    getLocale(),
    hrCardService.myEmployeeId(ctx),
  ]);

  return (
    <AppShell
      company={{ name: ctx.company.name, slug: ctx.company.slug }}
      companies={companies.map((c) => ({ name: c.name, slug: c.slug }))}
      user={{ name: ctx.user.name, email: ctx.user.email }}
      nav={navItems(ctx, { myEmployeeId }).map((i) => ({ ...i, label: t(i.key) }))}
      locale={locale}
      labels={{
        appName: tc("appName"),
        mainNav: t("main"),
        more: t("more"),
        switchCompany: t("switchCompany"),
        allCompanies: t("allCompanies"),
        signOut: tc("signOut"),
        language: tc("language"),
        fi: tl("fi"),
        en: tl("en"),
      }}
      signOutAction={signOutAction}
      setLocaleAction={setLocaleAction}
    >
      {children}
    </AppShell>
  );
}
