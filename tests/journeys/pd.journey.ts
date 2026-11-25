import { expect, test } from "@playwright/test";
import { acceptDialogs, navigate } from "../e2e/helpers";
import { COMPANY, Journey, openAs } from "./journey";

/**
 * Projektijohtaja (Mikko Malli): follows project finance and forecast, approves
 * quotes, variations, takt baselines and documents, reviews deviations and
 * risks, and uses the AI project controller. Desktop first.
 */
test("pd", async ({ browser }, testInfo) => {
  const page = await openAs(browser, testInfo, "pd");
  const j = new Journey(page, testInfo, "pd");
  acceptDialogs(page);
  const stamp = Date.now().toString(36);
  const t = { timeout: 8000 };
  const h1 = (name: string | RegExp) => page.getByRole("heading", { level: 1, name });

  async function openProject() {
    await navigate(page, testInfo, "Projektilista");
    await expect(h1("Projektit")).toBeVisible(t);
    await page.getByRole("link", { name: /NSM-001/ }).first().click();
    await expect(h1(/NSM-001/)).toBeVisible(t);
  }

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(h1(/Tervetuloa/)).toBeVisible(t);
  });

  await j.step("Avaa projekti NSM-001", openProject);

  await j.step("Tarkista budjetti ja toteuma", async () => {
    await page.getByRole("link", { name: "Talous", exact: true }).click();
    await expect(h1("Projektin talous")).toBeVisible(t);
    await expect(page.getByTestId("budget-vs-actual")).toBeVisible(t);
  });

  await j.step("Avaa ennuste (EAC)", async () => {
    await page.getByRole("link", { name: "NSM-001", exact: true }).click();
    await expect(h1(/NSM-001/)).toBeVisible(t);
    await page.getByRole("link", { name: "Sopimus ja ennuste", exact: true }).click();
    await expect(h1("Sopimus ja ennuste")).toBeVisible(t);
    await expect(page.getByTestId("forecast")).toBeVisible(t);
  });

  await j.step("Päivitä jäljellä oleva kustannusarvio", async () => {
    const note = `PD-arvio ${stamp}`;
    const form = page.getByTestId("etc-form");
    await form.getByLabel("Kustannuslaji").selectOption({ label: "Materiaalit" });
    await form.getByLabel("Jäljellä oleva kustannus (€)").fill("125000");
    await form.getByLabel("Huomautus").fill(note);
    await form.getByRole("button", { name: "Tallenna arvio" }).click();
    await expect(page.getByText(note).first()).toBeVisible(t);
  });

  await j.step("Hyväksy lisätyö sisäisesti", async () => {
    await page.getByRole("link", { name: /Väliaikainen työmaavalaistus/ }).first().click();
    await expect(h1(/Väliaikainen työmaavalaistus/)).toBeVisible(t);
    const form = page.getByTestId("variation-approve-form");
    if ((await form.count()) === 0) {
      if (await page.getByText("Olet laatinut tai lähettänyt tämän lisätyön").isVisible()) return "Oma lisätyö: hyväksyntä estetty";
      return "Lisätyö ei ollut enää sisäisessä tarkastuksessa (hyväksytty aiemmassa ajossa)";
    }
    await form.getByLabel("Perustelu / huomautus").fill(`Hinta tarkistettu ${stamp}`);
    await form.getByRole("button", { name: "Hyväksy ja lähetä asiakkaalle" }).click();
    await expect(page.getByTestId("variation-approve-form")).toHaveCount(0, t);
  });

  await j.step("Avaa hyväksyttävä tarjous", async () => {
    await navigate(page, testInfo, "Tarjoukset");
    await expect(h1("Tarjoukset")).toBeVisible(t);
    await page.getByRole("link", { name: /Valssaamon sähköasennukset/ }).first().click();
    await expect(h1(/Valssaamon sähköasennukset/)).toBeVisible(t);
  });

  await j.step("Hyväksy tarjous", async () => {
    const form = page.getByTestId("quote-decision-form");
    if ((await form.count()) === 0) return "Tarjous ei ollut enää hyväksyttävänä (päätetty aiemmassa ajossa)";
    await form.getByLabel("Perustelu / huomautus").fill(`Kate ja riskivaraus OK ${stamp}`);
    await form.getByRole("button", { name: "Hyväksy tarjous" }).click();
    await expect(page.getByTestId("quote-decision-form")).toHaveCount(0, t);
  });

  await j.step("Etsi hyväksyntää odottava piirustus", async () => {
    await navigate(page, testInfo, "Dokumentit");
    await expect(h1("Dokumentit")).toBeVisible(t);
    await page.getByRole("searchbox", { name: "Hae" }).fill("pääkaavio");
    await page.getByRole("searchbox", { name: "Hae" }).press("Enter");
    await page.getByRole("link", { name: /110 kV kytkinlaitoksen pääkaavio/ }).first().click();
    await expect(h1(/110 kV kytkinlaitoksen pääkaavio/)).toBeVisible(t);
  });

  await j.step("Hyväksy piirustuksen revisio B", async () => {
    const current = page.locator("section").filter({ has: page.getByRole("heading", { name: "Voimassa oleva versio" }) });
    const approve = current.getByRole("button", { name: "Hyväksy", exact: true });
    if ((await approve.count()) === 0) return "Voimassa oleva versio ei odottanut hyväksyntää (hyväksytty aiemmassa ajossa)";
    await approve.click();
    await expect(current.getByText("Hyväksytty").first()).toBeVisible(t);
  });

  await j.step("Avaa tahtisuunnitelma", async () => {
    await navigate(page, testInfo, "Tahtiaikataulu");
    await expect(h1("Tahti")).toBeVisible(t);
    await page.getByRole("link", { name: /Sulatto – asennustahti/ }).first().click();
    await expect(h1("Sulatto – asennustahti")).toBeVisible(t);
  });

  let openVersion: string | null = null;
  await j.step("Vertaa uutta versiota baselineen", async () => {
    const open = page.getByTestId("versions").getByRole("link", { name: /Luonnos|Hyväksyttävänä/ });
    if ((await open.count()) === 0) return "Ei avointa versiota vertailtavaksi (baseline hyväksytty aiemmassa ajossa)";
    openVersion = (await open.first().innerText()).match(/Versio (\d+)/)?.[1] ?? null;
    await open.first().click();
    await page.getByRole("link", { name: "Vertaa baselineen" }).click();
    await expect(h1("Versioiden vertailu")).toBeVisible(t);
    await expect(page.getByTestId("compare-summary")).toBeVisible(t);
  });

  await j.step("Hyväksy uusi baseline", async () => {
    if (!openVersion) return "Ei hyväksyttävää versiota";
    await page.getByRole("link", { name: "Tahtitaulu", exact: true }).click();
    await expect(h1("Sulatto – asennustahti")).toBeVisible(t);
    let note: string | undefined;
    const propose = page.getByRole("button", { name: "Ehdota hyväksyttäväksi" });
    if (await propose.isVisible()) {
      await propose.click();
      note = "Versio oli vielä luonnos: projektijohtaja joutui ehdottamaan sen itse ennen hyväksyntää";
    }
    await page.getByRole("button", { name: "Hyväksy baselineksi" }).click(t);
    await expect(page.getByTestId("versions").getByRole("link", { name: new RegExp(`Versio ${openVersion}.*Baseline`) })).toBeVisible(t);
    return note;
  });

  await j.step("Tarkista avoimet poikkeamat", async () => {
    await navigate(page, testInfo, "Tahtiaikataulu");
    await page.getByRole("navigation", { name: "Tuotannonohjaus" }).getByRole("link", { name: "Poikkeamat", exact: true }).click();
    await expect(h1("Poikkeamat")).toBeVisible(t);
    await expect(page.getByRole("heading", { name: "Avoimet poikkeamat" })).toBeVisible(t);
  });

  await j.step("Tarkista logistiikkariskit", async () => {
    await page.getByRole("navigation", { name: "Tuotannonohjaus" }).getByRole("link", { name: "Riskit", exact: true }).click();
    await expect(h1("Logistiikkariskit")).toBeVisible(t);
    const project = page.getByLabel("Projekti", { exact: true });
    if (await project.isVisible()) {
      const value = await project.locator("option", { hasText: "NSM-001" }).getAttribute("value", t);
      if (value) await project.selectOption(value);
      await page.getByRole("button", { name: "Näytä", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: /Havaitut riskit/ })).toBeVisible(t);
  });

  await j.step("Tarkista työturvallisuuden tilanne", async () => {
    await navigate(page, testInfo, "Työturvallisuus");
    await expect(h1("Työturvallisuus")).toBeVisible(t);
  });

  await j.step("Avaa tekoälyohjaaja", async () => {
    await openProject();
    await page.getByRole("link", { name: "Tekoälyohjaaja", exact: true }).click();
    await expect(h1("Tekoälyohjaaja")).toBeVisible(t);
  });

  await j.step("Käsittele tekoälyn suositus", async () => {
    const recs = page.getByTestId("ai-recommendations").locator("li[data-recommendation]");
    const n = await recs.count();
    if (n === 0) return "Ei avoimia suosituksia käsiteltäväksi";
    await recs.first().getByRole("button", { name: "Hyväksy", exact: true }).click();
    await expect(page.getByTestId("ai-recommendations").locator("li[data-recommendation]")).toHaveCount(n - 1, t);
  });

  await j.step("Kysy tekoälyltä katteen riskeistä", async () => {
    const question = page.getByLabel("Kysymys projektista");
    if (!(await question.isVisible())) return "Kysymyslomake ei näkyvissä (tekoäly ei käytössä tai kuukausikatto täynnä)";
    const text = `Mikä uhkaa katetta eniten? (${stamp})`;
    await question.fill(text);
    await page.getByRole("button", { name: "Kysy", exact: true }).click();
    // An AI run can take up to a minute.
    await expect(page.getByTestId("ai-runs").getByText(text)).toBeVisible({ timeout: 60_000 });
  });

  j.write();
});
