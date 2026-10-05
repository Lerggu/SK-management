import { createHash, randomUUID } from "node:crypto";
import { readClient, runInTransaction } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import type { RequestContext } from "@/platform/authz";
import { D, WORK_CLASS_MULTIPLIER, roundCents } from "@/modules/finance/calculations";
import { projectsWith, requireCompanyPermission, requireProjectCommercial } from "./access";
import { CommercialRepo } from "./repo";
import { bookedHours, findHourlyBillingRate, lineAmount, toCsv, type BillingRate, type ExportRow } from "./rules";
import { candidateListSchema, exportSchema, generateInternalSchema, generateSchema, markInvoicedSchema, noteSchema, type ExportInput, type GenerateInput, type MarkInvoicedInput } from "./schemas";

type NewCandidate = Parameters<CommercialRepo["createCandidates"]>[0][number];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayEnd = (d: Date) => new Date(d.getTime() + 86_400_000 - 1);

function candidate(c: Omit<NewCandidate, "amount" | "createdById" | "updatedById">, userId: string): NewCandidate {
  return { ...c, amount: lineAmount(c.quantity as string, c.unitPrice as string), createdById: userId, updatedById: userId };
}

function present<T extends { quantity: { toString(): string }; unitPrice: { toString(): string }; amount: { toString(): string } }>(c: T) {
  return { ...c, quantity: c.quantity.toString(), unitPrice: c.unitPrice.toString(), amount: c.amount.toString() };
}

const CUSTOMER_COLUMNS = ["candidateId", "sourceType", "sourceId", "projectCode", "customer", "customerBusinessId", "periodDate", "description", "quantity", "unit", "unitPrice", "amount", "currency"] as const;
const INTERNAL_COLUMNS = ["candidateId", "sourceType", "sourceId", "billToCompany", "billToBusinessId", "periodDate", "description", "quantity", "unit", "unitPrice", "amount", "currency"] as const;
const NUMERIC = new Set(["quantity", "unitPrice", "amount"]);

