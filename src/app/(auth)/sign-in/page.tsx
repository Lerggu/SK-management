import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isDevLoginEnabled, isEntraConfigured } from "@/platform/config/env";
import { listDevLoginUsers } from "@/modules/identity/service";
import { isEmailSignInAvailable } from "@/modules/identity/email-sign-in";
import Image from "next/image";
import { Button } from "@/ui/components/button";
import { getSessionUserId } from "@/app/_lib/context";
import { devSignInAction, entraSignInAction, requestEmailLinkAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth"))("signInTitle") };
}

const ERRORS: Record<string, string> = { not_invited: "errorNotInvited", rate_limited: "errorRateLimited", link_invalid: "errorLinkInvalid" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  if (await getSessionUserId()) redirect("/");
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  const { error, sent } = await searchParams;
  const emailAvailable = isEmailSignInAvailable();
  const devEnabled = isDevLoginEnabled();
  const devUsers = devEnabled ? await listDevLoginUsers() : [];

  return (
    <main className="flex min-h-dvh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <div className="w-full max-w-md space-y-6">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <Image src="/brand/sk-infra-logo-dark.svg" alt="SK Infra" width={207} height={48} priority unoptimized className="h-12 w-auto" />
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{tc("appName")}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t("signInTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("signInSubtitle")}</p>
          {error && (
            <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(ERRORS[error] ?? "errorGeneric")}
            </p>
          )}
          {sent && (
            <p role="status" className="mt-4 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800" data-testid="link-sent">
              {t("linkSent")}
            </p>
          )}
          <div className="mt-6">
            {isEntraConfigured() ? (
              <form action={entraSignInAction}>
                <Button type="submit" size="lg" className="w-full">
                  {t("signInWithMicrosoft")}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">{t("notConfigured")}</p>
            )}
          </div>
          {emailAvailable && (
            <form action={requestEmailLinkAction} className="mt-6 space-y-2 border-t pt-5" data-testid="email-link-form">
              <h2 className="text-sm font-semibold">{t("externalTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("externalHint")}</p>
              <label htmlFor="email-link" className="sr-only">
                {t("email")}
              </label>
              <input id="email-link" name="email" type="email" autoComplete="email" inputMode="email" required placeholder={t("email")} className="h-11 w-full rounded-lg border bg-background px-3 text-base md:text-sm" />
              <Button type="submit" size="lg" variant="outline" className="w-full">
                {t("sendLink")}
              </Button>
            </form>
          )}
        </div>

        {devEnabled && (
          <section className="rounded-2xl border border-dashed border-amber-500/60 bg-amber-50 p-6" aria-labelledby="dev-login">
            <h2 id="dev-login" className="text-base font-semibold">
              {t("devLoginTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("devLoginHint")}</p>
            {devUsers.length === 0 ? (
              <p className="mt-3 text-sm">{t("noDevUsers")}</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {devUsers.map((u) => (
                  <li key={u.id}>
                    <form action={devSignInAction}>
                      <input type="hidden" name="email" value={u.email} />
                      <button
                        type="submit"
                        className="flex min-h-14 w-full flex-col items-start justify-center rounded-lg border bg-background px-4 py-2 text-left hover:bg-muted"
                        data-testid={`dev-login-${u.email}`}
                      >
                        <span className="text-sm font-medium">{u.name ?? u.email}</span>
                        <span className="text-xs text-muted-foreground">
                          {u.email} · {u.companyMemberships.map((m) => `${m.company.name} (${m.roles.map((r) => r.role.name).join(", ")})`).join(" · ")}
                        </span>
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
