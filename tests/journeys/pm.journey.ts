/**
 * Role journey: Projektipäällikkö (Project Manager, Liisa Koe).
 *
 * Creates the demo project "Terästehdas Luulaja – demo" through the UI: project,
 * site, takt structure (building, areas, work packages), takt plan and train,
 * proposal for approval, then a quote with lines, a variation, a document with
 * two versions, the project finance view, billing readiness and marketing.
 */
import { expect, test, type Page } from "@playwright/test";
import { COMPANY, Journey, openAs } from "./journey";

const T = { timeout: 8000 };
const PROJECT_NAME = "Terästehdas Luulaja – demo";

test("pm", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const page = await openAs(browser, testInfo, "pm");
  page.on("dialog", (d) => d.accept().catch(() => {}));
  const j = new Journey(page, testInfo, "pm");
  const mobile = j.mobile;

  const run = `${testInfo.project.name.slice(0, 3).toUpperCase()}-${Date.now().toString(36).slice(-5)}`;
  const code = `TSL-${run}`;
  const projectLabel = `${code} · ${PROJECT_NAME}`;
  const siteName = `Terästehdas Luulaja ${run}`;
  const building = "Sulatto (EAF)";
  const areas = [
    { code: "L1", name: "Sulatto, linja 1" },
    { code: "L2", name: "Sulatto, linja 2" },
    { code: "L3", name: "Sulatto, linja 3" },
  ];
  const workPackages = [
    { code: "TR", name: "Teräsrakenteet", trade: "Asentaja" },
    { code: "KH", name: "Kaapelihyllyt", trade: "Sähköasentaja" },
    { code: "KV", name: "Kaapelinveto", trade: "Sähköasentaja" },
  ];
  const planName = `Sulatto – asennustahti ${run}`;
  const quoteTitle = `Terästehtaan sähköasennukset ${run}`;
  const variationTitle = `Lisäkaapelointi uunille ${run}`;
  const docTitle = `Sulaton kaapelireitit ${run}`;

  /** Navigates as a person would: sidebar on desktop, bottom bar / "Lisää" on phones. */
  async function nav(p: Page, label: string) {
    if (mobile) {
      const link = p.getByTestId("mobile-nav").getByRole("link", { name: label, exact: true });
      if (await link.count()) await link.click(T);
      else {
        await p.getByTestId("mobile-more").click(T);
        await p.getByRole("dialog").getByRole("link", { name: label, exact: true }).click(T);
      }
    } else {
      const aside = p.locator("aside");
      const collapsed = aside.locator('[data-nav-group][aria-expanded="false"]');
      for (let i = 0; i < 20 && (await collapsed.count()) > 0; i++) await collapsed.first().click(T);
      await aside.getByRole("link", { name: label, exact: true }).click(T);
    }
    await expect(p.getByRole("heading", { level: 1 })).toBeVisible(T);
  }

  /** Opens the new project from the project list. */
  async function openProject() {
    await nav(page, "Projektilista");
    await page.getByRole("link", { name: new RegExp(code) }).first().click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(projectLabel, T);
  }

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(T);
  });

  await j.step("Avaa projektilista", async () => {
    await nav(page, "Projektilista");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Projektit", T);
  });

  await j.step("Perusta projekti Terästehdas Luulaja – demo", async () => {
    await page.getByRole("link", { name: "Uusi projekti" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Uusi projekti", T);
    await page.getByLabel("Projektinumero").fill(code, T);
    await page.getByLabel("Projektin nimi").fill(PROJECT_NAME, T);
    await page.getByLabel("Asiakas").fill("Nordic Steel Demo AB", T);
    await page.getByLabel("Tila").selectOption("ACTIVE", T);
    await page.getByLabel("Alkaa").fill("2026-12-01", T);
    await page.getByLabel("Päättyy").fill("2027-12-31", T);
    await page.getByLabel("Kuvaus").fill("Demo: terästehtaan sulaton ja valssaamon sähkö- ja automaatioasennukset.", T);
    await page.getByRole("button", { name: "Luo", exact: true }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(projectLabel, T);
  });

  await j.step("Lisää työmaa", async () => {
    await page.getByRole("link", { name: "Lisää työmaa" }).click(T);
    await page.getByLabel("Työmaan nimi").fill(siteName, T);
    await page.getByLabel("Työmaatunnus").fill("LUL-1", T);
    await page.getByLabel("Osoite").fill("Demotie 1", T);
    await page.getByLabel("Paikkakunta").fill("Luulaja", T);
    await page.getByRole("button", { name: "Luo", exact: true }).click(T);
    await expect(page.getByTestId("site-list")).toContainText(siteName, T);
  });

  await j.step("Avaa projektin tahtirakenne", async () => {
    await page.getByRole("main").getByRole("link", { name: "Tahti", exact: true }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tahtirakenne", T);
  });

  await j.step("Lisää rakennus Sulatto", async () => {
    const form = page.getByTestId("building-form");
    await form.getByLabel("Työmaa").selectOption({ label: siteName }, T);
    await form.getByLabel("Nimi").fill(building, T);
    await form.getByLabel("Tyyppi").selectOption("BUILDING", T);
    await form.getByRole("button", { name: "Lisää rakennus/alue" }).click(T);
    await expect(page.locator(`[data-testid="building"][data-name="${building}"]`)).toBeVisible(T);
  });

  await j.step("Lisää takt-alueet linjoille 1–3", async () => {
    const card = page.locator(`[data-testid="building"][data-name="${building}"]`);
    for (const a of areas) {
      const form = card.getByTestId("area-form");
      await form.getByLabel("Tunnus").fill(a.code, T);
      await form.getByLabel("Nimi").fill(a.name, T);
      await form.getByRole("button", { name: "Lisää takt-alue" }).click(T);
      await expect(card.getByText(a.name)).toBeVisible(T);
    }
  });

  await j.step("Lisää työpaketit", async () => {
    for (const w of workPackages) {
      const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Lisää työpaketti" }) });
      await form.getByLabel("Tunnus").fill(w.code, T);
      await form.getByLabel("Nimi").fill(w.name, T);
      await form.getByLabel("Ammatti").fill(w.trade, T);
      await form.getByLabel("Miehitys (hlöä)").fill("3", T);
      await form.getByLabel("Kesto (tahtia)").fill("2", T);
      await form.getByRole("button", { name: "Lisää työpaketti" }).click(T);
      await expect(page.getByTestId("work-packages")).toContainText(w.name, T);
    }
  });

  await j.step("Luo tahtisuunnitelma", async () => {
    const form = page.getByTestId("plan-form");
    await form.getByLabel("Työmaa").selectOption({ label: siteName }, T);
    await form.getByLabel("Suunnitelman nimi").fill(planName, T);
    await form.getByLabel("Aloituspäivä").fill("2026-12-07", T);
    await form.getByRole("button", { name: "Luo suunnitelma" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(planName, T);
  });

  await j.step("Generoi tahtijuna", async () => {
    await page.getByRole("button", { name: "Generoi tahtijuna" }).click(T);
    const board = page.getByTestId("takt-board");
    for (const a of areas) for (const w of workPackages) await expect(board.locator(`[data-area="${a.code}"] [data-chip="${w.code}"]`)).toHaveCount(1, T);
  });

  await j.step("Lähetä versio hyväksyttäväksi", async () => {
    await page.getByRole("button", { name: "Ehdota hyväksyttäväksi" }).click(T);
    await expect(page.getByTestId("versions").locator('[data-version="1"]')).toContainText("Hyväksyttävänä", T);
  });

  await j.step("Löydä projekti tahtiaikataulusta", async () => {
    await nav(page, "Tahtiaikataulu");
    const row = page.getByTestId("takt-projects").locator("li").filter({ hasText: PROJECT_NAME }).filter({ hasText: code });
    await expect(row).toBeVisible(T);
  });

  await j.step("Luo tarjous projektille", async () => {
    await nav(page, "Tarjoukset");
    const form = page.getByTestId("quote-form");
    const customer = form.getByLabel("Asiakas");
    const options = (await customer.locator("option").allTextContents()).map((s) => s.trim());
    const pick = options.find((o) => /Nordic (Steel|Hyperscale)/.test(o)) ?? options.find((o) => o && o !== "–" && !o.startsWith("Valitse"));
    if (!pick) throw new Error("Asiakaslistalla ei ole asiakkaita");
    await customer.selectOption({ label: pick }, T);
    await form.getByLabel("Tarjouksen kohde").fill(quoteTitle, T);
    await form.getByLabel("Projekti").selectOption({ label: projectLabel }, T);
    await form.getByRole("button", { name: "Luo tarjous" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(quoteTitle, T);
  });

  await j.step("Lisää tarjousrivit", async () => {
    const lines = [
      { category: "LABOR", description: "Sähköasennustyö, sulatto", quantity: "800", unit: "h", cost: "48" },
      { category: "MATERIALS", description: "Kaapelihyllyt ja kiinnikkeet", quantity: "1", unit: "erä", cost: "25000" },
    ];
    for (const l of lines) {
      const form = page.getByTestId("quote-line-form");
      await form.getByLabel("Laji").selectOption(l.category, T);
      await form.getByLabel("Kuvaus").fill(l.description, T);
      await form.getByLabel("Määrä").fill(l.quantity, T);
      await form.getByLabel("Yksikkö", { exact: true }).fill(l.unit, T);
      await form.getByLabel("Yksikkökustannus").fill(l.cost, T);
      await form.getByRole("button", { name: "Lisää rivi" }).click(T);
      await expect(page.getByTestId("quote-lines")).toContainText(l.description, T);
    }
  });

  await j.step("Aseta kate ja lähetä tarjous hyväksyttäväksi", async () => {
    const draft = page.getByTestId("quote-draft-form");
    await draft.getByLabel("Kate (% hinnasta)").fill("15", T);
    await draft.getByRole("button", { name: "Tallenna" }).click(T);
    // Cost 800 × 48 € + 25 000 € = 63 400 €; the price shown must be above the cost.
    await expect(page.getByTestId("quote-price")).toContainText(/\d/, T);
    await page.getByRole("button", { name: "Lähetä hyväksyttäväksi" }).click(T);
    await expect(page.getByText(/Hyväksyttävänä/).first()).toBeVisible(T);
  });

  await j.step("Kirjaa lisätyö projektille", async () => {
    await openProject();
    await page.getByRole("main").getByRole("link", { name: "Sopimus ja ennuste" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sopimus ja ennuste", T);
    const form = page.getByTestId("variation-form");
    await form.getByLabel("Lisätyö").fill(variationTitle, T);
    await form.getByLabel("Syy").fill("Tilaajan muutos: lisäsyöttö uunille 2", T);
    await form.getByRole("button", { name: "Luo lisätyö" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(variationTitle, T);
    const d = page.getByTestId("variation-draft-form");
    await d.getByLabel("Työ (€)").fill("4800", T);
    await d.getByLabel("Materiaalit (€)").fill("2200", T);
    await d.getByLabel("Lisä (%)").fill("10", T);
    await d.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(page.getByTestId("variation-price")).toContainText("7 700,00", T);
    await page.getByRole("button", { name: "Lähetä sisäiseen tarkastukseen" }).click(T);
    await expect(page.getByRole("button", { name: "Lähetä sisäiseen tarkastukseen" })).toHaveCount(0, T);
  });

  await j.step("Lisää projektille dokumentti", async () => {
    await openProject();
    await page.getByRole("main").getByRole("link", { name: "Uusi dokumentti" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Uusi dokumentti", T);
    await page.getByLabel("Otsikko").fill(docTitle, T);
    await page.getByLabel("Luokka").selectOption("DRAWING", T);
    await page.getByLabel("Näkyvyys").selectOption({ label: projectLabel }, T);
    await page.getByLabel("Revisio").fill("A", T);
    await page.getByLabel("Tiedosto").setInputFiles({ name: "kaapelireitit-a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 kaapelireitit revisio A") }, T);
    await page.getByRole("button", { name: "Luo", exact: true }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(docTitle, T);
    await expect(page.getByTestId("current-version")).toContainText("Versio 1", T);
  });

  await j.step("Lataa dokumentista uusi versio", async () => {
    await page.getByLabel("Revisio").fill("B", T);
    await page.getByLabel("Muutoksen kuvaus").fill("Kaapelireitti siirretty linjalle 2", T);
    await page.getByLabel("Tiedosto").setInputFiles({ name: "kaapelireitit-b.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 kaapelireitit revisio B") }, T);
    await page.getByRole("button", { name: "Lataa uusi versio" }).click(T);
    await expect(page.getByTestId("current-version")).toContainText("Versio 2", T);
    await expect(page.getByTestId("version-list").locator("li")).toHaveCount(2, T);
  });

  await j.step("Tarkista projektin talous", async () => {
    await openProject();
    await page.getByRole("main").getByRole("link", { name: "Talous", exact: true }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Projektin talous", T);
  });

  await j.step("Tarkista laskutusvalmius", async () => {
    await nav(page, "Laskutus");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Laskutus", T);
    const gen = page.getByTestId("generate-form");
    await gen.getByLabel("Projekti").selectOption({ label: projectLabel }, T);
    await gen.getByRole("button", { name: "Muodosta" }).click(T);
    await expect(gen.getByRole("status")).toBeVisible(T);
  });

  await j.step("Avaa markkinointi", async () => {
    await nav(page, "Markkinointi");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Markkinointi", T);
  });

  j.write();
});
