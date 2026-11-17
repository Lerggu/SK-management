import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirect } from "@/platform/http/canonical-host";

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * Network boundary: tags every request with an id (used in audit events) and
 * sends visitors without a session cookie to sign-in, and forwards the default
 * Azure host to the own domain. This is only a fast
 * path — authorization is always enforced server-side per request.
 */
export function proxy(request: NextRequest) {
  // The old *.azurewebsites.net address forwards permanently to the own domain (AUTH_URL).
  const canonical = canonicalRedirect(request.headers.get("x-forwarded-host") ?? request.headers.get("host"), request.nextUrl.pathname, request.nextUrl.search, process.env.AUTH_URL);
  if (canonical) return NextResponse.redirect(canonical, 308);

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  // V7: lets the company layout keep external members inside the portal.
  headers.set("x-pathname", request.nextUrl.pathname);

  const { pathname } = request.nextUrl;
  const hasSession = SESSION_COOKIES.some((n) => request.cookies.has(n));
  if (!hasSession && (pathname === "/c" || pathname.startsWith("/c/"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
