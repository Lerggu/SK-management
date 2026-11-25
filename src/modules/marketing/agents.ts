/**
 * The marketing agents (ADR 0032). They run per company inside its tenant
 * scope, on a schedule (src/instrumentation.ts) or on demand:
 *
 * 1. discovery — TED notices (official API) scored by the AI, then AI web
 *    search per focus (data centres, industry, 110 kV grid, Finnish
 *    procurement); results are merged into the register with their sources;
 * 2. drafting — a targeted letter and call script per contact of a fitting
 *    lead; approved by a person unless automatic sending is switched on;
 * 3. sending — approved letters within the daily limit, with Reply-To set to
 *    the chosen salespeople and an unsubscribe link.
 *
 * Every AI call is recorded as a marketing run with its cost; runs stop once
 * the month's marketing AI budget is used.
 */
import { randomBytes } from "node:crypto";
import { db, readClient, runInTransaction, withTenantScope } from "@/platform/db";
import { writeAudit } from "@/platform/audit";
import { getAiProvider, usdToEur, type AiProvider } from "@/platform/ai";
import { getMailer, type Mailer } from "@/platform/mail";
import { appBaseUrl } from "@/platform/config/env";
import { getTedFetch, type TedNotice } from "@/platform/integrations/ted";
import { getWebSearch } from "@/platform/integrations/web-search";
import { withBudgetHold } from "@/modules/ai/budget";
import { MarketingRepo } from "./repo";
import {
  DISCOVERY_FOCUSES,
  DISCOVERY_SCHEMA,
  GOOGLE_SEARCH_TOOL,
  googleSearchInput,
  LETTER_SCHEMA,
  TED_SCORE_SCHEMA,
  discoveryPrompt,
  discoverySchema,
  heuristicTedScores,
  letterPrompt,
  letterSchema,
  sampleDiscovery,
  sampleLetter,
  tedScoreSchema,
  tedScoringPrompt,
  type DiscoveredProject,
  type DiscoveryFocus,
} from "./ai";
import { clampScore, dayStart, dedupeKey, discoveryDue, isoDateOrNull, letterLanguage, mergeLead, monthStart, normaliseEmail, safeUrl, type LeadFields } from "./rules";

export interface MarketingScope {
  companyId: string;
  organizationId: string;
}

export interface AgentOptions {
  /** The member who started the run (null = scheduler). */
  userId?: string | null;
  provider?: AiProvider | null;
  mailer?: Mailer | null;
  now?: Date;
}

const META = { requestId: "marketing-agent", ip: null, userAgent: "marketing-agent" };
const TED_BATCH = 40;
const DRAFTS_PER_RUN = 15;
/** Google (Serper/Brave) queries per discovery focus. */
const GOOGLE_SEARCHES_PER_RUN = 12;
/** Below this many euros left, no new AI call starts. */
const MIN_REMAINING_EUR = 0.5;

const systemActor = (scope: MarketingScope) => ({ kind: "system" as const, meta: META, companyId: scope.companyId, organizationId: scope.organizationId });
/** Error text stored on a run: known provider failures become translatable keys, others are clipped. */
export function err(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/authentication_error|invalid x-api-key|SK_ANTHROPIC_API_KEY is not configured/i.test(msg)) return "marketing.errors.aiKey";
  if (/rate_limit_error|overloaded_error|\b(429|529)\b/.test(msg)) return "marketing.errors.aiBusy";
  if (/credit balance|billing/i.test(msg)) return "marketing.errors.aiBilling";
  if (/TED search failed|Search failed|fetch failed|ETIMEDOUT|ECONNRESET|aborted|timeout/i.test(msg)) return "marketing.errors.sourceUnavailable";
  if (/did not finish within the tool budget|exceeded the output limit|did not deliver a structured answer/i.test(msg)) return "marketing.errors.aiIncomplete";
  return msg.slice(0, 500);
}

async function settingsOf(repo: MarketingRepo) {
  return (await repo.getSettings()) ?? (await repo.upsertSettings({}));
}

