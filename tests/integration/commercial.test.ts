import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError } from "@/platform/errors";
import { resolveRequestContext } from "@/modules/companies/context";
import { companyDirectoryService } from "@/modules/companies/service";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { documentService } from "@/modules/documents/service";
import { timesheetService } from "@/modules/timesheets/service";
import { bookingService } from "@/modules/logistics/booking.service";
import { commercialDashboardService, customerService, opportunityService } from "@/modules/commercial/crm.service";
import { quoteService } from "@/modules/commercial/quote.service";
import { contractService, forecastService, variationService } from "@/modules/commercial/project.service";
import { invoiceService } from "@/modules/commercial/invoice.service";
import { budgetService } from "@/modules/finance/service";
import { auditFor, createMember, createTenant, meta, textFile } from "../helpers/fixtures";

async function setup() {
  const t = await createTenant("Com");
  const project = await projectService.create(t.ownerCtx, { code: "C", name: "Commercial project" });
  const site = await siteService.create(t.ownerCtx, project.id, { name: "Site C" });
  const pm = await createMember(t, "PROJECT_MANAGER", [{ projectId: project.id }]);
  const pd = await createMember(t, "PROJECT_DIRECTOR");
  const pd2 = await createMember(t, "PROJECT_DIRECTOR");
  const sm = await createMember(t, "SITE_MANAGER", [{ projectId: project.id }]);
  const customer = await customerService.create(pm, { name: "Datakeskus Demo Oy", businessId: "1111111-1", city: "Oulu" });
  return { t, project, site, pm, pd, pd2, sm, customer };
}
type S = Awaited<ReturnType<typeof setup>>;

async function quoteWithLines(s: S, author = s.pm) {
  const q = await quoteService.create(author, { customerId: s.customer.id, title: "Kaapelointi ja nostot" });
  await quoteService.addLine(author, q.id, { category: "LABOR", description: "Asennustyö", quantity: "400", unit: "h", unitCost: "45,50" });
  await quoteService.addLine(author, q.id, { category: "LIFTING", description: "Nostot", quantity: "3", unit: "kpl", unitCost: "1250" });
  await quoteService.addLine(author, q.id, { category: "MATERIALS", description: "Kaapelit", quantity: "1", unit: "erä", unitCost: "12000" });
  await quoteService.updateDraft(author, q.id, { overheadPct: "8", riskPct: "5", marginPct: "15", validUntil: "2026-12-31" });
  return q;
}

