import { cookies } from "next/headers";

/**
 * The member's last-used site per company (role journeys 2026-11-26): pages
 * that pick a site (logistics, lifting, materials, map, calendar) open on it
 * instead of the alphabetically first site. A plain preference cookie; the
 * services still check that the member may see the site.
 */
export const siteCookieName = (companySlug: string) => `sk-site-${companySlug}`;

export async function preferredSiteId(companySlug: string, sites: { id: string }[], requested?: string | null): Promise<string | undefined> {
  if (requested && sites.some((s) => s.id === requested)) return requested;
  const remembered = (await cookies()).get(siteCookieName(companySlug))?.value;
  if (remembered && sites.some((s) => s.id === remembered)) return remembered;
  return sites[0]?.id;
}

/** The remembered site when it is still one of `sites` (no fallback). */
export async function rememberedSiteId(companySlug: string, sites: { id: string }[]): Promise<string | undefined> {
  const remembered = (await cookies()).get(siteCookieName(companySlug))?.value;
  return remembered && sites.some((s) => s.id === remembered) ? remembered : undefined;
}