/** Remaining marketing AI budget this month (EUR). */
export async function marketingBudget(repo: MarketingRepo, now = new Date()) {
  const s = await settingsOf(repo);
  const usedEur = usdToEur(await repo.costSinceUsd(monthStart(now)));
  const limitEur = Number(s.aiMonthlyBudgetEur);
  return { limitEur, usedEur, remainingEur: Math.max(0, limitEur - usedEur), exhausted: limitEur - usedEur < MIN_REMAINING_EUR };
}

/** Runs one AI call as a recorded marketing run; null when blocked or failed. */
async function aiRun<T>(
  scope: MarketingScope,
  opts: AgentOptions,
  run: { kind: "DISCOVERY" | "DRAFT"; source: string },
  call: (provider: AiProvider) => Promise<{ result: unknown; costUsd: number }>,
  parse: (raw: unknown) => T,
): Promise<{ value: T | null; runId: string; error?: string }> {
  const repo = new MarketingRepo(readClient(), scope.companyId);
  const r = await repo.createRun({ kind: run.kind, source: run.source, startedById: opts.userId ?? null });
  const provider = opts.provider !== undefined ? opts.provider : getAiProvider();
  if (!provider) {
    await repo.finishRun(r.id, { status: "FAILED", error: "marketing.errors.aiUnavailable" });
    return { value: null, runId: r.id, error: "marketing.errors.aiUnavailable" };
  }
  // Serialized with the other marketing runs of the company (ADR 0035).
  return withBudgetHold(
    scope.companyId,
    "MARKETING",
    async (tx) => (await marketingBudget(new MarketingRepo(tx, scope.companyId), opts.now)).remainingEur,
    async () => {
      await repo.finishRun(r.id, { status: "BLOCKED_BUDGET", error: "marketing.errors.budgetExhausted" });
      return { value: null, runId: r.id, error: "marketing.errors.budgetExhausted" };
    },
    async () => {
      let costUsd = 0;
      try {
        const out = await call(provider);
        costUsd = out.costUsd;
        const value = parse(out.result);
        await repo.finishRun(r.id, { status: "SUCCEEDED", costUsd: costUsd.toFixed(6) });
        return { value, runId: r.id };
      } catch (e) {
        await repo.finishRun(r.id, { status: "FAILED", costUsd: costUsd.toFixed(6), error: err(e) });
        return { value: null, runId: r.id, error: err(e) };
      }
    },
    { minFreeEur: MIN_REMAINING_EUR },
  );
}

// ── register upsert ─────────────────────────────────────────────────

interface Finding {
  lead: LeadFields;
  source: { kind: "TED" | "HILMA" | "GRID" | "WEB"; externalId: string; url: string | null; title: string | null; publishedAt: Date | null };
  extraSources?: { url: string; title: string | null; publishedAt: Date | null }[];
  contacts: { name: string | null; role: string | null; organization: string | null; responsibility: string | null; email: string | null; phone: string | null; sourceUrl: string | null }[];
}

