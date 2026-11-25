/**
 * Role journey: Nostovastaava (Lifting Supervisor), Ville Vinssi.
 * Lift plans and their approval, the lifting accessory register and
 * inspections, lift requests in logistics, and the QR scan.
 * Runs on the steel mill demo (scripts/demo-steel-theme.py).
 */
import { expect, test, type Page } from "@playwright/test";
import { COMPANY, Journey, openAs } from "./journey";

const T = { timeout: 8000 };
const SITE = "NSM-001 · Sulatto (EAF)";
const PENDING_LIFT = "Uunimuuntajan nosto perustukselle";
const APPROVED_LIFT = "Nosturiradan palkkien nosto +12 m tasolle";

/** yyyy-mm-dd `days` from today (local time of the test machine). */
function day(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A Playwright section locator by its h2 heading. */
function section(page: Page, title: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });
}

/** Picks the option whose text matches `re` in a native select. */
async function selectMatching(select: ReturnType<Page["locator"]>, re: RegExp) {
  const labels = await select.locator("option").allTextContents();
  const label = labels.find((l) => re.test(l));
  if (!label) throw new Error(`No option matching ${re} (options: ${labels.slice(0, 8).join(" | ")})`);
  await select.selectOption({ label }, T);
}

test("lifting", async ({ browser }, testInfo) => {
  const page = await openAs(browser, testInfo, "lifting");
  const j = new Journey(page, testInfo, "lifting");
  const stamp = Date.now().toString(36).slice(-5).toUpperCase();
  const accCode = `NR-J${stamp}`;
  const liftTitle = `Uunin kuoriosan nosto J${stamp}`;
  const requestTitle = `Kuoriosan nosto, nostopyyntö J${stamp}`;
  const h1 = () => page.getByRole("heading", { level: 1 });

  /** Navigates from the visible menu like a person; returns a note when the item hides under "Lisää". */
  async function go(label: string): Promise<string | void> {
    if (j.mobile) {
      const bar = page.getByTestId("mobile-nav");
      const link = bar.getByRole("link", { name: label, exact: true });
      if (await link.count()) {
        await link.click(T);
        return;
      }
      await bar.getByRole("button", { name: "Lisää" }).click(T);
      await page.getByRole("dialog").getByRole("link", { name: label, exact: true }).click(T);
      return `"${label}" löytyi vasta Lisää-valikon kautta`;
    }
    const aside = page.locator("aside");
    const link = aside.getByRole("link", { name: label, exact: true });
    if (!(await link.isVisible())) await aside.getByRole("button", { name: "Tuotannonohjaus" }).click(T);
    await link.click(T);
  }

  /** Chooses the demo site with the GET picker ("Työmaa" + "Näytä"). */
  async function pickSite(): Promise<string | void> {
    const picker = page.getByTestId("site-day-picker");
    const select = picker.getByLabel("Työmaa");
    const current = await select.locator("option:checked").textContent();
    if (current?.trim() === SITE) return;
    await select.selectOption({ label: SITE }, T);
    await picker.getByRole("button", { name: "Näytä" }).click(T);
    await expect(page).toHaveURL(/site=/, T);
    return "Oletustyömaa ei ollut oma nostotyömaa, työmaa piti valita ja painaa Näytä";
  }

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(h1()).toBeVisible(T);
  });

  await j.step("Avaa Nostot valikosta", async () => {
    const note = await go("Nostot");
    await expect(h1()).toHaveText("Nostot", T);
    return note;
  });

  await j.step("Valitse työmaa Sulatto (EAF)", async () => {
    const note = await pickSite();
    await expect(section(page, "Tulevat nostot").getByRole("link", { name: new RegExp(PENDING_LIFT) })).toBeVisible(T);
    return note;
  });

  await j.step("Avaa nostoapuvälinerekisteri", async () => {
    await page.getByRole("link", { name: "Nostoapuvälineet" }).click(T);
    await expect(h1()).toHaveText("Nostoapuvälineet", T);
    await expect(section(page, "Rekisteri").getByRole("link", { name: /KE-003/ })).toContainText("Tarkastus erääntynyt", T);
  });

  await j.step("Lisää uusi raksi rekisteriin", async () => {
    const form = section(page, "Uusi nostoapuväline");
    await form.getByLabel("Tunnus", { exact: true }).fill(accCode, T);
    await form.getByLabel("Nimi", { exact: true }).fill("Nostoraksi 5 t / 6 m (journey)", T);
    await form.getByLabel("Tyyppi", { exact: true }).selectOption({ label: "Raksi" }, T);
    await form.getByLabel("Käyttökuorma WLL (kg)").fill("5000", T);
    await form.getByLabel("Seuraava tarkastus").fill(day(180), T);
    await form.getByLabel("Valmistaja").fill("Raksi Demo Oy", T);
    await form.getByRole("button", { name: "Lisää rekisteriin" }).click(T);
    await expect(section(page, "Rekisteri").getByRole("link", { name: new RegExp(accCode) })).toBeVisible(T);
  });

  await j.step("Kirjaa raksin tarkastus (uusi tarkastuspäivä)", async () => {
    await section(page, "Rekisteri").getByRole("link", { name: new RegExp(accCode) }).click(T);
    await expect(h1()).toContainText(accCode, T);
    const form = section(page, "Muokkaa");
    await form.getByLabel("Seuraava tarkastus").fill(day(365), T);
    await form.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(form.getByRole("status")).toHaveText("Tallennettu", T);
    return "Tarkastusta ei voi kirjata omana tapahtumanaan (päivä, tarkastaja, tulos); vain seuraavan tarkastuksen päivää muutetaan muokkauslomakkeella";
  });

  await j.step("Skannaa apuvälineen QR-koodi (kirjoitettu tunnus)", async () => {
    const note = await go("Materiaalit");
    await expect(h1()).toHaveText("Materiaalit", T);
    await page.getByRole("link", { name: "Skannaa QR" }).click(T);
    await expect(h1()).toHaveText("Skannaa QR", T);
    const form = section(page, "Kirjoita tunnus");
    await form.getByLabel("Tunnus").fill(accCode.toLowerCase(), T);
    await form.getByRole("button", { name: "Avaa" }).click(T);
    await expect(h1()).toContainText(accCode, T);
    return note;
  });

  await j.step("Avaa hyväksytty nosto ja sen nostopyyntö", async () => {
    const note = await go("Nostot");
    await expect(h1()).toHaveText("Nostot", T);
    const siteNote = await pickSite();
    await section(page, "Tulevat nostot").getByRole("link", { name: new RegExp(APPROVED_LIFT.replace(/[+]/g, "\\+")) }).click(T);
    await expect(h1()).toHaveText(APPROVED_LIFT, T);
    await expect(page.getByTestId("lift-approved-by")).toContainText("Ville Vinssi", T);
    await section(page, "Nosto").getByRole("link", { name: APPROVED_LIFT }).click(T);
    await expect(page.getByRole("heading", { level: 2, name: "Logistiikkapyyntö" })).toBeVisible(T);
    await expect(section(page, "Logistiikkapyyntö")).toContainText("Nostoapuvälineet", T);
    return [note, siteNote].filter(Boolean).join("; ") || undefined;
  });

  await j.step("Avaa logistiikkataulu valikosta", async () => {
    const note = await go("Logistiikka");
    await expect(h1()).toHaveText("Logistiikkataulu", T);
    const siteNote = await pickSite();
    await expect(page.getByRole("heading", { level: 2, name: "Logistiikkapyynnöt" })).toBeVisible(T);
    return [note, siteNote].filter(Boolean).join("; ") || undefined;
  });

  await j.step("Tee nostopyyntö logistiikalle", async () => {
    const form = section(page, "Logistiikkapyynnöt");
    await form.getByLabel("Palvelu").selectOption({ label: "Nosto" }, T);
    await form.getByLabel("Otsikko").fill(requestTitle, T);
    await form.getByLabel("Alkaa").fill(`${day(2)}T08:00`, T);
    await form.getByLabel("Arvioitu lopetus").fill(`${day(2)}T10:00`, T);
    await form.getByLabel("Raskain kappale (kg)").fill("2000", T);
    await form.getByLabel("Kuorman kuvaus").fill("Uunin kuoriosa, 2 t", T);
    await form.getByLabel("Nostosäde (m)").fill("18", T);
    await form.getByLabel("Riggerit (hlö)").fill("2", T);
    await form.getByLabel("Nostoapuvälineet").fill(`${accCode} raksi 5 t, taglinet`, T);
    await form.getByLabel("Puhelin").fill("+358 40 000 0000", T);
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click(T);
    await expect(h1()).toHaveText(requestTitle, T);
    await expect(section(page, "Logistiikkapyyntö")).toContainText("Nostosäde (m)", T);
  });

  await j.step("Luo uusi nostosuunnitelma", async () => {
    const note = await go("Nostot");
    await expect(h1()).toHaveText("Nostot", T);
    const siteNote = await pickSite();
    const form = section(page, "Uusi nosto");
    await form.getByRole("textbox", { name: "Nosto", exact: true }).fill(liftTitle, T);
    await form.getByLabel("Alkaa").fill(`${day(2)}T08:00`, T);
    await form.getByLabel("Päättyy").fill(`${day(2)}T10:00`, T);
    await form.getByLabel("Takt-tehtävä").selectOption({ index: 1 }, T);
    await form.getByRole("button", { name: "Luo nostosuunnitelma" }).click(T);
    await expect(h1()).toHaveText(liftTitle, T);
    const requests = await page.getByLabel("Nostopyyntö (logistiikka)").count();
    return [note, siteNote, requests === 0 ? "Juuri tehtyä nostopyyntöä ei voi liittää suunnitelmaan ennen kuin logistiikka hyväksyy sen" : null].filter(Boolean).join("; ") || undefined;
  });

  await j.step("Täytä kuorma, nosturi ja nostoalue", async () => {
    const draft = section(page, "Luonnos v1");
    await draft.getByLabel("Kuorma", { exact: true }).fill("Uunin kuoriosa, nostokorvat valmiina", T);
    await draft.getByLabel("Kuorman paino (kg)").fill("2000", T);
    await draft.getByLabel("Nostovälineiden paino (kg)").fill("300", T);
    await selectMatching(draft.getByLabel("Nosturi", { exact: true }), /^EQ-001/);
    await draft.getByLabel("Säde (m)").fill("18", T);
    await draft.getByLabel("Kapasiteetti säteellä (kg)").fill("5000", T);
    await draft.getByLabel("Turvaetäisyys (m)").fill("6", T);
    await draft.getByLabel("Painopiste").fill("Painopiste merkitty kuoriosaan", T);
    await draft.getByLabel("Nostoalue ja eristys").fill("Nostoalue aidattu linjalla 2, liikenne ohjattu portille 1", T);
    await selectMatching(draft.getByLabel("Riskiarvio (asiakirja)"), /RAMS/);
    await draft.getByRole("button", { name: "Tallenna" }).first().click(T);
    await expect(draft.getByRole("status")).toHaveText("Tallennettu", T);
  });

  await j.step("Lisää oma raksi nostoon", async () => {
    const acc = page.getByTestId("lift-accessory-form");
    await selectMatching(acc.getByLabel("Nostoapuväline"), new RegExp(`^${accCode} `));
    await acc.getByLabel("Määrä").fill("1", T);
    await acc.getByRole("button", { name: "Lisää apuväline" }).click(T);
    await expect(page.getByTestId("lift-accessories")).toContainText(accCode, T);
  });

  await j.step("Tarkista nostosuunnitelman tarkistukset", async () => {
    const checks = section(page, "Tarkistukset");
    await expect(checks).toContainText("Ei huomautettavaa", T);
  });

  await j.step("Lähetä oma suunnitelma hyväksyttäväksi", async () => {
    await page.getByRole("button", { name: "Lähetä hyväksyttäväksi" }).click(T);
    await expect(page.getByRole("heading", { level: 2, name: "Hyväksyttävänä v1" })).toBeVisible(T);
    await expect(page.getByText("Olet laatinut tai lähettänyt tämän suunnitelman")).toBeVisible(T);
    return "Nostovastaava ei voi hyväksyä omaa suunnitelmaansa: tarvitaan toinen nostovastaava, toimitusjohtaja tai projektijohtaja";
  });

  await j.step("Avaa hyväksyntää odottava nosto", async () => {
    await page.getByRole("link", { name: "Nostot", exact: true }).first().click(T);
    await expect(h1()).toHaveText("Nostot", T);
    const note = await pickSite();
    await section(page, "Tulevat nostot").getByRole("link", { name: new RegExp(PENDING_LIFT) }).click(T);
    await expect(h1()).toHaveText(PENDING_LIFT, T);
    await expect(page.getByRole("heading", { level: 2, name: "Hyväksyttävänä v1" })).toBeVisible(T);
    return note;
  });

  await j.step("Lue tarkistukset ja varoitukset", async () => {
    const checks = section(page, "Tarkistukset");
    await expect(checks.getByText(/Käyttöaste .* lähellä kapasiteettia/)).toBeVisible(T);
    await expect(section(page, "Hyväksyttävänä v1")).toContainText("Kokonaiskuorma", T);
  });

  await j.step("Hyväksy nostosuunnitelma varoitukset kuitaten", async () => {
    const decision = page.getByTestId("lift-decision-form");
    await decision.getByLabel("Perustelu / huomautus").fill("Tuulirajat 8 m/s, merkinantaja paikalla, käyttöaste tarkistettu", T);
    await decision.getByLabel("Olen lukenut varoitukset").check(T);
    await decision.getByRole("button", { name: "Hyväksy nostosuunnitelma" }).click(T);
    await expect(page.getByRole("heading", { level: 2, name: "Hyväksytty suunnitelma v1" })).toBeVisible(T);
    await expect(page.getByTestId("lift-approved-by")).toContainText("Ville Vinssi", T);
  });

  await j.step("Tarkista nostoryhmän varaukset", async () => {
    const crew = section(page, "Nostoryhmä (varaukset)");
    await expect(crew).toBeVisible(T);
    const canBook = await crew.getByRole("button", { name: "Varaa nostoryhmä" }).count();
    if (!canBook) return "Nostovastaava ei voi itse varata nostoryhmää hyväksymälleen nostolle";
  });

  await j.step("Katso nostot tuotannon kalenterista", async () => {
    const note = await go("Logistiikka");
    await expect(h1()).toHaveText("Logistiikkataulu", T);
    await page.getByRole("link", { name: "Kalenteri", exact: true }).click(T);
    await expect(h1()).toBeVisible(T);
    await expect(page).toHaveURL(/logistics\/calendar/, T);
    return note;
  });

  j.write();
});
