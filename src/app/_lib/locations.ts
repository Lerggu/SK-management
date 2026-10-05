import "server-only";
import { projectPermissions, type PermissionKey, type RequestContext } from "@/platform/authz";
import { projectService, siteService } from "@/modules/projects/service";

/**
 * Project/site choices for forms, encoded as "p:<projectId>" or
 * "s:<projectId>:<siteId>", limited to projects where the member holds
 * `permission`. One select = one tap on a phone.
 */
export async function locationOptions(ctx: RequestContext, permission: PermissionKey) {
  const projects = (await projectService.list(ctx)).filter((p) => !p.archivedAt && projectPermissions(ctx, p.id).has(permission));
  const options: { value: string; label: string }[] = [];
  for (const p of projects) {
    options.push({ value: `p:${p.id}`, label: `${p.code} · ${p.name}` });
    for (const s of await siteService.list(ctx, p.id)) options.push({ value: `s:${p.id}:${s.id}`, label: `${p.code} › ${s.name}` });
  }
  return options;
}

export function parseLocation(value: unknown): { projectId: string | null; siteId: string | null } {
  const [kind, projectId, siteId] = String(value ?? "").split(":");
  return { projectId: kind ? (projectId ?? null) : null, siteId: kind === "s" ? (siteId ?? null) : null };
}
