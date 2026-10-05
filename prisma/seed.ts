/**
 * Development seed — FICTIONAL DATA ONLY. Never add real personal data here.
 *
 * Creates the "SK Group Demo" organization with two separate companies
 * (SK Infra Demo, Purent Demo), one demo user per role template, projects,
 * sites, employees, equipment, rates and documents. Data is created through
 * the domain services so that the same validation, authorization and audit
 * paths are exercised as in the application.
 *
 * Usage: pnpm db:seed   (idempotent: skips if the demo organization exists)
 */
import { db } from "@/platform/db";
import { writeAudit } from "@/platform/audit";
import type { RequestContext, RequestMeta, UserContext } from "@/platform/authz";
import { resolveRequestContext } from "@/modules/companies/context";
import { companyAdminService, companyDirectoryService } from "@/modules/companies/service";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { equipmentService, equipmentTypeService } from "@/modules/equipment/service";
import { documentService } from "@/modules/documents/service";
import { timesheetService } from "@/modules/timesheets/service";
import { diaryService } from "@/modules/diary/service";
import { budgetService, costService } from "@/modules/finance/service";
import { taktStructureService } from "@/modules/takt/structure.service";
import { taktPlanService } from "@/modules/takt/plan.service";
import { taktActivityService } from "@/modules/takt/activity.service";
import { bookingService } from "@/modules/logistics/booking.service";
import { liftingAccessoryService, liftPlanService } from "@/modules/lifting/lift.service";
import { cableDrumService, materialBatchService } from "@/modules/lifting/material.service";
import { customerService, opportunityService } from "@/modules/commercial/crm.service";
import { quoteService } from "@/modules/commercial/quote.service";
import { contractService, forecastService, variationService } from "@/modules/commercial/project.service";
import { invoiceService } from "@/modules/commercial/invoice.service";
import { deliveryService, logisticsLocationService, logisticsRequestService } from "@/modules/logistics/logistics.service";
import { hseActionService, hseObservationService, incidentService } from "@/modules/hse/hse.service";
import { hseInspectionService, riskAssessmentService, toolboxTalkService, workPermitService } from "@/modules/hse/planning.service";
import { addDays, isoDateString, weekStart } from "@/modules/timesheets/rules";
import { todayInDisplayZone } from "@/platform/i18n/config";

const meta: RequestMeta = { requestId: "seed", ip: null, userAgent: "seed" };
const ORG_SLUG = "sk-group-demo";

const SK_USERS = [
  { email: "ceo@skinfra.example.com", name: "Aino Esimerkki", role: "CEO" },
  { email: "pd@skinfra.example.com", name: "Mikko Malli", role: "PROJECT_DIRECTOR" },
  { email: "pm@skinfra.example.com", name: "Liisa Koe", role: "PROJECT_MANAGER" },
  { email: "site.manager@skinfra.example.com", name: "Pekka Demo", role: "SITE_MANAGER" },
  { email: "supervisor@skinfra.example.com", name: "Sanna Testi", role: "SUPERVISOR" },
  { email: "logistics@skinfra.example.com", name: "Jari Kuvitteellinen", role: "LOGISTICS_COORDINATOR" },
  { email: "lifting@skinfra.example.com", name: "Ville Vinssi", role: "LIFTING_SUPERVISOR" },
  { email: "hse@skinfra.example.com", name: "Riikka Harjoitus", role: "HSE" },
  { email: "employee@skinfra.example.com", name: "Timo Tyyppi", role: "EMPLOYEE" },
  { email: "subcontractor@example.com", name: "Aliurakka Demo Oy", role: "SUBCONTRACTOR" },
  { email: "client@example.com", name: "Asiakas Demo", role: "CLIENT" },
] as const;

const PURENT_USERS = [
  { email: "ceo@purent.example.com", name: "Kaisa Kokeilu", role: "CEO" },
  { email: "pm@purent.example.com", name: "Olli Otos", role: "PROJECT_MANAGER" },
] as const;

const GROUP_ADMIN = { email: "group.admin@example.com", name: "Konserni Admin" };

function textFile(name: string, body: string) {
  return { fileName: name, bytes: new TextEncoder().encode(body) };
}

async function ensureUser(email: string, name: string) {
  return db.user.upsert({ where: { email }, create: { email, name }, update: {} });
}

async function activateAll(companyId: string, organizationId: string) {
  const invited = await db.companyMembership.findMany({ where: { companyId, status: "INVITED" } });
  for (const m of invited) {
    await db.$transaction(async (tx) => {
      await tx.companyMembership.update({ where: { id: m.id }, data: { status: "ACTIVE", acceptedAt: new Date() } });
      await writeAudit(tx, { kind: "system", meta, companyId, organizationId }, {
        action: "membership.activate_seed",
        entityType: "company_membership",
        entityId: m.id,
        before: { status: "INVITED" },
        after: { status: "ACTIVE" },
      });
    });
  }
}

async function ctxFor(email: string, slug: string): Promise<RequestContext> {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return resolveRequestContext({ userId: user.id, companySlug: slug, meta, locale: "fi" });
}

async function seedCompany(params: {
  admin: UserContext;
  organizationId: string;
  name: string;
  slug: string;
  businessId: string;
  users: readonly { email: string; name: string; role: string }[];
}) {
  const company = await companyDirectoryService.createCompany(params.admin, {
    organizationId: params.organizationId,
    name: params.name,
    slug: params.slug,
    businessId: params.businessId,
  });
  const adminCtx = await resolveRequestContext({ userId: params.admin.user.id, companySlug: params.slug, meta, locale: "fi" });
  const roles = await companyAdminService.listRoles(adminCtx);
  const roleId = (key: string) => roles.find((r) => r.key === key)!.id;

  for (const u of params.users) {
    await companyAdminService.inviteMember(adminCtx, { email: u.email, name: u.name, roleIds: [roleId(u.role)] });
  }
  await activateAll(company.id, params.organizationId);
  return { company, adminCtx, roleId };
}

