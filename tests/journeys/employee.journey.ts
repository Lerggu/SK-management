/**
 * Journey: Työntekijä (Employee) – Timo Tyyppi, asentaja työmaalla puhelimella.
 * Etusivun "Tänään", omat tunnit ja viikon lähetys, oma henkilökortti
 * (kortit, perehdytykset), turvallisuushavainto ja avustaja.
 */
import { expect, test } from "@playwright/test";
import { COMPANY, Journey, openAs, lbl } from "./journey";

const T = { timeout: 8000 };

test("employee", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const page = await openAs(browser, testInfo, "employee");
  const j = new Journey(page, testInfo, "employee");
  const stamp = Date.now();
  const hoursNote = `Nosturiradan kiinnikkeet ${stamp}`;
  const overtimeNote = `Ylityö palkkien nosto ${stamp}`;
  const cardName = `Tulityökortti ${stamp}`;
  const observationTitle = `Kulkuväylä tukossa linjalla 3 ${stamp}`;
  const helsinkiDate = (addYears = 0) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + addYears);
    return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Helsinki" });
  };
  const h1 = (name: string | RegExp) => page.getByRole("heading", { level: 1, name });

  /** Opens a page from the visible menu: bottom bar or "Lisää" on phones, sidebar on desktop. Returns where it was found. */
  async function openMenu(item: string, group?: string): Promise<"bar" | "more" | "sidebar"> {
    if (j.mobile) {
      const direct = page.getByTestId("mobile-nav").getByRole("link", { name: item, exact: true });
      if ((await direct.count()) > 0) {
        await direct.click(T);
        return "bar";
      }
      await page.getByTestId("mobile-more").click(T);
      await page.getByRole("dialog").getByRole("link", { name: item, exact: true }).click(T);
      return "more";
    }
    const side = page.locator("aside nav");
    if (group) {
      const toggle = side.getByRole("button", { name: group });
      if ((await toggle.getAttribute("aria-expanded", T)) !== "true") await toggle.click(T);
    }
    await side.getByRole("link", { name: item, exact: true }).click(T);
    return "sidebar";
  }

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(h1(/Tervetuloa/)).toBeVisible(T);
  });

  await j.step("Katso tämän päivän tilanne etusivulta", async () => {
    const today = page.getByTestId("today");
    await expect(today.getByRole("heading", { name: "Tänään" })).toBeVisible(T);
    await expect(today.getByRole("link", { name: /Kirjaa tunnit/ })).toBeVisible(T);
    if ((await today.getByText(/Omat tunnit tänään/).count()) === 0) return "Etusivu ei näytä tämän päivän omia tunteja";
  });

  await j.step("Avaa tunnit etusivun Kirjaa tunnit -napista", async () => {
    await page.getByTestId("today").getByRole("link", { name: /Kirjaa tunnit/ }).click(T);
    await expect(h1("Tunnit")).toBeVisible(T);
  });

  await j.step("Kirjaa 8 h tunnit pikavalinnalla", async () => {
    await page.getByLabel(lbl("Projekti")).selectOption({ label: "NSM-001 › Sulatto (EAF)" }, T);
    await expect(page.getByLabel("Päivä")).toHaveValue(helsinkiDate(), T);
    await page.getByRole("group", { name: "Pikavalinta" }).getByRole("button", { name: "8 h" }).click(T);
    await expect(page.getByLabel(lbl("Tunnit"))).toHaveValue("8", T);
    await page.getByLabel("Muistiinpano").fill(hoursNote, T);
    await page.getByRole("button", { name: "Kirjaa tunnit" }).click(T);
    await expect(page.getByRole("status").filter({ hasText: "Tallennettu" })).toBeVisible(T);
    await expect(page.getByTestId("week-entries").getByText(hoursNote)).toBeVisible(T);
  });

  await j.step("Kirjaa ylityö alku- ja loppuajalla", async () => {
    await page.getByLabel(lbl("Projekti")).selectOption({ label: "NSM-001 › Sulatto (EAF)" }, T);
    await page.getByLabel(lbl("Tunnit")).fill("", T);
    await page.getByText("…tai anna alku- ja loppuaika").click(T);
    await page.getByLabel("Alkoi").fill("15:30", T);
    await page.getByLabel("Päättyi").fill("17:00", T);
    await page.getByLabel("Työaika").selectOption({ label: "Ylityö 50 %" }, T);
    await page.getByLabel("Muistiinpano").fill(overtimeNote, T);
    await page.getByRole("button", { name: "Kirjaa tunnit" }).click(T);
    const entry = page.getByTestId("week-entries").locator("li[data-status]", { hasText: overtimeNote });
    await expect(entry).toBeVisible(T);
    await expect(entry).toContainText("1,5 h", T);
    return "Alku- ja loppuaika on piilossa avattavan rivin takana; ylityölle pitää lisäksi vaihtaa Työaika-valinta";
  });

  await j.step("Tarkista viikon tunnit", async () => {
    await expect(page.getByRole("heading", { name: /Viikko yhteensä/ })).toBeVisible(T);
    await expect(page.getByTestId("week-entries").locator("li[data-status]", { hasText: hoursNote })).toHaveAttribute("data-status", "DRAFT", T);
  });

  await j.step("Lähetä viikko hyväksyttäväksi", async () => {
    await page.getByRole("button", { name: "Lähetä viikko hyväksyttäväksi" }).click(T);
    const entry = page.getByTestId("week-entries").locator("li[data-status]", { hasText: hoursNote });
    await expect(entry).toHaveAttribute("data-status", "SUBMITTED", T);
    await expect(entry).toContainText("Lähetetty", T);
  });

  await j.step("Avaa oma henkilökortti", async () => {
    const where = await openMenu("Oma kortti", "Henkilöstö");
    await expect(h1(/Timo Tyyppi/)).toBeVisible(T);
    if (where === "more") return "Oma kortti löytyi vasta Lisää-valikon kautta";
  });

  await j.step("Katso omat kortit ja pätevyydet", async () => {
    await page.getByRole("navigation", { name: "Henkilöstökortti" }).getByRole("link", { name: "Pätevyydet" }).click(T);
    await expect(page.getByRole("heading", { name: "Kortit ja pätevyydet" })).toBeVisible(T);
  });

  await j.step("Lisää oma tulityökortti", async () => {
    const add = page.getByTestId("add-qualification");
    await add.getByText("Lisää kortti tai pätevyys").click(T);
    await add.getByLabel("Kortin tai pätevyyden nimi").fill(cardName, T);
    await add.getByLabel("Myöntäjä").fill("SPEK", T);
    await add.getByLabel("Myöntämispäivä").fill(helsinkiDate(), T);
    await add.getByLabel("Viimeinen voimassaolopäivä").fill(helsinkiDate(5), T);
    await add.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(page.getByTestId("qualification-list").getByText(cardName)).toBeVisible(T);
  });

  await j.step("Katso perehdytykset", async () => {
    await expect(page.getByRole("heading", { name: "Perehdytykset" })).toBeVisible(T);
    await expect(page.getByText("Työmaaperehdytys").first()).toBeVisible(T);
  });

  await j.step("Kuittaa perehdytys", async () => {
    const ack = page.getByRole("button", { name: "Kuittaa perehdytys" });
    const before = await ack.count();
    if (before === 0) return "Ei kuitattavia perehdytyksiä (kuitattu jo aiemmassa ajossa)";
    await ack.first().click(T);
    await expect(ack).toHaveCount(before - 1, T);
    await expect(page.getByText(/Työntekijä kuitannut/).first()).toBeVisible(T);
  });

  await j.step("Avaa työturvallisuus", async () => {
    const where = await openMenu("Työturvallisuus");
    await expect(h1("Työturvallisuus")).toBeVisible(T);
    if (where === "more") return "Työturvallisuus löytyi vasta Lisää-valikon kautta";
  });

  await j.step("Aloita turvallisuushavainto", async () => {
    await page.getByTestId("hse-quick").getByRole("link", { name: "Turvallisuushavainto" }).click(T);
    await expect(h1("Turvallisuushavainto")).toBeVisible(T);
    await expect(page.getByRole("heading", { name: /NSM-001/ })).toBeVisible(T);
  });

  await j.step("Tee turvallisuushavainto tukossa olevasta kulkuväylästä", async () => {
    const form = page.getByTestId("observation-form");
    await expect(form.getByLabel("Ilmoituksen tyyppi")).toHaveValue("SAFETY_OBSERVATION", T);
    await form.getByLabel("Aihe").selectOption({ label: "Järjestys ja siisteys" }, T);
    await form.getByLabel("Mitä havaitsit / tapahtui?").fill(observationTitle, T);
    await form.getByLabel("Vakavuus").selectOption({ label: "Kohtalainen" }, T);
    await form.getByLabel("Työmaa").selectOption({ label: "Sulatto (EAF)" }, T);
    await form.getByLabel("Paikka").fill("Linja 3, itäpääty", T);
    await form.getByLabel("Kuvaus").fill("Teräspalkkeja kulkuväylällä, kiertotie ei merkitty.", T);
    await form.getByRole("button", { name: "Lähetä ilmoitus" }).click(T);
    await expect(h1(observationTitle)).toBeVisible(T);
  });

  await j.step("Näe oma havainto työturvallisuuden listalla", async () => {
    await page.getByRole("main").getByRole("link", { name: "Työturvallisuus" }).click(T);
    await expect(h1("Työturvallisuus")).toBeVisible(T);
    await expect(page.getByText(observationTitle)).toBeVisible(T);
  });

  await j.step("Avaa avustaja", async () => {
    const button = page.getByTestId("assistant-button");
    if ((await button.count()) === 0) {
      // No visible way in: try the page directly to see what the user would get.
      await page.goto(`${COMPANY}/assistant`);
      await expect(h1("Avustaja")).toBeVisible(T);
      if ((await page.getByText("Avustaja vaatii tekoälyn käyttöoikeuden.").count()) > 0) {
        return "Avustaja-painiketta ei näy, ja suoraan avattuna sivu sanoo 'Avustaja vaatii tekoälyn käyttöoikeuden.' (Työntekijä-roolilla ei ole ai.use-oikeutta)";
      }
      return "Avustaja-painiketta ei näy; sivu löytyi vain suoralla osoitteella";
    }
    await button.click(T);
    await expect(h1("Avustaja")).toBeVisible(T);
  });

  await j.step("Pyydä avustajaa kirjaamaan tunnit", async () => {
    const input = page.getByLabel("Kirjoita tai paina mikrofonia");
    if ((await input.count()) === 0) return "Avustaja ei ole käytettävissä tälle roolille";
    if ((await page.getByText("Tekoäly ei ole käytössä tässä ympäristössä.").count()) > 0) return "Tekoäly ei ole käytössä tässä ympäristössä";
    await input.fill("Kirjaa minulle huomiselle 8 tuntia Sulattoon", T);
    await page.getByRole("button", { name: "Lähetä" }).click(T);
    // Do not confirm: the assistant only proposes; a person confirms.
    await expect(page.getByRole("button", { name: "Vahvista" }).first().or(page.getByText(/ei saanut vastausta/))).toBeVisible({ timeout: 30_000 });
  });

  await j.step("Palaa etusivulle ja tarkista päivän tunnit", async () => {
    await openMenu("Etusivu");
    await expect(h1(/Tervetuloa/)).toBeVisible(T);
    await expect(page.getByTestId("today").getByText(/Omat tunnit tänään/)).toBeVisible(T);
  });

  j.write();
});