export const invoiceService = {
  async list(ctx: RequestContext, input: { projectId?: string | null; status?: string; kind?: string } = {}) {
    const data = parseInput(candidateListSchema, input);
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    if (data.kind === "INTERNAL") {
      requireCompanyPermission(ctx, "invoice.manage");
      return (await repo.listCandidates({ internal: true, status: data.status })).map(present);
    }
    let projectIds = projectsWith(ctx, "invoice.manage");
    if (data.projectId) {
      const p = await repo.findProject(data.projectId);
      if (!p) throw new NotFoundError();
      requireProjectCommercial(ctx, p.id, "invoice.manage");
      projectIds = [p.id];
    } else requireCompanyPermission(ctx, "invoice.manage");
    return (await repo.listCandidates({ internal: false, projectIds, status: data.status })).map(present);
  },

  /**
   * Invoice candidates for one project up to a date, from approved data only:
   * - LABOR: approved or payroll-exported hours × employee hourly BILLING rate × work-class multiplier;
   * - EQUIPMENT: signed site-diary equipment hours × equipment hourly BILLING rate;
   * - VARIATION: variations marked ready to invoice (sales price);
   * - MILESTONE: contract milestones due by the date.
   * A source is billed once; lines without a billing rate are reported, never guessed.
   */
  async generate(ctx: RequestContext, input: GenerateInput) {
    const data = parseInput(generateSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const project = await repo.findProject(data.projectId);
      if (!project) throw new NotFoundError();
      requireProjectCommercial(ctx, project.id, "invoice.manage");
      const currency = ctx.company.defaultCurrency;
      const to = data.to;
      const rows: NewCandidate[] = [];
      const unpriced: { sourceType: string; sourceId: string; description: string }[] = [];
      const base = { projectId: project.id, customerId: project.customerId, currency };

      const hours = await repo.billableTimeEntries(project.id, to);
      const doneLabor = new Set((await repo.existingSources("LABOR", hours.map((h) => h.id))).map((r) => r.sourceId));
      const empRates: BillingRate[] = (await repo.employeeBillingRates([...new Set(hours.map((h) => h.employeeId))])).map((r) => ({ ...r, resourceId: r.employeeId }));
      for (const h of hours) {
        if (doneLabor.has(h.id)) continue;
        const desc = `${h.employee.lastName} ${h.employee.firstName} ${iso(h.workDate)}${h.workClass !== "NORMAL" ? ` (${h.workClass})` : ""}`;
        const rate = findHourlyBillingRate(empRates, h.employeeId, h.workDate, currency);
        if (!rate) {
          unpriced.push({ sourceType: "LABOR", sourceId: h.id, description: desc });
          continue;
        }
        rows.push(candidate({ ...base, sourceType: "LABOR", sourceId: h.id, description: desc, quantity: h.hours.toString(), unit: "h", unitPrice: roundCents(rate.times(WORK_CLASS_MULTIPLIER[h.workClass])).toString(), periodDate: h.workDate }, ctx.user.id));
      }

      const eq = await repo.billableEquipmentHours(project.id, to);
      const doneEq = new Set((await repo.existingSources("EQUIPMENT", eq.map((e) => e.id))).map((r) => r.sourceId));
      const eqRates: BillingRate[] = (await repo.equipmentBillingRates([...new Set(eq.map((e) => e.equipmentId!))])).map((r) => ({ ...r, resourceId: r.equipmentId }));
      for (const e of eq) {
        if (doneEq.has(e.id)) continue;
        const desc = `${e.equipment!.assetNumber} ${e.equipment!.name} ${iso(e.dailyReport.reportDate)}`;
        const rate = findHourlyBillingRate(eqRates, e.equipmentId!, e.dailyReport.reportDate, currency);
        if (!rate) {
          unpriced.push({ sourceType: "EQUIPMENT", sourceId: e.id, description: desc });
          continue;
        }
        rows.push(candidate({ ...base, sourceType: "EQUIPMENT", sourceId: e.id, description: desc, quantity: e.hours!.toString(), unit: "h", unitPrice: rate.toString(), periodDate: e.dailyReport.reportDate }, ctx.user.id));
      }

      const vars = await repo.readyVariations(project.id);
      const doneVar = new Set((await repo.existingSources("VARIATION", vars.map((v) => v.id))).map((r) => r.sourceId));
      for (const v of vars) {
        if (doneVar.has(v.id) || v.currency !== currency) continue;
        rows.push(candidate({ ...base, sourceType: "VARIATION", sourceId: v.id, description: `Lisätyö ${v.number}: ${v.title}`, quantity: "1", unit: "erä", unitPrice: v.salesPrice.toString(), periodDate: to }, ctx.user.id));
      }

      const ms = await repo.dueMilestones(project.id, to);
      const doneMs = new Set((await repo.existingSources("MILESTONE", ms.map((m) => m.id))).map((r) => r.sourceId));
      for (const m of ms) {
        if (doneMs.has(m.id)) continue;
        rows.push(candidate({ ...base, customerId: m.contract.customerId, sourceType: "MILESTONE", sourceId: m.id, description: `${m.contract.contractNumber}: ${m.title}`, quantity: "1", unit: "erä", unitPrice: m.amount.toString(), periodDate: m.dueDate }, ctx.user.id));
      }

      const created = rows.length ? (await repo.createCandidates(rows)).count : 0;
      const total = rows.reduce((a, r) => a.plus(D(r.amount as string)), D(0)).toString();
      await writeAudit(tx, ctx, { action: "invoice_candidate.generate", entityType: "project", entityId: project.id, projectId: project.id, after: { to: iso(to), created, total, unpriced: unpriced.length } });
      return { created, total, unpriced };
    });
  },

  /**
   * Internal invoicing (owner decision 2): approved bookings of this
   * company's resources by other group companies × booked hours × this
   * company's (the owner's) hourly BILLING rate on the booking day.
   */
  async generateInternal(ctx: RequestContext, input: { to: string }) {
    requireCompanyPermission(ctx, "invoice.manage");
    const data = parseInput(generateInternalSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const currency = ctx.company.defaultCurrency;
      const bookings = await repo.internalBookings(dayEnd(data.to));
      const done = new Set((await repo.existingSources("INTERNAL_BOOKING", bookings.map((b) => b.id))).map((r) => r.sourceId));
      const empRates: BillingRate[] = (await repo.employeeBillingRates([...new Set(bookings.map((b) => b.employeeId).filter((x): x is string => !!x))])).map((r) => ({ ...r, resourceId: r.employeeId }));
      const eqRates: BillingRate[] = (await repo.equipmentBillingRates([...new Set(bookings.map((b) => b.equipmentId).filter((x): x is string => !!x))])).map((r) => ({ ...r, resourceId: r.equipmentId }));
      const rows: NewCandidate[] = [];
      const unpriced: { sourceType: string; sourceId: string; description: string }[] = [];
      for (const b of bookings) {
        if (done.has(b.id)) continue;
        const label = b.employee ? `${b.employee.lastName} ${b.employee.firstName}` : `${b.equipment!.assetNumber} ${b.equipment!.name}`;
        const desc = `${label} → ${b.company.name} ${b.project.code} ${iso(b.startsAt)}`;
        const rate = b.employee ? findHourlyBillingRate(empRates, b.employee.id, b.startsAt, currency) : findHourlyBillingRate(eqRates, b.equipment!.id, b.startsAt, currency);
        if (!rate) {
          unpriced.push({ sourceType: "INTERNAL_BOOKING", sourceId: b.id, description: desc });
          continue;
        }
        rows.push(candidate({ projectId: null, customerId: null, billToCompanyId: b.companyId, currency, sourceType: "INTERNAL_BOOKING", sourceId: b.id, description: desc, quantity: bookedHours(b.startsAt, b.endsAt).toString(), unit: "h", unitPrice: rate.toString(), periodDate: new Date(`${iso(b.startsAt)}T00:00:00Z`) }, ctx.user.id));
      }
      const created = rows.length ? (await repo.createCandidates(rows)).count : 0;
      const total = rows.reduce((a, r) => a.plus(D(r.amount as string)), D(0)).toString();
      await writeAudit(tx, ctx, { action: "invoice_candidate.generate_internal", entityType: "company", entityId: ctx.company.id, after: { to: iso(data.to), created, total, unpriced: unpriced.length } });
      return { created, total, unpriced };
    });
  },

  /** What other group companies bill to this company (amount and basis only). */
  async incomingInternal(ctx: RequestContext) {
    requireCompanyPermission(ctx, "invoice.manage");
    return (await new CommercialRepo(readClient(), ctx.company.id).incomingInternal()).map(present);
  },

  async void(ctx: RequestContext, candidateId: string, input: { note?: string | null } = {}) {
    const data = parseInput(noteSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const c = await repo.findCandidate(candidateId);
      if (!c) throw new NotFoundError();
      if (c.projectId) requireProjectCommercial(ctx, c.projectId, "invoice.manage");
      else requireCompanyPermission(ctx, "invoice.manage");
      if (c.status !== "OPEN") throw new ValidationError({ _form: ["validation.candidateNotOpen"] });
      await repo.updateCandidates([c.id], { status: "VOID", updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "invoice_candidate.void", entityType: "invoice_candidate", entityId: c.id, projectId: c.projectId, before: { status: "OPEN", amount: c.amount.toString() }, after: { status: "VOID", note: data.note } });
    });
  },

  /**
   * File export (owner decision 1): an immutable CSV/JSON batch with SHA-256.
   * Open candidates are exported once; including already exported rows is an
   * explicit, audited re-export.
   */
  async export(ctx: RequestContext, input: ExportInput) {
    const data = parseInput(exportSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const internal = data.kind === "INTERNAL";
      let projectIds: string[] | undefined;
      if (internal) requireCompanyPermission(ctx, "invoice.manage");
      else if (data.projectId) {
        const p = await repo.findProject(data.projectId);
        if (!p) throw new NotFoundError();
        requireProjectCommercial(ctx, p.id, "invoice.manage");
        projectIds = [p.id];
      } else {
        requireCompanyPermission(ctx, "invoice.manage");
        projectIds = projectsWith(ctx, "invoice.manage");
      }
      const rows = [
        ...(await repo.listCandidates({ internal, projectIds, status: "OPEN" })),
        ...(data.includeExported ? await repo.listCandidates({ internal, projectIds, status: "EXPORTED" }) : []),
      ];
      if (rows.length === 0) throw new ValidationError({ _form: ["validation.nothingToExport"] });
      const currencies = new Set(rows.map((r) => r.currency));
      if (currencies.size > 1) throw new ValidationError({ _form: ["validation.mixedCurrency"] });
      const currency = rows[0].currency;
      const total = rows.reduce((a, r) => a.plus(r.amount), D(0));
      const id = randomUUID();
      const out: ExportRow[] = rows.map((r): ExportRow =>
        internal
          ? { candidateId: r.id, sourceType: r.sourceType, sourceId: r.sourceId, billToCompany: r.billToCompany?.name ?? "", billToBusinessId: r.billToCompany?.businessId ?? "", periodDate: iso(r.periodDate), description: r.description, quantity: r.quantity.toString(), unit: r.unit, unitPrice: r.unitPrice.toString(), amount: r.amount.toString(), currency: r.currency }
          : { candidateId: r.id, sourceType: r.sourceType, sourceId: r.sourceId, projectCode: r.project?.code ?? "", customer: r.customer?.name ?? "", customerBusinessId: r.customer?.businessId ?? "", periodDate: iso(r.periodDate), description: r.description, quantity: r.quantity.toString(), unit: r.unit, unitPrice: r.unitPrice.toString(), amount: r.amount.toString(), currency: r.currency },
      );
      const createdAt = new Date();
      const content =
        data.format === "CSV"
          ? toCsv(internal ? INTERNAL_COLUMNS : CUSTOMER_COLUMNS, out, NUMERIC)
          : `${JSON.stringify({ batchId: id, kind: data.kind, company: ctx.company.name, createdAt: createdAt.toISOString(), currency, total: total.toString(), rows: out }, null, 2)}\n`;
      const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
      const fileName = `${internal ? "sisainen-laskutus" : "laskutus"}-${iso(createdAt)}-${id.slice(0, 8)}.${data.format.toLowerCase()}`;
      await repo.createExportBatch({ id, kind: data.kind, format: data.format, fileName, content, sha256, rowCount: rows.length, total, currency, reexport: rows.some((r) => r.status === "EXPORTED"), createdAt, createdById: ctx.user.id });
      await repo.updateCandidates(
        rows.map((r) => r.id),
        { status: "EXPORTED", exportBatchId: id, updatedById: ctx.user.id },
      );
      await writeAudit(tx, ctx, { action: "invoice_export.create", entityType: "invoice_export", entityId: id, projectId: data.projectId, after: { kind: data.kind, format: data.format, rows: rows.length, total: total.toString(), sha256, reexported: rows.filter((r) => r.status === "EXPORTED").length } });
      return { id, fileName, rowCount: rows.length, total: total.toString(), sha256 };
    });
  },

  async listExports(ctx: RequestContext) {
    requireCompanyPermission(ctx, "invoice.manage");
    const rows = await new CommercialRepo(readClient(), ctx.company.id).listExportBatches();
    return rows.map((b) => ({ ...b, total: b.total.toString() }));
  },

  /** The stored export file, byte for byte (its SHA-256 is recorded). */
  async download(ctx: RequestContext, batchId: string) {
    requireCompanyPermission(ctx, "invoice.manage");
    const repo = new CommercialRepo(readClient(), ctx.company.id);
    const b = await repo.findExportBatch(batchId);
    if (!b) throw new NotFoundError();
    // A member limited to some projects may only download batches of those projects.
    const allowed = projectsWith(ctx, "invoice.manage");
    if (allowed && b.candidates.some((c) => !c.projectId || !allowed.includes(c.projectId))) throw new NotFoundError();
    return { fileName: b.fileName, contentType: b.format === "CSV" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8", content: b.content, sha256: b.sha256 };
  },

  /** Marks exported candidates as invoiced in the accounting system (manual reference). */
  async markInvoiced(ctx: RequestContext, input: MarkInvoicedInput) {
    const data = parseInput(markInvoicedSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new CommercialRepo(tx, ctx.company.id);
      const rows = [...(await repo.listCandidates({ internal: false, ids: data.ids })), ...(await repo.listCandidates({ internal: true, ids: data.ids }))];
      if (rows.length !== new Set(data.ids).size) throw new NotFoundError();
      for (const r of rows) {
        if (r.projectId) requireProjectCommercial(ctx, r.projectId, "invoice.manage");
        else requireCompanyPermission(ctx, "invoice.manage");
        if (r.status !== "EXPORTED") throw new ValidationError({ _form: ["validation.candidateNotExported"] });
      }
      await repo.updateCandidates(
        rows.map((r) => r.id),
        { status: "INVOICED", invoicedAt: new Date(), invoicedById: ctx.user.id, invoiceReference: data.invoiceReference, updatedById: ctx.user.id },
      );
      // An invoiced variation completes its §21 lifecycle.
      for (const r of rows.filter((x) => x.sourceType === "VARIATION")) await repo.updateVariation(r.sourceId, { status: "INVOICED", updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "invoice_candidate.invoiced", entityType: "invoice_candidate", entityId: rows[0].id, after: { ids: rows.map((r) => r.id), invoiceReference: data.invoiceReference, total: rows.reduce((a, r) => a.plus(r.amount), D(0)).toString() } });
      return { count: rows.length };
    });
  },
};
