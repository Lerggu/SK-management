/**
 * Auth.js session cookie naming. Must match Auth.js defaults so that sessions
 * created by the dev login are read by `auth()`.
 */
export function secureCookiesEnabled(): boolean {
  return (process.env.AUTH_URL ?? "").startsWith("https://");
}

export function sessionCookieName(): string {
  return `${secureCookiesEnabled() ? "__Secure-" : ""}authjs.session-token`;
}
