/**
 * Canonical public address: requests that arrive at the default Azure host
 * (*.azurewebsites.net) are sent permanently to the own domain set in
 * AUTH_URL (e.g. https://sk.skinfra.fi), keeping the path and query.
 * The health check stays reachable on the default host for Azure's probe
 * and the deploy pipeline. No redirect without an own https domain.
 */
export function canonicalRedirect(requestHost: string | null, pathname: string, search: string, authUrl: string | undefined): string | null {
  if (!requestHost || !authUrl) return null;
  let target: URL;
  try {
    target = new URL(authUrl);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || target.hostname.endsWith(".azurewebsites.net")) return null;
  const host = requestHost.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (!host.endsWith(".azurewebsites.net") || host === target.hostname) return null;
  if (pathname === "/api/health") return null;
  return `${target.origin}${pathname}${search}`;
}
