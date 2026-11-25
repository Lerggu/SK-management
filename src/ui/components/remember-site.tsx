"use client";

import { useEffect } from "react";

/** Stores the site shown on the page as the member's default site (a preference cookie, one year). */
export function RememberSite({ cookieName, siteId }: { cookieName: string; siteId: string }) {
  useEffect(() => {
    document.cookie = `${encodeURIComponent(cookieName)}=${encodeURIComponent(siteId)}; path=/; max-age=31536000; samesite=lax`;
  }, [cookieName, siteId]);
  return null;
}
