import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { requirePermission, type RequestContext } from "@/platform/authz";
import { decryptField, encryptField, fieldEncryptionAvailable, fieldLookupHash } from "@/platform/crypto/field";
import { EmployeeRepo } from "./repo";
import { maskPersonalId, normalizePersonalId } from "./personal-id";

function requirePid(ctx: RequestContext) {
  if (ctx.external) throw new ForbiddenError("External members have no workforce access");
  requirePermission(ctx, "employee.pid.manage");
}

async function employeeOr404(repo: EmployeeRepo, id: string) {
  const e = await repo.find(id);
  if (!e) throw new NotFoundError();
  return e;
}

/**
 * Personal identity code (henkilötunnus) of an employee (ADR 0028). Stored
 * encrypted; only members with `employee.pid.manage` see or change it, never
 * in lists, exports, audit deltas or AI. Showing the full code is audited.
 */
export const personalIdService = {
  /** Whether a code is stored, its masked form, and whether storing is available. */
  async status(ctx: RequestContext, employeeId: string) {
    requirePid(ctx);
    const e = await employeeOr404(new EmployeeRepo(readClient(), ctx.company.id), employeeId);
    const available = fieldEncryptionAvailable();
    if (!e.personalIdEnc) return { set: false, masked: null, available };
    let masked: string | null = null;
    try {
      masked = maskPersonalId(decryptField(e.personalIdEnc));
    } catch {
      masked = null; // key missing or rotated: the code exists but cannot be read here
    }
    return { set: true, masked, available };
  },

  /** The full code, for a person who needs it (e.g. payroll); every view is audited. */
  async reveal(ctx: RequestContext, employeeId: string) {
    requirePid(ctx);
    return runInTransaction(async (tx) => {
      const e = await employeeOr404(new EmployeeRepo(tx, ctx.company.id), employeeId);
      if (!e.personalIdEnc) throw new ValidationError({ _form: ["workforce.pid.none"] });
      if (!fieldEncryptionAvailable()) throw new ValidationError({ _form: ["workforce.pid.unavailable"] });
      const personalId = decryptField(e.personalIdEnc);
      await writeAudit(tx, ctx, { action: "employee.pid_view", entityType: "employee", entityId: e.id, metadata: { field: "personalId" } });
      return { personalId };
    });
  },

  async set(ctx: RequestContext, employeeId: string, input: { personalId?: string | null }) {
    requirePid(ctx);
    const code = normalizePersonalId(String(input.personalId ?? ""));
    if (!code) throw new ValidationError({ personalId: ["validation.personalId"] });
    if (!fieldEncryptionAvailable()) throw new ValidationError({ _form: ["workforce.pid.unavailable"] });
    try {
      return await runInTransaction(async (tx) => {
        const repo = new EmployeeRepo(tx, ctx.company.id);
        const e = await employeeOr404(repo, employeeId);
        if (e.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
        await repo.update(e.id, { personalIdEnc: encryptField(code), personalIdHash: fieldLookupHash(code), updatedById: ctx.user.id });
        await writeAudit(tx, ctx, { action: "employee.pid_set", entityType: "employee", entityId: e.id, metadata: { field: "personalId", replaced: Boolean(e.personalIdEnc) } });
        return { set: true, masked: maskPersonalId(code) };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ValidationError({ personalId: ["validation.personalIdTaken"] });
      throw err;
    }
  },

  async clear(ctx: RequestContext, employeeId: string) {
    requirePid(ctx);
    return runInTransaction(async (tx) => {
      const repo = new EmployeeRepo(tx, ctx.company.id);
      const e = await employeeOr404(repo, employeeId);
      if (!e.personalIdEnc) return { set: false };
      await repo.update(e.id, { personalIdEnc: null, personalIdHash: null, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "employee.pid_clear", entityType: "employee", entityId: e.id, metadata: { field: "personalId" } });
      return { set: false };
    });
  },
};
