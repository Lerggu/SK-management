import "server-only";
import { hasPermission, type RequestContext } from "@/platform/authz";
import { hrCardService } from "@/modules/hr/card.service";
import { isAppError } from "@/platform/errors";

/** Which workforce tabs to show (services still enforce access). */
export async function hrTabsFor(ctx: RequestContext) {
  const companyWide = !ctx.external && (hasPermission(ctx, "hr.view") || hasPermission(ctx, "hr.manage"));
  const own = companyWide ? null : await hrCardService.myEmployeeId(ctx);
  const hrLists = companyWide || !!own;
  return {
    people: hasPermission(ctx, "employee.view"),
    matrix: hrLists,
    qualifications: hrLists,
    overview: hrLists,
    settings: !ctx.external && hasPermission(ctx, "hr.manage"),
  };
}

/** Forbidden list access (e.g. a supervisor with no reports) renders as an info message. */
export async function orForbidden<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (isAppError(e) && e.status === 403) return null;
    throw e;
  }
}
