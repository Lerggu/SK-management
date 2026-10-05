import "server-only";
import { cookies } from "next/headers";
import type { RequestMeta } from "@/platform/authz";
import { consumeEmailSignIn } from "@/modules/identity/email-sign-in";
import { sessionCookieName, secureCookiesEnabled } from "./cookies";

/** V7: completes an e-mail link sign-in and sets the session cookie. */
export async function emailLinkSignIn(token: string, meta: RequestMeta): Promise<void> {
  const { sessionToken, expires } = await consumeEmailSignIn(token, meta);
  (await cookies()).set(sessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
    expires,
  });
}
