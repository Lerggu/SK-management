import { readClient } from "@/platform/db";
import { ForbiddenError, NotFoundError } from "@/platform/errors";
import type { RequestContext } from "@/platform/authz";
import { companyWideHr, hrAccess, type HrAccess } from "./access";
import { HrRepo } from "./repo";

export type EmployeeRow = NonNullable<Awaited<ReturnType<HrRepo["findEmployee"]>>>;

const MAX_CHAIN = 25;

/** Supervisor ids above an employee (nearest first), cycle-safe. */
export function supervisorChain(employeeId: string, edges: readonly { id: string; supervisorId: string | null }[]): string[] {
  const parent = new Map(edges.map((e) => [e.id, e.supervisorId]));
  const chain: string[] = [];
  let current = parent.get(employeeId) ?? null;
  while (current && !chain.includes(current) && current !== employeeId && chain.length < MAX_CHAIN) {
    chain.push(current);
    current = parent.get(current) ?? null;
  }
  return chain;
}

/** Employees below any of the given supervisors (their area of responsibility). */
export function reportsOf(supervisorIds: readonly string[], edges: readonly { id: string; supervisorId: string | null }[]): Set<string> {
  const out = new Set<string>();
  if (supervisorIds.length === 0) return out;
  const roots = new Set(supervisorIds);
  for (const e of edges) {
    if (roots.has(e.id)) continue;
    if (supervisorChain(e.id, edges).some((s) => roots.has(s))) out.add(e.id);
  }
  return out;
}

export interface Viewer {
  /** Employee records linked to the signed-in user in this company. */
  ownEmployeeIds: string[];
  edges: { id: string; supervisorId: string | null }[];
}

export async function loadViewer(ctx: RequestContext, repo = new HrRepo(readClient(), ctx.company.id)): Promise<Viewer> {
  const [own, edges] = await Promise.all([repo.employeesOfUser(ctx.user.id), repo.supervisorEdges()]);
  return { ownEmployeeIds: own.map((e) => e.id), edges };
}

export function accessFor(ctx: RequestContext, viewer: Viewer, employee: { id: string; userId: string | null }): HrAccess {
  const self = employee.userId === ctx.user.id;
  const chain = supervisorChain(employee.id, viewer.edges);
  const supervisor = viewer.ownEmployeeIds.some((id) => chain.includes(id));
  return hrAccess(ctx, { self, supervisor });
}

/** Employee ids whose HR work data the viewer may see in company-wide lists. */
export function visibleEmployeeIds(ctx: RequestContext, viewer: Viewer): Set<string> | "ALL" {
  if (companyWideHr(ctx)) return "ALL";
  if (ctx.external) return new Set();
  const ids = reportsOf(viewer.ownEmployeeIds, viewer.edges);
  for (const id of viewer.ownEmployeeIds) ids.add(id);
  return ids;
}

/** Loads an employee and the caller's access; invisible employees are 404. */
export async function loadEmployeeAccess(ctx: RequestContext, employeeId: string, repo = new HrRepo(readClient(), ctx.company.id)) {
  const employee = await repo.findEmployee(employeeId);
  if (!employee) throw new NotFoundError();
  const viewer = await loadViewer(ctx, repo);
  const access = accessFor(ctx, viewer, employee);
  if (!access.basics) throw new NotFoundError();
  return { employee, access, viewer };
}

export function allowIf(condition: boolean, message = "Not allowed"): asserts condition {
  if (!condition) throw new ForbiddenError(message);
}

/** HR work data is hidden (404) from callers who only see the employee list. */
export function requireWork(access: HrAccess) {
  if (!access.work) throw new NotFoundError();
}
