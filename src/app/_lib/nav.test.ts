import { describe, expect, it } from "vitest";
import { ROLE_TEMPLATES, type PermissionKey, type RequestContext, type RoleTemplateKey } from "@/platform/authz";
import { mobilePrimary, navGroups } from "./nav";

function ctx(perms: PermissionKey[], opts: { external?: boolean } = {}): RequestContext {
  return {
    kind: "company",
    user: { id: "u", email: "u@example.test", name: null },
    meta: { requestId: "r" },
    locale: "fi",
    company: { id: "c", slug: "x", name: "C", organizationId: "o", defaultCurrency: "EUR" },
    membershipId: "m",
    permissions: new Set(perms),
    projectAccess: "ALL",
    external: !!opts.external,
    externalParties: new Set(),
    projectGrants: new Map(),
  } as RequestContext;
}

const role = (key: RoleTemplateKey) => ROLE_TEMPLATES.find((r) => r.key === key)!.permissions;
const shape = (c: RequestContext, myEmployeeId?: string) => Object.fromEntries(navGroups(c, { myEmployeeId }).map((g) => [g.key, g.items.map((i) => i.key)]));

describe("grouped navigation", () => {
  it("groups the CEO's pages by area", () => {
    expect(shape(ctx(role("CEO")), "e1")).toEqual({
      home: ["dashboard"],
      projectsGroup: ["projects", "time", "documents"],
      productionGroup: ["takt", "logistics", "lifting", "materials"],
      hseGroup: ["hse"],
      peopleGroup: ["workforce", "myCard", "teams", "rotation", "matrix", "qualifications", "hrOverview", "hrSettings"],
      equipmentGroup: ["equipment"],
      salesGroup: ["sales", "quotes", "marketing", "invoicing", "billing"],
      settingsGroup: ["settings"],
    });
  });

  it("shows only what a role may use", () => {
    const employee = shape(ctx(role("EMPLOYEE")), "e1");
    expect(employee.peopleGroup).toEqual(["myCard", "matrix", "qualifications", "hrOverview"]);
    expect(employee.salesGroup).toBeUndefined();
    expect(shape(ctx(role("EMPLOYEE"))).peopleGroup).toBeUndefined(); // no linked employee, no HR rights
    expect(shape(ctx(role("PROJECT_DIRECTOR"))).salesGroup).not.toContain("marketing"); // marketing: CEO and PM only
    expect(shape(ctx(role("PROJECT_MANAGER"))).salesGroup).toContain("marketing");
  });

  it("external members only see the portal", () => {
    expect(shape(ctx(role("SUBCONTRACTOR"), { external: true }))).toEqual({ portalGroup: ["portal"] });
  });

  it("links point into the company", () => {
    for (const g of navGroups(ctx(role("CEO")), { myEmployeeId: "e1" })) for (const i of g.items) expect(i.href.startsWith("/c/x/")).toBe(true);
  });
});

describe("phone bottom bar by role", () => {
  const picks = (key: RoleTemplateKey) => mobilePrimary(ctx(role(key)));
  it("puts lift plans first for the lifting supervisor", () => {
    expect(picks("LIFTING_SUPERVISOR")).toContainEqual({ item: "lifting" });
  });
  it("puts the logistics board first for the logistics coordinator", () => {
    expect(picks("LOGISTICS_COORDINATOR").slice(0, 2)).toEqual([{ item: "dashboard" }, { item: "logistics" }]);
  });
  it("puts HSE first for the HSE specialist", () => {
    expect(picks("HSE").slice(0, 2)).toEqual([{ item: "dashboard" }, { group: "hseGroup" }]);
  });
  it("gives a worker hours, safety and the own card", () => {
    expect(picks("EMPLOYEE")).toEqual([{ item: "dashboard" }, { item: "time" }, { group: "hseGroup" }, { item: "myCard" }]);
  });
  it("keeps the default order for managers and nothing for external members", () => {
    expect(picks("SITE_MANAGER")).toEqual([{ item: "dashboard" }]);
    expect(mobilePrimary(ctx(role("CLIENT"), { external: true }))).toEqual([]);
  });
});
