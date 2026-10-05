import { readClient, runInTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import type { RequestContext } from "@/platform/authz";
import { requireHse, requireHseVisible, requireRecordVisible } from "./access";
import { HseRepo } from "./repo";
import { PERMIT_FLOW, inspectionIndex, riskLevel, riskScore, type PermitStatus } from "./rules";
import {
  inspectionSchema,
  permitDecisionSchema,
  permitSchema,
  riskAssessmentSchema,
  riskAssessmentUpdateSchema,
  riskItemSchema,
  toolboxTalkSchema,
  type InspectionInput,
  type PermitDecisionInput,
  type PermitInput,
  type RiskAssessmentInput,
  type RiskAssessmentUpdateInput,
  type RiskItemInput,
  type ToolboxTalkInput,
} from "./schemas";

async function projectOr404(repo: HseRepo, projectId: string) {
  const p = await repo.findProject(projectId);
  if (!p) throw new NotFoundError();
  return p;
}

async function validateRefs(repo: HseRepo, projectId: string, refs: { siteId?: string | null; liftPlanId?: string | null }) {
  if (refs.siteId) {
    const s = await repo.findSite(refs.siteId);
    if (!s || s.archivedAt || s.projectId !== projectId) throw new ValidationError({ siteId: ["validation.invalidOption"] });
  }
  if (refs.liftPlanId) {
    const l = await repo.findLiftPlan(refs.liftPlanId);
    if (!l || l.projectId !== projectId) throw new ValidationError({ liftPlanId: ["validation.invalidOption"] });
  }
}

async function userNames(repo: HseRepo, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const users = unique.length ? await repo.findUsers(unique) : [];
  return Object.fromEntries(users.map((u) => [u.id, u.name ?? u.email]));
}

// ── toolbox talks ────────────────────────────────────────────────────
export const toolboxTalkService = {
  /** Recorded by site personnel (hse.create + register view). */
  async create(ctx: RequestContext, input: ToolboxTalkInput) {
    const data = parseInput(toolboxTalkSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, data.projectId);
      requireHse(ctx, project.id, "hse.view");
      requireHse(ctx, project.id, "hse.create");
      await validateRefs(repo, project.id, data);
      const t = await repo.createToolboxTalk({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "toolbox_talk.create", entityType: "toolbox_talk", entityId: t.id, projectId: project.id, after: t });
      return t;
    });
  },
};

// ── risk assessments ─────────────────────────────────────────────────
type RiskRow = NonNullable<Awaited<ReturnType<HseRepo["findRiskAssessment"]>>>;

async function loadRisk(repo: HseRepo, ctx: RequestContext, id: string) {
  const r = await repo.findRiskAssessment(id);
  if (!r) throw new NotFoundError();
  const can = requireHseVisible(ctx, r.projectId);
  if (!can.view) throw new NotFoundError();
  return { r, can };
}

function presentRisk(r: RiskRow) {
  return {
    ...r,
    items: r.items.map((i) => {
      const score = riskScore(i.likelihood, i.consequence);
      const residual = i.residualLikelihood && i.residualConsequence ? riskScore(i.residualLikelihood, i.residualConsequence) : null;
      return { ...i, score, level: riskLevel(score), residualScore: residual, residualLevel: residual === null ? null : riskLevel(residual) };
    }),
  };
}

function requireDraft(r: { status: string }) {
  if (r.status !== "DRAFT") throw new ValidationError({ _form: ["validation.riskAssessmentLocked"] });
}

