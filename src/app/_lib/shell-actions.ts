"use server";

import { cookies } from "next/headers";
import { signOut } from "@/platform/auth";
import { LOCALE_COOKIE, toLocale } from "@/platform/i18n/config";
import { profileService } from "@/modules/identity/service";
import { requireUserContext } from "./context";

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}

/** Switches UI language (cookie + user preference). */
export async function setLocaleAction(formData: FormData) {
  const locale = toLocale(String(formData.get("locale") ?? ""));
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  const uctx = await requireUserContext();
  await profileService.setLocale(uctx, { locale });
}