/** Merges one finding into the register; returns whether a lead was created. */
async function upsertFinding(scope: MarketingScope, f: Finding, userId: string | null): Promise<"created" | "updated" | "skipped"> {
  return runInTransaction(async (tx) => {
    const repo = new MarketingRepo(tx, scope.companyId);
    const known = await repo.findSource(f.source.kind, f.source.externalId);
    const key = dedupeKey({ country: f.lead.country, title: f.lead.title });
    let lead = known ? await tx.marketingLead.findFirst({ where: { id: known.leadId, companyId: scope.companyId } }) : await repo.findLeadByKey(key);
    let outcome: "created" | "updated" | "skipped";
    if (!lead) {
      lead = await repo.createLead({ ...f.lead, dedupeKey: key, createdById: userId, updatedById: userId });
      outcome = "created";
      await writeAudit(tx, systemActor(scope), { action: "marketing_lead.discover", entityType: "marketing_lead", entityId: lead.id, after: { title: lead.title, source: f.source.kind, fitScore: lead.fitScore } });
    } else {
      const patch = mergeLead(lead as unknown as Record<keyof LeadFields, unknown>, f.lead);
      await repo.updateLead(lead.id, { ...patch, lastSeenAt: new Date() });
      outcome = Object.keys(patch).length || !known ? "updated" : "skipped";
    }
    for (const s of [f.source, ...(f.extraSources ?? []).map((x) => ({ kind: f.source.kind, externalId: x.url, url: x.url, title: x.title, publishedAt: x.publishedAt }))]) {
      if (!(await repo.findSource(s.kind, s.externalId))) await repo.createSource({ leadId: lead.id, ...s });
    }
    for (const c of f.contacts) {
      const email = normaliseEmail(c.email);
      if (!c.name && !email && !c.phone) continue;
      if (email && (await repo.findContactByEmail(lead.id, email))) continue;
      const dupe = !email && (await tx.marketingContact.findFirst({ where: { companyId: scope.companyId, leadId: lead.id, archivedAt: null, name: c.name, phone: c.phone } }));
      if (dupe) continue;
      await repo.createContact({ leadId: lead.id, name: c.name, role: c.role, organization: c.organization, responsibility: c.responsibility, email, phone: c.phone, sourceUrl: c.sourceUrl, createdById: userId, updatedById: userId });
    }
    return outcome;
  });
}

function emptyLead(title: string): LeadFields {
  return { title, summary: null, category: "OTHER", stage: "UNKNOWN", country: null, location: null, ownerOrg: null, timing: null, startDate: null, tenderDeadline: null, budget: null, currency: null, budgetText: null, voltageKv: null, fitScore: 0, services: [], fitReason: null };
}

// ── discovery: TED ──────────────────────────────────────────────────

async function discoverTed(scope: MarketingScope, opts: AgentOptions, countries: string[], since: string) {
  const repo = new MarketingRepo(readClient(), scope.companyId);
  let notices: TedNotice[];
  try {
    // The home market (Finland) is queried on its own so that large countries do not crowd it out of the result limit.
    const home = countries.filter((c) => c === "FI");
    const others = countries.filter((c) => c !== "FI");
    const batches = await Promise.all([home, others].filter((c) => c.length).map((c) => getTedFetch()({ countries: c, since, limit: 100 })));
    const seen = new Set<string>();
    notices = batches.flat().filter((n) => !seen.has(n.publicationNumber) && seen.add(n.publicationNumber));
  } catch (e) {
    const r = await repo.createRun({ kind: "DISCOVERY", source: "TED", startedById: opts.userId ?? null });
    await repo.finishRun(r.id, { status: "FAILED", error: err(e) });
    return { found: 0, created: 0, updated: 0, error: err(e) };
  }
  const fresh: TedNotice[] = [];
  for (const n of notices) if (!(await repo.findSource("TED", n.publicationNumber))) fresh.push(n);
  let created = 0;
  let updated = 0;
  let error: string | undefined;
  for (let i = 0; i < fresh.length; i += TED_BATCH) {
    const batch = fresh.slice(i, i + TED_BATCH).map((n, j) => ({ ...n, ref: `n${j}` }));
    const { system, prompt } = tedScoringPrompt(batch);
    const scored = await aiRun(
      scope,
      opts,
      { kind: "DISCOVERY", source: "TED" },
      async (p) => {
        const out = await p.run({ system, prompt, tools: [], executeTool: async () => null, maxToolRounds: 0, resultSchema: TED_SCORE_SCHEMA, deterministicAnswer: () => heuristicTedScores(batch) });
        return { result: out.result, costUsd: out.usage.costUsd };
      },
      (raw) => tedScoreSchema.parse(raw).items,
    );
    if (!scored.value) {
      error = scored.error;
      break;
    }
    const before = { created, updated };
    for (const n of batch) {
      const s = scored.value.find((x) => x.ref === n.ref);
      if (!s) continue;
      const lead: LeadFields = {
        ...emptyLead(n.title),
        summary: s.summary,
        category: s.category,
        stage: s.stage === "UNKNOWN" ? "TENDERING" : s.stage,
        country: n.country,
        location: n.city,
        ownerOrg: n.buyer,
        tenderDeadline: isoDateOrNull(n.deadline),
        budget: n.estimatedValue !== null && n.currency ? n.estimatedValue.toFixed(2) : null,
        currency: n.estimatedValue !== null && n.currency ? n.currency.slice(0, 3).toUpperCase() : null,
        fitScore: clampScore(s.fitScore),
        services: s.services,
        fitReason: s.fitReason,
      };
      const contacts = n.buyerPhone ? [{ name: null, role: "Procurement", organization: n.buyer, responsibility: "Buyer (public procurement)", email: null, phone: n.buyerPhone.slice(0, 40), sourceUrl: n.url }] : [];
      const r = await upsertFinding(scope, { lead, source: { kind: "TED", externalId: n.publicationNumber, url: n.url, title: n.title, publishedAt: isoDateOrNull(n.publishedAt) }, contacts }, opts.userId ?? null);
      if (r === "created") created++;
      else if (r === "updated") updated++;
    }
    await repo.updateRunCounts(scored.runId, { found: batch.length, created: created - before.created, updated: updated - before.updated });
  }
  return { found: notices.length, created, updated, error };
}

