/**
 * V8: PostgreSQL row-level security (docs/adr/0022). These tests bypass the
 * repositories on purpose: inside a tenant scope even a query WITHOUT a
 * company condition must only see — and only write — the scoped company.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db, readClient, runInTransaction, withTenantScope } from "@/platform/db";
import { SERVICE_REGISTRY, isTenantScoped } from "@/modules/registry";
import { companyDirectoryService } from "@/modules/companies/service";
import { resolveRequestContext } from "@/modules/companies/context";
import { projectService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import type { RequestContext } from "@/platform/authz";
import { createTenant, meta, uniq, type Tenant } from "../helpers/fixtures";

let a: Tenant;
let b: Tenant;
let sibling: RequestContext;
const scopeOf = (t: { companyId: string; organizationId: string }) => ({ companyId: t.companyId, organizationId: t.organizationId });

beforeAll(async () => {
  a = await createTenant("RlsA");
  b = await createTenant("RlsB");
  await projectService.create(a.ownerCtx, { code: "A-RLS", name: "A secret" });
  await projectService.create(b.ownerCtx, { code: "B-RLS", name: "B secret" });
  // A second company in A's organization (group sharing).
  const slug = uniq("sib");
  await companyDirectoryService.createCompany(a.owner, { organizationId: a.organizationId, name: "Sibling Oy", slug });
  sibling = await resolveRequestContext({ userId: a.owner.user.id, companySlug: slug, meta, locale: "fi" });
  await employeeService.create(a.ownerCtx, { employeeNumber: "SH-1", firstName: "Shared", lastName: "Worker", shareableInGroup: "on" });
  await employeeService.create(a.ownerCtx, { employeeNumber: "PR-1", firstName: "Private", lastName: "Worker" });
});

describe("row-level security", () => {
  it("every registered service method runs in the tenant scope", () => {
    const methods = Object.entries(SERVICE_REGISTRY).flatMap(([s, obj]) => Object.entries(obj).map(([m, fn]) => [`${s}.${m}`, fn] as const));
    expect(methods.length).toBeGreaterThan(200);
    expect(methods.filter(([, fn]) => !isTenantScoped(fn)).map(([n]) => n)).toEqual([]);
  });

  it("every table with a company_id has row-level security and a tenant policy", async () => {
    const rows = await db.$queryRaw<{ table: string; rls: boolean; policies: number }[]>`
      SELECT c.relname AS table, c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'company_id')`;
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.filter((r) => !r.rls || r.policies === 0).map((r) => r.table)).toEqual([]);
    expect(rows.map((r) => r.table)).toEqual(expect.arrayContaining(["ai_runs", "ai_recommendations"]));
  });

  it("an unfiltered query sees only the scoped company — reads and transactions", async () => {
    const codes = await withTenantScope(scopeOf(a), () => readClient().project.findMany({ select: { code: true } }));
    expect(codes.map((p) => p.code)).toEqual(["A-RLS"]);
    const inTx = await withTenantScope(scopeOf(b), () => runInTransaction((tx) => tx.project.findMany({ select: { code: true } })));
    expect(inTx.map((p) => p.code)).toEqual(["B-RLS"]);
    const who = await withTenantScope(scopeOf(a), () => runInTransaction((tx) => tx.$queryRaw<{ u: string }[]>`SELECT current_user AS u`));
    expect(who[0].u).toBe("sk_app");
    // Outside a scope (identity paths) the owner role is used.
    expect(await db.project.count({ where: { code: { in: ["A-RLS", "B-RLS"] } } })).toBe(2);
  });

  it("cannot write a row for another company, even when asked to explicitly", async () => {
    await expect(
      withTenantScope(scopeOf(a), () => runInTransaction((tx) => tx.project.create({ data: { companyId: b.companyId, code: uniq("X"), name: "planted" } }))),
    ).rejects.toThrow(/row-level security/);
    const bProject = await db.project.findFirstOrThrow({ where: { companyId: b.companyId } });
    const updated = await withTenantScope(scopeOf(a), () => runInTransaction((tx) => tx.project.updateMany({ where: { id: bProject.id }, data: { name: "hijacked" } })));
    expect(updated.count).toBe(0);
    expect((await db.project.findUniqueOrThrow({ where: { id: bProject.id } })).name).toBe("B secret");
  });

  it("the app role without a company setting sees nothing", async () => {
    const rows = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE sk_app");
      return tx.project.count();
    });
    expect(rows).toBe(0);
  });

  it("group sharing: a sibling company reads only resources shared with the group; other organizations nothing", async () => {
    const names = await withTenantScope({ companyId: sibling.company.id, organizationId: sibling.company.organizationId }, () =>
      readClient().employee.findMany({ select: { firstName: true } }),
    );
    expect(names.map((e) => e.firstName)).toEqual(["Shared"]);
    const fromB = await withTenantScope(scopeOf(b), () => readClient().employee.findMany({ where: { companyId: a.companyId } }));
    expect(fromB).toEqual([]);
    // Shared rows are read-only for the sibling.
    const changed = await withTenantScope({ companyId: sibling.company.id, organizationId: sibling.company.organizationId }, () =>
      runInTransaction((tx) => tx.employee.updateMany({ where: { firstName: "Shared" }, data: { lastName: "Changed" } })),
    );
    expect(changed.count).toBe(0);
  });

  it("audit events are readable by their own company only", async () => {
    const own = await withTenantScope(scopeOf(a), () => readClient().auditEvent.findMany({ select: { companyId: true } }));
    expect(own.length).toBeGreaterThan(0);
    expect(new Set(own.map((e) => e.companyId))).toEqual(new Set([a.companyId]));
  });

  it("an invalid scope is refused", () => {
    expect(() => withTenantScope({ companyId: "x'; DROP TABLE projects; --", organizationId: a.organizationId }, () => 1)).toThrow(/Invalid tenant scope/);
  });
});
