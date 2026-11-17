import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { readClient, runInTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { optionalText, parseInput } from "@/platform/http/validation";
import { getStorage } from "@/platform/storage";
import { getMailer } from "@/platform/mail";
import { appBaseUrl } from "@/platform/config/env";
import { translate } from "@/platform/i18n/translate";
import { checkRateLimit, RATE_LIMITS } from "@/platform/ratelimit";
import { hasProjectPermission, projectIdsWithPermission, resolvePermissions, type RequestContext } from "@/platform/authz";
import { requireLogistics } from "@/modules/logistics/access";
import { sha256Hex } from "@/modules/documents/versioning";
import { validateHrFile } from "@/modules/hr/files.service";
import { ProductionRepo } from "./repo";

export const DEVIATION_TYPES = ["LATE_DELIVERY", "RESOURCE_MISSING", "EQUIPMENT_FAULT", "WEATHER", "SAFETY", "OTHER"] as const;

const reportSchema = z.object({ type: z.enum(DEVIATION_TYPES), comment: optionalText(1000) });
const resolveSchema = z.object({ resolution: optionalText(1000) });
const listSchema = z.object({ requestId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()), open: z.preprocess((v) => v === true || v === "1" || v === "true", z.boolean()).default(false) });

type Photo = { fileName: string; bytes: Uint8Array };

const toGrant = (r: { templateKey: string | null; projectAccess: "ALL" | "ASSIGNED"; permissions: { permissionKey: string }[] }) => ({
  templateKey: r.templateKey,
  projectAccess: r.projectAccess,
  permissions: r.permissions.map((p) => p.permissionKey),
});

/**
 * Deviations of logistics tasks (ADR 0026, phase 3). Anyone who sees the
 * task's logistics reports one from the phone (type, optional photo and
 * comment); logistics approvers are notified by e-mail and acknowledge and
 * resolve it. Open deviations blink red in the production calendar.
 */
export const deviationService = {
  async report(ctx: RequestContext, requestId: string, input: { type?: string; comment?: string | null }, photo?: Photo | null) {
    const data = parseInput(reportSchema, input);
    if (ctx.external) throw new NotFoundError();
    const repo = new ProductionRepo(readClient(), ctx.company.id);
    const task = await repo.findRequest(requestId);
    if (!task) throw new NotFoundError();
    requireLogistics(ctx, task.projectId, "logistics.view");
    if (task.status === "CANCELLED") throw new ValidationError({ _form: ["validation.invalidTransition"] });

    let stored: { fileName: string; contentType: string; size: number; sha256: string; key: string; id: string } | null = null;
    if (photo) {
      checkRateLimit(RATE_LIMITS.upload, ctx.user.id);
      const { fileName, contentType } = validateHrFile(photo, true);
      const id = uuidv7();
      const key = `companies/${ctx.company.id}/logistics/deviations/${task.id}/${id}`;
      await getStorage().put(key, photo.bytes, contentType);
      stored = { fileName, contentType, size: photo.bytes.byteLength, sha256: sha256Hex(photo.bytes), key, id };
    }

    const deviation = await runInTransaction(async (tx) => {
      const trepo = new ProductionRepo(tx, ctx.company.id);
      const d = await trepo.createDeviation({ projectId: task.projectId, requestId: task.id, type: data.type, comment: data.comment, reportedById: ctx.user.id });
      if (stored) {
        await trepo.createDeviationPhoto({ id: stored.id, deviationId: d.id, fileName: stored.fileName, contentType: stored.contentType, sizeBytes: BigInt(stored.size), sha256: stored.sha256, storageKey: stored.key, createdById: ctx.user.id });
      }
      await writeAudit(tx, ctx, { action: "logistics_deviation.report", entityType: "logistics_deviation", entityId: d.id, projectId: task.projectId, after: { requestId: task.id, type: d.type, photo: Boolean(stored) } });
      return d;
    });
    const notify = await notifyApprovers(ctx, deviation.id, task, data.type);
    return { id: deviation.id, status: deviation.status, ...notify };
  },

  /** Deviations of the visible projects, or of one task; `open` = open and acknowledged only. */
  async list(ctx: RequestContext, input: { requestId?: string; open?: boolean | string } = {}) {
    const data = parseInput(listSchema, input);
    if (ctx.external) throw new ForbiddenError("External members have no logistics access");
    const repo = new ProductionRepo(readClient(), ctx.company.id);
    let projectIds = projectIdsWithPermission(ctx, "logistics.view");
    if (projectIds && projectIds.length === 0) throw new ForbiddenError("Missing permission logistics.view");
    if (data.requestId) {
      const task = await repo.findRequest(data.requestId);
      if (!task) throw new NotFoundError();
      requireLogistics(ctx, task.projectId, "logistics.view");
      projectIds = [task.projectId];
    }
    const rows = await repo.listDeviations({ projectIds, requestId: data.requestId, open: data.open });
    const users = await repo.usersByIds([...new Set(rows.flatMap((r) => [r.reportedById, r.acknowledgedById, r.resolvedById]).filter((x): x is string => !!x))]);
    const name = (id: string | null) => {
      const u = users.find((x) => x.id === id);
      return u ? (u.name ?? u.email) : null;
    };
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      comment: r.comment,
      resolution: r.resolution,
      createdAt: r.createdAt,
      acknowledgedAt: r.acknowledgedAt,
      resolvedAt: r.resolvedAt,
      reportedBy: name(r.reportedById),
      acknowledgedBy: name(r.acknowledgedById),
      resolvedBy: name(r.resolvedById),
      photoIds: r.photos.map((p) => p.id),
      task: { id: r.request.id, title: r.request.title, site: `${r.request.site.project.code} · ${r.request.site.name}` },
      canManage: hasProjectPermission(ctx, r.projectId, "logistics.approve") && r.status !== "RESOLVED",
    }));
  },

  async acknowledge(ctx: RequestContext, deviationId: string) {
    return manage(ctx, deviationId, async (repo, d) => {
      if (d.status !== "OPEN") return d;
      return repo.updateDeviation(d.id, { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedById: ctx.user.id });
    }, "logistics_deviation.acknowledge");
  },

  async resolve(ctx: RequestContext, deviationId: string, input: { resolution?: string | null } = {}) {
    const data = parseInput(resolveSchema, input);
    return manage(ctx, deviationId, async (repo, d) => {
      if (d.status === "RESOLVED") return d;
      return repo.updateDeviation(d.id, { status: "RESOLVED", resolvedAt: new Date(), resolvedById: ctx.user.id, resolution: data.resolution, acknowledgedAt: d.acknowledgedAt ?? new Date(), acknowledgedById: d.acknowledgedById ?? ctx.user.id });
    }, "logistics_deviation.resolve");
  },

  /** Authorized photo download (images only, checked on upload). */
  async photo(ctx: RequestContext, photoId: string) {
    const repo = new ProductionRepo(readClient(), ctx.company.id);
    const p = await repo.findDeviationPhoto(photoId);
    if (!p || ctx.external) throw new NotFoundError();
    requireLogistics(ctx, p.deviation.projectId, "logistics.view");
    const object = await getStorage().get(p.storageKey);
    if (!object) throw new NotFoundError("File missing from storage");
    return { fileName: p.fileName, contentType: p.contentType, body: object.body };
  },
};