// ── discovery: web search ───────────────────────────────────────────

function toFinding(p: DiscoveredProject, focus: DiscoveryFocus): Finding | null {
  const sources = p.sources.map((s) => ({ url: safeUrl(s.url), title: s.title, publishedAt: isoDateOrNull(s.publishedAt) })).filter((s): s is { url: string; title: string | null; publishedAt: Date | null } => s.url !== null);
  if (!sources.length) return null; // nothing without a source
  const country = p.country && /^[A-Za-z]{2}$/.test(p.country) ? p.country.toUpperCase() : null;
  const currency = p.currency && /^[A-Za-z]{3}$/.test(p.currency) ? p.currency.toUpperCase() : null;
  return {
    lead: {
      title: p.title,
      summary: p.summary,
      category: p.category,
      stage: p.stage,
      country,
      location: p.location,
      ownerOrg: p.ownerOrg,
      timing: p.timing,
      startDate: isoDateOrNull(p.startDate),
      tenderDeadline: isoDateOrNull(p.tenderDeadline),
      budget: p.budget !== null && currency ? p.budget.toFixed(2) : null,
      currency: p.budget !== null && currency ? currency : null,
      budgetText: p.budgetText,
      voltageKv: p.voltageKv,
      fitScore: clampScore(p.fitScore),
      services: p.services,
      fitReason: p.fitReason,
    },
    source: { kind: focus.sourceKind, externalId: sources[0].url, url: sources[0].url, title: sources[0].title, publishedAt: sources[0].publishedAt },
    extraSources: sources.slice(1),
    // A contact without the page it was published on is dropped (GDPR: source of data).
    contacts: p.contacts.map((c) => ({ ...c, sourceUrl: safeUrl(c.sourceUrl) })).filter((c) => c.sourceUrl !== null),
  };
}

