"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isExternalPath } from "@/app/_lib/nav";

/**
 * Keeps external members (Client, Subcontractor) in the portal. Uses the
 * browser's real path: a layout is not re-rendered on client-side
 * navigation, and during a redirect chain (sign-in, registration) the
 * server-side request path is stale, which left external users on a blank
 * page. Services still enforce access on the server.
 */
export function ExternalGuard({ portalHref, children }: { portalHref: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const allowed = isExternalPath(pathname);
  useEffect(() => {
    if (!allowed) router.replace(portalHref);
  }, [allowed, router, portalHref]);
  return allowed ? children : null;
}