async function manage(
  ctx: RequestContext,
  deviationId: string,
  fn: (repo: ProductionRepo, d: NonNullable<Awaited<ReturnType<ProductionRepo["findDeviation"]>>>) => Promise<{ id: string; status: string }>,
  action: string,
) {
  if (ctx.external) throw new NotFoundError();
  const d = await new ProductionRepo(readClient(), ctx.company.id).findDeviation(deviationId);
  if (!d) throw new NotFoundError();
  requireLogistics(ctx, d.projectId, "logistics.approve");
  return runInTransaction(async (tx) => {
    const after = await fn(new ProductionRepo(tx, ctx.company.id), d);
    if (after.status !== d.status) await writeAudit(tx, ctx, { action, entityType: "logistics_deviation", entityId: d.id, projectId: d.projectId, before: { status: d.status }, after: { status: after.status } });
    return { id: after.id, status: after.status };
  });
}

/**
 * E-mails the project's logistics approvers (capability, never role names).
 * Runs after the report is saved: a mail failure never loses the report.
 */
async function notifyApprovers(ctx: RequestContext, deviationId: string, task: { id: string; title: string; projectId: string }, type: string) {
  const repo = new ProductionRepo(readClient(), ctx.company.id);
  const members = await repo.membersWithRoles(task.projectId);
  const recipients = members.filter((m) => {
    if (m.userId === ctx.user.id) return false;
    const r = resolvePermissions(
      m.roles.map((x) => toGrant(x.role)),
      m.projectMemberships.map((pm) => ({ projectId: pm.projectId, role: toGrant(pm.role) })),
    );
    if (r.external) return false;
    const access = r.projectAccess === "ALL" || r.projectGrants.has(task.projectId);
    return access && (r.permissions.has("logistics.approve") || (r.projectGrants.get(task.projectId)?.has("logistics.approve") ?? false));
  });
  const mailer = getMailer();
  let sent = 0;
  if (mailer) {
    const link = `${appBaseUrl()}/c/${ctx.company.slug}/logistics/requests/${task.id}`;
    for (const r of recipients) {
      const params = { task: task.title, type: translate(r.user.locale, `production.deviations.types.${type}`), link };
      try {
        await mailer.send({ to: r.user.email, subject: translate(r.user.locale, "mail.deviationSubject", params), text: translate(r.user.locale, "mail.deviationBody", params) });
        sent += 1;
      } catch (e) {
        console.error("deviation notification failed", { deviationId, error: (e as Error).message });
      }
    }
  }
  await runInTransaction(async (tx) => {
    await new ProductionRepo(tx, ctx.company.id).updateDeviation(deviationId, { notifiedAt: new Date() });
    await writeAudit(tx, ctx, { action: "logistics_deviation.notify", entityType: "logistics_deviation", entityId: deviationId, projectId: task.projectId, metadata: { recipients: recipients.length, emailsSent: sent, channel: mailer?.kind ?? "in-app" } });
  });
  return { recipients: recipients.length, emailsSent: sent };
}
