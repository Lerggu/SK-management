import { readClient, runInTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { canAccessProject, projectPermissions, type RequestContext } from "@/platform/authz";
import { CommercialRepo } from "./repo";
import { VARIATION_FLOW, clientSnapshot, snapshotHash, type ClientSnapshot } from "./rules";
import { portalDecisionSchema, type PortalDecisionInput } from "./schemas";

/**
 * V7 owner decision 2: the named client person (variation.client_approve,
 * Client approver project role) approves or rejects variations in the client
 * portal. Only the frozen snapshot is shown — never costs or margin — and the
 * decision is bound to its SHA-256. docs/adr/0020-external-access-and-portals.md.
 */
function requireApprover(ctx: RequestContext, projectId: string) {
  if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
  const p = projectPermissions(ctx, projectId);
  if (!p.has("portal.client")) throw new NotFoundError();
  if (!p.has("variation.client_approve")) throw new ForbiddenError("Missing permission variation.client_approve");
}

type ApprovalRow = NonNullable<Awaited<ReturnType<CommercialRepo["findClientApproval"]>>>;

function present(a: ApprovalRow) {
  return {
    id: a.id,
    project: a.project,
    snapshot: a.snapshot as unknown as ClientSnapshot,
    contentSha256: a.contentSha256,
    sentAt: a.sentAt,
    decision: a.decision,
    channel: a.channel,
    decidedAt: a.decidedAt,
    decisionNote: a.decisionNote,
  };
}

export const clientApprovalService = {
  /** Variations sent to the client in a project (pending first). */
  async list(ctx: RequestContext, projectId: string) {
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    const project = await repo.findProject(projectId);
    if (!project) throw new NotFoundError();
    requireApprover(ctx, project.id);
    const rows = await repo.listClientApprovals({ projectId: project.id });
    const out = rows.map(present);
    return [...out.filter((r) => r.decision === "PENDING"), ...out.filter((r) => r.decision !== "PENDING")];
  },

  async get(ctx: RequestContext, approvalId: string) {
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    const a = await repo.findClientApproval(approvalId);
    if (!a) throw new NotFoundError();
    requireApprover(ctx, a.projectId);
    const users = a.decidedById ? await repo.findUsers([a.decidedById]) : [];
    return { ...present(a), decidedBy: users[0]?.name ?? users[0]?.email ?? null, canDecide: a.decision === "PENDING" };
  },

  async decide(ctx: RequestContext, approvalId: string, input: PortalDecisionInput) {
    const data = parseInput(portalDecisionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const a = await repo.findClientApproval(approvalId);
      if (!a) throw new NotFoundError();
      requireApprover(ctx, a.projectId);
      if (a.decision !== "PENDING") throw new ValidationError({ _form: ["validation.clientDecisionFinal"] });
      // The decision is bound to exactly the content the client saw.
      const snapshot = a.snapshot as unknown as ClientSnapshot;
      if (data.contentSha256 !== a.contentSha256 || snapshotHash(snapshot) !== a.contentSha256) throw new ValidationError({ _form: ["validation.clientSnapshotChanged"] });
      const v = await repo.findVariation(a.variationId);
      if (!v || v.status !== "SUBMITTED_TO_CLIENT" || !VARIATION_FLOW[v.status].includes(data.decision)) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      if (snapshotHash(clientSnapshot(v)) !== a.contentSha256) throw new ValidationError({ _form: ["validation.clientSnapshotChanged"] });
      const now = new Date();
      const updated = await repo.decideClientApproval(a.id, { decision: data.decision, channel: "PORTAL", decidedAt: now, decidedById: ctx.user.id, decisionNote: data.note, decisionIp: ctx.meta.ip ?? null });
      if (updated.count !== 1) throw new ValidationError({ _form: ["validation.clientDecisionFinal"] });
      await repo.updateVariation(v.id, { status: data.decision, clientDecisionAt: now, decisionNote: data.note, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, {
        action: data.decision === "APPROVED" ? "variation.client_approve" : "variation.client_reject",
        entityType: "variation",
        entityId: v.id,
        projectId: v.projectId,
        before: { status: v.status },
        after: { status: data.decision, note: data.note, salesPrice: snapshot.salesPrice },
        metadata: { channel: "PORTAL", clientApprovalId: a.id, contentSha256: a.contentSha256 },
      });
      return { id: a.id, decision: data.decision };
    });
  },
};
