import {
  COMPANY_ONLY_PERMISSIONS,
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
      set.add(p);
    }
    projectGrants.set(projectId, set);
  }

  return { permissions, projectAccess, external, projectGrants };
}
