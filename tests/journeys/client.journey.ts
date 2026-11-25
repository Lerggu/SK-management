/**
 * Role journey: Tilaajan edustaja (Client, ulkoinen) — Asiakas Demo.
 *
 * The client representative uses the portal only: project overview, schedule
 * status, safety figures, variations waiting for a decision and shared
 * documents. The client must never see costs, rates or margins; the frozen
 * variation price ("Hinta (alv 0 %)") is the only price shown, by design
 * (V7 owner decision: the client approves the priced variation).
 */
import { expect, test, type Page } from "@playwright/test";
import { navigate } from "../e2e/helpers";
import { COMPANY, Journey, openAs } from "./journey";

const T = { timeout: 8000 };
const PROJECT = /NSM-001/;
const VARIATION = "UPS-tilan lisäpistorasiat";
const DOCUMENT = "110 kV kytkinlaitoksen pääkaavio";

/** Internal cost, rate and margin labels (fi.json: rates, commercial.costs, finance). */
const COST_PATTERNS: [string, RegExp][] = [
  ["Kustannus", /kustannu/i],
  ["Laskutushinta", /laskutushinta/i],
  ["Tuntihinta / €/h", /tuntihinta|€\s*\/\s*(h|pv)\b/i],
  ["Kate", /\bkate\b|katepro|marginaali/i],
  ["Lisä (%)", /Lisä \(%\)/],
  ["Kustannuserät (€)", /(Työ|Kalusto|Materiaalit|Alihankinta|Muut) \(€\)/],
  // Seeded internal cost lines of the pending variation (1 900 € work, 1 300 € materials).
  ["Muutostyön kustannusrivit", /\b1[\s  ]?900,00|\b1[\s  ]?300,00/],
];

/** Returns a note for every cost/rate hint on the page; the variation sales price is listed separately. */
async function costFindings(page: Page, where: string): Promise<string[]> {
  const text = await page.locator("main").innerText(T);
  const found = COST_PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => `${where}: näkyy "${label}"`);
  const euros = [...new Set(text.match(/[\d\s  ]+,\d{2}[\s  ]?€/g) ?? [])].map((s) => s.trim());
  if (euros.length) found.push(`${where}: euromääriä näkyvissä (${euros.slice(0, 5).join(", ")}) – tarkista, että ne ovat vain muutostyön myyntihintoja`);
  return found;
}

