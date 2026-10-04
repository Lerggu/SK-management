import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/platform/auth";
import { isAppError, RateLimitedError, UnauthenticatedError, ValidationError, ForbiddenError } from "@/platform/errors";
import type { RequestContext, UserContext } from "@/platform/authz";
import { resolveRequestContext, resolveUserContext } from "@/modules/companies/context";
import { getLocale, getRequestMeta } from "@/app/_lib/context";

/** JSON-safe serialization (BigInt → number, Decimal → string via toJSON). */
export function json(data: unknown, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), {
    ...init,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...(init?.headers ?? {}) },
  });
}

function errorResponse(e: unknown) {
  if (isAppError(e)) {
    const body: Record<string, unknown> = { code: e.code, message: e.message };
    if (e instanceof ValidationError) body.fieldErrors = e.fieldErrors;
    const headers: Record<string, string> = e instanceof RateLimitedError ? { "Retry-After": String(e.retryAfterSeconds) } : {};
    return json({ error: body }, { status: e.status, headers });
  }
  console.error("Unhandled API error", e);
  return json({ error: { code: "internal_error", message: "Internal error" } }, { status: 500 });
}

/**
 * CSRF defence for cookie-authenticated writes: require a JSON body (which a
 * cross-site form cannot send without a CORS preflight) and a same-origin
 * Origin header when present.
 */
function assertSafeWrite(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ForbiddenError("Cross-origin request");
  if (request.method !== "DELETE" && !request.headers.get("content-type")?.includes("application/json")) {
    throw new ValidationError({ _form: ["validation.invalidFormat"] }, "Content-Type must be application/json");
  }
}

async function sessionUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthenticatedError();
  return session.user.id;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError({ _form: ["validation.invalidFormat"] }, "Invalid JSON body");
  }
}

export function withUser(fn: (uctx: UserContext, request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      assertSafeWrite(request);
      const uctx = await resolveUserContext(await sessionUserId(), await getRequestMeta(), await getLocale());
      return await fn(uctx, request);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Company-scoped API handler: the slug is validated against the session user's membership. */
export function withCompany<P extends { companySlug: string }>(fn: (ctx: RequestContext, request: Request, params: P) => Promise<Response>) {
  return async (request: Request, { params }: { params: Promise<P> }) => {
    try {
      assertSafeWrite(request);
      const p = await params;
      const ctx = await resolveRequestContext({ userId: await sessionUserId(), companySlug: p.companySlug, meta: await getRequestMeta(), locale: await getLocale() });
      return await fn(ctx, request, p);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
