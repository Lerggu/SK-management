/**
 * Actions the assistant may propose (ADR 0031). Each action has a parameter
 * schema (model output is untrusted), a server-written summary shown on the
 * confirmation card, a money flag, and an executor that calls the normal
 * domain service with the confirming person's own context — so permissions,
 * validation and audit are exactly those of the UI.
 *
 * References: an id parameter may be an existing id (looked up by the
 * assistant's search tools) or "#n", the result of action n of the same
 * proposal (e.g. a person created earlier in the same request).
 */
import { z } from "zod";
import type { RequestContext } from "@/platform/authz";
import { readClient } from "@/platform/db";
import { ValidationError } from "@/platform/errors";
import { projectService, siteService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { rotationService } from "@/modules/workforce/rotation.service";
import { teamService } from "@/modules/workforce/team.service";
import { logisticsRequestService } from "@/modules/logistics/logistics.service";
import { hseObservationService } from "@/modules/hse/hse.service";

const ref = z.string().trim().regex(/^(#\d{1,2}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, "validation.invalidOption");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");
const dateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "validation.dateTime");
const name = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).optional().nullable();

export type Resolver = (value: string) => string;
export type Labels = { project: (id: string) => Promise<string>; site: (id: string) => Promise<string>; employee: (id: string) => Promise<string>; team: (id: string) => Promise<string> };

interface ActionDef<S extends z.ZodTypeAny> {
  description: string;
  params: S;
  money?: boolean;
  summary(p: z.output<S>, l: Labels): Promise<string>;
  execute(ctx: RequestContext, p: z.output<S>, r: Resolver): Promise<{ id: string; label: string }>;
}

const def = <S extends z.ZodTypeAny>(d: ActionDef<S>) => d;
const STATUS_FI: Record<string, string> = { WORK: "töissä", OFF: "vapaalla", VACATION: "lomalla", SICK: "sairaana", TRAINING: "koulutuksessa", OTHER: "poissa (muu syy)" };
const fiDate = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;
const fiDateTime = (iso: string) => `${fiDate(iso.slice(0, 10))} klo ${iso.slice(11, 16)}`;

/** Next free "E-####" employee number of the company. */
async function nextEmployeeNumber(ctx: RequestContext) {
  const rows = await readClient().employee.findMany({ where: { companyId: ctx.company.id, employeeNumber: { startsWith: "E-" } }, select: { employeeNumber: true } });
  const max = rows.map((r) => Number(r.employeeNumber.slice(2))).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 1000);
  return `E-${max + 1}`;
}

/** A project code from the name ("Mikkeli" → "MIK-01"), the first one not in use. */
async function nextProjectCode(ctx: RequestContext, projectName: string) {
  const base = (projectName.normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 3) || "PRJ").toUpperCase();
  const taken = new Set((await readClient().project.findMany({ where: { companyId: ctx.company.id, code: { startsWith: `${base}-` } }, select: { code: true } })).map((p) => p.code));
  for (let i = 1; i < 100; i++) {
    const code = `${base}-${String(i).padStart(2, "0")}`;
    if (!taken.has(code)) return code;
  }
  return `${base}-${Date.now() % 10000}`;
}