async function main() {
  if (await db.organization.findUnique({ where: { slug: ORG_SLUG } })) {
    console.log(`Seed skipped: organization "${ORG_SLUG}" already exists. Run "pnpm db:reset" for a clean database.`);
    return;
  }

  // Organization and its owner (system-created).
  const adminUser = await ensureUser(GROUP_ADMIN.email, GROUP_ADMIN.name);
  const org = await db.$transaction(async (tx) => {
    const o = await tx.organization.create({ data: { slug: ORG_SLUG, name: "SK Group Demo" } });
    await tx.organizationMembership.create({ data: { organizationId: o.id, userId: adminUser.id, role: "OWNER" } });
    await writeAudit(tx, { kind: "system", meta, organizationId: o.id }, {
      action: "organization.create",
      entityType: "organization",
      entityId: o.id,
      after: o,
    });
    return o;
  });
  const admin: UserContext = { kind: "user", user: { id: adminUser.id, email: adminUser.email, name: adminUser.name }, meta, locale: "fi" };

  // ── SK Infra Demo ────────────────────────────────────────────────
  const sk = await seedCompany({
    admin,
    organizationId: org.id,
    name: "SK Infra Demo",
    slug: "sk-infra-demo",
    businessId: "0000000-1",
    users: SK_USERS,
  });
  const skCeo = await ctxFor("ceo@skinfra.example.com", "sk-infra-demo");

  const ndc = await projectService.create(skCeo, {
    code: "NDC-001",
    name: "Nordic Data Center Demo",
    customerName: "Nordic Hyperscale Demo Oy",
    description: "Fictional data center campus: data halls, 110 kV substation and site logistics.",
    status: "ACTIVE",
    startDate: "2026-03-01",
    endDate: "2027-12-31",
  });
  const hallA = await siteService.create(skCeo, ndc.id, { code: "DH-A", name: "Data Hall A", address: "Demotie 1", postalCode: "90100", city: "Oulu" });
  const substation = await siteService.create(skCeo, ndc.id, { code: "SS-110", name: "110 kV Substation", address: "Demotie 3", postalCode: "90100", city: "Oulu" });
  await siteService.create(skCeo, ndc.id, { code: "LOG", name: "Logistics Yard", address: "Demotie 5", postalCode: "90100", city: "Oulu" });

  const cable = await projectService.create(skCeo, {
    code: "CBL-002",
    name: "Demo 110 kV Cable Route",
    customerName: "Verkko Demo Oy",
    status: "PLANNED",
    startDate: "2026-11-01",
  });
  await siteService.create(skCeo, cable.id, { code: "S1", name: "Cable Route Section 1", city: "Muhos" });

  // Project assignments (ASSIGNED roles see only these projects).
  for (const u of SK_USERS.filter((u) => !["CEO", "PROJECT_DIRECTOR"].includes(u.role))) {
    const user = await db.user.findUniqueOrThrow({ where: { email: u.email } });
    // V7: the client contact is the named client approver of this project.
    await projectService.assignMember(skCeo, ndc.id, { userId: user.id, roleId: sk.roleId(u.role === "CLIENT" ? "CLIENT_APPROVER" : u.role) });
  }
  const pmUser = await db.user.findUniqueOrThrow({ where: { email: "pm@skinfra.example.com" } });
  await projectService.assignMember(skCeo, cable.id, { userId: pmUser.id, roleId: sk.roleId("PROJECT_MANAGER") });

  // Employees and rates.
  const employees = [
    { employeeNumber: "E-1001", firstName: "Antti", lastName: "Esimerkki", trade: "Sähköasentaja", jobTitle: "Electrician", cost: "42.50", billing: "68.00" },
    { employeeNumber: "E-1002", firstName: "Elina", lastName: "Malli", trade: "Suurjännitejatkosasentaja", jobTitle: "HV cable jointer", cost: "48.00", billing: "79.00" },
    { employeeNumber: "E-1003", firstName: "Ville", lastName: "Koe", trade: "Rigger", jobTitle: "Rigger", cost: "39.00", billing: "62.00" },
    { employeeNumber: "E-1004", firstName: "Hanna", lastName: "Demo", trade: "Nosturinkuljettaja", jobTitle: "Crane operator", cost: "45.00", billing: "74.00" },
    { employeeNumber: "E-1005", firstName: "Juha", lastName: "Testi", trade: "Logistiikka", jobTitle: "Site logistics", cost: "35.00", billing: "55.00" },
    { employeeNumber: "E-1006", firstName: "Minna", lastName: "Kuvitteellinen", trade: "Telinerakentaja", jobTitle: "Scaffolder", cost: "37.00", billing: "58.00" },
  ];
  const createdEmployees = [];
  for (const e of employees) {
    const emp = await employeeService.create(skCeo, {
      employeeNumber: e.employeeNumber,
      firstName: e.firstName,
      lastName: e.lastName,
      trade: e.trade,
      jobTitle: e.jobTitle,
      email: `${e.firstName.toLowerCase()}.${e.lastName.toLowerCase()}@skinfra.example.com`,
      phone: "+358 40 000 0000",
      startDate: "2025-01-01",
    });
    createdEmployees.push(emp);
    await employeeService.addRate(skCeo, emp.id, { rateType: "COST", unit: "HOUR", amount: e.cost, currency: "EUR", validFrom: "2026-01-01" });
    await employeeService.addRate(skCeo, emp.id, { rateType: "BILLING", unit: "HOUR", amount: e.billing, currency: "EUR", validFrom: "2026-01-01" });
  }

  // Equipment.
  const typeDefs = [
    { name: "Ajoneuvonosturi", category: "CRANE" },
    { name: "Kurottaja", category: "TELEHANDLER" },
    { name: "Kaivinkone", category: "EXCAVATOR" },
    { name: "Trukki", category: "FORKLIFT" },
    { name: "Kaapelirumpuvaunu", category: "CABLE_EQUIPMENT" },
  ] as const;
  const types: Record<string, string> = {};
  for (const t of typeDefs) types[t.category] = (await equipmentTypeService.create(skCeo, t)).id;

  const equipmentDefs = [
    { assetNumber: "EQ-001", name: "Mobile crane 100 t", type: "CRANE", manufacturer: "Liebherr", model: "LTM 1100-4.2", meterHours: "5320.0", inspection: isoDateString(addDays(new Date(`${todayInDisplayZone()}T00:00:00Z`), 45)), site: hallA.id, cost: "95.00", billing: "165.00" },
    { assetNumber: "EQ-002", name: "Telehandler 4 t / 17 m", type: "TELEHANDLER", manufacturer: "Manitou", model: "MT 1840", meterHours: "2110.5", inspection: "2027-02-15", site: substation.id, cost: "28.00", billing: "48.00" },
    { assetNumber: "EQ-003", name: "Excavator 22 t", type: "EXCAVATOR", manufacturer: "Volvo", model: "EC220E", meterHours: "7400.0", inspection: "2026-12-01", site: null, cost: "45.00", billing: "78.00" },
    { assetNumber: "EQ-004", name: "Forklift 3 t", type: "FORKLIFT", manufacturer: "Toyota", model: "8FD30", meterHours: "980.0", inspection: "2026-10-10", site: null, cost: "12.00", billing: "25.00" },
    { assetNumber: "EQ-005", name: "Cable drum trailer 20 t", type: "CABLE_EQUIPMENT", manufacturer: "Demo Trailer Oy", model: "CDT-20", meterHours: null, inspection: "2027-05-01", site: null, cost: "15.00", billing: "30.00" },
  ];
  const createdEquipment = [];
  for (const e of equipmentDefs) {
    const eq = await equipmentService.create(skCeo, {
      equipmentTypeId: types[e.type],
      assetNumber: e.assetNumber,
      name: e.name,
      manufacturer: e.manufacturer,
      model: e.model,
      status: e.site ? "IN_USE" : "AVAILABLE",
      currentProjectId: e.site ? ndc.id : null,
      currentSiteId: e.site,
      meterHours: e.meterHours,
      nextInspectionDate: e.inspection,
    });
    createdEquipment.push(eq);
    await equipmentService.addRate(skCeo, eq.id, { rateType: "COST", unit: "HOUR", amount: e.cost, validFrom: "2026-01-01" });
    await equipmentService.addRate(skCeo, eq.id, { rateType: "BILLING", unit: "HOUR", amount: e.billing, validFrom: "2026-01-01" });
  }

  // Documents (requires object storage — MinIO in docker-compose).
  try {
    const rams = await documentService.create(
      skCeo,
      { title: "RAMS – Data Hall A nostot", category: "RAMS", documentNumber: "NDC-RAMS-001", projectId: ndc.id, siteId: hallA.id, revisionLabel: "A" },
      textFile("NDC-RAMS-001_A.txt", "FICTIONAL DEMO DOCUMENT\nRisk assessment and method statement for lifting operations in Data Hall A.\n"),
    );
    await documentService.setVersionApproval(skCeo, rams.currentVersion.id, { state: "APPROVED" });

    const drawing = await documentService.create(
      skCeo,
      { title: "110 kV kytkinlaitoksen pääkaavio", category: "ELECTRICAL_PLAN", documentNumber: "NDC-E-110", projectId: ndc.id, siteId: substation.id, revisionLabel: "A" },
      textFile("NDC-E-110_A.txt", "FICTIONAL DEMO DRAWING – revision A\n"),
    );
    await documentService.setVersionApproval(skCeo, drawing.currentVersion.id, { state: "APPROVED" });
    const revB = await documentService.uploadVersion(
      skCeo,
      drawing.id,
      { revisionLabel: "B", changeNote: "Kaapelireitti päivitetty" },
      textFile("NDC-E-110_B.txt", "FICTIONAL DEMO DRAWING – revision B\n"),
    );
    await documentService.setVersionApproval(skCeo, revB.id, { state: "PENDING_APPROVAL" });
    // V7: shared externally — the client and subcontractors see approved revision A only.
    await documentService.setSharing(skCeo, drawing.id, { sharedWithClient: "on", sharedWithSubcontractors: "on" });
    await documentService.setSharing(skCeo, rams.id, { sharedWithSubcontractors: "on" });

    const cert = await documentService.create(
      skCeo,
      { title: "Nosturin määräaikaistarkastus 2026", category: "INSPECTION", documentNumber: "EQ-001-INSP-2026" },
      textFile("EQ-001_inspection_2026.txt", "FICTIONAL DEMO INSPECTION CERTIFICATE\n"),
    );
    await documentService.addLink(skCeo, cert.id, { entityType: "EQUIPMENT", entityId: createdEquipment[0].id });

    const competence = await documentService.create(
      skCeo,
      { title: "SFS 6002 -pätevyys", category: "CERTIFICATE" },
      textFile("E-1001_SFS6002.txt", "FICTIONAL DEMO COMPETENCE CERTIFICATE\n"),
    );
    await documentService.addLink(skCeo, competence.id, { entityType: "EMPLOYEE", entityId: createdEmployees[0].id });
  } catch (e) {
    console.warn("⚠ Documents were not seeded (is object storage running? docker compose -f docker/docker-compose.yml up -d):", (e as Error).message);
  }

  // ── V2: hours, site diary and project finance (SK Infra Demo) ─────
  const today = new Date(`${todayInDisplayZone()}T00:00:00Z`);
  const lastMonday = addDays(weekStart(today), -7);
  const linked = [
    { email: "employee@skinfra.example.com", number: "E-1007", first: "Timo", last: "Tyyppi", trade: "Sähköasentaja", cost: "41.00" },
    { email: "supervisor@skinfra.example.com", number: "E-1008", first: "Sanna", last: "Testi", trade: "Työnjohtaja", cost: "52.00" },
    { email: "site.manager@skinfra.example.com", number: "E-1009", first: "Pekka", last: "Demo", trade: "Työmaapäällikkö", cost: "58.00" },
  ];
  for (const l of linked) {
    const user = await db.user.findUniqueOrThrow({ where: { email: l.email } });
    const emp = await employeeService.create(skCeo, { employeeNumber: l.number, firstName: l.first, lastName: l.last, trade: l.trade, userId: user.id, startDate: "2024-01-01" });
    await employeeService.addRate(skCeo, emp.id, { rateType: "COST", amount: l.cost, validFrom: "2026-01-01" });
    createdEmployees.push(emp);
  }
  const supervisorCtx = await ctxFor("supervisor@skinfra.example.com", "sk-infra-demo");
  const siteManagerCtx = await ctxFor("site.manager@skinfra.example.com", "sk-infra-demo");
  const employeeCtx = await ctxFor("employee@skinfra.example.com", "sk-infra-demo");
  const crew = createdEmployees.slice(0, 4).map((e) => e.id);

  // Last week: crew hours entered by the supervisor, submitted and approved by the site manager.
  for (let d = 0; d < 5; d++) {
    const workDate = isoDateString(addDays(lastMonday, d));
    await timesheetService.createCrew(supervisorCtx, { employeeIds: crew, projectId: ndc.id, siteId: hallA.id, workDate, hours: "8", note: "Kaapelihyllyt, Data Hall A" });
    if (d === 3) await timesheetService.createCrew(supervisorCtx, { employeeIds: crew.slice(0, 2), projectId: ndc.id, siteId: hallA.id, workDate, hours: "2", workClass: "OVERTIME_50", note: "Kiireellinen nosto" });
  }
  for (const id of crew) await timesheetService.submitWeek(supervisorCtx, { employeeId: id, date: isoDateString(lastMonday) });
  const toApprove = await timesheetService.listForApproval(siteManagerCtx, { projectId: ndc.id });
  await timesheetService.decide(siteManagerCtx, { entryIds: toApprove.map((e) => e.id), decision: "APPROVE" });

  // This week: the employee's own hours (submitted) and today's draft.
  const thisMonday = weekStart(today);
  for (let d = 0; d < Math.min(2, Math.max(1, Math.round((today.getTime() - thisMonday.getTime()) / 86_400_000))); d++) {
    await timesheetService.create(employeeCtx, { projectId: ndc.id, siteId: substation.id, workDate: isoDateString(addDays(thisMonday, d)), startTime: "07:00", endTime: "15:30" });
  }
  await timesheetService.submitWeek(employeeCtx, { date: isoDateString(thisMonday) });
  await timesheetService.create(employeeCtx, { projectId: ndc.id, siteId: substation.id, workDate: isoDateString(today), hours: "7,5", note: "Maadoitukset" });

  // Site diary: last Friday signed (with crane hours), today's draft.
  const friday = isoDateString(addDays(lastMonday, 4));
  const signedDiary = await diaryService.open(supervisorCtx, { siteId: hallA.id, date: friday });
  await diaryService.update(supervisorCtx, signedDiary.id, { weather: "Pilvistä, +2 °C", summary: "Kaapelihyllyasennukset Data Hall A:ssa valmiit linjoilla 1–4. Nosturilla nostettiin muuntajan osat paikalleen." });
  await diaryService.addEntry(supervisorCtx, signedDiary.id, { kind: "WORK", description: "Kaapelihyllyt linjat 1–4 asennettu ja tarkastettu" });
  await diaryService.addEntry(supervisorCtx, signedDiary.id, { kind: "EQUIPMENT", equipmentId: createdEquipment[0].id, hours: "4" });
  await diaryService.addEntry(supervisorCtx, signedDiary.id, { kind: "DELAY", description: "Toimitus myöhässä 2 h (kaapelirummut)" });
  await diaryService.sign(supervisorCtx, signedDiary.id);
  const todayDiary = await diaryService.open(supervisorCtx, { siteId: hallA.id, date: isoDateString(today) });
  await diaryService.addEntry(supervisorCtx, todayDiary.id, { kind: "WORK", description: "Kaapelinveto linja 5 aloitettu" });

  // Budget (original version) and manual costs.
  const budget = await budgetService.createVersion(skCeo, ndc.id, { note: "Alkuperäinen budjetti" });
  for (const [category, description, amount] of [
    ["LABOR", "Asennustyö", "180000"],
    ["EQUIPMENT", "Nosturit ja kurottajat", "90000"],
    ["MATERIALS", "Kaapelit ja hyllyt", "250000"],
    ["SUBCONTRACT", "Telineet ja purku", "120000"],
    ["OTHER", "Majoitus ja matkat", "20000"],
  ] as const) {
    await budgetService.addLine(skCeo, budget.id, { category, description, amount });
  }
  await budgetService.activate(skCeo, budget.id);
  await costService.create(skCeo, ndc.id, { category: "MATERIALS", entryDate: isoDateString(lastMonday), description: "Kaapelirummut 4 kpl", supplier: "Kaapeli Demo Oy", reference: "LASKU-1001", amount: "38500" });
  await costService.create(skCeo, ndc.id, { category: "SUBCONTRACT", entryDate: isoDateString(addDays(lastMonday, 2)), description: "Telinetyöt viikko", supplier: "Teline Demo Oy", reference: "LASKU-2001", amount: "12000" });

  // ── V3: takt plan for Data Hall A (SK Infra Demo) ─────────────────
  const pmCtx = await ctxFor("pm@skinfra.example.com", "sk-infra-demo");
  const dc1 = await taktStructureService.createBuilding(pmCtx, { siteId: hallA.id, name: "DC1 – Data Hall A", code: "DC1" });
  for (let i = 1; i <= 6; i++) await taktStructureService.createArea(pmCtx, { buildingId: dc1.id, code: `A${i}`, name: `Sali A, vyöhyke ${i}` });
  const wagons = [
    { code: "TE", name: "Telineet", trade: "Telinerakentaja", defaultCrewSize: "2", color: "#B7950B" },
    { code: "KH", name: "Kaapelihyllyt", trade: "Sähköasentaja", defaultCrewSize: "3", color: "#1E88A8", equipmentTypeId: types.TELEHANDLER, equipmentCount: "1" },
    { code: "KA", name: "Kaapelinveto", trade: "Sähköasentaja", defaultCrewSize: "4", color: "#0B2545", equipmentTypeId: types.CABLE_EQUIPMENT, equipmentCount: "1" },
    { code: "KY", name: "Kytkennät", trade: "Sähköasentaja", defaultCrewSize: "2", color: "#4C9F38" },
    { code: "TS", name: "Testaus ja käyttöönotto", trade: "Sähköasentaja", defaultCrewSize: "2", color: "#8E44AD" },
  ];
  const wagonIds: Record<string, string> = {};
  for (const w of wagons) wagonIds[w.code] = (await taktStructureService.createWorkPackage(pmCtx, ndc.id, { ...w, defaultDurationCycles: "1" })).id;
  const taktPlan = await taktPlanService.create(pmCtx, { siteId: hallA.id, name: "Data Hall A – sähkötahti", startDate: isoDateString(lastMonday) });
  const v1 = (await taktPlanService.board(pmCtx, taktPlan.id)).selected!;
  await taktPlanService.generateTrain(pmCtx, v1.id, { startCycle: 0, bufferCycles: 0 });
  await taktPlanService.propose(pmCtx, v1.id);
  await taktPlanService.approve(pmCtx, v1.id);

  // Progress: finished work up to yesterday, today's work half done.
  const todayIso = isoDateString(today);
  const baselineBoard = await taktPlanService.board(pmCtx, taktPlan.id);
  const byKey = (wp: string, area: string) => baselineBoard.activities.find((a) => a.workPackage.code === wp && a.taktArea.code === area)!;
  for (const a of [...baselineBoard.activities].sort((x, y) => (x.plannedStart ?? "").localeCompare(y.plannedStart ?? ""))) {
    if (!a.plannedStart || !a.plannedEnd) continue;
    if (a.plannedEnd < todayIso) await taktActivityService.recordProgress(supervisorCtx, a.id, { progressPct: "100", reportDate: a.plannedEnd, note: "Valmis" });
    else if (a.plannedStart <= todayIso) await taktActivityService.recordProgress(supervisorCtx, a.id, { progressPct: "50", reportDate: todayIso, note: "Työ käynnissä" });
  }
  const drawings = await taktActivityService.addConstraint(supervisorCtx, byKey("KY", "A1").id, { type: "DRAWINGS", description: "Kytkentäkaaviot rev. B hyväksytty" });
  await taktActivityService.clearConstraint(supervisorCtx, drawings.id);
  await taktActivityService.addConstraint(supervisorCtx, byKey("KA", "A5").id, { type: "MATERIAL", description: "Kaapelirummut (4 kpl) toimitus myöhässä", dueDate: isoDateString(addDays(today, 3)) });
  await taktActivityService.addConstraint(supervisorCtx, byKey("TS", "A2").id, { type: "PERMIT", description: "Jännitetyölupa haettava" });
  await taktActivityService.setBlocked(supervisorCtx, byKey("KH", "A6").id, { blocked: true, delayReason: "Kurottaja huollossa", recoveryAction: "Vuokrakurottaja tilattu, saapuu huomenna" });

  // A change in progress: cable delivery late → new draft version, cabling and later wagons shifted by 2 days.
  const v2 = await taktPlanService.createDraft(pmCtx, taktPlan.id, { reason: "Kaapelitoimitus myöhässä 2 työpäivää" });
  for (const code of ["KA", "KY", "TS"]) await taktPlanService.shiftWorkPackage(pmCtx, v2.id, wagonIds[code], { days: 2 });

  // ── Purent Demo (separate company, same platform) ─────────────────
  await seedCompany({
    admin,
    organizationId: org.id,
    name: "Purent Demo",
    slug: "purent-demo",
    businessId: "0000000-2",
    users: PURENT_USERS,
  });
  const purentCeo = await ctxFor("ceo@purent.example.com", "purent-demo");
  const harbor = await projectService.create(purentCeo, {
    code: "PUR-001",
    name: "Purent Harbor Warehouse Demo",
    customerName: "Satama Demo Oy",
    status: "ACTIVE",
    startDate: "2026-05-01",
  });
  await siteService.create(purentCeo, harbor.id, { name: "Warehouse 3", city: "Kotka" });
  const purentPm = await db.user.findUniqueOrThrow({ where: { email: "pm@purent.example.com" } });
  const purentRoles = await companyAdminService.listRoles(purentCeo);
  await projectService.assignMember(purentCeo, harbor.id, { userId: purentPm.id, roleId: purentRoles.find((r) => r.key === "PROJECT_MANAGER")!.id });

  const purentEmp = await employeeService.create(purentCeo, { employeeNumber: "P-001", firstName: "Kalle", lastName: "Kokeilu", trade: "Purkutyö", jobTitle: "Demolition worker" });
  await employeeService.addRate(purentCeo, purentEmp.id, { rateType: "COST", amount: "36.00", validFrom: "2026-01-01" });
  await employeeService.create(purentCeo, { employeeNumber: "P-002", firstName: "Laura", lastName: "Leikki", trade: "Työnjohto", jobTitle: "Foreman" });
  const forklift = await equipmentTypeService.create(purentCeo, { name: "Trukki", category: "FORKLIFT" });
  // Shared with the group: SK Infra may book it (Purent approves; ownership stays with Purent).
  const purentForklift = await equipmentService.create(purentCeo, { equipmentTypeId: forklift.id, assetNumber: "PU-EQ-01", name: "Forklift 2.5 t", manufacturer: "Linde", nextInspectionDate: "2026-11-30", shareableInGroup: "on" });

  // ── V4: logistics at Data Hall A (SK Infra Demo) ──────────────────
  const logCtx = await ctxFor("logistics@skinfra.example.com", "sk-infra-demo");
  const tomorrowIso = isoDateString(addDays(today, 1));
  const gate1 = await logisticsLocationService.create(logCtx, { siteId: hallA.id, kind: "GATE", name: "Portti 1 (pohjoinen)", opens: "06:00", closes: "18:00" });
  const gate2 = await logisticsLocationService.create(logCtx, { siteId: hallA.id, kind: "GATE", name: "Portti 2 (itä)", opens: "07:00", closes: "15:00" });
  const unloadA = await logisticsLocationService.create(logCtx, { siteId: hallA.id, kind: "UNLOADING", name: "Purkualue A" });
  const cableStore = await logisticsLocationService.create(logCtx, { siteId: hallA.id, kind: "STORAGE", name: "Kaapelivarasto" });
  await logisticsLocationService.create(logCtx, { siteId: hallA.id, kind: "STORAGE", name: "Kenttävarasto" });

  const drumRequest = await logisticsRequestService.create(supervisorCtx, {
    siteId: hallA.id,
    activityId: byKey("KA", "A5").id,
    serviceType: "DELIVERY",
    title: "Kaapelirummut 4 kpl (AXMK 4×240)",
    requestedStart: `${todayIso}T09:00`,
    requestedEnd: `${todayIso}T10:00`,
    weightKg: "8400",
    priority: "HIGH",
    pickup: "Kaapeli Demo Oy, Vantaa",
    destination: "Kaapelivarasto",
    equipmentTypeId: types.CRANE,
    submit: "on",
  });
  await logisticsRequestService.transition(logCtx, drumRequest.id, { to: "APPROVED", note: "Portti 1 klo 9, nosturi varattu" });
  await logisticsRequestService.create(supervisorCtx, {
    siteId: hallA.id,
    activityId: byKey("KH", "A6").id,
    serviceType: "LIFT",
    title: "Kaapelihyllynippujen nosto 2. kerrokseen",
    requestedStart: `${tomorrowIso}T07:00`,
    requestedEnd: `${tomorrowIso}T09:00`,
    weightKg: "1200",
    submit: "on",
  });

  const scaffolding = await deliveryService.create(logCtx, { siteId: hallA.id, gateId: gate1.id, unloadingId: unloadA.id, supplier: "Teline Demo Oy", vehicle: "ABC-123", material: "Telinetarvikkeet", quantity: "2 lavaa", date: todayIso, startTime: "07:00", slots: "1" });
  for (const to of ["ARRIVED_GATE", "CHECKED_IN", "UNLOADING", "STORED"]) await deliveryService.advance(logCtx, scaffolding.id, { to });
  const drums = await deliveryService.create(logCtx, { siteId: hallA.id, gateId: gate1.id, unloadingId: unloadA.id, storageId: cableStore.id, requestId: drumRequest.id, supplier: "Kaapeli Demo Oy", carrier: "Kuljetus Demo Oy", vehicle: "XYZ-789", material: "Kaapelirummut 4 kpl", quantity: "4 rumpua", weightKg: "8400", date: todayIso, startTime: "09:00", slots: "2" });
  await deliveryService.advance(logCtx, drums.id, { to: "CONFIRMED" });
  await deliveryService.create(logCtx, { siteId: hallA.id, gateId: gate2.id, activityId: byKey("KH", "A6").id, supplier: "Hylly Demo Oy", material: "Kaapelihyllyt 200 m", quantity: "200 m", date: todayIso, startTime: "11:00", slots: "1" });

  // Bookings: crane for today (approved), an overlapping request (conflict), a crew for tomorrow, Purent's forklift.
  await bookingService.create(pmCtx, { resources: [`EQUIPMENT:${createdEquipment[0].id}`], projectId: ndc.id, activityId: byKey("KA", "A5").id, startsAt: `${todayIso}T07:00`, endsAt: `${todayIso}T15:30`, note: "Kaapelirumpujen purku" });
  await bookingService.create(pmCtx, { resources: [`EQUIPMENT:${createdEquipment[0].id}`], projectId: ndc.id, activityId: byKey("KH", "A6").id, startsAt: `${todayIso}T13:00`, endsAt: `${todayIso}T17:00`, note: "Hyllynippujen nosto" });
  const electricians = createdEmployees.filter((e) => e.trade === "Sähköasentaja").map((e) => `EMPLOYEE:${e.id}`);
  await bookingService.create(pmCtx, { resources: electricians, projectId: ndc.id, activityId: byKey("KA", "A6").id, startsAt: `${tomorrowIso}T07:00`, endsAt: `${tomorrowIso}T15:30` });
  await bookingService.create(pmCtx, { resources: [`EQUIPMENT:${purentForklift.id}`], projectId: ndc.id, siteId: hallA.id, startsAt: `${tomorrowIso}T07:00`, endsAt: `${tomorrowIso}T15:30`, note: "Kenttävaraston siirrot" });

  // ── V5: lifting and material flow at Data Hall A (SK Infra Demo) ──
  const liftCtx = await ctxFor("lifting@skinfra.example.com", "sk-infra-demo");
  const smCtx = await ctxFor("site.manager@skinfra.example.com", "sk-infra-demo");
  const inDays = (n: number) => isoDateString(addDays(today, n));
  const sling4 = await liftingAccessoryService.create(smCtx, { code: "NR-001", name: "Nostoraksi 4 t / 4 m", kind: "SLING", wllKg: "4000", manufacturer: "Raksi Demo Oy", nextInspectionDate: inDays(120) });
  await liftingAccessoryService.create(smCtx, { code: "NR-002", name: "Nostoraksi 4 t / 4 m", kind: "SLING", wllKg: "4000", manufacturer: "Raksi Demo Oy", nextInspectionDate: inDays(120) });
  const shackle = await liftingAccessoryService.create(smCtx, { code: "SA-010", name: "Sakkeli 6,5 t", kind: "SHACKLE", wllKg: "6500", nextInspectionDate: inDays(90) });
  const beam = await liftingAccessoryService.create(smCtx, { code: "NP-001", name: "Nostopalkki 10 t", kind: "SPREADER_BEAM", wllKg: "10000", nextInspectionDate: inDays(200) });
  // Overdue inspection: the register and lift plans flag it.
  await liftingAccessoryService.create(smCtx, { code: "KE-003", name: "Nostoketju 2-haarainen 3,15 t", kind: "CHAIN", wllKg: "3150", nextInspectionDate: inDays(-3) });
  const rams = await db.document.findFirstOrThrow({ where: { companyId: sk.company.id, documentNumber: "NDC-RAMS-001" } });

  // An approved lift for the LIFT request (supervisor plans, lifting supervisor approves).
  const liftRequest = await db.logisticsRequest.findFirstOrThrow({ where: { companyId: sk.company.id, serviceType: "LIFT" } });
  await logisticsRequestService.transition(logCtx, liftRequest.id, { to: "APPROVED" });
  const trayLift = await liftPlanService.create(supervisorCtx, { siteId: hallA.id, requestId: liftRequest.id, title: "Kaapelihyllynippujen nosto 2. kerrokseen", plannedStart: `${tomorrowIso}T07:00`, plannedEnd: `${tomorrowIso}T09:00` });
  await liftPlanService.updateDraft(supervisorCtx, trayLift.id, { loadDescription: "Kaapelihyllyniput 4 × 300 kg nostopalkissa", loadWeightKg: "1200", riggingWeightKg: "350", cogNotes: "Painopiste palkin keskellä", craneId: createdEquipment[0].id, radiusM: "22", craneCapacityKg: "7400", areaDescription: "Nostoalue aidattu linjalla 5, liikenne ohjattu portille 2", safetyDistanceM: "6", riskDocumentId: rams.id });
  await liftPlanService.addAccessory(supervisorCtx, trayLift.id, { accessoryId: beam.id, count: 1 });
  await liftPlanService.addAccessory(supervisorCtx, trayLift.id, { accessoryId: sling4.id, count: 1 });
  await liftPlanService.submit(supervisorCtx, trayLift.id);
  await liftPlanService.decide(liftCtx, trayLift.id, { decision: "APPROVE", note: "Tuulirajat 10 m/s, merkinantaja paikalla" });
  const operator = createdEmployees.find((e) => e.trade === "Nosturinkuljettaja")!;
  await bookingService.create(pmCtx, { resources: [`EMPLOYEE:${operator.id}`], projectId: ndc.id, siteId: hallA.id, liftPlanId: trayLift.id, startsAt: `${tomorrowIso}T06:30`, endsAt: `${tomorrowIso}T09:30`, note: "Nosturinkuljettaja" });

  // A heavier lift awaiting approval (high utilisation, warnings shown to the approver).
  const transformerLift = await liftPlanService.create(supervisorCtx, { siteId: hallA.id, activityId: byKey("KA", "A6").id, title: "Muuntajan nosto perustukselle", plannedStart: `${inDays(3)}T08:00`, plannedEnd: `${inDays(3)}T10:00` });
  await liftPlanService.updateDraft(supervisorCtx, transformerLift.id, { loadDescription: "Jakelumuuntaja 1600 kVA", loadWeightKg: "6200", riggingWeightKg: "400", cogNotes: "Valmistajan nostopisteet, painopiste merkitty", craneId: createdEquipment[0].id, radiusM: "14", craneCapacityKg: "7200", areaDescription: "Muuntamon edusta", safetyDistanceM: "8" });
  await liftPlanService.addAccessory(supervisorCtx, transformerLift.id, { accessoryId: shackle.id, count: 2 });
  await liftPlanService.addAccessory(supervisorCtx, transformerLift.id, { accessoryId: sling4.id, count: 2 });
  await liftPlanService.submit(supervisorCtx, transformerLift.id);

  // Cable drums with pulls in metres, traced to takt activities.
  const drumDelivery = await db.delivery.findFirstOrThrow({ where: { companyId: sk.company.id, requestId: drumRequest.id } });
  const drumDefs = [
    { code: "KK-0001", cableType: "AXMK 4×240 1 kV", length: "500", pulls: [["120", "KA", "A5"], ["85.5", "KA", "A5"]] },
    { code: "KK-0002", cableType: "AXMK 4×240 1 kV", length: "500", pulls: [["210", "KA", "A6"]] },
    { code: "KK-0003", cableType: "MCMK 4×16+16 1 kV", length: "1000", pulls: [] },
    { code: "KK-0004", cableType: "AHXAMK-W 3×240 20 kV", length: "350", pulls: [] },
  ] as const;
  for (const d of drumDefs) {
    const drum = await cableDrumService.create(supervisorCtx, { siteId: hallA.id, code: d.code, manufacturer: "Kaapelitehdas Demo Oy", cableType: d.cableType, originalLengthM: d.length, weightKg: "2100", dimensions: "Ø 2200 × 1300 mm", locationId: cableStore.id, deliveryId: drumDelivery.id, reservedActivityId: byKey("KA", "A5").id, receivedDate: inDays(-7), nextInspectionDate: inDays(180) });
    for (const [m, wp, area] of d.pulls) await cableDrumService.pull(supervisorCtx, drum.id, { lengthM: m, activityId: byKey(wp, area).id, pulledOn: inDays(-2) });
  }

  // Material batches moving delivery → storage → workface → installed.
  const trays = await materialBatchService.create(supervisorCtx, { siteId: hallA.id, code: "ME-0001", material: "Kaapelihylly 400 mm, kuumasinkitty", quantity: "120", unit: "m", deliveryId: scaffolding.id, locationId: cableStore.id });
  await materialBatchService.move(supervisorCtx, trays.id, { to: "STORED", locationId: cableStore.id });
  await materialBatchService.move(supervisorCtx, trays.id, { to: "AT_WORKFACE", activityId: byKey("KH", "A5").id });
  await materialBatchService.move(supervisorCtx, trays.id, { to: "INSTALLED", note: "Linjat 1–4" });
  const brackets = await materialBatchService.create(supervisorCtx, { siteId: hallA.id, code: "ME-0002", material: "Hyllykannakkeet", quantity: "300", unit: "kpl" });
  await materialBatchService.move(supervisorCtx, brackets.id, { to: "STORED", locationId: cableStore.id });
  await materialBatchService.move(supervisorCtx, brackets.id, { to: "AT_WORKFACE", activityId: byKey("KH", "A6").id });
  await materialBatchService.create(supervisorCtx, { siteId: hallA.id, code: "ME-0003", material: "Kaapelimerkit ja nippusiteet", quantity: "4", unit: "laatikko", locationId: cableStore.id });

  // ── V6: commercial (SK Infra Demo) ───────────────────────────────
  const pdCtx = await ctxFor("pd@skinfra.example.com", "sk-infra-demo");
  const hyperscale = await customerService.create(pmCtx, { name: "Nordic Hyperscale Demo Oy", businessId: "0000001-9", address: "Esimerkkitie 1", postalCode: "90100", city: "Oulu" });
  await customerService.addContact(pmCtx, hyperscale.id, { name: "Hanna Hankinta", title: "Hankintapäällikkö", email: "hanna.hankinta@hyperscale.example.com", phone: "+358 40 000 0001" });
  const verkko = await customerService.create(pmCtx, { name: "Verkko Demo Oy", businessId: "0000002-7", city: "Muhos" });
  const tuuli = await customerService.create(pmCtx, { name: "Tuulipuisto Demo Oy", businessId: "0000003-5", city: "Raahe" });
  await opportunityService.create(pmCtx, { customerId: tuuli.id, title: "Tuulipuiston keräilyverkko 33 kV", stage: "RFQ", estimatedValue: "1850000", probabilityPct: "30", expectedCloseDate: inDays(60) });
  await opportunityService.create(pmCtx, { customerId: verkko.id, title: "Kaapelireitti osa 2", stage: "QUALIFIED", estimatedValue: "620000", probabilityPct: "50", expectedCloseDate: inDays(45) });
  const phase2 = await opportunityService.create(pmCtx, { customerId: hyperscale.id, title: "Data Hall B sähköasennukset", stage: "TENDER", estimatedValue: "940000", probabilityPct: "60", expectedCloseDate: inDays(30) });

  // Main contract for the data center project: a won quote (PM prepared, PD approved).
  const mainQuote = await quoteService.create(pmCtx, { customerId: hyperscale.id, projectId: ndc.id, title: "Data Hall A kaapeloinnit ja nostot" });
  for (const [category, description, quantity, unit, unitCost] of [
    ["LABOR", "Sähköasennustyö", "6400", "h", "44.00"],
    ["EQUIPMENT", "Kurottaja ja kaapelirumpuvaunu", "900", "h", "38.00"],
    ["LIFTING", "Ajoneuvonosturi, nostot", "24", "kpl", "1450.00"],
    ["MATERIALS", "Kaapelit ja hyllyt", "1", "erä", "310000.00"],
    ["SUBCONTRACT", "Telineet", "1", "erä", "42000.00"],
  ] as const) await quoteService.addLine(pmCtx, mainQuote.id, { category, description, quantity, unit, unitCost });
  await quoteService.updateDraft(pmCtx, mainQuote.id, { overheadPct: "8", riskPct: "4", marginPct: "14", validUntil: inDays(30), scope: "Kaapeloinnit, hyllyt ja nostot Data Hall A:ssa. Ei sisällä muuntajia." });
  await quoteService.submit(pmCtx, mainQuote.id);
  await quoteService.decide(pdCtx, mainQuote.id, { decision: "APPROVE", note: "Kate ja riskivaraus OK" });
  await quoteService.markSent(pmCtx, mainQuote.id);
  const won = await quoteService.recordOutcome(pmCtx, mainQuote.id, { outcome: "WON", projectId: ndc.id, contractNumber: "SOP-NDC-001", signedDate: isoDateString(addDays(today, -40)) });
  await contractService.addMilestone(pmCtx, won.contractId!, { title: "Ennakko 15 %", amount: "120000", dueDate: isoDateString(addDays(today, -30)) });
  await contractService.addMilestone(pmCtx, won.contractId!, { title: "Hyllyasennukset valmiit", amount: "220000", dueDate: inDays(20) });

  // Phase 2 quote awaiting the Project Director's approval.
  const phase2Quote = await quoteService.create(pmCtx, { customerId: hyperscale.id, opportunityId: phase2.id, title: "Data Hall B sähköasennukset" });
  await quoteService.addLine(pmCtx, phase2Quote.id, { category: "LABOR", description: "Sähköasennustyö", quantity: "8200", unit: "h", unitCost: "45.00" });
  await quoteService.addLine(pmCtx, phase2Quote.id, { category: "MATERIALS", description: "Kaapelit ja hyllyt", quantity: "1", unit: "erä", unitCost: "380000.00" });
  await quoteService.addLine(pmCtx, phase2Quote.id, { category: "LIFTING", description: "Nostot", quantity: "30", unit: "kpl", unitCost: "1450.00" });
  await quoteService.updateDraft(pmCtx, phase2Quote.id, { overheadPct: "8", riskPct: "5", marginPct: "15", validUntil: inDays(45) });
  await quoteService.submit(pmCtx, phase2Quote.id);

  // Variations: one approved by the client (uninvoiced), one awaiting internal approval, one ready to invoice.
  const vo1 = await variationService.create(pmCtx, { projectId: ndc.id, contractId: won.contractId, title: "Lisäkaapelointi linja 6", cause: "Asiakkaan muutospyyntö", clientReference: "Muutospyyntö MP-03" });
  await variationService.updateDraft(pmCtx, vo1.id, { title: "Lisäkaapelointi linja 6", cause: "Asiakkaan muutospyyntö", clientReference: "Muutospyyntö MP-03", laborCost: "8200", equipmentCost: "1400", materialsCost: "12600", markupPct: "15" });
  await variationService.submitForReview(pmCtx, vo1.id);
  await variationService.approveInternal(pdCtx, vo1.id, { decision: "APPROVE" });
  await variationService.recordClientDecision(pmCtx, vo1.id, { decision: "APPROVED", clientReference: "Tilaus MP-03 / sähköposti" });
  const vo2 = await variationService.create(pmCtx, { projectId: ndc.id, contractId: won.contractId, title: "Väliaikainen työmaavalaistus", cause: "Aikataulumuutos" });
  await variationService.updateDraft(pmCtx, vo2.id, { title: "Väliaikainen työmaavalaistus", cause: "Aikataulumuutos", laborCost: "2400", materialsCost: "1800", markupPct: "12" });
  await variationService.submitForReview(pmCtx, vo2.id);
  const vo3 = await variationService.create(pmCtx, { projectId: ndc.id, contractId: won.contractId, title: "Kaapelihyllyn lisäkannakointi", cause: "Suunnitelmamuutos", clientReference: "RFI-12" });
  await variationService.updateDraft(pmCtx, vo3.id, { title: "Kaapelihyllyn lisäkannakointi", cause: "Suunnitelmamuutos", clientReference: "RFI-12", laborCost: "3100", materialsCost: "2200", markupPct: "15" });
  await variationService.submitForReview(pmCtx, vo3.id);
  await variationService.approveInternal(pdCtx, vo3.id, { decision: "APPROVE" });
  await variationService.recordClientDecision(pmCtx, vo3.id, { decision: "APPROVED", clientReference: "RFI-12 vastaus" });
  await variationService.markExecuted(pmCtx, vo3.id);
  await variationService.markReadyToInvoice(pmCtx, vo3.id);

  // V7: a variation waiting for the client's decision in the portal.
  const vo4 = await variationService.create(pmCtx, { projectId: ndc.id, contractId: won.contractId, title: "UPS-tilan lisäpistorasiat", cause: "Asiakkaan muutospyyntö", clientReference: "MP-07", description: "12 kpl lisäpistorasioita UPS-tilaan, asennus ja käyttöönotto." });
  await variationService.updateDraft(pmCtx, vo4.id, { title: "UPS-tilan lisäpistorasiat", cause: "Asiakkaan muutospyyntö", clientReference: "MP-07", description: "12 kpl lisäpistorasioita UPS-tilaan, asennus ja käyttöönotto.", laborCost: "1900", materialsCost: "1300", markupPct: "15" });
  await variationService.submitForReview(pmCtx, vo4.id);
  await variationService.approveInternal(pdCtx, vo4.id, { decision: "APPROVE", note: "Hinta tarkistettu" });

  // Forecast: estimate to complete per category; invoice candidates up to today.
  for (const [category, etcAmount] of [["LABOR", "182000"], ["EQUIPMENT", "41000"], ["MATERIALS", "96000"], ["SUBCONTRACT", "18000"]] as const) await forecastService.setEtc(pmCtx, ndc.id, { category, etcAmount, note: "Kuukausiennuste" });
  await invoiceService.generate(pmCtx, { projectId: ndc.id, to: todayIso });

  // ── V7: HSE (SK Infra Demo, Nordic Data Center Demo) ─────────────
  const hseCtx = await ctxFor("hse@skinfra.example.com", "sk-infra-demo");
  const subCtx = await ctxFor("subcontractor@example.com", "sk-infra-demo");
  const at = (days: number, hm: string) => `${inDays(days)}T${hm}`;
  await hseObservationService.create(employeeCtx, { projectId: ndc.id, siteId: hallA.id, kind: "SAFETY_OBSERVATION", category: "HOUSEKEEPING", severity: "MEDIUM", title: "Kaapelikelojen välissä kulkuväylä tukossa", location: "Data Hall A, 1. krs", occurredAt: at(-3, "09:20") });
  const nearMiss = await hseObservationService.create(subCtx, { projectId: ndc.id, siteId: hallA.id, kind: "NEAR_MISS", category: "LIFTING", severity: "HIGH", title: "Hyllynippu heilahti noston aikana", description: "Taglinea ei käytetty, kukaan ei ollut nostoalueella.", occurredAt: at(-2, "13:05"), liftPlanId: trayLift.id });
  await hseObservationService.triage(smCtx, nearMiss.id, { category: "LIFTING", severity: "HIGH" });
  const tagAction = await hseActionService.create(smCtx, { sourceType: "OBSERVATION", sourceId: nearMiss.id, title: "Taglinet pakollisiksi kaikkiin hyllynostoihin", assigneeId: (await db.user.findUniqueOrThrow({ where: { email: "supervisor@skinfra.example.com" } })).id, dueDate: inDays(3) });
  void tagAction;
  const minor = await incidentService.report(employeeCtx, { projectId: ndc.id, siteId: hallA.id, type: "INJURY", severity: "FIRST_AID", title: "Viiltohaava kaapelin kuorinnassa", occurredAt: at(-10, "10:40"), immediateActions: "Ensiapu annettu" });
  await incidentService.triage(smCtx, minor.id, { type: "INJURY", severity: "FIRST_AID", immediateActions: "Ensiapu annettu, viiltosuojahanskat jaettu" });
  await incidentService.close(smCtx, minor.id, { note: "Viiltosuojahanskat käyttöön" });
  const serious = await incidentService.report(supervisorCtx, { projectId: ndc.id, siteId: hallA.id, type: "INJURY", severity: "LOST_TIME", title: "Kaatuminen telineeltä 1,5 m", occurredAt: at(-1, "14:30"), immediateActions: "Alue eristetty, teline tarkastettu" });
  await incidentService.triage(smCtx, serious.id, { type: "INJURY", severity: "LOST_TIME", immediateActions: "Alue eristetty, teline tarkastettu" });
  await incidentService.startInvestigation(hseCtx, serious.id);
  await incidentService.addPerson(hseCtx, serious.id, { personName: "Demo Henkilö", employerName: "SK Infra Demo", bodyPart: "Nilkka", injuryDescription: "Nyrjähdys (fiktiivinen)", absenceDays: "5" });
  await incidentService.recordInvestigation(hseCtx, serious.id, { rootCause: "Telineen kaide irrotettu ilman lupaa", lostDays: "5" });
  const railAction = await hseActionService.create(smCtx, { sourceType: "INCIDENT", sourceId: serious.id, title: "Telineiden päivittäinen tarkastus ennen käyttöä", dueDate: inDays(2) });
  await hseActionService.markDone(smCtx, railAction.id, { note: "Tarkastuslista otettu käyttöön" });
  await toolboxTalkService.create(smCtx, { projectId: ndc.id, siteId: hallA.id, heldOn: inDays(-7), topic: "Nostot ja taglinet", presenter: "Pekka Demo", attendeeCount: "14" });
  await toolboxTalkService.create(smCtx, { projectId: ndc.id, siteId: hallA.id, heldOn: inDays(-1), topic: "Telineiden käyttö", presenter: "Riikka Harjoitus", attendeeCount: "16" });
  for (const [days, correct, incorrect] of [[-21, 88, 12], [-14, 91, 9], [-7, 94, 6]] as const) {
    await hseInspectionService.create(smCtx, { projectId: ndc.id, siteId: hallA.id, kind: "MVR", inspectedOn: inDays(days), correctCount: String(correct), incorrectCount: String(incorrect) });
  }
  const ra = await riskAssessmentService.create(smCtx, { projectId: ndc.id, siteId: hallA.id, title: "Muuntajan nosto perustukselle", workDescription: "Ajoneuvonosturi, 18 t muuntaja", liftPlanId: transformerLift.id });
  await riskAssessmentService.addItem(smCtx, ra.id, { hazard: "Taakan putoaminen", likelihood: "2", consequence: "5", controls: "Nostoalue eristetty, nostovastaava paikalla", residualLikelihood: "1", residualConsequence: "5" });
  await riskAssessmentService.addItem(smCtx, ra.id, { hazard: "Nosturin kaatuminen", likelihood: "1", consequence: "5", controls: "Maapohja tarkastettu, tukijalkojen alusta", residualLikelihood: "1", residualConsequence: "4" });
  await riskAssessmentService.approve(hseCtx, ra.id);
  const permit = await workPermitService.request(subCtx, { projectId: ndc.id, siteId: hallA.id, type: "HOT_WORK", description: "Kannakkeiden hitsaus", contractor: "Aliurakka Demo Oy", validFrom: at(1, "07:00"), validTo: at(1, "15:00"), precautions: "Sammutin ja palovartija" });
  await workPermitService.decide(smCtx, permit.id, { decision: "APPROVE", note: "Palovartija nimetty" });
  await workPermitService.request(subCtx, { projectId: ndc.id, siteId: hallA.id, type: "WORK_AT_HEIGHT", description: "Hyllyasennus nostimelta", contractor: "Aliurakka Demo Oy", validFrom: at(2, "07:00"), validTo: at(2, "15:00") });

  console.log("✔ Seed complete (fictional data).");
  console.log("  Dev login users: group.admin@example.com (both companies), ceo@skinfra.example.com, pm@skinfra.example.com, lifting@skinfra.example.com, pd@skinfra.example.com, hse@skinfra.example.com, client@example.com (client approver), subcontractor@example.com, ceo@purent.example.com …");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
