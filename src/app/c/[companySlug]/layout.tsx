import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { companyDirectoryService } from "@/modules/companies/service";
import { hrCardService } from "@/modules/hr/card.service";
import { canUseAssistant } from "@/modules/assistant/service";
import { AssistantButton } from "@/ui/shell/assistant-button";
import { AppShell } from "@/ui/shell/app-shell";
import { ExternalGuard } from "./_components/external-guard";
import { getLocale, requireCompanyContext, requireUserContext } from "@/app/_lib/context";
import { requireRegistered } from "@/app/_lib/registration";
import { navItems } from "@/app/_lib/nav";
import { setLocaleAction, signOutAction } from "@/app/_lib/shell-actions";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const uctx = await requireUserContext();
  const pathname = (await headers()).get("x-pathname");
  await requireRegistered(uctx, pathname ?? `/c/${companySlug}/dashboard`);
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
      {/* External members (Client, Subcontractor) are kept in the portal. */}
      {ctx.external ? <ExternalGuard portalHref={`/c/${companySlug}/portal`}>{children}</ExternalGuard> : children}
      {canUseAssistant(ctx) && !(pathname ?? "").includes("/assistant") && <AssistantButton href={`/c/${companySlug}/assistant`} label={tc("assistant")} />}
    </AppShell>
  );
}