async function discoverWeb(scope: MarketingScope, opts: AgentOptions, focus: DiscoveryFocus, countries: string[]) {
  const repo = new MarketingRepo(readClient(), scope.companyId);
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const settings = await settingsOf(repo);
  const search = getWebSearch();
  const { system, prompt } = discoveryPrompt(focus, { countries, today, known: await repo.knownTitles(), watchCompanies: settings.watchCompanies, googleSearch: !!search });
  // Google results (Serper) or Brave, when a key is configured: a client tool the app executes.
  let searches = 0;
  const executeTool = async (name: string, input: unknown) => {
    if (name !== GOOGLE_SEARCH_TOOL.name || !search) throw new Error(`Unknown tool ${name}`);
    if (++searches > GOOGLE_SEARCHES_PER_RUN) throw new Error("Search limit for this run reached; deliver the result now.");
    const q = googleSearchInput.parse(input);
    const hits = await search.search({ query: q.query, news: q.news, country: q.country || focus.country || null, language: q.language || focus.language || null, num: 10 });
    return hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet, date: h.date, source: h.source }));
  };
  const res = await aiRun(
    scope,
    opts,
    { kind: "DISCOVERY", source: focus.key },
    async (p) => {
      const out = await p.run({
        system,
        prompt,
        tools: search ? [GOOGLE_SEARCH_TOOL] : [],
        executeTool,
        maxToolRounds: search ? 10 : 0,
        resultSchema: DISCOVERY_SCHEMA,
        maxOutputTokens: 32_000,
        webSearch: { maxUses: focus.maxSearches, allowedDomains: focus.allowedDomains },
        deterministicAnswer: () => sampleDiscovery(focus),
      });
      return { result: out.result, costUsd: out.usage.costUsd };
    },
    (raw) => discoverySchema.parse(raw).projects,
  );
  if (!res.value) return { found: 0, created: 0, updated: 0, error: res.error };
  let created = 0;
  let updated = 0;
  for (const p of res.value) {
    const f = toFinding(p, focus);
    if (!f) continue;
    const r = await upsertFinding(scope, f, opts.userId ?? null);
    if (r === "created") created++;
    else if (r === "updated") updated++;
  }
  await repo.updateRunCounts(res.runId, { found: res.value.length, created, updated });
  return { found: res.value.length, created, updated };
}

export interface DiscoveryResult {
  sources: { source: string; found: number; created: number; updated: number; error?: string }[];
}

/** Discovery run for one company (inside its tenant scope). */
export async function runDiscovery(scope: MarketingScope, opts: AgentOptions = {}): Promise<DiscoveryResult> {
  return withTenantScope(scope, async () => {
    const repo = new MarketingRepo(readClient(), scope.companyId);
    const settings = await settingsOf(repo);
    const now = opts.now ?? new Date();
    const since = (settings.lastRunAt ? new Date(settings.lastRunAt.getTime() - 86_400_000) : new Date(now.getTime() - 30 * 86_400_000)).toISOString().slice(0, 10);
    await repo.touchLastRun(now);
    const out: DiscoveryResult = { sources: [] };
    out.sources.push({ source: "TED", ...(await discoverTed(scope, opts, settings.countries, since)) });
    for (const focus of DISCOVERY_FOCUSES) {
      if (focus.country && !settings.countries.includes(focus.country)) continue;
      out.sources.push({ source: focus.key, ...(await discoverWeb(scope, opts, focus, settings.countries)) });
    }
    return out;
  });
}

// ── drafting ────────────────────────────────────────────────────────

