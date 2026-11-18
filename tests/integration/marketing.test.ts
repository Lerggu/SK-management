/**
 * Marketing automation (ADR 0032) against real PostgreSQL: discovery from
 * TED and web search into the register (with sources, no duplicates),
 * letter drafting, approval and sending with Reply-To and unsubscribe,
 * opt-out, automatic sending, budget cap, call list, CRM conversion and
 * permissions.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, ValidationError } from "@/platform/errors";
import { FakeAiProvider, setAiProviderForTests, type AiProvider } from "@/platform/ai";
import { MemoryMailer, setMailerForTests } from "@/platform/mail";
import { setTedFetchForTests, type TedNotice } from "@/platform/integrations/ted";
import { setWebSearchForTests, type SearchQuery } from "@/platform/integrations/web-search";
import { marketingService } from "@/modules/marketing/service";
import { companyAdminService } from "@/modules/companies/service";
import { draftLetters, runDiscovery, runMarketingCycle, sendApproved, unsubscribeByToken, unsubscribeInfo } from "@/modules/marketing/agents";
import { createMember, createTenant, type Tenant } from "../helpers/fixtures";

const notice = (n: number, title: string, extra: Partial<TedNotice> = {}): TedNotice => ({
  publicationNumber: `9000${n}-2026`,
  title,
  noticeType: "cn-standard",
  publishedAt: "2026-11-10",
  buyer: "Kaupunki Oy",
  country: "FI",
  city: "Kajaani",
  buyerPhone: "+358 40 000 0000",
  deadline: "2026-12-15",
  estimatedValue: 2_500_000,
  currency: "EUR",
  description: null,
  url: `https://ted.europa.eu/en/notice/-/detail/9000${n}-2026`,
  ...extra,
});

let t: Tenant;
const scope = () => ({ companyId: t.companyId, organizationId: t.organizationId });

beforeAll(async () => {
  t = await createTenant("Mark");
});
afterEach(() => {
  setAiProviderForTests(undefined);
  setMailerForTests(undefined);
  setTedFetchForTests(undefined);
});

async function enable(extra: Record<string, unknown> = {}) {
  await marketingService.updateSettings(t.ownerCtx, {
    enabled: "on",
    countries: ["FI", "SE"],
    minScore: "60",
    dailySendLimit: "20",
    intervalHours: "24",
    aiMonthlyBudgetEur: "40",
    replyToUserIds: [t.owner.user.id],
    senderName: "SK Infra myynti",
    pitch: "Teemme 110 kV liittymiä.",
    ...extra,
  });
}

describe("marketing agents", () => {
  it("discovers projects from TED and web search into the register, with sources and without duplicates", async () => {
    await enable();
    const ai = new FakeAiProvider();
    setAiProviderForTests(ai);
    const tedQueries: string[][] = [];
    setTedFetchForTests(async (s) => {
      tedQueries.push(s.countries);
      return s.countries.includes("FI") ? [notice(1, "Datakeskuksen 110 kV sähköasema"), notice(2, "Koulun valaistus")] : [];
    });
    const r = await runDiscovery(scope(), { userId: t.owner.user.id });
    expect(r.sources.map((s) => s.source)).toEqual(["TED", "FI_INVESTMENTS", "FI_GRID_PERMITS", "FI_HYDROGEN_BIO", "SE_INVESTMENTS", "SE_GRID_PERMITS", "SE_HYDROGEN_BIO", "WATCHLIST", "HYDROGEN_BIO", "DATA_CENTERS", "INDUSTRY", "GRID", "FI_PROCUREMENT"]);
    // Finland is queried on its own so that large countries do not crowd it out.
    expect(tedQueries).toEqual([["FI"], ["SE"]]);
    // The Finnish focuses search Finland only, in Finnish.
    const fi = ai.requests.find((q) => q.prompt.includes("datakeskus"));
    expect(fi?.prompt).toContain("Country: FI only");
    expect(fi?.webSearch?.allowedDomains).toBeUndefined();
    expect(r.sources[0]).toMatchObject({ found: 2, created: 2 });

    const leads = await marketingService.listLeads(t.ownerCtx);
    // 2 TED + 12 web focuses; the Finnish and the European hydrogen samples are the same project and merge.
    expect(leads).toHaveLength(13);
    // Hydrogen and bio projects have their own category.
    expect(leads.some((l) => l.category === "HYDROGEN")).toBe(true);
    const dc = leads.find((l) => l.title === "Datakeskuksen 110 kV sähköasema")!;
    expect(dc).toMatchObject({ category: "DATA_CENTER", fitScore: 85, ownerOrg: "Kaupunki Oy", country: "FI" });
    const detail = await marketingService.getLead(t.ownerCtx, dc.id);
    expect(detail.sources[0]).toMatchObject({ kind: "TED", url: expect.stringContaining("ted.europa.eu") });
    expect(detail.contacts[0]).toMatchObject({ phone: "+358 40 000 0000", email: null, sourceUrl: expect.stringContaining("ted.europa.eu") });
    expect(String(detail.budget)).toBe("2500000");

    // Web search ran with the search tool and allowed domains for grid operators.
    const grid = ai.requests.find((q) => q.webSearch?.allowedDomains?.includes("fingrid.fi"));
    expect(grid?.webSearch?.maxUses).toBeGreaterThan(0);
    expect(ai.requests.find((q) => q.webSearch?.allowedDomains?.includes("hankintailmoitukset.fi"))).toBeDefined();

    // Run again: same findings merge, nothing duplicated.
    const again = await runDiscovery(scope(), { userId: t.owner.user.id });
    expect(again.sources.reduce((n, s) => n + s.created, 0)).toBe(0);
    expect(await marketingService.listLeads(t.ownerCtx)).toHaveLength(13);
    // Known TED notices are not scored again: 1 + 12 runs first, 12 web runs second.
    expect(await db.marketingRun.count({ where: { companyId: t.companyId, kind: "DISCOVERY", status: "SUCCEEDED" } })).toBe(25);
  });

  it("uses Google search (when a key is configured) with the focus country and language", async () => {
    const t6 = await createTenant("Google");
    await marketingService.updateSettings(t6.ownerCtx, { enabled: "", countries: ["FI", "SE"], minScore: "60", dailySendLimit: "20", intervalHours: "24", aiMonthlyBudgetEur: "40", replyToUserIds: [], watchCompanies: "Google\nEcoDataCenter\nGoogle" });
    expect((await marketingService.getSettings(t6.ownerCtx)).settings.watchCompanies).toEqual(["Google", "EcoDataCenter"]);
    setTedFetchForTests(async () => []);
    const queries: SearchQuery[] = [];
    setWebSearchForTests({ name: "test", search: async (q) => (queries.push(q), [{ title: "Hamina data center expansion", url: "https://news.example/hamina", snippet: "s", date: null, source: null }]) });
    const prompts: string[] = [];
    const provider: AiProvider = {
      name: "test",
      model: "test",
      async run(req) {
        prompts.push(req.prompt);
        if (req.tools.length) await req.executeTool("google_search", { query: "datakeskus", news: true, country: "", language: "" });
        return { provider: "test", model: "test", result: { projects: [] }, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.001 } };
      },
    };
    setAiProviderForTests(provider);
    try {
      await runDiscovery({ companyId: t6.companyId, organizationId: t6.organizationId });
    } finally {
      setWebSearchForTests(undefined);
    }
    // Finnish focuses search Finland in Finnish, Swedish ones Sweden in Swedish; others are open.
    expect(queries.slice(0, 6).map((q) => [q.country, q.language])).toEqual([["FI", "fi"], ["FI", "fi"], ["FI", "fi"], ["SE", "sv"], ["SE", "sv"], ["SE", "sv"]]);
    expect(queries.length).toBe(12);
    expect(prompts.find((p) => p.includes("Followed companies"))).toContain("EcoDataCenter");
    expect(prompts.every((p) => p.includes("google_search"))).toBe(true);
  });

  it("drops projects without a source URL and contacts without the page they were published on", async () => {
    const t2 = await createTenant("Src");
    setTedFetchForTests(async () => []);
    setAiProviderForTests(
      new FakeAiProvider({
        respond: () => ({
          projects: [
            { title: "Ei lähdettä", summary: null, category: "DATA_CENTER", stage: "PLANNING", country: "FI", location: null, ownerOrg: null, timing: null, startDate: null, tenderDeadline: null, budget: null, currency: null, budgetText: null, voltageKv: null, fitScore: 90, services: [], fitReason: null, sources: [{ url: "not a url", title: null, publishedAt: null }], contacts: [] },
            {
              title: "Lähteellinen hanke",
              summary: "S",
              category: "GRID",
              stage: "PERMITTING",
              country: "se",
              location: "Luleå",
              ownerOrg: "Dev AB",
              timing: "2027",
              startDate: "2027-03-01",
              tenderDeadline: null,
              budget: 1000000,
              currency: "sek",
              budgetText: null,
              voltageKv: 130,
              fitScore: 140,
              services: ["ELECTRICAL"],
              fitReason: "x",
              sources: [{ url: "https://example.test/a", title: "A", publishedAt: "2026-11-01" }],
              contacts: [
                { name: "Ok", role: null, organization: null, responsibility: null, email: "OK@Example.test", phone: null, sourceUrl: "https://example.test/a" },
                { name: "Guessed", role: null, organization: null, responsibility: null, email: "guess@example.test", phone: null, sourceUrl: "" },
              ],
            },
          ],
        }),
      }),
    );
    await runDiscovery({ companyId: t2.companyId, organizationId: t2.organizationId });
    const leads = await marketingService.listLeads(t2.ownerCtx);
    // One per web focus with the same answer → merged to a single lead.
    expect(leads.map((l) => l.title)).toEqual(["Lähteellinen hanke"]);
    const lead = await marketingService.getLead(t2.ownerCtx, leads[0].id);
    expect(lead).toMatchObject({ country: "SE", currency: "SEK", fitScore: 100, voltageKv: 130 });
    expect(lead.contacts.map((c) => c.email)).toEqual(["ok@example.test"]);
  });

  it("drafts letters, a person approves, the letter is sent with Reply-To and an unsubscribe link", async () => {
    setAiProviderForTests(new FakeAiProvider());
    const d = await draftLetters(scope());
    expect(d.drafted).toBe(12); // the twelve web leads have an e-mail contact; TED leads only a phone
    const drafts = await marketingService.listMessages(t.ownerCtx, { status: "DRAFT" });
    expect(drafts).toHaveLength(12);
    const m = drafts[0];
    expect(m.language).toBe("fi");
    await marketingService.updateMessage(t.ownerCtx, m.id, { subject: "Sähköurakointi hankkeeseenne", body: m.body, callScript: m.callScript });

    const mailer = new MemoryMailer();
    setMailerForTests(mailer);
    expect(await marketingService.approveMessage(t.ownerCtx, m.id)).toEqual({ sent: true, error: null });
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0];
    expect(mail.subject).toBe("Sähköurakointi hankkeeseenne");
    expect(mail.replyTo).toEqual([t.owner.user.email]);
    expect(mail.text).toContain("SK Infra myynti");
    expect(mail.text).toMatch(/\/unsubscribe\/[A-Za-z0-9_-]{20,}/);
    expect(mail.headers?.["List-Unsubscribe"]).toMatch(/\/api\/unsubscribe\//);
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const sent = await db.marketingMessage.findUniqueOrThrow({ where: { id: m.id }, include: { lead: true } });
    expect(sent).toMatchObject({ status: "SENT", sentTo: mail.to, approvedById: t.owner.user.id });
    expect(sent.lead.status).toBe("CONTACTED");
    await expect(marketingService.approveMessage(t.ownerCtx, m.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await db.auditEvent.count({ where: { companyId: t.companyId, action: "marketing_message.send", entityId: m.id } })).toBe(1);
  });

  it("unsubscribing suppresses the address for good and cancels pending letters", async () => {
    const sent = await db.marketingMessage.findFirstOrThrow({ where: { companyId: t.companyId, status: "SENT" }, include: { contact: true } });
    expect(await unsubscribeInfo(sent.unsubscribeToken)).toMatchObject({ ok: true, language: "fi", done: false });
    // A second contact with the same address on another lead, with a pending draft.
    const other = await db.marketingMessage.findFirstOrThrow({ where: { companyId: t.companyId, status: "DRAFT" } });
    await db.marketingContact.update({ where: { id: other.contactId }, data: { email: sent.contact.email } });

    expect(await unsubscribeByToken(sent.unsubscribeToken)).toMatchObject({ ok: true });
    expect(await unsubscribeInfo(sent.unsubscribeToken)).toMatchObject({ done: true });
    expect(await db.marketingSuppression.count({ where: { companyId: t.companyId, email: sent.contact.email! } })).toBe(1);
    expect((await db.marketingMessage.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("REJECTED");
    expect(await unsubscribeByToken("not-a-valid-token-xxxxxxxxxxxx")).toEqual({ ok: false });

    // No new letters are drafted to a suppressed address.
    setAiProviderForTests(new FakeAiProvider());
    const lead = await db.marketingLead.findFirstOrThrow({ where: { companyId: t.companyId, status: "NEW" } });
    await marketingService.addContact(t.ownerCtx, lead.id, { name: "Sama", email: sent.contact.email!, sourceUrl: "https://example.test/x" });
    const before = await db.marketingMessage.count({ where: { companyId: t.companyId } });
    await draftLetters(scope(), { leadId: lead.id });
    const drafted = await db.marketingMessage.findMany({ where: { companyId: t.companyId, contact: { email: sent.contact.email } }, select: { status: true } });
    expect(drafted.every((x) => x.status !== "DRAFT")).toBe(true);
    expect(await db.marketingMessage.count({ where: { companyId: t.companyId } })).toBeGreaterThanOrEqual(before);
  });

  it("respects the daily send limit; automatic sending sends without approval in the cycle", async () => {
    const t3 = await createTenant("Auto");
    const s3 = { companyId: t3.companyId, organizationId: t3.organizationId };
    await marketingService.updateSettings(t3.ownerCtx, { enabled: "on", autoSend: "on", countries: ["FI"], minScore: "50", dailySendLimit: "2", intervalHours: "24", aiMonthlyBudgetEur: "40", replyToUserIds: [t3.owner.user.id] });
    setAiProviderForTests(new FakeAiProvider());
    setTedFetchForTests(async () => []);
    const mailer = new MemoryMailer();
    setMailerForTests(mailer);
    const cycle = (await runMarketingCycle()).find((r) => r.companyId === t3.companyId)!;
    expect(cycle).toMatchObject({ drafted: 9, sent: 2 });
    expect(await db.marketingMessage.count({ where: { companyId: t3.companyId, status: "APPROVED", approvedById: null } })).toBe(7);
    expect((await sendApproved(s3)).error).toBe("marketing.errors.dailyLimit");
    // Not due again within the interval: no new discovery.
    const second = (await runMarketingCycle()).find((r) => r.companyId === t3.companyId)!;
    expect(second.discovery).toBeUndefined();
  });

  it("tells the salespeople by e-mail when new letters wait for approval", async () => {
    const t5 = await createTenant("Notice");
    await marketingService.updateSettings(t5.ownerCtx, { enabled: "on", countries: ["FI"], minScore: "50", dailySendLimit: "20", intervalHours: "24", aiMonthlyBudgetEur: "40", replyToUserIds: [t5.owner.user.id] });
    setAiProviderForTests(new FakeAiProvider());
    setTedFetchForTests(async () => []);
    const mailer = new MemoryMailer();
    setMailerForTests(mailer);
    const cycle = (await runMarketingCycle()).find((r) => r.companyId === t5.companyId)!;
    expect(cycle).toMatchObject({ drafted: 9, sent: 0 });
    const notice = mailer.sent.filter((m) => m.to === t5.owner.user.email);
    expect(notice).toHaveLength(1);
    expect(notice[0].subject).toContain("9 uutta markkinointikirjettä");
    expect(notice[0].text).toContain(`/c/${t5.slug}/marketing/approvals`);
  });

  it("stops at the monthly AI budget", async () => {
    const t4 = await createTenant("Budget");
    await marketingService.updateSettings(t4.ownerCtx, { enabled: "", countries: ["FI"], minScore: "60", dailySendLimit: "20", intervalHours: "24", aiMonthlyBudgetEur: "1", replyToUserIds: [] });
    setTedFetchForTests(async () => [notice(7, "Iso datakeskus")]);
    setAiProviderForTests(new FakeAiProvider({ costUsd: 2 }));
    const r = await runDiscovery({ companyId: t4.companyId, organizationId: t4.organizationId });
    expect(r.sources[0].created).toBe(1); // first call within budget
    expect(r.sources.slice(1).every((s) => s.error === "marketing.errors.budgetExhausted")).toBe(true);
    expect(await db.marketingRun.count({ where: { companyId: t4.companyId, status: "BLOCKED_BUDGET" } })).toBe(9);
  });

  it("call list, call outcome and conversion to a CRM opportunity", async () => {
    const sent = await db.marketingMessage.findFirstOrThrow({ where: { companyId: t.companyId, status: "SENT" } });
    await db.marketingContact.update({ where: { id: sent.contactId }, data: { phone: "+358 50 123 4567" } });
    const calls = await marketingService.callList(t.ownerCtx);
    expect(calls.map((c) => c.id)).toContain(sent.id);
    await marketingService.recordCall(t.ownerCtx, sent.id, { callStatus: "MEETING", callNote: "Tapaaminen ma" });
    expect((await db.marketingLead.findUniqueOrThrow({ where: { id: sent.leadId } })).status).toBe("INTERESTED");

    const { opportunityId } = await marketingService.convertToOpportunity(t.ownerCtx, sent.leadId);
    const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { customer: { include: { contacts: true } } } });
    expect(opp.stage).toBe("LEAD");
    expect(opp.customer.contacts.length).toBeGreaterThan(0);
    expect((await db.marketingLead.findUniqueOrThrow({ where: { id: sent.leadId } })).status).toBe("CONVERTED");
    expect(await marketingService.convertToOpportunity(t.ownerCtx, sent.leadId)).toEqual({ opportunityId });
  });

  it("validates settings and enforces permissions", async () => {
    await expect(marketingService.updateSettings(t.ownerCtx, { enabled: "on", countries: ["FI"], minScore: "60", dailySendLimit: "20", intervalHours: "24", aiMonthlyBudgetEur: "40", replyToUserIds: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      marketingService.updateSettings(t.ownerCtx, { enabled: "", countries: ["XX"], minScore: "60", dailySendLimit: "20", intervalHours: "24", aiMonthlyBudgetEur: "40", replyToUserIds: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const outsider = await createTenant("Other");
    await expect(
      marketingService.updateSettings(t.ownerCtx, { enabled: "", countries: ["FI"], minScore: "60", dailySendLimit: "20", intervalHours: "24", aiMonthlyBudgetEur: "40", replyToUserIds: [outsider.owner.user.id] }),
    ).rejects.toBeInstanceOf(ValidationError);

    // Owner decision 2026-11-18: only the CEO and project manager roles.
    const pm = await createMember(t, "PROJECT_MANAGER");
    expect((await marketingService.listLeads(pm)).length).toBeGreaterThan(0);
    for (const role of ["PROJECT_DIRECTOR", "SITE_MANAGER", "HR_ADMIN"] as const) {
      await expect(marketingService.listLeads(await createMember(t, role))).rejects.toBeInstanceOf(ForbiddenError);
    }
    // ... and the permissions cannot be handed out any other way.
    await expect(companyAdminService.updateRolePermissions(t.ownerCtx, await t.roleId("PROJECT_DIRECTOR"), { permissionKeys: ["project.view", "marketing.view"] })).rejects.toBeInstanceOf(ValidationError);
    const sm = await createMember(t, "SITE_MANAGER");
    const smMembership = await db.companyMembership.findFirstOrThrow({ where: { companyId: t.companyId, userId: sm.user.id } });
    await expect(companyAdminService.setMemberPermissions(t.ownerCtx, smMembership.id, { permissionKeys: ["marketing.view"] })).rejects.toBeInstanceOf(ValidationError);
    const pmRole = await t.roleId("PROJECT_MANAGER");
    const pmKeys = (await db.rolePermission.findMany({ where: { roleId: pmRole } })).map((r) => r.permissionKey);
    await companyAdminService.updateRolePermissions(t.ownerCtx, pmRole, { permissionKeys: pmKeys });
    const sub = await createMember(t, "SUBCONTRACTOR");
    await expect(marketingService.overview(sub)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
