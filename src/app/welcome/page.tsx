import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { profileService } from "@/modules/identity/service";
import { findExternalSignInUser } from "@/modules/identity/email-sign-in";
import { ActionForm, CheckboxField, SelectField, SubmitButton, TextField } from "@/ui/components/form";
import { getSessionUserId, getLocale, requireUserContext } from "@/app/_lib/context";
import { safeNext } from "@/app/_lib/registration";
import { registerAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("welcome"))("title") };
}

/** Registration form shown once, on the first sign-in of an invited person (ADR 0030). */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!(await getSessionUserId())) redirect("/sign-in");
  const { next } = await searchParams;
  const uctx = await requireUserContext();
  const [t, profile, locale, external] = await Promise.all([getTranslations("welcome"), profileService.getProfile(uctx), getLocale(), findExternalSignInUser(uctx.user.email)]);
  const target = safeNext(next);
  if (profile.registeredAt) redirect(target);
  return (
    <main className="flex min-h-dvh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-sm">
        <Image src="/brand/sk-infra-logo-dark.svg" alt="SK Infra" width={207} height={48} priority unoptimized className="h-10 w-auto" />
        <h1 className="mt-4 text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro", { email: profile.email })}</p>
        <ActionForm action={registerAction.bind(null, target)} className="mt-6 space-y-4" data-testid="registration-form">
          <TextField name="name" label={t("name")} defaultValue={profile.name} required autoComplete="name" />
          <TextField name="phone" label={t("phone")} defaultValue={profile.phone} type="tel" inputMode="tel" autoComplete="tel" hint={t("phoneHint")} />
          <TextField name="organization" label={external ? t("organizationExternal") : t("organization")} defaultValue={profile.organization} required={Boolean(external)} autoComplete="organization" />
          <TextField name="jobTitle" label={t("jobTitle")} defaultValue={profile.jobTitle} autoComplete="organization-title" />
          <SelectField name="locale" label={t("language")} defaultValue={profile.locale ?? locale} options={[{ value: "fi", label: "Suomi" }, { value: "en", label: "English" }]} />
          <div className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">{t("privacyTitle")}</p>
            <p>{t("privacyText")}</p>
          </div>
          <CheckboxField name="acceptPrivacy" label={t("acceptPrivacy")} />
          <SubmitButton className="w-full">{t("submit")}</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
