"use server";

import { redirect } from "next/navigation";
import { devSignIn, signIn } from "@/platform/auth";
import { RateLimitedError } from "@/platform/errors";
import { getRequestMeta } from "@/app/_lib/context";

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
