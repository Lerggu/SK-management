import { v7 as uuidv7 } from "uuid";
import { Prisma, readClient, runInTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { uploadMaxBytes } from "@/platform/config/env";
import { getStorage } from "@/platform/storage";
import { checkRateLimit, RATE_LIMITS } from "@/platform/ratelimit";
import { canAccessProject, projectPermissions, type PermissionKey, type RequestContext } from "@/platform/authz";
import { resolveContentType, sanitizeFileName, sha256Hex } from "@/modules/documents/versioning";
import { DiaryRepo } from "./repo";
import { attachmentMetaSchema, entrySchema, listSchema, openReportSchema, reportFieldsSchema, type DiaryEntryInput } from "./schemas";

const IMAGE_OR_PDF = /^(image\/(png|jpeg|webp|heic)|application\/pdf)$/;

/** Diary visibility is project-scoped: not visible → 404, no capability → 403. */
function requireDiary(ctx: RequestContext, projectId: string, permission: PermissionKey) {
  if (!canAccessProject(ctx, projectId)) throw new NotFoundError();
  const perms = projectPermissions(ctx, projectId);
  if (!perms.has("diary.view")) throw new NotFoundError();
  if (!perms.has(permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

interface AttendanceRow {
  employeeId: string;
  name: string;
  employeeNumber: string;
  hours: string;
  statuses: string[];
}

/** Attendance = time entries on the site that day, summed per person. */
function summarizeAttendance(entries: Awaited<ReturnType<DiaryRepo["attendance"]>>): AttendanceRow[] {
  const by = new Map<string, AttendanceRow & { total: Prisma.Decimal }>();
  for (const e of entries) {
    const row = by.get(e.employeeId) ?? {
      employeeId: e.employeeId,
      name: `${e.employee.lastName} ${e.employee.firstName}`,
      employeeNumber: e.employee.employeeNumber,
      hours: "0",
      statuses: [],
      total: new Prisma.Decimal(0),
    };
    row.total = row.total.plus(e.hours);
    if (!row.statuses.includes(e.status)) row.statuses.push(e.status);
    by.set(e.employeeId, row);
  }
  return [...by.values()].map(({ total, ...r }) => ({ ...r, hours: total.toFixed(2) })).sort((a, b) => a.name.localeCompare(b.name));
}

export const diaryService = {
  async list(ctx: RequestContext, input: { projectId: string }) {
    const { projectId } = parseInput(listSchema, input);
    const repo = new DiaryRepo(readClient(), ctx.company.id);
    const project = await repo.findProject(projectId);
    if (!project) throw new NotFoundError();
    requireDiary(ctx, project.id, "diary.view");
    return repo.listForProject(project.id);
  },

  /** Opens the diary of a site for a day, creating the draft if needed. */
  async open(ctx: RequestContext, input: { siteId: string; date: string }) {
    const data = parseInput(openReportSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new DiaryRepo(tx, ctx.company.id);
      const site = await repo.findSite(data.siteId);
      if (!site) throw new NotFoundError();
      requireDiary(ctx, site.projectId, "diary.view");
      const existing = await repo.findBySiteDate(site.id, data.date);
      if (existing) return existing;
      requireDiary(ctx, site.projectId, "diary.manage");
      if (site.archivedAt || site.project.archivedAt) throw new ValidationError({ _form: ["validation.archived"] });
      const report = await repo.create({ projectId: site.projectId, siteId: site.id, reportDate: data.date, createdById: ctx.user.id, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "daily_report.create", entityType: "daily_report", entityId: report.id, projectId: report.projectId, after: report });
      return report;
    });
  },

  async get(ctx: RequestContext, reportId: string) {
    const repo = new DiaryRepo(readClient(), ctx.company.id);
    const report = await repo.findDetailed(reportId);
    if (!report) throw new NotFoundError();
    requireDiary(ctx, report.projectId, "diary.view");
    const attendance =
      report.status === "SIGNED" ? ((report.attendanceSnapshot as unknown as AttendanceRow[]) ?? []) : summarizeAttendance(await repo.attendance(report.siteId, report.reportDate));
    const perms = projectPermissions(ctx, report.projectId);
    const signer = report.signedById ? (await repo.findUsers([report.signedById]))[0] ?? null : null;
    return {
      ...report,
      attachments: report.attachments.map((a) => ({ ...a, sizeBytes: Number(a.sizeBytes) })),
      attendance,
      signer,
      permissions: { manage: perms.has("diary.manage"), sign: perms.has("diary.sign") },
    };
  },

  /** Equipment offered for equipment-hour entries. */
  async equipmentOptions(ctx: RequestContext, reportId: string) {
    const repo = new DiaryRepo(readClient(), ctx.company.id);
    const report = await repo.find(reportId);
    if (!report) throw new NotFoundError();
    requireDiary(ctx, report.projectId, "diary.manage");
    return repo.listEquipment();
  },

  async update(ctx: RequestContext, reportId: string, input: { weather?: string | null; summary?: string | null }) {
    const data = parseInput(reportFieldsSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new DiaryRepo(tx, ctx.company.id);
      const before = await repo.find(reportId);
      if (!before) throw new NotFoundError();
      requireDiary(ctx, before.projectId, "diary.manage");
      if (before.status === "SIGNED") throw new ValidationError({ _form: ["validation.diarySigned"] });
      const after = await repo.update(before.id, { ...data, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "daily_report.update", entityType: "daily_report", entityId: after.id, projectId: after.projectId, before, after, diff: true });
      return after;
    });
  },

  /** Adds an entry to a draft, or an audited addendum to a signed diary. */
  async addEntry(ctx: RequestContext, reportId: string, input: DiaryEntryInput) {
    const data = parseInput(entrySchema, input);
    return runInTransaction(async (tx) => {
      const repo = new DiaryRepo(tx, ctx.company.id);
      const report = await repo.find(reportId);
      if (!report) throw new NotFoundError();
      requireDiary(ctx, report.projectId, "diary.manage");
      if (data.kind === "EQUIPMENT" && !(await repo.findEquipment(data.equipmentId!))) throw new ValidationError({ equipmentId: ["validation.invalidOption"] });
      const isAddendum = report.status === "SIGNED";
      const entry = await repo.createEntry({
        dailyReportId: report.id,
        kind: data.kind,
        description: data.description,
        equipmentId: data.kind === "EQUIPMENT" ? data.equipmentId : null,
        hours: data.kind === "EQUIPMENT" ? data.hours : null,
        isAddendum,
        createdById: ctx.user.id,
      });
      await writeAudit(tx, ctx, {
        action: isAddendum ? "daily_report.addendum" : "daily_report.entry_add",
        entityType: "daily_report_entry",
        entityId: entry.id,
        projectId: report.projectId,
        after: { dailyReportId: report.id, kind: entry.kind, description: entry.description, equipmentId: entry.equipmentId, hours: entry.hours },
      });
      return entry;
    });
  },

  async removeEntry(ctx: RequestContext, entryId: string) {
    return runInTransaction(async (tx) => {
      const repo = new DiaryRepo(tx, ctx.company.id);
      const entry = await repo.findEntry(entryId);
      if (!entry) throw new NotFoundError();
      const report = await repo.find(entry.dailyReportId);
      if (!report) throw new NotFoundError();
      requireDiary(ctx, report.projectId, "diary.manage");
      if (report.status === "SIGNED") throw new ValidationError({ _form: ["validation.diarySigned"] });
      await repo.deleteEntry(entry.id);
      await writeAudit(tx, ctx, {
        action: "daily_report.entry_remove",
        entityType: "daily_report_entry",
        entityId: entry.id,
        projectId: report.projectId,
        before: { dailyReportId: report.id, kind: entry.kind, description: entry.description, equipmentId: entry.equipmentId, hours: entry.hours },
      });
    });
  },

  /** Photo or PDF for the diary (addendum after signing). */
  async addAttachment(ctx: RequestContext, reportId: string, input: { caption?: string | null }, file: { fileName: string; bytes: Uint8Array }) {
    const meta = parseInput(attachmentMetaSchema, input);
    const report = await new DiaryRepo(readClient(), ctx.company.id).find(reportId);
    if (!report) throw new NotFoundError();
    requireDiary(ctx, report.projectId, "diary.manage");
    checkRateLimit(RATE_LIMITS.upload, ctx.user.id);
    const fileName = sanitizeFileName(file.fileName);
    const contentType = resolveContentType(fileName);
    if (!contentType || !IMAGE_OR_PDF.test(contentType)) throw new ValidationError({ file: ["validation.imageType"] });
    if (file.bytes.byteLength === 0) throw new ValidationError({ file: ["validation.fileEmpty"] });
    if (file.bytes.byteLength > uploadMaxBytes()) throw new ValidationError({ file: ["validation.fileTooLarge"] });
    const id = uuidv7();
    const storageKey = `companies/${ctx.company.id}/daily-reports/${report.id}/attachments/${id}`;
    await getStorage().put(storageKey, file.bytes, contentType);
    return runInTransaction(async (tx) => {
      const repo = new DiaryRepo(tx, ctx.company.id);
      const current = await repo.find(report.id);
      const isAddendum = current?.status === "SIGNED";
      const a = await repo.createAttachment({
        id,
        dailyReportId: report.id,
        fileName,
        contentType,
        sizeBytes: BigInt(file.bytes.byteLength),
        sha256: sha256Hex(file.bytes),
        storageKey,
        caption: meta.caption,
        isAddendum,
        createdById: ctx.user.id,
      });
      await writeAudit(tx, ctx, {
        action: isAddendum ? "daily_report.addendum" : "daily_report.attachment_add",
        entityType: "daily_report_attachment",
        entityId: a.id,
        projectId: report.projectId,
        after: { dailyReportId: report.id, fileName, sha256: a.sha256, caption: a.caption },
      });
      return { ...a, sizeBytes: Number(a.sizeBytes) };
    });
  },

  async downloadAttachment(ctx: RequestContext, attachmentId: string) {
    const repo = new DiaryRepo(readClient(), ctx.company.id);
    const a = await repo.findAttachment(attachmentId);
    if (!a) throw new NotFoundError();
    const report = await repo.find(a.dailyReportId);
    if (!report) throw new NotFoundError();
    requireDiary(ctx, report.projectId, "diary.view");
    const object = await getStorage().get(a.storageKey);
    if (!object) throw new NotFoundError("File missing from storage");
    return { fileName: a.fileName, contentType: a.contentType, body: object.body };
  },

  /** Signing freezes attendance and locks the diary (DB trigger). */
  async sign(ctx: RequestContext, reportId: string) {
    return runInTransaction(async (tx) => {
      const repo = new DiaryRepo(tx, ctx.company.id);
      const report = await repo.find(reportId);
      if (!report) throw new NotFoundError();
      requireDiary(ctx, report.projectId, "diary.sign");
      if (report.status === "SIGNED") throw new ValidationError({ _form: ["validation.diarySigned"] });
      const attendance = summarizeAttendance(await repo.attendance(report.siteId, report.reportDate));
      const signed = await repo.update(report.id, {
        status: "SIGNED",
        signedAt: new Date(),
        signedById: ctx.user.id,
        attendanceSnapshot: attendance as unknown as object,
        updatedById: ctx.user.id,
      });
      await writeAudit(tx, ctx, {
        action: "daily_report.sign",
        entityType: "daily_report",
        entityId: signed.id,
        projectId: signed.projectId,
        before: { status: "DRAFT" },
        after: { status: "SIGNED", attendance: attendance.length },
      });
      return signed;
    });
  },
};
