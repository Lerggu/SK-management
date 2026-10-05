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
    await projectService.assignMember(skCeo, ndc.id, { userId: user.id, roleId: sk.roleId(u.role) });
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
    { assetNumber: "EQ-001", name: "Mobile crane 100 t", type: "CRANE", manufacturer: "Liebherr", model: "LTM 1100-4.2", meterHours: "5320.0", inspection: "2026-10-20", site: hallA.id, cost: "95.00", billing: "165.00" },
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
  await equipmentService.create(purentCeo, { equipmentTypeId: forklift.id, assetNumber: "PU-EQ-01", name: "Forklift 2.5 t", manufacturer: "Linde", nextInspectionDate: "2026-11-30" });

  console.log("✔ Seed complete (fictional data).");
  console.log("  Dev login users: group.admin@example.com (both companies), ceo@skinfra.example.com, pm@skinfra.example.com, client@example.com, ceo@purent.example.com …");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
