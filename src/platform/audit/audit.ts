import type { Tx } from "@/platform/db";
import type { RequestContext, RequestMeta, UserContext } from "@/platform/authz/context";
import { computeDelta, maskRecord, type JsonObject } from "./mask";

export type AuditActor =
  | RequestContext
  | UserContext
  | { kind: "system"; meta: RequestMeta; organizationId?: string | null; companyId?: string | null };

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  /** Override the company (e.g. when creating a new company from a UserContext). */
  companyId?: string | null;
  organizationId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** When true, before/after are reduced to the changed fields. */
  diff?: boolean;
  metadata?: JsonObject;
}

/**
 * Appends an audit event inside the caller's transaction, so the event and
 * the change commit together. The table itself is append-only (DB trigger).
 */
export async function writeAudit(tx: Tx, actor: AuditActor, input: AuditInput): Promise<void> {
  let before: JsonObject | null;
  let after: JsonObject | null;
  if (input.diff && input.before && input.after) {
    ({ before, after } = computeDelta(input.entityType, input.before, input.after));
  } else {
    before = maskRecord(input.entityType, input.before);
    after = maskRecord(input.entityType, input.after);
  }

  const companyId =
    input.companyId !== undefined ? input.companyId : actor.kind === "company" ? actor.company.id : actor.kind === "system" ? (actor.companyId ?? null) : null;
  const organizationId =
    input.organizationId !== undefined
      ? input.organizationId
      : actor.kind === "company"
        ? actor.company.organizationId
        : actor.kind === "system"
          ? (actor.organizationId ?? null)
          : null;

  await tx.auditEvent.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      projectId: input.projectId ?? null,
      companyId,
      organizationId,
      actorType: actor.kind === "system" ? "SYSTEM" : "USER",
      actorUserId: actor.kind === "system" ? null : actor.user.id,
      before: before ?? undefined,
      after: after ?? undefined,
      metadata: {
        requestId: actor.meta.requestId,
        ip: actor.meta.ip ?? null,
        userAgent: actor.meta.userAgent ?? null,
        ...(input.metadata ?? {}),
      },
    },
  });
}
