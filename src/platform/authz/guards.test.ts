import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/platform/errors";
import type { RequestContext } from "./context";
import type { PermissionKey } from "./permissions";
import { canAccessProject, projectIdsWithPermission, projectPermissions, requirePermission, requireProjectPermission } from "./guards";

function ctx(perms: PermissionKey[], access: "ALL" | "ASSIGNED", grants: Record<string, PermissionKey[]> = {}): RequestContext {
  return {
    kind: "company",
    user: { id: "u", email: "u@example.test", name: null },
    meta: { requestId: "r" },
    locale: "fi",
    company: { id: "c", slug: "c", name: "C", organizationId: "o", defaultCurrency: "EUR" },
    membershipId: "m",
    permissions: new Set(perms),
    projectAccess: access,
    external: false,
    projectGrants: new Map(Object.entries(grants).map(([k, v]) => [k, new Set(v)])),
  };
}

describe("authorization guards", () => {
  it("requirePermission throws 403 without the capability", () => {
    expect(() => requirePermission(ctx(["project.view"], "ALL"), "project.manage")).toThrow(ForbiddenError);
    expect(() => requirePermission(ctx(["project.manage"], "ALL"), "project.manage")).not.toThrow();
  });

  it("unassigned projects are 404 for ASSIGNED members", () => {
    const c = ctx(["project.view", "project.manage"], "ASSIGNED", { p1: [] });
    expect(canAccessProject(c, "p2")).toBe(false);
    expect(() => requireProjectPermission(c, "p2", "project.view")).toThrow(NotFoundError);
    expect(() => requireProjectPermission(c, "p1", "project.manage")).not.toThrow();
  });

  it("visible project without capability is 403", () => {
    const c = ctx(["project.view"], "ASSIGNED", { p1: [] });
    expect(() => requireProjectPermission(c, "p1", "project.manage")).toThrow(ForbiddenError);
  });

  it("effective project permissions are company ∪ project role", () => {
    const c = ctx(["project.view"], "ASSIGNED", { p1: ["documents.manage"] });
    expect(projectPermissions(c, "p1").has("documents.manage")).toBe(true);
    expect(projectPermissions(c, "p1").has("project.view")).toBe(true);
    expect(projectPermissions(c, "p2").size).toBe(0);
  });

  it("projectIdsWithPermission returns undefined for ALL access", () => {
    expect(projectIdsWithPermission(ctx(["project.view"], "ALL"), "project.view")).toBeUndefined();
    expect(projectIdsWithPermission(ctx([], "ASSIGNED", { p1: ["project.view"], p2: [] }), "project.view")).toEqual(["p1"]);
  });
});