export const riskAssessmentService = {
  async create(ctx: RequestContext, input: RiskAssessmentInput) {
    const data = parseInput(riskAssessmentSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, data.projectId);
      requireHse(ctx, project.id, "hse.manage");
      await validateRefs(repo, project.id, data);
      const r = await repo.createRiskAssessment({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "risk_assessment.create", entityType: "risk_assessment", entityId: r.id, projectId: project.id, after: r });
      return r;
    });
  },

  async get(ctx: RequestContext, riskAssessmentId: string) {
    const repo = new HseRepo(readClient(), ctx.company.id);
    const { r, can } = await loadRisk(repo, ctx, riskAssessmentId);
    const [actions, photos, users] = await Promise.all([
      repo.listActions({ projectId: r.projectId, sourceType: "RISK_ASSESSMENT", sourceId: r.id }),
      repo.listPhotos("RISK_ASSESSMENT", r.id),
      userNames(repo, [r.createdById, r.approvedById]),
    ]);
    const self = r.createdById === ctx.user.id;
    return {
      ...presentRisk(r),
      actions,
      photos: photos.map((p) => ({ ...p, sizeBytes: Number(p.sizeBytes) })),
      users,
      can: {
        edit: can.manage && r.status === "DRAFT",
        approve: can.manage && r.status === "DRAFT" && !self && r.items.length > 0,
        selfApprovalBlocked: can.manage && r.status === "DRAFT" && self,
        archive: can.manage && r.status !== "ARCHIVED",
        addAction: can.manage && r.status !== "ARCHIVED",
        addPhoto: can.manage,
      },
    };
  },

  async update(ctx: RequestContext, riskAssessmentId: string, input: RiskAssessmentUpdateInput) {
    const data = parseInput(riskAssessmentUpdateSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { r } = await loadRisk(repo, ctx, riskAssessmentId);
      requireHse(ctx, r.projectId, "hse.manage");
      requireDraft(r);
      await validateRefs(repo, r.projectId, data);
      const { items: _items, site: _site, liftPlan: _lp, ...before } = r;
      void _items;
      void _site;
      void _lp;
      const after = await repo.updateRiskAssessment(r.id, { ...data, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "risk_assessment.update", entityType: "risk_assessment", entityId: r.id, projectId: r.projectId, before, after, diff: true });
      return after;
    });
  },

  async addItem(ctx: RequestContext, riskAssessmentId: string, input: RiskItemInput) {
    const data = parseInput(riskItemSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { r } = await loadRisk(repo, ctx, riskAssessmentId);
      requireHse(ctx, r.projectId, "hse.manage");
      requireDraft(r);
      const item = await repo.createRiskItem({ ...data, riskAssessmentId: r.id, position: await repo.nextItemPosition(r.id) });
      await writeAudit(tx, ctx, { action: "risk_assessment.item_add", entityType: "risk_assessment_item", entityId: item.id, projectId: r.projectId, after: { ...item, score: riskScore(item.likelihood, item.consequence) } });
      return item;
    });
  },

  async removeItem(ctx: RequestContext, itemId: string) {
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const item = await repo.findRiskItem(itemId);
      if (!item) throw new NotFoundError();
      const { r } = await loadRisk(repo, ctx, item.riskAssessmentId);
      requireHse(ctx, r.projectId, "hse.manage");
      requireDraft(r);
      await repo.deleteRiskItem(item.id);
      await writeAudit(tx, ctx, { action: "risk_assessment.item_remove", entityType: "risk_assessment_item", entityId: item.id, projectId: r.projectId, before: item });
    });
  },

  /** Approved by another hse.manage holder; frozen afterwards (DB trigger). */
  async approve(ctx: RequestContext, riskAssessmentId: string) {
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { r } = await loadRisk(repo, ctx, riskAssessmentId);
      requireHse(ctx, r.projectId, "hse.manage");
      requireDraft(r);
      if (r.createdById === ctx.user.id) throw new ValidationError({ _form: ["validation.hseSelfApproval"] });
      if (r.items.length === 0) throw new ValidationError({ _form: ["validation.riskAssessmentEmpty"] });
      const after = await repo.updateRiskAssessment(r.id, { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, {
        action: "risk_assessment.approve",
        entityType: "risk_assessment",
        entityId: r.id,
        projectId: r.projectId,
        before: { status: r.status },
        after: { status: after.status, items: r.items.length, maxScore: Math.max(...r.items.map((i) => riskScore(i.likelihood, i.consequence))) },
      });
      return after;
    });
  },

  async archive(ctx: RequestContext, riskAssessmentId: string) {
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { r } = await loadRisk(repo, ctx, riskAssessmentId);
      requireHse(ctx, r.projectId, "hse.manage");
      if (r.status === "ARCHIVED") return r;
      const after = await repo.updateRiskAssessment(r.id, { status: "ARCHIVED", archivedAt: new Date(), updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "risk_assessment.archive", entityType: "risk_assessment", entityId: r.id, projectId: r.projectId, before: { status: r.status }, after: { status: after.status } });
      return after;
    });
  },
};

// ── permits to work ──────────────────────────────────────────────────
type PermitRow = NonNullable<Awaited<ReturnType<HseRepo["findPermit"]>>>;

async function loadPermit(repo: HseRepo, ctx: RequestContext, id: string) {
  const p = await repo.findPermit(id);
  if (!p) throw new NotFoundError();
  const can = requireRecordVisible(ctx, p);
  return { p, can };
}

