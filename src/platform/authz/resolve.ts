import {
  COMPANY_ONLY_PERMISSIONS,
  EXTERNAL_ONLY_PERMISSIONS,
  EXTERNAL_TEMPLATE_KEYS,
  SENSITIVE_PERMISSIONS,
  isPermissionKey,
  type PermissionKey,
} from "./permissions";

export interface RoleGrant {
  templateKey: string | null;
  projectAccess: "ALL" | "ASSIGNED";
  permissions: readonly string[];
}

export interface ProjectRoleGrant {
  projectId: string;
  role: RoleGrant;
}

export interface ResolvedPermissions {
  /** Company-level permissions (union of the member's company roles). */
  permissions: ReadonlySet<PermissionKey>;
  projectAccess: "ALL" | "ASSIGNED";
  /** True when the member holds any external (Client/Subcontractor) role. */
  external: boolean;
  /** Per-project grants from project roles (company-only permissions removed). */
  projectGrants: ReadonlyMap<string, ReadonlySet<PermissionKey>>;
  /** External parties the member represents (empty for internal members). */
  externalParties: ReadonlySet<ExternalParty>;
}

export type ExternalParty = "CLIENT" | "SUBCONTRACTOR";

const PARTY_BY_TEMPLATE: Readonly<Record<string, ExternalParty>> = {
  CLIENT: "CLIENT",
  CLIENT_APPROVER: "CLIENT",
  SUBCONTRACTOR: "SUBCONTRACTOR",
};

/**
 * The external parties a member represents (V7 document sharing and
 * portals), from their company roles and project roles.
 */
export function externalParties(companyRoles: readonly RoleGrant[], projectRoles: readonly ProjectRoleGrant[] = []): ReadonlySet<ExternalParty> {
  const out = new Set<ExternalParty>();
  if (!companyRoles.some(isExternal)) return out;
  for (const r of [...companyRoles, ...projectRoles.map((p) => p.role)]) {
    const party = r.templateKey ? PARTY_BY_TEMPLATE[r.templateKey] : undefined;
    if (party) out.add(party);
  }
  return out;
}

function isExternal(role: RoleGrant): boolean {
  return role.templateKey !== null && EXTERNAL_TEMPLATE_KEYS.has(role.templateKey);
}

/**
 * Pure permission resolution.
 *
 * - Company permissions = union of all company roles' permissions.
 * - Project access is ALL if any company role grants ALL, else ASSIGNED.
 * - Project grants = the project role's permissions, minus company-only ones.
 * - Members holding an external role (Client/Subcontractor), or receiving an
 *   external project role, never get sensitive (cost/rate) permissions, even
 *   if a role was misconfigured to include them.
 * - External-only permissions (portals, client approval) are kept only for
 *   members holding an external company role: an internal user never acts
 *   on the client's behalf, even if given an external project role.
 * - Unknown permission keys are ignored.
 */
export function resolvePermissions(companyRoles: readonly RoleGrant[], projectRoles: readonly ProjectRoleGrant[] = []): ResolvedPermissions {
  const external = companyRoles.some(isExternal);
  const permissions = new Set<PermissionKey>();
  let projectAccess: "ALL" | "ASSIGNED" = "ASSIGNED";

  for (const role of companyRoles) {
    if (role.projectAccess === "ALL") projectAccess = "ALL";
    for (const p of role.permissions) {
      if (!isPermissionKey(p)) continue;
      if (external && SENSITIVE_PERMISSIONS.has(p)) continue;
      if (!external && EXTERNAL_ONLY_PERMISSIONS.has(p)) continue;
      permissions.add(p);
    }
  }
  // External members never get ALL project access.
  if (external) projectAccess = "ASSIGNED";

  const projectGrants = new Map<string, Set<PermissionKey>>();
  for (const { projectId, role } of projectRoles) {
    const stripSensitive = external || isExternal(role);
    const set = projectGrants.get(projectId) ?? new Set<PermissionKey>();
    for (const p of role.permissions) {
      if (!isPermissionKey(p)) continue;
      if (COMPANY_ONLY_PERMISSIONS.has(p)) continue;
      if (stripSensitive && SENSITIVE_PERMISSIONS.has(p)) continue;
      if (!external && EXTERNAL_ONLY_PERMISSIONS.has(p)) continue;
      set.add(p);
    }
    projectGrants.set(projectId, set);
  }

  return { permissions, projectAccess, external, projectGrants, externalParties: externalParties(companyRoles, projectRoles) };
}
