import "server-only";
import { cookies } from "next/headers";
import { isDevLoginEnabled } from "@/platform/config/env";
import { ForbiddenError, UnauthenticatedError } from "@/platform/errors";
import { checkRateLimit, RATE_LIMITS } from "@/platform/ratelimit";
import type { RequestMeta } from "@/platform/authz";
import { createDatabaseSession, findSignInEligibleUser, recordSignIn } from "@/modules/identity/service";
import { sessionCookieName, secureCookiesEnabled } from "./cookies";

/**
 * Development-only credentials login. Creates a normal database session for
 * an invited user. Hard-disabled when NODE_ENV=production (isDevLoginEnabled).
 */
export async function devSignIn(email: string, meta: RequestMeta): Promise<void> {
  if (!isDevLoginEnabled()) throw new ForbiddenError("Dev login is disabled");
  checkRateLimit(RATE_LIMITS.signIn, `dev:${meta.ip ?? "unknown"}`);
  const user = await findSignInEligibleUser(email);
  if (!user) throw new UnauthenticatedError("Not invited");
  const { sessionToken, expires } = await createDatabaseSession(user.id);
  await recordSignIn({ userId: user.id, provider: "dev", subject: user.email, email: user.email, meta });
  (await cookies()).set(sessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
    expires,
  });
}
