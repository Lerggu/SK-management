/**
 * Journey: Työmaapäällikkö / vastaava työnjohtaja (Pekka Demo, `siteManager`).
 * Runs a working day on the steel mill demo site (NSM-001 · Sulatto (EAF)):
 * hours, site diary, takt and look-ahead, production control, HSE, rotation and teams.
 */
import { expect, test, type Locator } from "@playwright/test";
import { COMPANY, Journey, openAs } from "./journey";

const T = { timeout: 8000 };
const PROJECT = "Nordic Steel Mill Demo";
const SITE = "Sulatto (EAF)";
const PLAN = "Sulatto – asennustahti";

test("siteManager", async ({ browser }, testInfo) => {
  const page = await openAs(browser, testInfo, "siteManager");
  const j = new Journey(page, testInfo, "siteManager");
  const tag = `SM-${testInfo.project.name.slice(0, 3)}-${Date.now().toString(36).slice(-5)}`;
  // Signing the diary and similar actions ask for confirmation.
  page.on("dialog", (d) => d.accept().catch(() => {}));

  const h1 = (name: string | RegExp) => expect(page.getByRole("heading", { level: 1, name })).toBeVisible(T);

  /** Opens a page from the visible menu: bottom bar / "Lisää" on phones, sidebar group on desktop. */
  async function go(label: string, opts: { group?: string; mobileLabel?: string } = {}) {
    if (j.mobile) {
      const bar = page.getByTestId("mobile-nav");
      const inBar = bar.getByRole("link", { name: opts.mobileLabel ?? label, exact: true });
      if (await inBar.count()) {
        await inBar.click(T);
      } else {
        await page.getByTestId("mobile-more").click(T);
        await page.getByRole("dialog").getByRole("link", { name: label, exact: true }).click(T);
      }
    } else {
      const aside = page.locator("aside");
      const link = aside.getByRole("link", { name: label, exact: true });
      if (!(await link.isVisible()) && opts.group) {
        const group = aside.getByRole("button", { name: opts.group, exact: true });
        if ((await group.getAttribute("aria-expanded")) === "false") await group.click(T);
      }
      await link.click(T);
    }
  }

  /** Production control sub-tab (Tahtiaikataulu, Look-ahead, Kalenteri, Aluekartta, Poikkeamat …). */
  async function tab(label: string) {
    await page.getByRole("main").getByRole("navigation", { name: "Tuotannonohjaus" }).getByRole("link", { name: label, exact: true }).click(T);
  }

  /** Chooses the first option whose text contains `text` (site names carry a project prefix in some pickers). */
  async function selectContaining(select: Locator, text: string) {
    const value = await select.locator("option", { hasText: text }).first().getAttribute("value", T);
    if (value === null) throw new Error(`No option containing "${text}"`);
    await select.selectOption(value, T);
  }

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(T);
  });

  await j.step("Hyväksy lähetetyt tunnit", async () => {
    await go("Tunnit", { group: "Projektit" });
    await h1("Tunnit");
    await page.getByRole("link", { name: "Hyväksyntä" }).click(T);
    await h1("Hyväksyntä");
    const groups = page.getByTestId("approval-group");
    if ((await groups.count()) === 0) {
      await expect(page.getByText("Ei hyväksyttäviä tunteja.")).toBeVisible(T);
      return "Ei hyväksyttäviä tunteja (toinen ajo hyväksyi ne jo)";
    }
    await page.getByRole("button", { name: "Hyväksy valitut" }).click(T);
    await expect(page.getByRole("status").or(page.getByText("Ei hyväksyttäviä tunteja."))).toBeVisible(T);
  });

  await j.step("Kirjaa omat 8 h tunnit", async () => {
    await go("Tunnit", { group: "Projektit" });
    await h1("Tunnit");
    const location = page.getByLabel("Projekti", { exact: true });
    if (await location.locator("option", { hasText: SITE }).count()) await selectContaining(location, SITE);
    await page.getByLabel("Tunnit", { exact: true }).fill("8");
    await page.getByLabel("Muistiinpano", { exact: true }).fill(`Työnjohto ja tarkastukset ${tag}`);
    await page.getByRole("button", { name: "Kirjaa tunnit", exact: true }).click(T);
    await expect(page.getByTestId("week-entries").getByText(`Työnjohto ja tarkastukset ${tag}`)).toBeVisible(T);
  });

  await j.step("Avaa päivän työmaapäiväkirja", async () => {
    await go("Projektilista", { group: "Projektit", mobileLabel: "Projektit" });
    await h1("Projektit");
    await page.getByRole("link", { name: new RegExp(PROJECT) }).first().click(T);
    await h1(new RegExp(PROJECT));
    await page.getByRole("button", { name: `Päiväkirja tänään: ${SITE}` }).click(T);
    await h1(`Työmaapäiväkirja · ${SITE}`);
  });

  await j.step("Kirjaa sää, yhteenveto ja tehty työ", async () => {
    const signed = await page.getByTestId("diary-signed").isVisible();
    if (!signed) {
      await page.getByLabel("Sää", { exact: true }).fill("Selkeää, -4 °C");
      await page.getByLabel("Päivän yhteenveto", { exact: true }).fill(`Uunin kuoriosien asennus linjalla 5 jatkui. ${tag}`);
      await page.getByRole("button", { name: "Tallenna", exact: true }).click(T);
      await expect(page.getByRole("status").first()).toBeVisible(T);
    }
    await page.getByLabel("Tyyppi", { exact: true }).selectOption({ label: "Tehty työ" }, T);
    await page.getByLabel("Kuvaus", { exact: true }).fill(`Nosturiradan palkit linja 5 asennettu ${tag}`);
    await page.getByRole("button", { name: signed ? "Lisäys" : "Lisää merkintä", exact: true }).click(T);
    await expect(page.getByTestId("diary-entries").getByText(`Nosturiradan palkit linja 5 asennettu ${tag}`)).toBeVisible(T);
    if (signed) return "Päiväkirja oli jo allekirjoitettu, merkintä kirjattiin lisäyksenä";
  });

  await j.step("Allekirjoita työmaapäiväkirja", async () => {
    if (await page.getByTestId("diary-signed").isVisible()) return "Päiväkirja oli jo allekirjoitettu";
    await page.getByRole("button", { name: "Allekirjoita päiväkirja" }).click(T);
    await expect(page.getByTestId("diary-signed")).toBeVisible(T);
  });

  await j.step("Avaa tahtitaulu", async () => {
    await go("Tahtiaikataulu", { group: "Tuotannonohjaus", mobileLabel: "Tuotannonohjaus" });
    await h1("Tahti");
    await page.getByRole("link", { name: new RegExp(PLAN) }).first().click(T);
    await h1(PLAN);
    await expect(page.getByRole("heading", { level: 2, name: /Tahtitaulu/ })).toBeVisible(T);
  });

  await j.step("Kirjaa tämän päivän edistyminen 75 %", async () => {
    const week = page.getByTestId("week-list");
    await expect(week).toBeVisible(T);
    const open = week.locator("li[data-activity]").filter({ has: page.getByRole("button", { name: "75 %" }) }).first();
    if (!(await open.count())) return "Tämän viikon tehtävillä ei ole pikakirjauspainikkeita";
    await open.getByRole("button", { name: "75 %" }).click(T);
    await expect(open.getByText("75 %").last()).toBeVisible(T);
  });

  await j.step("Lisää tehtävälle este (rajoite)", async () => {
    await page.getByTestId("week-list").locator("li[data-activity] a").first().click(T);
    await expect(page.getByRole("heading", { level: 2, name: "Rajoitteet" })).toBeVisible(T);
    await page.getByLabel("Rajoite", { exact: true }).selectOption({ label: "Materiaali saatavilla" }, T);
    await page.getByLabel("Lisätiedot", { exact: true }).fill(`Uunin kuoriosat puuttuvat ${tag}`);
    await page.getByRole("button", { name: "Lisää rajoite" }).click(T);
    await expect(page.getByText(`Uunin kuoriosat puuttuvat ${tag}`)).toBeVisible(T);
  });

  await j.step("Tarkista look-ahead 6 viikkoa", async () => {
    await go("Tahtiaikataulu", { group: "Tuotannonohjaus", mobileLabel: "Tuotannonohjaus" });
    await tab("Look-ahead");
    await h1("Look-ahead");
    await page.getByRole("link", { name: "6 viikkoa (resurssit)" }).click(T);
    await expect(page).toHaveURL(/weeks=6/, T);
    await expect(page.getByTestId("shortage-count")).toBeVisible(T);
  });

  await j.step("Katso tuotantokalenteri viikolta", async () => {
    await tab("Kalenteri");
    await h1("Tuotantokalenteri");
    const controls = page.getByTestId("calendar-controls");
    await selectContaining(controls.getByLabel("Työmaa"), SITE);
    await controls.getByRole("button", { name: "Näytä" }).click(T);
    await expect(page).toHaveURL(/site=/, T);
    await controls.getByRole("link", { name: "Viikko", exact: true }).click(T);
    await expect(page).toHaveURL(/zoom=week/, T);
  });

  await j.step("Ilmoita poikkeama: kuorma myöhässä", async () => {
    await tab("Poikkeamat");
    await h1("Poikkeamat");
    const tasks = page.getByTestId("report-tasks").getByRole("link");
    const drum = tasks.filter({ hasText: "Uunin kuoriosat" });
    await ((await drum.count()) ? drum.first() : tasks.first()).click(T);
    const form = page.getByTestId("deviation-form");
    await expect(form).toBeVisible(T);
    await form.locator("label", { hasText: "Kuorma myöhässä" }).click(T);
    await form.getByLabel("Kommentti (valinnainen)").fill(`Kuorma jonossa portilla 1 ${tag}`);
    await form.getByRole("button", { name: "Lähetä poikkeama" }).click(T);
    await expect(form.getByRole("status")).toContainText("Poikkeama lähetetty", T);
  });

  await j.step("Katso aluekartta ja portin tiedot", async () => {
    await tab("Aluekartta");
    await h1("Aluekartta");
    const controls = page.getByTestId("map-controls");
    const select = controls.getByLabel("Työmaa");
    const current = await select.locator("option:checked").textContent();
    if (!current?.includes(SITE)) {
      await selectContaining(select, SITE);
      await controls.getByRole("button", { name: "Näytä" }).click(T);
    }
    await expect(page.getByTestId("site-map")).toBeVisible(T);
    await page.getByTestId("map-objects").getByRole("button", { name: /Portti 1/ }).click(T);
    await expect(page.getByTestId("map-object-panel")).toBeVisible(T);
  });

  await j.step("Tee turvallisuushavainto", async () => {
    await go("Työturvallisuus", { group: "Työturvallisuus" });
    await h1("Työturvallisuus");
    await page.getByTestId("hse-quick").getByRole("link", { name: "Turvallisuushavainto" }).click(T);
    await h1("Turvallisuushavainto");
    await page.getByLabel("Aihe", { exact: true }).selectOption({ label: "Järjestys ja siisteys" }, T);
    await page.getByLabel("Mitä havaitsit / tapahtui?").fill(`Palkkien välissä kulkuväylä tukossa ${tag}`);
    await page.getByLabel("Vakavuus", { exact: true }).selectOption({ label: "Kohtalainen" }, T);
    const site = page.getByLabel("Työmaa", { exact: true });
    if (await site.count()) await selectContaining(site, SITE);
    await page.getByLabel("Paikka", { exact: true }).fill("Sulatto, linja 3");
    await page.getByRole("button", { name: "Lähetä ilmoitus" }).click(T);
    await h1(new RegExp(`Palkkien välissä kulkuväylä tukossa ${tag}`));
  });

  await j.step("Lisää tapaturmalle korjaava toimenpide", async () => {
    await go("Työturvallisuus", { group: "Työturvallisuus" });
    await h1("Työturvallisuus");
    const urgent = page.getByTestId("hse-urgent").getByRole("link", { name: /Kaatuminen telineeltä/ });
    if (await urgent.count()) await urgent.first().click(T);
    else await page.getByRole("link", { name: /Kaatuminen telineeltä/ }).first().click(T);
    await h1(/Tapaturma #/);
    await page.getByText("Lisää korjaava toimenpide").click(T);
    const form = page.getByTestId("action-form");
    await form.getByLabel("Toimenpide", { exact: true }).fill(`Telineiden kaiteet lukittaviksi ${tag}`);
    await form.getByLabel("Määräaika", { exact: true }).fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
    await form.getByRole("button", { name: "Luo" }).click(T);
    await expect(page.getByText(`Telineiden kaiteet lukittaviksi ${tag}`)).toBeVisible(T);
  });

  await j.step("Merkitse rotaatioon koulutuspäivä", async () => {
    await go("Rotaatio", { group: "Henkilöstö" });
    await h1("Rotaatio");
    await page.getByRole("group", { name: "Näkymä" }).getByRole("button", { name: "Henkilöt" }).click(T);
    const row = page.locator('[data-person-row*="Pekka"]').first();
    await row.locator("button[data-day]").last().click(T);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible(T);
    await dialog.getByRole("button", { name: "Koulutuksessa" }).click(T);
    await dialog.getByLabel("Lisätieto (valinnainen)").fill(`Nostoturvallisuuskoulutus ${tag}`);
    await dialog.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(page.getByRole("status").filter({ hasText: "merkintä tallennettu" })).toBeVisible(T);
  });

  await j.step("Katso tiimit ja luo uusi tiimi", async () => {
    await go("Tiimit", { group: "Henkilöstö" });
    await h1("Tiimit");
    await expect(page.locator('[data-team="Kaapelitiimi"]')).toBeVisible(T);
    const form = page.getByTestId("team-form");
    if (!(await form.count())) return "Tiimin luonti ei näy työmaapäällikölle (vaatii employee.manage), vaikka rooli kokoaa työryhmät";
    await form.getByLabel("Tiimin nimi").fill(`Asennustiimi ${tag}`);
    await form.getByRole("button", { name: "Luo tiimi" }).click(T);
    await expect(page.locator(`[data-team="Asennustiimi ${tag}"]`)).toBeVisible(T);
  });

  await j.step("Takaisin etusivulle", async () => {
    await go("Etusivu", { mobileLabel: "Etusivu" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(T);
  });

  j.write();
});