function permitCan(ctx: RequestContext, can: ReturnType<typeof requireRecordVisible>, p: PermitRow) {
  const self = p.createdById === ctx.user.id;
  return {
    decide: can.permitApprove && p.status === "REQUESTED" && !self,
    selfDecisionBlocked: can.permitApprove && p.status === "REQUESTED" && self,
    close: p.status === "APPROVED" && (can.permitApprove || self),
  };
}

export const workPermitService = {
  /** Requested with hse.create — subcontractors too. */
  async request(ctx: RequestContext, input: PermitInput) {
    const data = parseInput(permitSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, data.projectId);
      requireHse(ctx, project.id, "hse.create");
      if (project.archivedAt) throw new ValidationError({ projectId: ["validation.invalidOption"] });
      await validateRefs(repo, project.id, data);
      await repo.lockProject(project.id);
      const p = await repo.createPermit({ ...data, number: await repo.nextPermitNumber(project.id), requestedByExternal: ctx.external, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "work_permit.request", entityType: "work_permit", entityId: p.id, projectId: project.id, after: p });
      return p;
    });
  },

  async get(ctx: RequestContext, permitId: string) {
    const repo = new HseRepo(readClient(), ctx.company.id);
    const { p, can } = await loadPermit(repo, ctx, permitId);
    const users = await userNames(repo, [p.createdById, p.decidedById, p.closedById]);
    return { ...p, users, can: permitCan(ctx, can, p), ownOnly: can.ownOnly };
  },

  /** permit.approve by someone other than the requester (also a DB trigger). */
  async decide(ctx: RequestContext, permitId: string, input: PermitDecisionInput) {
    const data = parseInput(permitDecisionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { p } = await loadPermit(repo, ctx, permitId);
      requireHse(ctx, p.projectId, "permit.approve");
      const to: PermitStatus = data.decision === "APPROVE" ? "APPROVED" : "REJECTED";
      if (!PERMIT_FLOW[p.status as PermitStatus].includes(to)) throw new ValidationError({ _form: ["validation.invalidTransition"] });
      if (p.createdById === ctx.user.id) throw new ValidationError({ _form: ["validation.hseSelfApproval"] });
      const after = await repo.updatePermit(p.id, { status: to, decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: data.note, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: to === "APPROVED" ? "work_permit.approve" : "work_permit.reject", entityType: "work_permit", entityId: p.id, projectId: p.projectId, before: { status: p.status }, after: { status: to, note: data.note } });
      return after;
    });
  },

  /** Closed when the work ends: by the requester or a permit approver. */
  async close(ctx: RequestContext, permitId: string) {
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const { p, can } = await loadPermit(repo, ctx, permitId);
      if (!permitCan(ctx, can, p).close) {
        if (p.status !== "APPROVED") throw new ValidationError({ _form: ["validation.invalidTransition"] });
        throw new ForbiddenError("Cannot close this permit");
      }
      const after = await repo.updatePermit(p.id, { status: "CLOSED", closedAt: new Date(), closedById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "work_permit.close", entityType: "work_permit", entityId: p.id, projectId: p.projectId, before: { status: p.status }, after: { status: after.status } });
      return after;
    });
  },
};

// ── inspections (MVR / TR) ───────────────────────────────────────────
export const hseInspectionService = {
  async create(ctx: RequestContext, input: InspectionInput) {
    const data = parseInput(inspectionSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new HseRepo(tx, ctx.company.id);
      const project = await projectOr404(repo, data.projectId);
      requireHse(ctx, project.id, "hse.manage");
      await validateRefs(repo, project.id, data);
      const i = await repo.createInspection({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "hse_inspection.create", entityType: "hse_inspection", entityId: i.id, projectId: project.id, after: { ...i, index: inspectionIndex(i.correctCount, i.incorrectCount) } });
      return i;
    });
  },

  async get(ctx: RequestContext, inspectionId: string) {
    const repo = new HseRepo(readClient(), ctx.company.id);
    const i = await repo.findInspection(inspectionId);
    if (!i) throw new NotFoundError();
    const can = requireHseVisible(ctx, i.projectId);
    if (!can.view) throw new NotFoundError();
    const [actions, photos, users] = await Promise.all([
      repo.listActions({ projectId: i.projectId, sourceType: "INSPECTION", sourceId: i.id }),
      repo.listPhotos("INSPECTION", i.id),
      userNames(repo, [i.createdById]),
    ]);
    return {
      ...i,
      index: inspectionIndex(i.correctCount, i.incorrectCount),
      actions,
      photos: photos.map((p) => ({ ...p, sizeBytes: Number(p.sizeBytes) })),
      users,
      can: { addAction: can.manage, addPhoto: can.manage },
    };
  },
};