test("client", async ({ browser }, testInfo) => {
  const page = await openAs(browser, testInfo, "client");
  const j = new Journey(page, testInfo, "client");
  const stamp = Date.now();
  let variationTitle: string | null = null;

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    // External members land in the portal; a single project opens directly.
    await page.waitForURL(/\/portal\//, T);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(PROJECT, T);
  });

  await j.step("Avaa portaali valikosta", async () => {
    await navigate(page, testInfo, "Portaali");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(PROJECT, T);
    const menuLinks = j.mobile ? await page.getByTestId("mobile-nav").getByRole("link").allInnerTexts() : await page.locator("aside nav").getByRole("link").allInnerTexts();
    const extra = menuLinks.map((s) => s.trim()).filter((s) => s && s !== "Portaali");
    if (extra.length) return `Valikossa muitakin kohtia kuin Portaali: ${extra.join(", ")}`;
  });

  await j.step("Tarkista aikataulun tila", async () => {
    await expect(page.getByRole("heading", { name: "Aikataulu ja eteneminen" })).toBeVisible(T);
    const schedule = page.getByTestId("portal-schedule");
    await expect(schedule).toBeVisible(T);
    await expect(schedule.getByText("Kokonaisvalmius")).toBeVisible(T);
    await expect(schedule).toContainText("Sulatto – asennustahti", T);
    await expect(schedule.getByText(/työvaihetta valmiina/)).toBeVisible(T);
  });

  await j.step("Katso työturvallisuuden tunnusluvut", async () => {
    await expect(page.getByRole("heading", { name: "Työturvallisuus", level: 2 })).toBeVisible(T);
    await expect(page.getByTestId("hse-metrics")).toBeVisible(T);
    await expect(page.getByText("Koosteluvut ilman henkilötietoja.")).toBeVisible(T);
  });

  await j.step("Katso hyväksyttävät muutostyöt", async () => {
    await expect(page.getByRole("heading", { name: "Hyväksyttävät muutostyöt" })).toBeVisible(T);
    const pending = page.locator('a[href*="/approvals/"]').filter({ hasText: "Odottaa päätöstäsi" });
    const n = await pending.count();
    if (n === 0) return "Ei odottavia muutostöitä (demon muutostyö on ehkä päätetty aiemmassa ajossa)";
    return `${n} muutostyö(tä) odottaa päätöstä`;
  });

  await j.step("Avaa odottava muutostyö", async () => {
    const pending = page.locator('a[href*="/approvals/"]').filter({ hasText: "Odottaa päätöstäsi" });
    const named = pending.filter({ hasText: VARIATION });
    let note: string | undefined;
    if (await named.count()) await named.first().click();
    else if (await pending.count()) await pending.first().click();
    else {
      await page.getByTestId("decided-approvals").getByRole("link").first().click(T);
      note = "Avattiin jo päätetty muutostyö, koska odottavia ei ollut";
    }
    await page.waitForURL(/\/approvals\//, T);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText(/Muutostyö \d+ · /, T);
    variationTitle = (await h1.innerText(T)).replace(/^Muutostyö \d+ · /, "").trim();
    return note;
  });

  await j.step("Tarkista muutostyön kuvaus ja hinta", async () => {
    await expect(page.getByRole("heading", { name: "Muutostyö", exact: true })).toBeVisible(T);
    await expect(page.getByText("Hinta (alv 0 %)")).toBeVisible(T);
    await expect(page.getByTestId("approval-price")).toContainText("€", T);
    await expect(page.getByText("Asiakkaan viite")).toBeVisible(T);
    await expect(page.getByTestId("approval-hash")).toContainText(/[0-9a-f]{64}/, T);
  });

  await j.step("Varmista, ettei kustannuksia tai katetta näy muutostyössä", async () => {
    const notes = (await costFindings(page, "Muutostyö")).filter((s) => !s.includes("euromääriä"));
    return notes.length ? `EPÄILYTTÄVÄÄ: ${notes.join("; ")}` : undefined;
  });

  await j.step("Yritä hylätä ilman perustelua", async () => {
    const form = page.getByTestId("approval-form");
    if (!(await form.count())) return "Päätöslomaketta ei ole (muutostyö on jo päätetty)";
    await form.getByLabel("Kommentti").fill("");
    await form.getByRole("button", { name: "Hylkään" }).click(T);
    // The server refuses a rejection without a note; the decision must stay open.
    await expect(form.getByText("Pakollinen tieto")).toBeVisible(T);
    await expect(page.getByRole("button", { name: "Hyväksyn muutostyön" })).toBeVisible(T);
  });

  await j.step("Hyväksy muutostyö kommentilla", async () => {
    const form = page.getByTestId("approval-form");
    if (!(await form.count())) return "Päätöslomaketta ei ole (muutostyö on jo päätetty)";
    await form.getByLabel("Kommentti").fill(`Hyväksytty tilaajan puolesta, journey ${stamp}`);
    await form.getByRole("button", { name: "Hyväksyn muutostyön" }).click(T);
    await expect(page.getByText("Päätös tallennettu.")).toBeVisible(T);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(PROJECT, T);
  });

  await j.step("Tarkista päätetyt muutostyöt", async () => {
    if (!/\/portal\/[^/]+$/.test(new URL(page.url()).pathname)) await page.getByRole("link", { name: /NSM-001/ }).first().click(T);
    const decided = page.getByTestId("decided-approvals");
    await expect(decided).toBeVisible(T);
    if (variationTitle) await expect(decided).toContainText(variationTitle, T);
    await expect(decided.getByText("Hyväksytty").first()).toBeVisible(T);
  });

  await j.step("Avaa jaettu dokumentti", async () => {
    await expect(page.getByRole("heading", { name: "Jaetut dokumentit" })).toBeVisible(T);
    await page.getByRole("link", { name: new RegExp(DOCUMENT) }).first().click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(DOCUMENT, T);
    await expect(page.getByRole("heading", { name: "Voimassa oleva versio" })).toBeVisible(T);
    // The client should see only the approved revision A, not the pending revision B.
    const versions = page.getByTestId("version-list");
    if (await versions.getByText("Odottaa hyväksyntää").count()) return "Tilaaja näkee hyväksymättömän revision (Odottaa hyväksyntää)";
  });

  await j.step("Lataa dokumentin voimassa oleva versio", async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download", T),
      page.getByRole("link", { name: /^Lataa \(/ }).first().click(T),
    ]);
    const name = download.suggestedFilename();
    if (!/NDC-E-110_A/.test(name)) return `Ladattu tiedosto: ${name}`;
  });

  await j.step("Varmista, ettei dokumentissa näy sisäisiä tietoja", async () => {
    const notes = await costFindings(page, "Dokumentti");
    if (await page.getByRole("heading", { name: "Jakaminen ulkoisille" }).count()) notes.push("Dokumentti: jakamisasetukset näkyvät tilaajalle");
    if (await page.getByRole("button", { name: "Arkistoi" }).count()) notes.push("Dokumentti: Arkistoi-painike näkyy tilaajalle");
    return notes.length ? `EPÄILYTTÄVÄÄ: ${notes.join("; ")}` : undefined;
  });

  await j.step("Palaa portaaliin", async () => {
    await page.getByRole("link", { name: "Portaali" }).first().click(T);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(PROJECT, T);
  });

  await j.step("Tarkista, ettei portaalissa näy kustannuksia tai hintoja", async () => {
    const notes = await costFindings(page, "Portaali");
    return notes.length ? notes.join("; ") : undefined;
  });

  await j.step("Sisäiset sivut eivät aukea tilaajalle", async () => {
    // A direct URL is the only way to try these: they are not in the client's menu.
    const leaks: string[] = [];
    for (const path of ["projects", "workforce", "equipment", "billing", "sales", "invoicing", "time"]) {
      await page.goto(`${COMPANY}/${path}`);
      const ok = await page.waitForURL(/\/portal/, T).then(() => true, () => false);
      if (!ok) leaks.push(path);
      else {
        const found = (await costFindings(page, path).catch(() => [])).filter((s) => !s.includes("euromääriä"));
        leaks.push(...found);
      }
    }
    return leaks.length ? `EPÄILYTTÄVÄÄ: ei ohjautunut portaaliin tai näkyi hintatietoa: ${leaks.join(", ")}` : undefined;
  });

  j.write();
});