/** Drafts letters for contacts of fitting leads; auto-approves when automatic sending is on. */
export async function draftLetters(scope: MarketingScope, opts: AgentOptions & { leadId?: string } = {}) {
  return withTenantScope(scope, async () => {
    const repo = new MarketingRepo(readClient(), scope.companyId);
    const [settings, company] = await Promise.all([settingsOf(repo), repo.getCompany()]);
    const minScore = opts.leadId ? 0 : settings.minScore;
    const candidates = (await repo.contactsNeedingLetters(minScore, DRAFTS_PER_RUN * 3)).filter((c) => !opts.leadId || c.leadId === opts.leadId).slice(0, DRAFTS_PER_RUN);
    let drafted = 0;
    let error: string | undefined;
    for (const c of candidates) {
      const language = letterLanguage(c.lead.country);
      const input = {
        companyName: company?.name ?? "",
        pitch: settings.pitch,
        language,
        lead: { title: c.lead.title, summary: c.lead.summary, category: c.lead.category, stage: c.lead.stage, location: c.lead.location, country: c.lead.country, ownerOrg: c.lead.ownerOrg, timing: c.lead.timing, services: c.lead.services, voltageKv: c.lead.voltageKv },
        contact: { name: c.name, role: c.role, organization: c.organization, responsibility: c.responsibility },
      };
      const { system, prompt } = letterPrompt(input);
      const res = await aiRun(
        scope,
        opts,
        { kind: "DRAFT", source: c.leadId },
        async (p) => {
          const out = await p.run({ system, prompt, tools: [], executeTool: async () => null, maxToolRounds: 0, resultSchema: LETTER_SCHEMA, deterministicAnswer: () => sampleLetter(input) });
          return { result: out.result, costUsd: out.usage.costUsd };
        },
        (raw) => letterSchema.parse(raw),
      );
      if (!res.value) {
        error = res.error;
        break;
      }
      const letter = res.value;
      await runInTransaction(async (tx) => {
        const r = new MarketingRepo(tx, scope.companyId);
        const auto = settings.autoSend;
        const m = await r.createMessage({
          leadId: c.leadId,
          contactId: c.id,
          language,
          subject: letter.subject,
          body: letter.body,
          callScript: letter.callScript,
          status: auto ? "APPROVED" : "DRAFT",
          approvedAt: auto ? new Date() : null,
          unsubscribeToken: randomBytes(24).toString("base64url"),
          createdById: opts.userId ?? null,
          updatedById: opts.userId ?? null,
        });
        if (c.lead.status === "NEW") await r.updateLead(c.leadId, { status: "QUALIFIED" });
        await writeAudit(tx, systemActor(scope), { action: auto ? "marketing_message.auto_approve" : "marketing_message.draft", entityType: "marketing_message", entityId: m.id, after: { leadId: c.leadId, language } });
      });
      drafted++;
    }
    return { candidates: candidates.length, drafted, error };
  });
}

// ── sending ─────────────────────────────────────────────────────────

const UNSUBSCRIBE_TEXT = {
  fi: "Jos et halua enää yhteydenottoja meiltä, peru ne tästä:",
  sv: "Om du inte vill bli kontaktad av oss igen, avregistrera dig här:",
  en: "If you do not want to hear from us again, unsubscribe here:",
} as const;

export function unsubscribeUrl(token: string) {
  return `${appBaseUrl()}/unsubscribe/${token}`;
}

/** One-click endpoint for mail clients (RFC 8058). */
export function oneClickUnsubscribeUrl(token: string) {
  return `${appBaseUrl()}/api/unsubscribe/${token}`;
}

