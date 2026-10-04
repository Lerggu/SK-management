import { describe, expect, it } from "vitest";
import { resolvePermissions, type RoleGrant } from "./resolve";
import { ROLE_TEMPLATES, SENSITIVE_PERMISSIONS, getRoleTemplate } from "./permissions";

const grant = (key: string): RoleGrant => {
  const t = getRoleTemplate(key)!;
  return { templateKey: t.key, projectAccess: t.projectAccess, permissions: t.permissions };
};

describe("resolvePermissions", () => {
  it("unions company roles", () => {
    const r = resolvePermissions([grant("SITE_MANAGER"), grant("LOGISTICS_COORDINATOR")]);
    expect(r.permissions.has("equipment.manage")).toBe(true);
    expect(r.permissions.has("documents.manage")).toBe(true);
    expect(r.permissions.has("project.manage")).toBe(false);
  });

  it("gives ALL project access only to CEO and Project Director templates", () => {
    const all = ROLE_TEMPLATES.filter((t) => t.projectAccess === "ALL").map((t) => t.key);
    expect(all.sort()).toEqual(["CEO", "PROJECT_DIRECTOR"]);
    expect(resolvePermissions([grant("CEO")]).projectAccess).toBe("ALL");
    expect(resolvePermissions([grant("PROJECT_MANAGER")]).projectAccess).toBe("ASSIGNED");
    expect(resolvePermissions([grant("EMPLOYEE"), grant("PROJECT_DIRECTOR")]).projectAccess).toBe("ALL");
  });

  it("never grants sensitive permissions to Client or Subcontractor templates", () => {
    for (const key of ["CLIENT", "SUBCONTRACTOR"]) {
      const t = getRoleTemplate(key)!;
      expect(t.permissions.some((p) => SENSITIVE_PERMISSIONS.has(p))).toBe(false);
    }
  });

  it("strips sensitive permissions from external members even if a role is misconfigured", () => {
    const misconfigured: RoleGrant = { templateKey: "CLIENT", projectAccess: "ALL", permissions: ["project.view", "employee.rates.view", "equipment.rates.view"] };
    const r = resolvePermissions([misconfigured, grant("PROJECT_DIRECTOR")]);
    expect(r.external).toBe(true);
    expect(r.permissions.has("employee.rates.view")).toBe(false);
    expect(r.permissions.has("equipment.rates.manage")).toBe(false);
    expect(r.projectAccess).toBe("ASSIGNED");
  });

  it("project grants exclude company-only permissions", () => {
    const r = resolvePermissions([grant("EMPLOYEE")], [{ projectId: "p1", role: grant("CEO") }]);
    const p1 = r.projectGrants.get("p1")!;
    expect(p1.has("project.manage")).toBe(true);
    expect(p1.has("documents.approve")).toBe(true);
    expect(p1.has("employee.rates.view")).toBe(false);
    expect(p1.has("company.members.manage")).toBe(false);
    expect(r.permissions.has("project.manage")).toBe(false);
  });

  it("external project roles never carry sensitive permissions", () => {
    const r = resolvePermissions([grant("EMPLOYEE")], [{ projectId: "p1", role: { templateKey: "SUBCONTRACTOR", projectAccess: "ASSIGNED", permissions: ["documents.view", "equipment.rates.view"] } }]);
    expect([...r.projectGrants.get("p1")!]).toEqual(["documents.view"]);
  });

  it("ignores unknown permission keys", () => {
    const r = resolvePermissions([{ templateKey: null, projectAccess: "ASSIGNED", permissions: ["project.view", "root.everything"] }]);
    expect([...r.permissions]).toEqual(["project.view"]);
  });
});