export const ACTIONS = {
  create_project: def({
    description: "Create a project. Params: name (required), code (optional, generated), customerName, startDate, endDate (YYYY-MM-DD).",
    params: z.object({ name: name(160), code: opt(30), customerName: opt(160), startDate: day.optional().nullable(), endDate: day.optional().nullable() }),
    async summary(p) {
      return [`Uusi projekti ”${p.name}”`, p.code ? `tunnus ${p.code}` : null, p.customerName ? `asiakas ${p.customerName}` : null, p.startDate ? `alkaa ${fiDate(p.startDate)}` : null, p.endDate ? `päättyy ${fiDate(p.endDate)}` : null].filter(Boolean).join(", ");
    },
    async execute(ctx, p) {
      const code = p.code || (await nextProjectCode(ctx, p.name));
      const created = await projectService.create(ctx, { name: p.name, code, customerName: p.customerName ?? null, startDate: p.startDate ?? null, endDate: p.endDate ?? null });
      return { id: created.id, label: `${code} ${p.name}` };
    },
  }),
  create_site: def({
    description: "Create a site in a project. Params: projectId (id or #n), name, city, address.",
    params: z.object({ projectId: ref, name: name(160), city: opt(80), address: opt(200) }),
    async summary(p, l) {
      return `Uusi työmaa ”${p.name}” projektiin ${await l.project(p.projectId)}${p.city ? `, ${p.city}` : ""}`;
    },
    async execute(ctx, p, r) {
      const site = await siteService.create(ctx, r(p.projectId), { name: p.name, city: p.city ?? null, address: p.address ?? null });
      return { id: site.id, label: p.name };
    },
  }),
  create_employee: def({
    description: "Add an employee. Params: firstName, lastName, trade (e.g. 'Ajoneuvonosturin kuljettaja'), jobTitle, phone, employeeNumber (optional, generated).",
    params: z.object({ firstName: name(80), lastName: name(80), trade: opt(120), jobTitle: opt(120), phone: opt(40), employeeNumber: opt(30) }),
    async summary(p) {
      return [`Uusi henkilö ${p.firstName} ${p.lastName}`, p.trade ? `ammatti ${p.trade}` : null, p.jobTitle ? `nimike ${p.jobTitle}` : null, p.phone ? `puh. ${p.phone}` : null].filter(Boolean).join(", ");
    },
    async execute(ctx, p) {
      const employeeNumber = p.employeeNumber || (await nextEmployeeNumber(ctx));
      const e = await employeeService.create(ctx, { employeeNumber, firstName: p.firstName, lastName: p.lastName, trade: p.trade ?? null, jobTitle: p.jobTitle ?? null, phone: p.phone ?? null });
      return { id: e.id, label: `${p.firstName} ${p.lastName} (${employeeNumber})` };
    },
  }),
  set_rotation: def({
    description: "Plan a person in the rotation calendar for a period. Params: employeeId (id or #n), status WORK|OFF|VACATION|SICK|TRAINING|OTHER, siteId (only with WORK), from, until (YYYY-MM-DD, until is required: ask if not said), note.",
    params: z.object({ employeeId: ref, status: z.enum(["WORK", "OFF", "VACATION", "SICK", "TRAINING", "OTHER"]), siteId: ref.optional().nullable(), from: day, until: day, note: opt(200) }),
    async summary(p, l) {
      return `${await l.employee(p.employeeId)}: ${STATUS_FI[p.status]}${p.siteId ? `, työmaa ${await l.site(p.siteId)}` : ""}, ${fiDate(p.from)}–${fiDate(p.until)}`;
    },
    async execute(ctx, p, r) {
      const res = await rotationService.setRange(ctx, { employeeId: r(p.employeeId), status: p.status, siteId: p.siteId ? r(p.siteId) : null, from: p.from, until: p.until, note: p.note ?? null });
      return { id: r(p.employeeId), label: `${res.days} päivää` };
    },
  }),
  create_team: def({
    description: "Create a team. Params: name, leaderId (optional), memberIds (optional list of employee ids or #n).",
    params: z.object({ name: name(80), leaderId: ref.optional().nullable(), memberIds: z.array(ref).max(50).optional() }),
    async summary(p, l) {
      const members = await Promise.all((p.memberIds ?? []).map((m) => l.employee(m)));
      return [`Uusi tiimi ”${p.name}”`, p.leaderId ? `vetäjä ${await l.employee(p.leaderId)}` : null, members.length ? `jäsenet ${members.join(", ")}` : null].filter(Boolean).join(", ");
    },
    async execute(ctx, p, r) {
      const team = await teamService.create(ctx, { name: p.name, leaderId: p.leaderId ? r(p.leaderId) : null });
      if (p.memberIds?.length) await teamService.addMembers(ctx, team.id, { employeeIds: p.memberIds.map(r) });
      return { id: team.id, label: p.name };
    },
  }),
  add_team_members: def({
    description: "Add people to an existing team. Params: teamId, employeeIds.",
    params: z.object({ teamId: ref, employeeIds: z.array(ref).min(1).max(50) }),
    async summary(p, l) {
      const members = await Promise.all(p.employeeIds.map((m) => l.employee(m)));
      return `Tiimiin ${await l.team(p.teamId)} lisätään ${members.join(", ")}`;
    },
    async execute(ctx, p, r) {
      await teamService.addMembers(ctx, r(p.teamId), { employeeIds: p.employeeIds.map(r) });
      return { id: r(p.teamId), label: `${p.employeeIds.length} jäsentä` };
    },
  }),
  create_logistics_task: def({
    description: "Create a logistics task (request). Params: siteId, title, serviceType DELIVERY|LIFT|INTERNAL_MOVE|WASTE_REMOVAL|OTHER, start, end (YYYY-MM-DDTHH:mm, Helsinki time), weightKg, taskTypeId (optional, from list_task_types).",
    params: z.object({ siteId: ref, title: name(160), serviceType: z.enum(["DELIVERY", "LIFT", "INTERNAL_MOVE", "WASTE_REMOVAL", "OTHER"]), start: dateTime, end: dateTime, weightKg: z.number().positive().max(1_000_000).optional().nullable(), taskTypeId: ref.optional().nullable() }),
    async summary(p, l) {
      return `Logistiikkatehtävä ”${p.title}” työmaalle ${await l.site(p.siteId)}, ${fiDateTime(p.start)}–${p.end.slice(11, 16)}${p.weightKg ? `, raskain kuorma ${p.weightKg} kg` : ""}`;
    },
    async execute(ctx, p, r) {
      const t = await logisticsRequestService.create(ctx, { siteId: r(p.siteId), title: p.title, serviceType: p.serviceType, requestedStart: p.start, requestedEnd: p.end, weightKg: p.weightKg ? String(p.weightKg) : null, taskTypeId: p.taskTypeId ? r(p.taskTypeId) : null });
      return { id: t.id, label: p.title };
    },
  }),
  report_hse_observation: def({
    description: "Report a safety observation. Params: projectId, siteId (optional), title, description.",
    params: z.object({ projectId: ref, siteId: ref.optional().nullable(), title: name(200), description: opt(2000) }),
    async summary(p, l) {
      return `Turvallisuushavainto projektiin ${await l.project(p.projectId)}: ”${p.title}”`;
    },
    async execute(ctx, p, r) {
      const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(" ", "T");
      const o = await hseObservationService.create(ctx, { projectId: r(p.projectId), siteId: p.siteId ? r(p.siteId) : null, kind: "SAFETY_OBSERVATION", title: p.title, description: p.description ?? null, occurredAt: now });
      return { id: o.id, label: p.title };
    },
  }),
  add_employee_rate: def({
    description: "MONEY: add a cost or billing rate for a person. Params: employeeId, rateType COST|BILLING, unit HOUR|DAY, amount (euros, e.g. '45.50'), validFrom (YYYY-MM-DD). Always needs explicit confirmation of the amount.",
    params: z.object({ employeeId: ref, rateType: z.enum(["COST", "BILLING"]), unit: z.enum(["HOUR", "DAY"]).default("HOUR"), amount: z.string().trim().regex(/^\d{1,8}([.,]\d{1,2})?$/, "validation.decimal"), validFrom: day }),
    money: true,
    async summary(p, l) {
      return `${p.rateType === "COST" ? "Kustannushinta" : "Laskutushinta"} ${await l.employee(p.employeeId)}: ${p.amount.replace(".", ",")} € / ${p.unit === "HOUR" ? "tunti" : "päivä"} alkaen ${fiDate(p.validFrom)}`;
    },
    async execute(ctx, p, r) {
      await employeeService.addRate(ctx, r(p.employeeId), { rateType: p.rateType, unit: p.unit, amount: p.amount.replace(",", "."), currency: "EUR", validFrom: p.validFrom });
      return { id: r(p.employeeId), label: `${p.amount.replace(".", ",")} €` };
    },
  }),
} as const;

export type ActionType = keyof typeof ACTIONS;
export const ACTION_TYPES = Object.keys(ACTIONS) as ActionType[];

/** Parses a proposed action's params; throws ValidationError with the field errors. */
export function parseActionParams(type: ActionType, params: unknown) {
  const r = ACTIONS[type].params.safeParse(params);
  if (!r.success) throw new ValidationError(Object.fromEntries(r.error.issues.map((i) => [i.path.join(".") || "_form", [i.message]])));
  return r.data;
}

/** Amount of a money action, normalized for the explicit confirmation. */
export function moneyAmount(type: ActionType, params: Record<string, unknown>): string | null {
  return ACTIONS[type].money ? String(params.amount ?? "").replace(",", ".") : null;
}
