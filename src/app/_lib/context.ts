import "@/modules/registry"; // V8: tenant scope (row-level security) for all services
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { auth } from "@/platform/auth";
import { isAppError, NotFoundError } from "@/platform/errors";
import type { RequestContext, RequestMeta, UserContext } from "@/platform/authz";
import { LOCALE_COOKIE, toLocale, type AppLocale } from "@/platform/i18n/config";
import { resolveRequestContext, resolveUserContext } from "@/modules/companies/context";

/** Request metadata for audit events (request id is set by src/proxy.ts). */
export const getRequestMeta = cache(async (): Promise<RequestMeta> => {
  const h = await headers();
  return {
    requestId: h.get("x-request-id") ?? randomUUID(),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    userAgent: h.get("user-agent"),
  };
});

export const getLocale = cache(async (): Promise<AppLocale> => toLocale((await cookies()).get(LOCALE_COOKIE)?.value));

export const getSessionUserId = cache(async (): Promise<string | null> => {
  const session = await auth();
  return session?.user?.id ?? null;
});

/** Signed-in user or redirect to sign-in. */
export const requireUserContext = cache(async (): Promise<UserContext> => {
  const userId = await getSessionUserId();
  if (!userId) redirect("/sign-in");
  try {
    return await resolveUserContext(userId, await getRequestMeta(), await getLocale());
  } catch {
    redirect("/sign-in");
  }
});

/**
 * Company context for pages and actions under /c/[companySlug]. The slug is
 * validated against the user's membership on every request; anything else
 * renders 404.
 */
export const requireCompanyContext = cache(async (companySlug: string): Promise<RequestContext> => {
  const userId = await getSessionUserId();
  if (!userId) redirect("/sign-in");
  try {
    return await resolveRequestContext({ userId, companySlug, meta: await getRequestMeta(), locale: await getLocale() });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (isAppError(e) && e.status === 401) redirect("/sign-in");
    throw e;
  }
});

/** Runs a service call from a page; NotFound becomes the 404 page. */
export async function loadOr404<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}
