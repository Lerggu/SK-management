"use server";

import { redirect } from "next/navigation";
import { devSignIn, emailLinkSignIn, signIn } from "@/platform/auth";
import { RateLimitedError } from "@/platform/errors";
import { requestEmailSignIn } from "@/modules/identity/email-sign-in";
import { getLocale, getRequestMeta } from "@/app/_lib/context";

export async function devSignInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  try {
    await devSignIn(email, await getRequestMeta());
  } catch (e) {
    redirect(`/sign-in?error=${e instanceof RateLimitedError ? "rate_limited" : "not_invited"}`);
  }
  redirect("/");
}

export async function entraSignInAction() {
  await signIn("microsoft-entra-id", { redirectTo: "/" });
}

/**
 * V7: e-mail sign-in link for external users. The response is the same
 * whether or not the address exists (no user enumeration).
 */
export async function requestEmailLinkAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").slice(0, 200);
  try {
    await requestEmailSignIn(email, await getRequestMeta(), await getLocale());
  } catch (e) {
    if (e instanceof RateLimitedError) redirect("/sign-in?error=rate_limited");
    console.error("e-mail link request failed", (e as Error).message);
  }
  redirect("/sign-in?sent=1");
}

/** Consumes the link token on an explicit POST (mail scanners only GET). */
export async function confirmEmailLinkAction(formData: FormData) {
  try {
    await emailLinkSignIn(String(formData.get("token") ?? ""), await getRequestMeta());
  } catch (e) {
    redirect(`/sign-in?error=${e instanceof RateLimitedError ? "rate_limited" : "link_invalid"}`);
  }
  redirect("/");
}
