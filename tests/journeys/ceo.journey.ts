/**
 * Role journey: Toimitusjohtaja (CEO), Aino Esimerkki, mainly on desktop.
 * Walks the company overview, project finance and forecast, the AI project
 * controller, sales and quotes, order confirmations, billing settings,
 * marketing, HSE, members/roles/audit and the assistant.
 * Creates only its own uniquely named data; demo data is not changed.
 */
import { expect, test, type Page } from "@playwright/test";
import { acceptDialogs, navigate } from "../e2e/helpers";
import { COMPANY, Journey, openAs } from "./journey";

const T = { timeout: 8000 };
const AI = { timeout: 15_000 };

/** A section of the page by its h2 title. */
const section = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });

test("ceo", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const page = await openAs(browser, testInfo, "ceo");
  acceptDialogs(page);
  const j = new Journey(page, testInfo, "ceo");
  const go = (label: string) => navigate(page, testInfo, label);
  const stamp = Date.now().toString(36).slice(-5);
  const tag = `${j.mobile ? "MOB" : "DSK"}-${stamp}`;

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Tervetuloa", T);
    await expect(page.getByText("Aktiiviset projektit")).toBeVisible(T);
  });

  await j.step("Avaa terästehtaan projekti", async () => {
    await go("Projektilista");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Projektit", T);
    await page.getByRole("link", { name: /NSM-001/ }).first().click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("NSM-001 · Nordic Steel Mill Demo", T);
  });

  await j.step("Tarkista projektin talous", async () => {
    await page.getByRole("link", { name: "Talous", exact: true }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Projektin talous", T);
    await expect(page.getByRole("heading", { level: 2, name: "Budjetti vs. toteuma" })).toBeVisible(T);
  });

  await j.step("Katso sopimus ja ennuste", async () => {
    await page.getByRole("link", { name: "NSM-001", exact: true }).first().click(T);
    await page.getByRole("link", { name: "Sopimus ja ennuste" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sopimus ja ennuste", T);
    await expect(page.getByText("Ennustettu kate").first()).toBeVisible(T);
  });

  await j.step("Kysy tekoälyohjaajalta katteesta", async () => {
    await page.getByRole("link", { name: "NSM-001", exact: true }).first().click(T);
    await page.getByRole("link", { name: "Tekoälyohjaaja" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tekoälyohjaaja", T);
    await expect(page.getByTestId("ai-budget")).toContainText("käytetty tässä kuussa", T);
    const question = `Mikä uhkaa katetta eniten? (${tag})`;
    const ask = page.getByTestId("ai-ask-form");
    await ask.getByLabel("Kysymys projektista").fill(question);
    await ask.getByRole("button", { name: "Kysy" }).click(T);
    await expect(page.getByTestId("ai-runs").locator("[data-run]").first()).toContainText(question, AI);
  });

  await j.step("Myynnin yleiskuva ja myyntiputki", async () => {
    await go("Asiakkaat ja myyntiputki");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Myynti", T);
    await expect(page.getByTestId("sales-kpis")).toContainText("Painotettu myyntiputki", T);
    await expect(page.getByTestId("pipeline")).toBeVisible(T);
  });

  await j.step("Avaa asiakas ja yhteyshenkilöt", async () => {
    await page.getByRole("link", { name: /^Nordic Steel Demo AB/ }).first().click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nordic Steel Demo AB", T);
    await expect(page.getByTestId("contacts")).toBeVisible(T);
  });

  const quoteTitle = `Valssaamon huoltoseisokki ${tag}`;
  await j.step("Luo uusi tarjous", async () => {
    await go("Tarjoukset");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tarjoukset", T);
    const form = page.getByTestId("quote-form");
    await form.getByLabel("Asiakas").selectOption({ label: "Nordic Steel Demo AB" });
    await form.getByLabel("Tarjouksen kohde").fill(quoteTitle);
    await form.getByRole("button", { name: "Luo tarjous" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(quoteTitle, T);
  });

  await j.step("Hinnoittele tarjous", async () => {
    const line = page.getByTestId("quote-line-form");
    await line.getByLabel("Kuvaus").fill("Asennustyö seisokissa");
    await line.getByLabel("Määrä").fill("200");
    await line.getByLabel("Yksikkökustannus").fill("48");
    await line.getByRole("button", { name: "Lisää rivi" }).click(T);
    await expect(page.getByTestId("quote-lines")).toContainText("Asennustyö seisokissa", T);
    const draft = page.getByTestId("quote-draft-form");
    await draft.getByLabel("Kate (% hinnasta)").fill("18");
    await draft.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(page.getByTestId("quote-price")).not.toHaveText(/^\s*0,00/, T);
  });

  await j.step("Lähetä tarjous hyväksyttäväksi", async () => {
    await page.getByRole("button", { name: "Lähetä hyväksyttäväksi" }).click(T);
    await expect(page.getByText(/Hyväksyttävänä/).first()).toBeVisible(T);
    // Own quote: the CEO may not approve it (four-eyes rule).
    await expect(page.getByText("Olet laatinut tai lähettänyt tämän version, joten et voi hyväksyä sitä.")).toBeVisible(T);
  });

  await j.step("Tarkista hyväksyntää odottava tarjous", async () => {
    await go("Tarjoukset");
    const pending = page.getByRole("link", { name: /Valssaamon sähköasennukset/ }).first();
    if (!(await pending.isVisible())) return "Demon odottavaa tarjousta ei löytynyt listalta";
    await pending.click(T);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Valssaamon sähköasennukset", T);
    const decision = page.getByTestId("quote-decision-form");
    if (!(await decision.isVisible())) return "Tarjous on jo käsitelty – hyväksyntälomaketta ei näy";
    await expect(decision.getByRole("button", { name: "Hyväksy tarjous" })).toBeVisible(T);
    await expect(decision.getByLabel("Perustelu / huomautus")).toBeVisible(T);
    // Demo quote left for the Project Director's journey; the button is only checked.
    return "Hyväksyntä löytyi; demotarjousta ei hyväksytty, jotta se jää projektijohtajan polulle";
  });

  const orderTitle = `Uunin kuoriosien toimitus ${tag}`;
  await j.step("Tee tilausvahvistus", async () => {
    await go("Tilausvahvistukset ja laskut");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tilausvahvistukset ja laskut", T);
    const create = page.getByTestId("invoicing-create-form");
    await create.getByLabel("Tyyppi").selectOption({ label: "Tilausvahvistus" });
    await create.getByLabel("Ehdot").selectOption({ label: "Myynti – myyntiehdot" });
    await create.getByLabel("Asiakas rekisteristä").selectOption({ label: "Nordic Steel Demo AB (0000001-9)" });
    await create.getByLabel("Otsikko").fill(orderTitle);
    await create.getByRole("button", { name: "Luo luonnos" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tilausvahvistus (luonnos)", T);
  });

  await j.step("Lisää tilausvahvistukselle rivi", async () => {
    const line = page.getByTestId("invoicing-line-form");
    await line.getByLabel("Koodi").fill("UK-4");
    await line.getByLabel("Nimike").fill("Uunin kuoriosa");
    await line.getByLabel("Määrä").fill("4");
    await line.getByLabel("a-hinta (alv 0 %)").fill("12500");
    await line.getByRole("button", { name: "Lisää rivi" }).click(T);
    await expect(page.getByTestId("invoicing-lines")).toContainText("Uunin kuoriosa", T);
    await expect(page.getByTestId("invoicing-gross")).toContainText("62 750,00", T);
  });

  await j.step("Vahvista ja lähetä tilausvahvistus", async () => {
    const send = page.getByTestId("invoicing-send-form");
    await expect(send.getByLabel("Vastaanottaja")).not.toHaveValue("", T);
    await send.getByRole("button", { name: "Vahvista ja lähetä" }).click(T);
    await expect(page.getByText("Lähetetty.", { exact: true })).toBeVisible(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Tilausvahvistus \d+$/, T);
  });

  await j.step("Tarkista laskutusasetukset", async () => {
    await go("Tilausvahvistukset ja laskut");
    await page.getByRole("link", { name: "Laskutusasetukset" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Laskutusasetukset", T);
    const form = page.getByTestId("billing-settings-form");
    await expect(form.getByLabel("IBAN")).not.toHaveValue("", T);
    await expect(form.getByLabel("Seuraava laskun numero")).toBeVisible(T);
    await expect(form.getByRole("checkbox", { name: "Tilausvahvistukset ja laskut käytössä" })).toBeChecked(T);
  });

  await j.step("Markkinoinnin tilanne", async () => {
    await go("Markkinointi");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Markkinointi", T);
    await expect(page.getByTestId("marketing-kpis")).toContainText("Odottaa hyväksyntää", T);
    await expect(page.getByRole("heading", { level: 2, name: "Markkinointirekisteri" })).toBeVisible(T);
  });

  const leadTitle = `Terästehtaan laajennus ${tag}`;
  await j.step("Lisää hanke käsin rekisteriin", async () => {
    const form = page.getByTestId("lead-form");
    await form.getByLabel("Hankkeen nimi").fill(leadTitle);
    await form.getByLabel("Maa (ISO, esim. FI)").fill("SE");
    await form.getByLabel("Tilaaja / rakennuttaja").fill("Nordic Steel Demo AB");
    await form.getByLabel("Sijainti").fill("Luleå");
    await form.getByRole("button", { name: "Lisää hanke käsin" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(leadTitle, T);
  });

  await j.step("Katso hyväksyttävät kirjeet", async () => {
    await go("Markkinointi");
    await page.getByRole("navigation", { name: "Markkinointi" }).getByRole("link", { name: /^Hyväksyttävät/ }).click(T);
    await expect(page).toHaveURL(/\/marketing\/approvals/, T);
    await expect(page.getByTestId("letters").or(page.getByText("Ei hyväksyttäviä kirjeitä.")).first()).toBeVisible(T);
  });

  await j.step("Työturvallisuuden tilanne", async () => {
    await go("Työturvallisuus");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Työturvallisuus", T);
    await expect(page.getByRole("heading", { level: 2, name: "Tunnusluvut" })).toBeVisible(T);
    await expect(page.getByRole("heading", { level: 2, name: "Tapaturmat ja vahingot" })).toBeVisible(T);
  });

  await j.step("Kutsu uusi käyttäjä", async () => {
    await go("Asetukset");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Asetukset", T);
    await page.getByRole("navigation", { name: "Asetukset" }).getByRole("link", { name: "Käyttäjät" }).click(T);
    await expect(page).toHaveURL(/\/settings\/members/, T);
    const invite = section(page, "Kutsu käyttäjä");
    await invite.getByLabel("Sähköposti").fill(`journey.ceo.${tag.toLowerCase()}@example.com`);
    await invite.getByLabel("Nimi").fill(`Testi Työnjohtaja ${tag}`);
    await invite.getByRole("group", { name: "Roolit" }).getByRole("checkbox", { name: "Työnjohtaja", exact: true }).check();
    await invite.getByRole("button", { name: "Kutsu käyttäjä" }).click(T);
    await expect(invite.getByRole("status")).toBeVisible(T);
  });

  await j.step("Tarkista roolit ja oikeudet", async () => {
    await page.getByRole("navigation", { name: "Asetukset" }).getByRole("link", { name: "Roolit ja oikeudet" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Roolit ja oikeudet", T);
    await expect(page.getByRole("heading", { level: 2, name: "Asiakas", exact: true })).toBeVisible(T);
    await expect(page.getByRole("heading", { level: 2, name: "Toimitusjohtaja", exact: true })).toBeVisible(T);
  });

  await j.step("Selaa muutoslokia", async () => {
    await page.getByRole("navigation", { name: "Asetukset" }).getByRole("link", { name: "Muutosloki" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Muutosloki", T);
    await expect(page.getByTestId("audit-list")).toBeVisible(T);
  });

  await j.step("Aloita projekti avustajalla", async () => {
    // The test provider recognises "uusi projekti <Nimi>" with a letters-only name.
    const name = `Teras${stamp.replace(/[^a-z]/gi, "")}${j.mobile ? "Mob" : "Dsk"}`;
    await page.getByRole("link", { name: "Avustaja", exact: true }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Avustaja", T);
    await page.getByRole("textbox", { name: "Kirjoita tai paina mikrofonia" }).fill(`Aloitetaan uusi projekti ${name}`);
    await page.getByRole("button", { name: "Lähetä" }).click(T);
    const card = page.getByTestId("assistant-actions").locator('[data-action="create_project"]').last();
    await expect(card).toHaveAttribute("data-status", "PROPOSED", AI);
    await card.getByRole("button", { name: "Vahvista" }).click(T);
    await expect(card).toHaveAttribute("data-status", "CONFIRMED", T);
  });

  j.write();
});
