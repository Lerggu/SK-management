import { expect, test, type Locator } from "@playwright/test";
import { COMPANY, Journey, openAs, lbl } from "./journey";

/**
 * Henkilöstöhallinto (HR, Helena Henkilöstö): perustaa henkilön, täydentää
 * henkilöstökortin (kortti + muistutus, perehdytys, osaamisarvio, varusteet),
 * katsoo matriisin ja korttilistan, perustaa tiimin, merkitsee rotaation ja
 * tarkistaa yleiskuvan, asetukset sekä palkanlaskennan viennin.
 */
test("hr", async ({ browser }, testInfo) => {
  const page = await openAs(browser, testInfo, "hr");
  page.setDefaultTimeout(8000);
  const j = new Journey(page, testInfo, "hr");
  const T = { timeout: 8000 };

  const stamp = Date.now();
  const first = "Jonna";
  const last = `Polku${stamp}`;
  const listName = `${last} ${first}`; // listat, matriisi, tiimit, rotaatio
  const cardName = `${first} ${last}`; // henkilöstökortin otsikko
  const teamName = `Tiimi ${stamp}`;
  const serial = `IMEI-${stamp}`;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const inDays = (n: number) => iso(new Date(today.getTime() + n * 86_400_000));

  /** Päävalikko: työpöydällä sivupalkki (ryhmä auki tarvittaessa), puhelimella "Lisää". */
  async function menu(link: string, group = "Henkilöstö") {
    if (j.mobile) {
      await page.getByTestId("mobile-nav").getByRole("button", { name: "Lisää", exact: true }).click(T);
      await page.getByRole("dialog").getByRole("link", { name: link, exact: true }).click(T);
      return;
    }
    const side = page.locator("aside").getByRole("navigation", { name: "Päävalikko" });
    const target = side.getByRole("link", { name: link, exact: true });
    if (!(await target.isVisible())) await side.getByRole("button", { name: group, exact: true }).click(T);
    await target.click(T);
  }

  const section = (heading: string | RegExp): Locator => page.locator("section").filter({ has: page.getByRole("heading", { name: heading }) });
  const cardTab = (name: string) => page.getByRole("navigation", { name: "Henkilöstökortti" }).getByRole("link", { name, exact: true });

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Helena", T);
  });

  await j.step("Avaa henkilöstörekisteri", async () => {
    await menu("Henkilöt");
    await expect(page.getByRole("heading", { level: 1, name: "Henkilöstö", exact: true })).toBeVisible(T);
  });

  await j.step("Hae henkilö nimellä", async () => {
    await page.getByRole("searchbox", { name: "Hae" }).fill("Tyyppi");
    await page.getByRole("button", { name: "Hae", exact: true }).click(T);
    await expect(page.getByRole("link", { name: /Tyyppi Timo/ })).toBeVisible(T);
  });

  await j.step("Perusta uusi henkilö", async () => {
    await page.getByRole("link", { name: "Uusi henkilö" }).click(T);
    await expect(page.getByRole("heading", { level: 1, name: "Uusi henkilö" })).toBeVisible(T);
    await page.getByLabel("Etunimi").fill(first);
    await page.getByLabel("Sukunimi").fill(last);
    await page.getByLabel("Henkilönumero").fill(`J-${stamp}`);
    await page.getByLabel(lbl("Ammatti")).fill("Asentaja");
    await page.getByLabel("Tehtävänimike").fill("Teräsrakenneasentaja");
    await page.getByLabel("Puhelin").fill("+358 40 000 0000");
    await page.getByLabel("Sähköposti").fill(`jonna.${stamp}@example.com`);
    await page.getByLabel("Aloituspäivä").fill(iso(today));
    await page.getByRole("button", { name: "Luo", exact: true }).click(T);
    await expect(page.getByRole("heading", { level: 1, name: cardName })).toBeVisible({ timeout: 15_000 });
  });

  await j.step("Täydennä esihenkilö ja toimipiste", async () => {
    const form = page.getByTestId("employment-form");
    await form.locator("summary").click(T);
    await form.getByLabel(lbl("Esihenkilö")).selectOption({ index: 1 });
    await form.getByLabel(lbl("Toimipiste")).fill("Tornio");
    await form.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(section("Työsuhde ja organisaatio").locator("dd").filter({ hasText: /^Tornio$/ })).toBeVisible(T);
  });

  await j.step("Lisää tulityökortti muistutuksella", async () => {
    await cardTab("Pätevyydet").click(T);
    const add = page.getByTestId("add-qualification");
    await add.locator("summary").click(T);
    await add.getByLabel(lbl("Tyyppi")).selectOption({ label: "Tulityökortti" });
    await add.getByLabel("Myöntäjä").fill("Suomen Pelastusalan Keskusjärjestö SPEK");
    await add.getByLabel("Korttinumero").fill(`TT-${stamp}`);
    await add.getByLabel("Myöntämispäivä").fill(inDays(-1800));
    await add.getByLabel("Viimeinen voimassaolopäivä").fill(inDays(20));
    await add.getByLabel("Lähetä sähköpostimuistutus").check();
    await add.getByRole("button", { name: "Tallenna" }).click(T);
    const item = page.getByTestId("qualification-list").locator("li").filter({ hasText: `TT-${stamp}` });
    await expect(item).toContainText("Tulityökortti", T);
    await expect(item).toContainText("Vanhenee kuukauden sisällä", T);
  });

  await j.step("Tarkista vanhenemismuistutus", async () => {
    const item = page.getByTestId("qualification-list").locator("li").filter({ hasText: `TT-${stamp}` });
    const info = item.getByTestId("reminder-info");
    await expect(info).toContainText("Muistutus", T);
    if (await info.getByText("Sähköpostin lähetys ei ole käytössä").isVisible()) return "Muistutus näkyy, mutta sähköpostin lähetys ei ole käytössä";
  });

  await j.step("Kirjaa työmaaperehdytys", async () => {
    const add = page.getByTestId("add-orientation");
    await add.locator("summary").click(T);
    await add.getByLabel("Perehdytyksen laji").selectOption({ label: "Työmaa" });
    await add.getByLabel(lbl("Aihe")).fill(`Työmaaperehdytys ${stamp}`);
    await add.getByLabel(lbl("Kohde")).fill("Sulatto (EAF)");
    await add.getByLabel("Perehdyttäjä").fill("Helena Henkilöstö");
    await add.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(page.getByTestId("orientation").filter({ hasText: `Työmaaperehdytys ${stamp}` })).toBeVisible(T);
  });

  await j.step("Tee ja julkaise osaamisarvio", async () => {
    await cardTab("Osaaminen").click(T);
    const add = page.getByTestId("new-assessment");
    await add.locator("summary").click(T);
    await add.getByLabel("Osaamisalue").selectOption({ label: "Maanrakennus · Kaivannot ja luiskat" });
    await add.getByLabel("Osaamistaso").selectOption({ label: "3 – Osaa itsenäisesti" });
    await add.getByLabel("Käytännön havainnot").fill("Tekee kaivantotyöt itsenäisesti ja turvallisesti.");
    await add.getByRole("button", { name: "Julkaise", exact: true }).click(T);
    await expect(page.getByTestId("assessment-history").locator("li").filter({ hasText: "Kaivannot ja luiskat" }).first()).toContainText("Julkaistu", T);
  });

  await j.step("Kirjaa työvaatteiden luovutus", async () => {
    await cardTab("Varusteet").click(T);
    const add = page.getByTestId("issue-clothing");
    await add.locator("summary").click(T);
    await add.getByLabel("Tuote").fill("Huomiotakki, luokka 3");
    await add.getByLabel(lbl("Koko")).fill("L");
    await add.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(page.getByText("Huomiotakki, luokka 3").first()).toBeVisible(T);
  });

  await j.step("Luovuta työpuhelin", async () => {
    const add = page.getByTestId("add-item");
    await add.locator("summary").click(T);
    await add.getByLabel("Tavaran nimi").fill("Työpuhelin");
    await add.getByLabel(lbl("Tyyppi")).selectOption({ label: "Puhelin" });
    await add.getByLabel("Sarjanumero").fill(serial);
    await add.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(page.getByTestId("company-items")).toContainText(serial, T);
  });

  await j.step("Katso osaamismatriisi", async () => {
    await menu("Osaamismatriisi");
    await expect(page.getByRole("heading", { level: 1, name: "Osaamismatriisi" })).toBeVisible(T);
    await expect(page.getByTestId("competence-matrix").getByRole("link", { name: listName })).toBeVisible(T);
  });

  await j.step("Suodata vanhenevat kortit", async () => {
    await menu("Kortit ja pätevyydet");
    await expect(page.getByRole("heading", { level: 1, name: "Kortit ja pätevyydet" })).toBeVisible(T);
    const filters = page.getByTestId("qualification-filters");
    await filters.getByLabel("Henkilöstön tila").selectOption({ label: "Vanhenee kuukauden sisällä" });
    await filters.getByRole("button", { name: "Suodata" }).click(T);
    await expect(page.getByTestId("all-qualifications").getByRole("link", { name: listName })).toBeVisible(T);
  });

  await j.step("Perusta tiimi vetäjineen", async () => {
    await menu("Tiimit");
    await expect(page.getByRole("heading", { level: 1, name: "Tiimit" })).toBeVisible(T);
    const form = section("Luo tiimi");
    await form.getByLabel("Tiimin nimi").fill(teamName);
    await form.getByLabel("Vetäjä").selectOption({ label: listName });
    await form.getByLabel("Kuvaus").fill("Sulaton asennustiimi");
    await form.getByRole("button", { name: "Luo tiimi" }).click(T);
    const team = section(teamName);
    await expect(team).toBeVisible(T);
    await expect(team.getByRole("link", { name: listName })).toBeVisible(T);
  });

  await j.step("Avaa rotaatio", async () => {
    await menu("Rotaatio");
    await expect(page.getByRole("heading", { level: 1, name: "Rotaatio" })).toBeVisible(T);
  });

  await j.step("Merkitse rotaatiorytmi 10/4 Sulattoon", async () => {
    const form = section("Rotaatiorytmi");
    const site = form.getByLabel(lbl("Työmaa"));
    const sulatto = site.locator("option", { hasText: "Sulatto" });
    const value = (await sulatto.count()) > 0 ? await sulatto.first().getAttribute("value") : null;
    if (value) await site.selectOption(value);
    await form.getByLabel("Työpäiviä").fill("10");
    await form.getByLabel("Vapaapäiviä").fill("4");
    await form.getByLabel(listName).check();
    await form.getByRole("button", { name: "Lisää rytmi" }).click(T);
    await expect(form.getByRole("status")).toContainText("Rytmi lisätty", T);
    if (!value) return "Työmaata \"Sulatto\" ei löytynyt valikosta, rytmi merkittiin ilman työmaata";
  });

  await j.step("Katso HR-yleiskuva", async () => {
    await menu("HR-yleiskuva");
    await expect(page.getByRole("heading", { level: 1, name: "Henkilöstön yhteenveto" })).toBeVisible(T);
    await expect(page.getByTestId("overview-expiring").getByRole("link", { name: listName })).toBeVisible(T);
  });

  await j.step("Tarkista muistutusten asetukset", async () => {
    await menu("HR-asetukset");
    await expect(page.getByRole("heading", { level: 1, name: "Henkilöstöhallinnan asetukset" })).toBeVisible(T);
    const s = section("Sähköpostimuistutukset");
    await expect(s.getByLabel("Ylläpidon sähköpostiosoite")).not.toHaveValue("", T);
    if (await s.getByText("Sähköpostin lähetys ei ole käytössä").isVisible()) return "Sähköpostin lähetys ei ole käytössä: muistutukset jäävät odottamaan";
  });

  await j.step("Vie tunnit palkanlaskentaan", async () => {
    let found = false;
    if (j.mobile) {
      await page.getByTestId("mobile-nav").getByRole("button", { name: "Lisää", exact: true }).click(T);
      const link = page.getByRole("dialog").getByRole("link", { name: "Tunnit", exact: true });
      found = await link.isVisible();
      if (found) await link.click(T);
      else await page.keyboard.press("Escape");
    } else {
      const side = page.locator("aside").getByRole("navigation", { name: "Päävalikko" });
      const group = side.getByRole("button", { name: "Projektit", exact: true });
      const link = side.getByRole("link", { name: "Tunnit", exact: true });
      if (!(await link.isVisible()) && (await group.isVisible())) await group.click(T);
      found = await link.isVisible();
      if (found) await link.click(T);
    }
    if (!found) return "Tunnit-valikkoa ei näy HR-roolille, joten tuntien vientiä palkanlaskentaan ei löydy";
    const exp = page.getByRole("link", { name: "Vienti palkanlaskentaan" });
    if (!(await exp.isVisible())) return "Tunnit-sivulla ei ole Vienti palkanlaskentaan -painiketta";
    await exp.click(T);
    await expect(page.getByRole("heading", { level: 1, name: "Vienti palkanlaskentaan" })).toBeVisible(T);
  });

  j.write();
});