describe("acceptance 1: quotes cannot change silently; the Project Director approves", () => {
  it("prices, submits, approves (never by the author), sends and wins into a contract", async () => {
    const s = await setup();
    const opp = await opportunityService.create(s.pm, { customerId: s.customer.id, title: "Datakeskus vaihe 2", stage: "RFQ", estimatedValue: "50000", probabilityPct: "50" });
    const q = await quoteWithLines(s);
    await quoteService.updateDraft(s.pm, q.id, { overheadPct: "8", riskPct: "5", marginPct: "15" });
    await db.quote.update({ where: { id: q.id }, data: { opportunityId: opp.id } });
    const v1 = (await quoteService.get(s.pm, q.id)).versions[0];
    expect(v1.pricing).toMatchObject({ base: "33950", overhead: "2716", risk: "1833.3", cost: "38499.3", price: "45293.29", marginPct: "15" });

    await quoteService.submit(s.pm, q.id);
    // Frozen once submitted — in the service and in the database.
    await expect(quoteService.addLine(s.pm, q.id, { category: "OTHER", description: "x", quantity: "1", unit: "kpl", unitCost: "1" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.versionNotDraft"] } });
    await expect(db.quoteVersion.update({ where: { id: v1.id }, data: { marginPct: "40" } })).rejects.toThrow(/frozen/);
    await expect(db.quoteLine.deleteMany({ where: { versionId: v1.id } })).rejects.toThrow(/draft/);

    // PM prepares but cannot approve; approval by a Project Director.
    await expect(quoteService.decide(s.pm, q.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(db.quoteVersion.update({ where: { id: v1.id }, data: { status: "APPROVED", decidedById: v1.submittedById } })).rejects.toThrow(/author or submitter/);
    await quoteService.decide(s.pd, q.id, { decision: "APPROVE", note: "OK" });
    await quoteService.markSent(s.pm, q.id);
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stage).toBe("TENDER");

    const r = await quoteService.recordOutcome(s.pm, q.id, { outcome: "WON", projectId: s.project.id, signedDate: "2026-10-15" });
    const contract = await db.contract.findUniqueOrThrow({ where: { id: r.contractId! } });
    expect(contract).toMatchObject({ value: expect.anything(), customerId: s.customer.id, projectId: s.project.id, contractNumber: q.quoteNumber.replace("TAR-", "SOP-") });
    expect(contract.value.toString()).toBe("45293.29");
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stage).toBe("WON");
    expect((await db.project.findUniqueOrThrow({ where: { id: s.project.id } })).customerId).toBe(s.customer.id);
    const actions = (await auditFor(s.t.companyId, v1.id)).map((a) => a.action);
    expect(actions.filter((a) => !["quote.update", "quote.line_add"].includes(a))).toEqual(["quote.submit", "quote.approve", "quote.send", "quote.won"]);
  });

  it("the author never approves; a change is a new version that supersedes the sent one", async () => {
    const s = await setup();
    const q = await quoteWithLines(s, s.pd);
    await quoteService.submit(s.pd, q.id);
    expect((await quoteService.get(s.pd, q.id)).can).toMatchObject({ decide: false, selfApprovalBlocked: true });
    await expect(quoteService.decide(s.pd, q.id, { decision: "APPROVE" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.commercialSelfApproval"] } });
    await expect(quoteService.decide(s.pd2, q.id, { decision: "REJECT" })).rejects.toMatchObject({ fieldErrors: { note: ["validation.required"] } });
    await quoteService.decide(s.pd2, q.id, { decision: "APPROVE" });
    await quoteService.markSent(s.pd, q.id);

    const v2 = await quoteService.revise(s.pm, q.id, { reason: "Asiakas pyysi lisää nostoja" });
    expect(v2.versionNumber).toBe(2);
    await quoteService.addLine(s.pm, q.id, { category: "LIFTING", description: "Lisänosto", quantity: "1", unit: "kpl", unitCost: "1250" });
    await quoteService.submit(s.pm, q.id);
    await quoteService.decide(s.pd, q.id, { decision: "APPROVE" });
    const versions = (await quoteService.get(s.pm, q.id)).versions;
    expect(versions.map((v) => [v.versionNumber, v.status])).toEqual([
      [2, "APPROVED"],
      [1, "SUPERSEDED"],
    ]);
    expect(Number(versions[0].pricing.price)).toBeGreaterThan(Number(versions[1].pricing.price));
    await quoteService.markSent(s.pm, q.id);
    await expect(quoteService.recordOutcome(s.pm, q.id, { outcome: "LOST" })).rejects.toMatchObject({ fieldErrors: { note: ["validation.required"] } });
    await quoteService.recordOutcome(s.pm, q.id, { outcome: "LOST", note: "Hinta" });
    await expect(db.quoteVersion.update({ where: { id: versions[0].id }, data: { status: "SENT" } })).rejects.toThrow();
  });
});

describe("acceptance 2: variations follow §21; approved-but-uninvoiced value is visible", () => {
  it("draft → internal review → PD approval → client approval with evidence → executed → ready → invoiced", async () => {
    const s = await setup();
    const contract = await contractService.create(s.pm, { projectId: s.project.id, customerId: s.customer.id, contractNumber: "SOP-1", title: "Pääsopimus", value: "200000" });
    const v = await variationService.create(s.pm, { projectId: s.project.id, contractId: contract.id, title: "Lisäkaapelointi linja 6", cause: "Asiakkaan muutospyyntö" });
    expect(v.number).toBe(1);
    await expect(variationService.submitForReview(s.pm, v.id)).rejects.toMatchObject({ fieldErrors: { _form: ["validation.variationUnpriced"] } });
    await variationService.updateDraft(s.pm, v.id, { title: v.title, laborCost: "1200", equipmentCost: "450,50", materialsCost: "800", otherCost: "49.50", markupPct: "12,5" });
    expect((await variationService.get(s.pm, v.id)).salesPrice).toBe("2812.5");
    await variationService.submitForReview(s.pm, v.id);
    await expect(db.variation.update({ where: { id: v.id }, data: { laborCost: "1" } })).rejects.toThrow(/frozen/);
    await expect(variationService.approveInternal(s.pm, v.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
    await variationService.approveInternal(s.pd, v.id, { decision: "APPROVE" });
    await expect(variationService.recordClientDecision(s.pm, v.id, { decision: "APPROVED" })).rejects.toMatchObject({ fieldErrors: { clientReference: ["validation.approvalEvidence"] } });
    const doc = await documentService.create(s.pm, { title: "Asiakkaan hyväksyntä LT-1", projectId: s.project.id }, textFile("lt1.pdf"));
    await variationService.recordClientDecision(s.pm, v.id, { decision: "APPROVED", clientReference: "Sähköposti 12.10.", evidenceDocumentId: doc.id });

    const dash = await commercialDashboardService.summary(s.pm);
    expect(dash.uninvoicedVariations).toEqual({ count: 1, value: "2812.5" });
    expect((await forecastService.get(s.pm, s.project.id)).uninvoicedVariations).toBe("2812.5");

    await variationService.markExecuted(s.pm, v.id);
    await variationService.markReadyToInvoice(s.pm, v.id);
    const gen = await invoiceService.generate(s.pm, { projectId: s.project.id, to: "2026-12-31" });
    expect(gen.created).toBe(1);
    const exp = await invoiceService.export(s.pm, { kind: "CUSTOMER", projectId: s.project.id });
    const cand = (await invoiceService.list(s.pm, { projectId: s.project.id })).find((c) => c.sourceType === "VARIATION")!;
    expect(cand).toMatchObject({ status: "EXPORTED", amount: "2812.5", exportBatchId: exp.id });
    await invoiceService.markInvoiced(s.pm, { ids: [cand.id], invoiceReference: "LASKU-9001" });
    expect((await db.variation.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("INVOICED");
    expect((await commercialDashboardService.summary(s.pm)).uninvoicedVariations).toEqual({ count: 0, value: "0" });
    await expect(db.variation.delete({ where: { id: v.id } })).rejects.toThrow(/cannot be deleted/);
  });
});

describe("acceptance 3 and 5: invoice candidates from approved data, file export", () => {
  it("bills approved hours and diary equipment with billing rates, once; exports an immutable CSV with SHA-256", async () => {
    const s = await setup();
    await db.project.update({ where: { id: s.project.id }, data: { customerId: s.customer.id } });
    const sup = await createMember(s.t, "SUPERVISOR", [{ projectId: s.project.id }]);
    const e1 = await employeeService.create(s.t.ownerCtx, { employeeNumber: "C-1", firstName: "Eero", lastName: "Esimerkki" });
    const e2 = await employeeService.create(s.t.ownerCtx, { employeeNumber: "C-2", firstName: "Kaisa", lastName: "Kokeilu" });
    await employeeService.addRate(s.t.ownerCtx, e1.id, { rateType: "BILLING", amount: "58", validFrom: "2026-01-01" });
    const entries = await timesheetService.createCrew(sup, { employeeIds: [e1.id, e2.id], projectId: s.project.id, siteId: s.site.id, workDate: "2026-03-04", hours: "7,5", workClass: "OVERTIME_50" });
    await timesheetService.submitWeek(sup, { employeeId: e1.id, date: "2026-03-04" });
    await timesheetService.submitWeek(sup, { employeeId: e2.id, date: "2026-03-04" });
    await timesheetService.decide(s.sm, { entryIds: entries.map((e) => e.id), decision: "APPROVE" });
    const c = await contractService.create(s.pm, { projectId: s.project.id, customerId: s.customer.id, contractNumber: "SOP-M", title: "M", value: "50000" });
    await contractService.addMilestone(s.pm, c.id, { title: "Ennakko 20 %", amount: "10000", dueDate: "2026-03-31" });
    await contractService.addMilestone(s.pm, c.id, { title: "Loppuerä", amount: "40000", dueDate: "2027-06-30" });

    const g1 = await invoiceService.generate(s.pm, { projectId: s.project.id, to: "2026-04-30" });
    expect(g1.created).toBe(2); // e1's hours + the due milestone
    expect(g1.unpriced).toEqual([expect.objectContaining({ sourceType: "LABOR", sourceId: entries[1].id })]); // e2 has no billing rate: reported, never guessed
    const labor = (await invoiceService.list(s.pm, { projectId: s.project.id })).find((x) => x.sourceType === "LABOR")!;
    expect(labor).toMatchObject({ quantity: "7.5", unitPrice: "87", amount: "652.5", customer: expect.objectContaining({ name: "Datakeskus Demo Oy" }) });
    // Nothing is billed twice.
    expect((await invoiceService.generate(s.pm, { projectId: s.project.id, to: "2026-04-30" })).created).toBe(0);
    await expect(db.invoiceCandidate.create({ data: { companyId: s.t.companyId, projectId: s.project.id, sourceType: "LABOR", sourceId: labor.sourceId, description: "dup", quantity: "1", unit: "h", unitPrice: "1", amount: "1", periodDate: new Date() } })).rejects.toThrow();
    await expect(db.invoiceCandidate.update({ where: { id: labor.id }, data: { unitPrice: "1", amount: "7.5" } })).rejects.toThrow(/immutable/);
    // A void candidate can be regenerated (e.g. after a rate correction).
    await invoiceService.void(s.pm, labor.id, { note: "Väärä hinta" });
    expect((await invoiceService.generate(s.pm, { projectId: s.project.id, to: "2026-04-30" })).created).toBe(1);

    const exp = await invoiceService.export(s.pm, { kind: "CUSTOMER", format: "CSV", projectId: s.project.id });
    expect(exp.rowCount).toBe(2);
    const file = await invoiceService.download(s.pm, exp.id);
    expect(file.content.startsWith("﻿candidateId;sourceType;sourceId;projectCode;customer")).toBe(true);
    expect(file.content).toContain(";652,5;EUR");
    expect(file.content).toContain(";10000;EUR");
    expect(createHash("sha256").update(file.content, "utf8").digest("hex")).toBe(exp.sha256);
    await expect(invoiceService.export(s.pm, { kind: "CUSTOMER", projectId: s.project.id })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.nothingToExport"] } });
    const re = await invoiceService.export(s.pm, { kind: "CUSTOMER", format: "JSON", projectId: s.project.id, includeExported: "on" });
    expect(JSON.parse((await invoiceService.download(s.pm, re.id)).content)).toMatchObject({ batchId: re.id, total: "10652.5", rows: expect.any(Array) });
    expect((await db.invoiceExportBatch.findUniqueOrThrow({ where: { id: re.id } })).reexport).toBe(true);
    await expect(db.invoiceExportBatch.update({ where: { id: exp.id }, data: { content: "x" } })).rejects.toThrow(/append-only/);
    // Site managers see no prices.
    await expect(invoiceService.list(s.sm, { projectId: s.project.id })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("acceptance 4: forecast and EAC", () => {
  it("EAC = actual + ETC; revenue = contract + approved variations", async () => {
    const s = await setup();
    const b = await budgetService.createVersion(s.pm, s.project.id, {});
    await budgetService.addLine(s.pm, b.id, { category: "LABOR", description: "Työ", amount: "80000" });
    await budgetService.activate(s.pm, b.id);
    await contractService.create(s.pm, { projectId: s.project.id, customerId: s.customer.id, contractNumber: "SOP-F", title: "F", value: "120000" });
    await forecastService.setEtc(s.pm, s.project.id, { category: "LABOR", etcAmount: "50000" });
    await forecastService.setEtc(s.pm, s.project.id, { category: "LABOR", etcAmount: "70000", note: "Lisää asennustyötä" });
    const f = await forecastService.get(s.pm, s.project.id);
    expect(f.forecast).toMatchObject({ budget: "80000", actualCost: "0", etc: "70000", eac: "70000", budgetVariance: "10000", forecastRevenue: "120000", forecastMargin: "50000", forecastMarginPct: "41.7" });
    expect(f.etc).toEqual([expect.objectContaining({ category: "LABOR", etcAmount: "70000" })]);
    const row = await db.costForecast.findFirstOrThrow({ where: { projectId: s.project.id } });
    await expect(db.costForecast.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});

describe("internal invoicing within the group (owner decision 2)", () => {
  it("the owner bills the booking company at the owner's billing rate; the booker sees amount and basis only", async () => {
    const s = await setup();
    const purent = await companyDirectoryService.createCompany(s.t.owner, { organizationId: s.t.organizationId, name: "Purent Laskutus Oy", slug: `purent-inv-${Date.now()}` });
    const pCtx = await resolveRequestContext({ userId: s.t.owner.user.id, companySlug: purent.slug, meta, locale: "fi" });
    const type = await equipmentTypeService.create(pCtx, { name: "Trukki", category: "FORKLIFT" });
    const fork = await equipmentService.create(pCtx, { equipmentTypeId: type.id, assetNumber: "P-T9", name: "Trukki 3 t", shareableInGroup: "on" });
    await equipmentService.addRate(pCtx, fork.id, { rateType: "COST", amount: "12", validFrom: "2026-01-01" });
    await equipmentService.addRate(pCtx, fork.id, { rateType: "BILLING", amount: "25", validFrom: "2026-01-01" });
    const [b] = await bookingService.create(s.pm, { resources: [`EQUIPMENT:${fork.id}`], projectId: s.project.id, startsAt: "2026-11-04T07:00", endsAt: "2026-11-04T15:30" });
    await bookingService.decide(pCtx, b.id, { decision: "APPROVE" });

    const g = await invoiceService.generateInternal(pCtx, { to: "2026-11-30" });
    expect(g).toMatchObject({ created: 1, total: "212.5" });
    expect((await invoiceService.generateInternal(pCtx, { to: "2026-11-30" })).created).toBe(0);
    const [cand] = await invoiceService.list(pCtx, { kind: "INTERNAL" });
    expect(cand).toMatchObject({ sourceType: "INTERNAL_BOOKING", sourceId: b.id, quantity: "8.5", unitPrice: "25", amount: "212.5", billToCompanyId: s.t.companyId, projectId: null });
    const incoming = await invoiceService.incomingInternal(s.t.ownerCtx);
    expect(incoming).toEqual([expect.objectContaining({ amount: "212.5", company: { name: "Purent Laskutus Oy" } })]);
    expect(JSON.stringify(incoming)).not.toContain('"12'); // never the owner's cost rate
    const exp = await invoiceService.export(pCtx, { kind: "INTERNAL", format: "CSV" });
    expect((await invoiceService.download(pCtx, exp.id)).content).toContain(";212,5;EUR");
    // The booking company cannot read the owner's export.
    await expect(invoiceService.download(s.t.ownerCtx, exp.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
