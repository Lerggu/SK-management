import type { PermissionKey } from "./permissions";

export type Locale = "fi" | "en";

export interface RequestMeta {
  requestId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
}

/** Context for actions that are not (yet) inside a company, e.g. company selection. */
export interface UserContext {
  kind: "user";
  user: AuthenticatedUser;
  meta: RequestMeta;
  locale: Locale;
}

/**
 * Context for every company-scoped service call. Built once per request from
 * the authenticated user and the company slug in the URL, after verifying an
 * ACTIVE membership. Services must never take a company id from user input.
 */
export interface RequestContext {
  kind: "company";
  user: AuthenticatedUser;
  meta: RequestMeta;
  locale: Locale;
  company: {
    id: string;
    slug: string;
    name: string;
    organizationId: string;
    defaultCurrency: string;
  };
  membershipId: string;
  permissions: ReadonlySet<PermissionKey>;
  projectAccess: "ALL" | "ASSIGNED";
  external: boolean;
  projectGrants: ReadonlyMap<string, ReadonlySet<PermissionKey>>;
}
