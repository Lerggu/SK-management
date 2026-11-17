/**
 * Voice/text assistant (ADR 0031) with the deterministic test provider:
 * proposals are validated on the server, nothing is saved before a person
 * confirms, "#n" references chain new items, money needs the amount typed,
 * permissions and audit are those of the confirming person. Real PostgreSQL.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { FakeAiProvider, setAiProviderForTests } from "@/platform/ai";
import { setSpeechForTests } from "@/platform/speech";
import type { RequestContext } from "@/platform/authz";
import { projectService, siteService } from "@/modules/projects/service";
import { assistantService } from "@/modules/assistant/service";
import { createMember, createTenant, type Tenant } from "../helpers/fixtures";

let t: Tenant;
let o: RequestContext;
let siteId: string;
let fake: FakeAiProvider;
const answer = (reply: string, actions: { type: string; params: unknown }[]) => () => ({ reply, actions: actions.map((a) => ({ type: a.type, params_json: JSON.stringify(a.params) })) });
const useFake = (respond?: () => unknown) => {
  fake = new FakeAiProvider(respond ? { respond } : {});
  setAiProviderForTests(fake);
};
afterEach(() => {
  setAiProviderForTests(undefined);
  setSpeechForTests(undefined);
});

beforeAll(async () => {
  t = await createTenant("Assistant");
  o = t.ownerCtx;
  const p = await projectService.create(o, { code: "LPR", name: "Lappeenranta" });
  siteId = (await siteService.create(o, p.id, { name: "Lappeenranta", city: "Lappeenranta" })).id;
});

describe("assistant", () => {
  it("proposes a person and a rotation for them; nothing is saved until confirmed; #1 links the new person", async () => {
    useFake(
      answer("Ehdotan henkilön ja rotaation.", [
        { type: "create_employee", params: { firstName: "Matti", lastName: "Meikäläinen", trade: "Ajoneuvonosturin kuljettaja" } },
        { type: "set_rotation", params: { employeeId: "#1", status: "WORK", siteId, from: "2026-12-15", until: "2026-12-31" } },
      ]),
    );
    const r = await assistantService.converse(o, { message: "Lisää henkilö Matti Meikäläinen, ajoneuvonosturin kuljettaja, ja laita hänet Lappeenrannan työmaalle 15.12.–31.12." });
    expect(r.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(r.actions.map((a) => a.summary)).toEqual([
      "Uusi henkilö Matti Meikäläinen, ammatti Ajoneuvonosturin kuljettaja",
      "(Uusi henkilö Matti Meikäläinen, ammatti Ajoneuvonosturin kuljettaja): töissä, työmaa Lappeenranta, 15.12.2026–31.12.2026",
    ]);
    expect(await db.employee.count({ where: { companyId: t.companyId, lastName: "Meikäläinen" } })).toBe(0);
    // The search tools only ran with the owner's rights, and the run is metered without a project.
    const run = await db.aiRun.findFirstOrThrow({ where: { companyId: t.companyId, kind: "ASSISTANT" }, orderBy: { createdAt: "desc" } });
    expect(run.projectId).toBeNull();

    // The rotation cannot go first.
    await expect(assistantService.confirm(o, r.actions[1].id)).rejects.toMatchObject({ fieldErrors: { _form: ["assistant.confirmEarlierFirst"] } });
    const all = await assistantService.confirmAll(o, r.conversationId!);
    expect(all.results.map((x) => x.status)).toEqual(["CONFIRMED", "CONFIRMED"]);
    const matti = await db.employee.findFirstOrThrow({ where: { companyId: t.companyId, lastName: "Meikäläinen" } });
    expect(matti.trade).toBe("Ajoneuvonosturin kuljettaja");
    expect(matti.employeeNumber).toMatch(/^E-\d+$/);
    expect(await db.rotationEntry.count({ where: { employeeId: matti.id, siteId, status: "WORK" } })).toBe(17);
    expect(await db.auditEvent.count({ where: { companyId: t.companyId, action: "assistant.confirm" } })).toBe(2);
    expect(await db.auditEvent.count({ where: { companyId: t.companyId, action: "employee.create", entityId: matti.id } })).toBe(1);
    await expect(assistantService.confirm(o, r.actions[0].id)).rejects.toMatchObject({ fieldErrors: { _form: ["assistant.notPending"] } });
  });

  it("creates a project with a generated code and its sites", async () => {
    useFake(
      answer("Uusi projekti Mikkeli.", [
        { type: "create_project", params: { name: "Mikkeli", customerName: "Mikkelin kaupunki", startDate: "2027-01-15" } },
        { type: "create_site", params: { projectId: "#1", name: "Keskusta", city: "Mikkeli" } },
      ]),
    );
    const r = await assistantService.converse(o, { message: "Aloitetaanpa uusi projekti Mikkeli, asiakas Mikkelin kaupunki, alkaa tammikuun puolivälissä, työmaa keskusta." });
    await assistantService.confirmAll(o, r.conversationId!);
    const p = await db.project.findFirstOrThrow({ where: { companyId: t.companyId, name: "Mikkeli" }, include: { sites: true } });
    expect(p.code).toBe("MIK-01");
    expect(p.sites.map((s) => s.name)).toEqual(["Keskusta"]);
  });

  it("drops invalid or invented proposals, and a new turn replaces unconfirmed ones", async () => {
    useFake(
      answer("Ehdotus.", [
        { type: "create_site", params: { projectId: "01900000-0000-7000-8000-000000000000", name: "Keksitty" } },
        { type: "delete_everything", params: {} },
        { type: "set_rotation", params: { employeeId: "#5", status: "WORK", from: "2026-12-01", until: "2026-12-02" } },
        { type: "create_employee", params: { firstName: "Liisa", lastName: "Lisätty" } },
      ]),
    );
    const r = await assistantService.converse(o, { message: "testi" });
    expect(r.actions.map((a) => a.type)).toEqual(["create_employee"]);
    expect(r.messages.at(-1)!.text).toContain("3 epäselvää ehdotusta");
    useFake(answer("Mihin asti?", []));
    const r2 = await assistantService.converse(o, { conversationId: r.conversationId, message: "laita Liisa työmaalle" });
    expect(r2.actions.find((a) => a.id === r.actions[0].id)!.status).toBe("REJECTED");
    expect(fake.requests[0].history).toHaveLength(2);
  });

  it("money: the amount must be typed again, and the person's own rights apply", async () => {
    const e = await db.employee.findFirstOrThrow({ where: { companyId: t.companyId, lastName: "Meikäläinen" } });
    useFake(answer("Kustannushinta.", [{ type: "add_employee_rate", params: { employeeId: e.id, rateType: "COST", amount: "45.50", validFrom: "2026-12-01" } }]));
    const r = await assistantService.converse(o, { message: "Matin kustannushinta 45,50 tunnilta joulukuun alusta" });
    const a = r.actions[0];
    expect(a).toMatchObject({ money: true, amount: "45.50" });
    expect((await assistantService.confirmAll(o, r.conversationId!)).results).toEqual([]); // money is never confirmed in bulk
    await expect(assistantService.confirm(o, a.id, { confirmAmount: "45" })).rejects.toMatchObject({ fieldErrors: { confirmAmount: ["assistant.amountMismatch"] } });
    expect((await assistantService.confirm(o, a.id, { confirmAmount: "45,50 €" })).status).toBe("CONFIRMED");
    expect(await db.employeeRate.count({ where: { employeeId: e.id } })).toBe(1);

    // A site manager may use the assistant, but a rate still needs employee.rates.manage.
    const sm = await createMember(t, "SITE_MANAGER");
    useFake(answer("Hinta.", [{ type: "add_employee_rate", params: { employeeId: e.id, rateType: "COST", amount: "50", validFrom: "2027-01-01" } }]));
    const r2 = await assistantService.converse(sm, { message: "hinta" });
    await expect(assistantService.confirm(sm, r2.actions[0].id, { confirmAmount: "50" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("needs ai.use; conversations are personal; external members have no assistant", async () => {
    const sup = await createMember(t, "SUPERVISOR");
    await expect(assistantService.current(sup)).rejects.toBeInstanceOf(ForbiddenError);
    const client = await createMember(t, "CLIENT");
    await expect(assistantService.converse(client, { message: "moi" })).rejects.toBeInstanceOf(ForbiddenError);
    const pm = await createMember(t, "PROJECT_MANAGER");
    const mine = await assistantService.current(o);
    await expect(assistantService.current(pm, { conversationId: mine.conversationId })).rejects.toBeInstanceOf(NotFoundError);
    const pending = mine.actions.find((a) => a.status === "PROPOSED");
    if (pending) await expect(assistantService.confirm(pm, pending.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("transcribes 16 kHz mono WAV through the speech port; other formats are refused", async () => {
    await expect(assistantService.transcribe(o, { bytes: new Uint8Array(10) })).rejects.toMatchObject({ fieldErrors: { _form: ["assistant.speechUnavailable"] } });
    setSpeechForTests({ name: "test", transcribe: async () => "uusi projekti Kouvola" });
    const wav = new Uint8Array(44 + 3200);
    const v = new DataView(wav.buffer);
    wav.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
    wav.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true);
    v.setUint16(34, 16, true);
    expect(await assistantService.transcribe(o, { bytes: wav })).toEqual({ text: "uusi projekti Kouvola" });
    await expect(assistantService.transcribe(o, { bytes: new TextEncoder().encode("not audio at all, not audio at all, not audio at all") })).rejects.toBeInstanceOf(ValidationError);
  });
});