/** Final text of a letter: body, signature and the unsubscribe link. */
export function composeLetter(m: { body: string; language: string; unsubscribeToken: string }, signature: { senderName: string | null; companyName: string; replyTo: { name: string | null; email: string }[] }) {
  const lang = (m.language in UNSUBSCRIBE_TEXT ? m.language : "en") as keyof typeof UNSUBSCRIBE_TEXT;
  const people = signature.replyTo.map((p) => (p.name ? `${p.name} <${p.email}>` : p.email)).join("\n");
  return [m.body.trim(), "", signature.senderName ?? "", signature.companyName, people, "", "--", `${UNSUBSCRIBE_TEXT[lang]} ${unsubscribeUrl(m.unsubscribeToken)}`]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

/** Sends approved letters of one company within the daily limit. */
export async function sendApproved(scope: MarketingScope, opts: AgentOptions & { messageId?: string } = {}) {
  return withTenantScope(scope, async () => {
    const mailer = opts.mailer !== undefined ? opts.mailer : getMailer();
    const repo = new MarketingRepo(readClient(), scope.companyId);
    const [settings, company] = await Promise.all([settingsOf(repo), repo.getCompany()]);
    const replyTo = (await repo.activeMembers(settings.replyToUserIds)).map((m) => m.user).filter((u) => normaliseEmail(u.email));
    const result = { sent: 0, failed: 0, suppressed: 0, skipped: 0, error: undefined as string | undefined };
    if (!mailer) return { ...result, error: "marketing.errors.mailNotConfigured" };
    if (!replyTo.length) return { ...result, error: "marketing.errors.noReplyTo" };
    const room = settings.dailySendLimit - (await repo.countSentSince(dayStart(opts.now)));
    if (room <= 0) return { ...result, error: "marketing.errors.dailyLimit" };
    const ids = opts.messageId ? [{ id: opts.messageId }] : await repo.approvedIds(room);
    for (const { id } of ids.slice(0, room)) {
      const claimed = await runInTransaction((tx) => new MarketingRepo(tx, scope.companyId).claimMessage(id, ["APPROVED", "FAILED"], { status: "SENDING", attempts: { increment: 1 } }));
      if (!claimed) {
        result.skipped++;
        continue;
      }
      const m = await repo.findMessage(id);
      const email = normaliseEmail(m?.contact.email);
      if (!m || !m.approvedAt || !email || (await repo.isSuppressed(email)) || m.contact.archivedAt) {
        await repo.updateMessage(id, { status: "REJECTED", error: "marketing.errors.suppressed" });
        result.suppressed++;
        continue;
      }
      try {
        await mailer.send({
          to: email,
          subject: m.subject,
          text: composeLetter(m, { senderName: settings.senderName, companyName: company?.name ?? "", replyTo: replyTo.map((u) => ({ name: u.name, email: u.email })) }),
          replyTo: replyTo.map((u) => u.email),
          headers: { "List-Unsubscribe": `<${oneClickUnsubscribeUrl(m.unsubscribeToken)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        });
        await runInTransaction(async (tx) => {
          const r = new MarketingRepo(tx, scope.companyId);
          await r.updateMessage(id, { status: "SENT", sentAt: new Date(), sentTo: email, error: null, callStatus: m.contact.phone ? "TODO" : null });
          if (m.lead.status === "NEW" || m.lead.status === "QUALIFIED") await r.updateLead(m.leadId, { status: "CONTACTED" });
          await writeAudit(tx, systemActor(scope), { action: "marketing_message.send", entityType: "marketing_message", entityId: id, after: { leadId: m.leadId, replyTo: replyTo.length } });
        });
        result.sent++;
      } catch (e) {
        await repo.updateMessage(id, { status: "FAILED", error: err(e) });
        result.failed++;
      }
    }
    return result;
  });
}

// ── unsubscribe (public link) ───────────────────────────────────────

/** What the public unsubscribe page shows for a token (language, company, already done). */
export async function unsubscribeInfo(token: string): Promise<{ ok: boolean; language: string; companyName?: string; done?: boolean }> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, language: "en" };
  const m = await db.marketingMessage.findUnique({ where: { unsubscribeToken: token }, select: { companyId: true, language: true, contact: { select: { email: true } }, company: { select: { name: true } } } });
  if (!m) return { ok: false, language: "en" };
  const email = normaliseEmail(m.contact.email);
  const done = email ? !!(await db.marketingSuppression.findUnique({ where: { companyId_email: { companyId: m.companyId, email } } })) : false;
  return { ok: true, language: m.language, companyName: m.company.name, done };
}

/** Opt-out by the token of a letter: the address is never contacted again by that company. */
export async function unsubscribeByToken(token: string): Promise<{ ok: boolean; companyName?: string }> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false };
  const m = await db.marketingMessage.findUnique({ where: { unsubscribeToken: token }, select: { id: true, companyId: true, contact: { select: { email: true } } } });
  if (!m) return { ok: false };
  const company = await db.company.findUniqueOrThrow({ where: { id: m.companyId }, select: { id: true, name: true, organizationId: true } });
  const scope = { companyId: company.id, organizationId: company.organizationId };
  const email = normaliseEmail(m.contact.email);
  await withTenantScope(scope, () =>
    runInTransaction(async (tx) => {
      const r = new MarketingRepo(tx, scope.companyId);
      if (email && !(await r.isSuppressed(email))) {
        await r.suppress(email, "UNSUBSCRIBE");
        await writeAudit(tx, systemActor(scope), { action: "marketing.unsubscribe", entityType: "marketing_message", entityId: m.id, metadata: { via: "link" } });
      }
      // Pending letters to the address are cancelled.
      if (email) await tx.marketingMessage.updateMany({ where: { companyId: scope.companyId, status: { in: ["DRAFT", "APPROVED", "FAILED"] }, contact: { email } }, data: { status: "REJECTED", error: "marketing.errors.suppressed" } });
    }),
  );
  return { ok: true, companyName: company.name };
}

// ── approval notice ─────────────────────────────────────────────────

/**
 * Tells the reply recipients (the salespeople) that new letters wait for
 * approval, with a link to the approval list. Only when letters are not
 * sent automatically; a failure never stops the cycle.
 */
export async function notifyPendingApprovals(scope: MarketingScope, drafted: number, opts: AgentOptions = {}) {
  if (drafted <= 0) return { sent: 0 };
  return withTenantScope(scope, async () => {
    const mailer = opts.mailer !== undefined ? opts.mailer : getMailer();
    const repo = new MarketingRepo(readClient(), scope.companyId);
    const [settings, company] = await Promise.all([settingsOf(repo), repo.getCompany()]);
    if (!mailer || settings.autoSend || !company) return { sent: 0 };
    const people = (await repo.activeMembers(settings.replyToUserIds)).map((m) => m.user).filter((u) => normaliseEmail(u.email));
    const drafts = await repo.listMessages(["DRAFT"], 10);
    const total = (await repo.listMessages(["DRAFT"], 500)).length;
    const url = `${appBaseUrl()}/c/${company.slug}/marketing/approvals`;
    const lines = drafts.map((d) => `– ${d.lead.title} (${d.lead.fitScore}/100) → ${d.contact.name ?? d.contact.email}`);
    let sent = 0;
    for (const p of people) {
      try {
        await mailer.send({
          to: p.email,
          subject: `SK Management: ${drafted} uutta markkinointikirjettä odottaa hyväksyntää`,
          text: [`Hei ${p.name ?? ""},`.trim(), "", `Markkinointiagentti laati ${drafted} uutta kirjettä (hyväksyntää odottaa yhteensä ${total}).`, "", ...lines, "", `Tarkista ja hyväksy: ${url}`].join("\n"),
        });
        sent++;
      } catch (e) {
        console.error("marketing approval notice failed", err(e));
      }
    }
    return { sent };
  });
}

// ── scheduler ───────────────────────────────────────────────────────

/** One cycle for every company whose discovery is due: discover, draft, send. */
export async function runMarketingCycle(opts: AgentOptions = {}) {
  const now = opts.now ?? new Date();
  const rows = await db.marketingSettings.findMany({ where: { enabled: true, company: { archivedAt: null } }, select: { companyId: true, enabled: true, intervalHours: true, lastRunAt: true, company: { select: { organizationId: true } } } });
  const results: { companyId: string; discovery?: DiscoveryResult; drafted?: number; sent?: number; error?: string }[] = [];
  for (const s of rows) {
    const scope = { companyId: s.companyId, organizationId: s.company.organizationId };
    try {
      const due = discoveryDue(s, now);
      const discovery = due ? await runDiscovery(scope, opts) : undefined;
      const drafts = due ? await draftLetters(scope, opts) : undefined;
      if (drafts?.drafted) await notifyPendingApprovals(scope, drafts.drafted, opts);
      const sent = await sendApproved(scope, opts);
      results.push({ companyId: s.companyId, discovery, drafted: drafts?.drafted, sent: sent.sent });
    } catch (e) {
      results.push({ companyId: s.companyId, error: err(e) });
    }
  }
  return results;
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

/** Starts the marketing scheduler once per process (src/instrumentation.ts); checks hourly. */
export function startMarketingScheduler(intervalMinutes = 60) {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runMarketingCycle();
      if (r.length) console.log("marketing cycle", JSON.stringify(r.map((x) => ({ companyId: x.companyId, drafted: x.drafted, sent: x.sent, error: x.error }))));
    } catch (e) {
      console.error("marketing cycle failed", err(e));
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5 * 60_000).unref?.();
  timer = setInterval(tick, intervalMinutes * 60_000);
  timer.unref?.();
}
